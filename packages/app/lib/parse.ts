/**
 * Parse a decimal-string input ("1.5") to the on-chain bigint representation
 * given a decimals count. Returns `null` for empty / non-numeric input or for
 * fractional precision exceeding the asset's decimals (the UI surfaces that
 * as "Amount too precise").
 */
export function parseAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;

  const [whole = "", frac = ""] = trimmed.split(".");
  if (whole === "" && frac === "") return null;
  if (frac.length > decimals) return null;

  const wholePart = whole === "" ? "0" : whole;
  const fracPadded = frac.padEnd(decimals, "0");
  try {
    return BigInt(wholePart + fracPadded);
  } catch {
    return null;
  }
}
