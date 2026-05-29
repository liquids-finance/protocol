/**
 * Live deployments on X Layer mainnet (chain id 196).
 * Hook + Lens + demo share token verified on OKLink.
 */
export const CONTRACTS = {
  // Liquids core
  hook: "0x7DEfe0E1617F4ce2f147828CA8D9EDbd525F6a40" as const,
  lens: "0xaab403f8e9B6c0c9A254C2fa5D6038E83C44b94e" as const,

  // V4 protocol on X Layer
  poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32" as const,
  stateView: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990" as const,
  quoter: "0x8928074ca1b241d8ec02815881c1af11e8bc5219" as const,
  positionManager: "0xcf1eafc6928dc385a342e7c6491d371d2871458b" as const,
  universalRouter: "0x8b844f885672f333bc0042cb669255f93a4c1e6b" as const, // v2.1.1 (V4-aware)

  // Uniswap Permit2 (canonical, same on every EVM chain)
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const,
} as const;

/**
 * Demo market (xETH / USDT0) registered via CreateDemoPool.s.sol.
 * Currency sort: USDT0 < xETH → USDT0 = currency0, xETH = currency1.
 * borrowCurrencyIndex = 0 → USDT0 is the borrowable side.
 */
export const DEMO_POOL = {
  poolId: "0x60ecbd1477b335ddd1a8c3b45cdb5f6837fddd8b239d1ca714f68dabd9947e9b" as const,
  shareToken: "0x0d80882f1C2F891E5F056e8db5EcBbe92dC43c24" as const,
  currency0: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const, // USDT0 (6 decimals)
  currency1: "0xE7B000003A45145decf8a28FC755aD5eC5EA025A" as const, // xETH (18 decimals)
  oracle0: "0x673b428Fd1df93a6F77fA7ea1F8eeD8A4Ff36b9f" as const, // USDT/USD
  oracle1: "0x8b85b50535551F8E8cDAF78dA235b5Cf1005907b" as const, // ETH/USD
  fee: 500,
  tickSpacing: 10,
  borrowCurrencyIndex: 0, // USDT0 is borrowable
  symbol0: "USDT0",
  symbol1: "xETH",
  decimals0: 6,
  decimals1: 18,
} as const;

export const OKLINK_ADDRESS = (addr: string) => `https://www.oklink.com/x-layer/address/${addr}`;
export const OKLINK_TX = (hash: string) => `https://www.oklink.com/x-layer/tx/${hash}`;
