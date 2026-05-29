/**
 * Display formatters used across the app. All assume USD or generic numbers —
 * token-amount formatting that needs decimals should use viem/format helpers.
 */

export const fmtUSD = (n: number, dec = 0): string =>
  "$" + Number(n).toLocaleString(undefined, {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });

export const fmtNum = (n: number, dec = 2): string =>
  Number(n).toLocaleString(undefined, {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });

export const fmtCompact = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(0);
};

export const fmtPct = (n: number, dec = 2): string => n.toFixed(dec) + "%";

export const shortAddr = (addr: string, head = 6, tail = 4): string =>
  addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;

/**
 * WAD (1e18-scaled bigint) → number. Loses precision below 1e-15 — fine for
 * display, never use for transaction inputs. The `÷ 1e6` then `× 1e-12` split
 * keeps the intermediate within Number.MAX_SAFE_INTEGER for any realistic TVL.
 */
export const wadToNum = (wad: bigint): number => {
  const SCALE = 1_000_000n; // 1e6 — drops 6 of 18 decimals up front
  const lossless = Number(wad / SCALE);
  return lossless / 1e12;
};

/** Raw token-amount (bigint, with given decimals) → number. Same caveat as wadToNum. */
export const rawToNum = (raw: bigint, decimals: number): number => {
  if (decimals <= 6) return Number(raw) / 10 ** decimals;
  const headDigits = BigInt(10 ** (decimals - 6));
  return Number(raw / headDigits) / 1e6;
};
