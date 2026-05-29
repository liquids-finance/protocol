# Liquids.finance

> **Pool-native lending on Uniswap V4.** Each registered pool *is* its own isolated lending market — LPs earn swap fees **plus** lending interest from the same dollar of capital, borrowers post their LP shares as collateral and draw the pool's stable side.

**OKX Build X Hackathon — Hook Edition** · X Layer mainnet · _DEMO BUILD — UNAUDITED — DO NOT USE WITH REAL FUNDS_

---

## Why

Aave + Uniswap is the standard DeFi composition: deposit on Uniswap for swap fees, deposit on Aave for lending interest. **Same dollar, two protocols, half the capital efficiency.** Liquidsfi collapses both into a single Uniswap V4 hook so LPs earn both yields on the same position, and borrowers use their V4 LP directly as collateral instead of a wrapped derivative.

## Core ideas

- **Aggregate vault per pool.** Hook is the V4 position owner, LPs receive an ERC20 share token (factory pattern à la Aave's aTokens).
- **Morpho Blue style permissionless market creation.** Anyone calls `createPool(key, sqrtPrice, oracle0, oracle1, borrowCurrencyIndex)` — risk is isolated per pool.
- **Unified vault liquidation (no V4 swap).** Burning the borrower's shares while cancelling their debt is an O(1) accounting move; the V4 position is untouched. No slippage, no MEV cascade.
- **Manipulation-resistant valuation.** Fair-value formula `V = 2 * L * sqrt(P0 * P1)` uses oracle prices only, never spot. A pool dump cannot move HF or share value.
- **Aggressive re-add on repay.** No idle balances — repaid stables are swapped half-and-half and re-added to V4 immediately. Dual yield property preserved.
- **Uniswap Permit2 wrappers.** `supplyWithPermit2` and `repayWithPermit2` accept signed Permit2 payloads so users skip the separate ERC20 approve tx. Pulls land directly into the hook; signature semantics enforced by the canonical Permit2 deployment (same address on every EVM chain).
- **Periphery Lens with projected views.** All read-only queries (debt, health factor, share value, APYs, utilization) live on `LiquidsLensDemo` — frees the hook's bytecode budget and returns **forward-projected** values so UIs see live interest growth without forcing a write op.
- **Demo guardrails on-chain.** `VERSION`, `WARNING`, `DeployedForHackathon` event, owner `pause()`, "DEMO" prefix in the share token name — visible to any wallet or block explorer.

## Risk parameters (MVP)

| Knob | Value | Notes |
|---|---|---|
| Max LTV | 60% | Borrow caps at 60% of collateral USD value |
| Liquidation HF threshold | 1.15 | 15% buffer above underwater, protocol gets a clean exit |
| Liquidator finder fee | 0.5% | Paid as shares from the burned collateral |
| Interest curve | base 1%, slope1 6%, slope2 100%, kink U=70% | Aave-style two-slope |
| Reserve factor | 0% | All lending interest flows back to LPs |
| Oracle staleness max | 26 hours | Sized for X Layer Chainlink's 24h heartbeat + 2h buffer; V2 makes this per-pool |
| First-deposit dust shares | 1000 → `DEAD_ADDRESS` | Uniswap V2 inflation-attack mitigation |

## Architecture

```
                  ┌────────────────────────────────────────┐
                  │     Uniswap V4 PoolManager             │
                  │  (X Layer mainnet, official deployment)│
                  └───────────────┬────────────────────────┘
                                  │  V4 IHooks
                                  │
            ┌─────────────────────▼─────────────────────────┐
            │  LiquidsHookDemo (singleton, magic CREATE2)   │
            │  WRITE PATH — 24,301 / 24,576 bytecode bytes   │
            │                                                │
            │  • beforeInitialize / beforeAdd / beforeRemove │
            │    / afterSwap                                 │
            │  • createPool, supply, withdraw, borrow,       │
            │    repay, liquidate                            │
            │  • supplyWithPermit2, repayWithPermit2         │
            │  • pause / unpause (onlyOwner)                 │
            │  • view: only hasOpenDebt (used by share-token │
            │    transfer guard)                             │
            │                                                │
            │  state: configs[poolId], vaults[poolId],       │
            │         debts[poolId][user]                    │
            └─────┬──────────────────┬───────────────┬──────┘
                  │ deploys per pool │ uses          │ all reads
                  ▼                  ▼               ▼
    ┌─────────────────────────┐ ┌──────────────┐ ┌─────────────────────────┐
    │ LiquidsDemoShareToken   │ │  IPriceFeed  │ │ LiquidsLensDemo         │
    │ (per-pool ERC20)        │ │ (Chainlink)  │ │ READ PATH — periphery   │
    │ • mint/burn onlyHook    │ │ • oracle0,   │ │                         │
    │ • transfer-lock-on-debt │ │   oracle1    │ │ • debtOf / healthFactor │
    └─────────────────────────┘ └──────────────┘ │   /shareValue/totalAssets│
                                                 │ • utilization/borrowAPY  │
            ┌──────────────────────────────┐     │   /lendingAPY            │
            │ Uniswap Permit2 (canonical)  │     │ • projected to now —     │
            │ 0x...22D4... (every chain)   │     │   no write tx required   │
            │ • SignatureTransfer subset   │     │ • debtOfRaw, borrowIndex,│
            │   used by supply/repay       │     │   projectedBorrowIndex   │
            │   Permit2 wrappers           │     └─────────────────────────┘
            └──────────────────────────────┘
```

Helper libraries (compile-time inlined into the hook):

- `BaseHook.sol` — abstract IHooks with reverting defaults + `onlyPoolManager` + address-bits validation
- `InterestRateModel.sol` — kink-curve borrow rate + linear accrual primitives
- `PositionValue.sol` — fair-value USD valuation of a full-range V4 position
- `HookMiner.sol` (test/script only) — brute-force CREATE2 salt finder for the magic address
- `IPermit2.sol` — minimal `ISignatureTransfer` interface for the canonical Permit2 deployment

### Lens design rationale

The Lens isn't just a bytecode-budget workaround — it actively improves UX. The hook's `borrowIndex` only updates on write ops; between writes, on-chain debt + APYs are stale by the elapsed time. The Lens forward-projects `borrowIndex` to `block.timestamp` using the exact same kink rate model the hook would apply on the next write, so:

- `lens.debtOf(...)` returns the **current** debt including unsettled interest, no write tx required.
- `lens.healthFactor(...)` decays in real time as interest accrues — surfaces liquidation risk live.
- After any write, `hook.vaults(pid).borrowIndex` will equal the Lens's pre-write `projectedBorrowIndex` exactly (tested in `LiquidsLens.t.sol`).
- For tests that want pre-projection semantics, the Lens also exposes `debtOfRaw` and `borrowIndex(...)`.

## Tech stack

| Layer | Choice |
|---|---|
| Smart contracts | Solidity 0.8.26, Foundry |
| V4 protocol | `@uniswap/v4-core`, `@uniswap/v4-periphery` |
| Standard libs | OpenZeppelin (`ERC20`, `Ownable`, `Pausable`, `ReentrancyGuardTransient`, `SafeERC20`, `Math`) |
| Compiler | `via_ir = true`, `optimizer_runs = 1`, `bytecode_hash = "none"`, `evm_version = "cancun"` |
| Tests | Foundry, fully local V4 deployment (no fork required) |

## Test coverage

```
90 tests passing across 9 suites — total 89.09% line coverage / 88.93% statement coverage
                                   hook 91.20% lines, lens 97.83% lines

LiquidsHook.t.sol            —  9 tests  lifecycle:     createPool → supply → borrow → repay → withdraw
LiquidsHookLiquidation.t.sol —  4 tests  liquidation:   healthy reject / no debt / underwater / LP benefit
LiquidsHookInterest.t.sol    —  4 tests  accrual:       1y growth / idempotent / U-rate / lendingAPY relation
LiquidsHookGuards.t.sol      — 12 tests  guards:        transfer lock / pause states / onlyOwner
LiquidsHookValidation.t.sol  — 17 tests  validation:    zero amounts / unregistered / slippage
LiquidsHookSecurity.t.sol    — 13 tests  security:      callback ACL / direct V4 bypass / oracle stale|invalid
LiquidsHookExploits.t.sol    — 10 tests  exploits:      inflation / donation / multi-borrower / multi-pool / HF boundary
LiquidsHookPermit2.t.sol     — 11 tests  permit2:       happy paths / batch+token mismatch / over-permit / deadline
LiquidsLens.t.sol            — 10 tests  lens:          projection accuracy / raw vs projected / constants / HF decay
```

Run them:

```bash
cd packages/contracts
forge test
forge coverage --report summary --ir-minimum
```

## Bytecode budget

```
LiquidsHookDemo runtime:  24,301 bytes / 24,576 limit (98.9% used, 275 byte headroom)
LiquidsLensDemo runtime:   5,428 bytes (24KB budget — plenty of room)
LiquidsDemoShareToken:     2,280 bytes (plenty of room)
```

Hook is tight because of the Permit2 wrappers (batch + single permit variants with full
validation) and the V4 unlock-callback dispatcher. View functions live on the Lens to free
hook room — see "Lens design rationale" above.

## Quickstart

```bash
git clone https://github.com/<you>/liquidsfi && cd liquidsfi
cd packages/contracts
forge install
forge build
forge test
```

## Deployment

Three-stage broadcast — preflight → core contracts → demo pool. All env values live in
`packages/contracts/.env` (copy from `.env.example`).

```bash
cd packages/contracts
cp .env.example .env          # fill in PRIVATE_KEY + OKLINK_API_KEY locally

# Stage 0: preflight (read-only sanity checks on every address + oracle freshness)
forge script script/Preflight.s.sol:Preflight --rpc-url x_layer_mainnet

# Stage 1: hook (CREATE2 mined) + lens
forge script script/DeployCore.s.sol:DeployCore --rpc-url x_layer_mainnet --broadcast
# Copy the printed hook address into .env (HOOK=0x...)

# Stage 2: register the demo xETH/USDT0 market
forge script script/CreateDemoPool.s.sol:CreateDemoPool --rpc-url x_layer_mainnet --broadcast
```

`DeployCore` soft-checks Permit2 presence at the canonical address
(`0x000000000022D473030F116dDEE9F6B43aC78BA3`). If absent on X Layer, classic
ERC20-approve supply/repay still work; only the Permit2 wrappers would revert.

### Source verification on OKLink

OKLink's Etherscan-compat plugin endpoint **does not require an API key** (verified against the
official X Layer Foundry-verify docs). chainShortName for X Layer mainnet is `XLAYER`.

The `[etherscan]` block in `foundry.toml` doesn't always get matched by Foundry's chain-id lookup,
so pass `--verifier-url` explicitly on the CLI to be safe:

```bash
OKLINK_URL="https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER"

# 1) LiquidsHookDemo — single address constructor arg (V4 PoolManager).
forge verify-contract \
    <HOOK_ADDRESS> src/LiquidsHook.sol:LiquidsHookDemo \
    --chain 196 --verifier oklink --verifier-url "$OKLINK_URL" --watch \
    --constructor-args $(cast abi-encode "constructor(address)" $V4_POOL_MANAGER)

# 2) LiquidsLensDemo — single address constructor arg (hook).
forge verify-contract \
    <LENS_ADDRESS> src/LiquidsLens.sol:LiquidsLensDemo \
    --chain 196 --verifier oklink --verifier-url "$OKLINK_URL" --watch \
    --constructor-args $(cast abi-encode "constructor(address)" $HOOK)

# 3) LiquidsDemoShareToken — deployed by hook.createPool(). The CreateDemoPool script prints
#    its exact name, symbol and poolId in the "For OKLink verify of LiquidsDemoShareToken"
#    block; copy those values into the constructor-args below.
forge verify-contract \
    <SHARE_TOKEN_ADDRESS> src/LiquidsShareToken.sol:LiquidsDemoShareToken \
    --chain 196 --verifier oklink --verifier-url "$OKLINK_URL" --watch \
    --constructor-args $(cast abi-encode "constructor(string,string,bytes32)" \
        "<NAME from CreateDemoPool log>" \
        "<SYMBOL from CreateDemoPool log>" \
        <POOL_ID from CreateDemoPool log>)
```

For testnet, swap `XLAYER` → `XLAYER_TESTNET` in `$OKLINK_URL` and use `--chain 195`.

## Deployed addresses (X Layer mainnet)

Live and source-verified on OKLink:

| Contract | Address | Explorer |
|---|---|---|
| LiquidsHookDemo | `0x7DEfe0E1617F4ce2f147828CA8D9EDbd525F6a40` | [oklink](https://www.oklink.com/x-layer/address/0x7DEfe0E1617F4ce2f147828CA8D9EDbd525F6a40) |
| LiquidsLensDemo | `0xaab403f8e9B6c0c9A254C2fa5D6038E83C44b94e` | [oklink](https://www.oklink.com/x-layer/address/0xaab403f8e9B6c0c9A254C2fa5D6038E83C44b94e) |
| LiquidsDemoShareToken (USDT0 / xETH) | `0x0d80882f1C2F891E5F056e8db5EcBbe92dC43c24` | [oklink](https://www.oklink.com/x-layer/address/0x0d80882f1C2F891E5F056e8db5EcBbe92dC43c24) |
| Demo pool — currency0 (USDT0) | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | — |
| Demo pool — currency1 (xETH) | `0xE7B000003A45145decf8a28FC755aD5eC5EA025A` | — |
| Demo pool — oracle (USDT/USD) | `0x673b428Fd1df93a6F77fA7ea1F8eeD8A4Ff36b9f` | — |
| Demo pool — oracle (ETH/USD) | `0x8b85b50535551F8E8cDAF78dA235b5Cf1005907b` | — |
| Demo pool ID | `0x60ecbd1477b335ddd1a8c3b45cdb5f6837fddd8b239d1ca714f68dabd9947e9b` | — |
| Demo pool key | `(USDT0, xETH, fee=500, tickSpacing=10, hooks=LiquidsHook, borrowCurrencyIndex=0)` | — |
| V4 PoolManager (X Layer) | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | — |
| Uniswap Permit2 (canonical) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | — |

## Demo flow

1. Visit the frontend, see the prominent DEMO warning banner.
2. Connect wallet to X Layer mainnet.
3. Pool stats: TVL, utilization, borrow APY, lending APY.
4. Supply 1 xETH + 2000 USDT0 → receive `lqfDEMO-XETH-USDT0` share tokens.
5. Borrow 1000 USDT0 against the shares — health factor and LTV update live.
6. Repay → debt clears, share transfer guard releases.
7. Withdraw → tokens returned, position closed.
8. (Bonus) Tank ETH via oracle and trigger a liquidation via `cast`.

## Security posture

We tested for:

- ✅ Reentrancy: `ReentrancyGuardTransient` on every user entrypoint, all hook callbacks `onlyPoolManager`-gated
- ✅ Inflation attack: `MIN_LIQUIDITY_SHARES` burn to `DEAD_ADDRESS`, `totalAssetsWad` ignores raw token balance
- ✅ Donation attack: confirmed neutral on `shareValue` and `totalAssets`
- ✅ Oracle manipulation: fair-value `2*L*sqrt(P0*P1)` is pool-spot-independent
- ✅ Oracle staleness + invalid price → typed reverts
- ✅ Direct V4 bypass (initialize / modifyLiquidity from non-hook): blocked at `beforeInitialize` and `beforeAdd/Remove`
- ✅ Cross-pool / cross-borrower state isolation
- ✅ HF boundary correctness
- ✅ Pause is exit-only (allows withdraw / repay / liquidate; blocks supply / borrow / createPool)
- ✅ Share-token transfer locked while debt is open

**Oracle staleness trade-off.** X Layer's canonical Chainlink feeds run a 24-hour heartbeat (vs.
Ethereum mainnet's typically 1h). To keep the hook usable on X Layer, `MAX_PRICE_STALENESS` is
set to 26 hours (24h + 2h buffer). This means a downed feed could go undetected for up to ~26h
— acceptable for the demo build, NOT for production. V2 makes this per-pool so each market can
match its own feed's actual heartbeat (or escalate to a redundancy-stacked oracle).

We **explicitly did not** test (out of MVP scope):

- ❌ Real ERC777-style reentrant token (covered by `nonReentrant` modifier + source inspection)
- ❌ 24-decimal extreme tokens (X Layer demo uses 18/6 dec only)
- ❌ Bridge-induced depeg between xETH / underlying ETH (deployment-time concern; pool creator picks the oracle)

## ⚠️ Disclaimers

- **Demo build.** Names start with `Liquidsfi DEMO`, an on-chain `WARNING` string is visible on the hook, the deployer-owner has an emergency `pause()` switch. We do not commit to any UX or asset safety.
- **No audit.** No third party has reviewed this code. Bugs may exist.
- **No insurance fund.** Bad debt is socialized across remaining LPs (`reserveFactor = 0` in MVP).
- **Immutable, unupgradeable.** Hook is deployed at a CREATE2-mined magic address; new logic = new contract = pool migration.

## V2 roadmap

What we deliberately punted, in rough priority order:

- **Concentrated-vault auto-rebalance.** Full-range MVP loses V4's capital efficiency edge; v2 picks a range and rebalances via `afterSwap`.
- **Reserve factor > 0 / insurance fund.** Slice off some interest into a protocol-owned buffer so bad debt does not hit LPs first.
- **Keeper integration (Chainlink Automation / Gelato).** Permissionless `liquidate()` works today; an active keeper makes it production-grade.
- **Dual-asset borrow.** Allow borrowing either side of the pair, not just the stable. Two indices per pool.
- **Compound interest (Taylor series).** Linear accrual is fine at per-tx cadence; compound is the cleaner mathematical model for long-idle positions.
- **TWAP-style swap protection on borrow / repay.** Sandwich resistance for the internal swap.
- **Governance-owned pause + timelock.** Replace deployer EOA with a multisig + delay.
- **Frontend, indexer, position-history dashboard.**

## License

MIT.
