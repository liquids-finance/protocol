import type { CSSProperties } from "react";

/**
 * Per-token render hint. Tokens with a deployed asset under `/public/tokens`
 * render as a real <img>; everything else falls back to the original
 * gradient-disc-plus-glyph treatment so the table never shows a blank cell.
 */
type TokenMeta = { img: string } | { grad: string; glyph: string };

const TOKENS: Record<string, TokenMeta> = {
  xETH:   { img: "/tokens/xeth.webp" },
  USDT0:  { img: "/tokens/usdt0.png" },
  wstETH: { grad: "linear-gradient(135deg,#5AC8FA,#2364C4)", glyph: "Ξ" },
  weETH:  { grad: "linear-gradient(135deg,#8C7BFF,#3A2C8A)", glyph: "Ξ" },
  WETH:   { grad: "linear-gradient(135deg,#7A86A8,#2B3550)", glyph: "Ξ" },
  WBTC:   { grad: "linear-gradient(135deg,#F7931A,#9C5A0E)", glyph: "₿" },
  cbBTC:  { grad: "linear-gradient(135deg,#F0A030,#A85F12)", glyph: "₿" },
  USDC:   { grad: "linear-gradient(135deg,#3C8DF0,#1A4E8A)", glyph: "$" },
  USDe:   { grad: "linear-gradient(135deg,#3B3B46,#0D0D12)", glyph: "$" },
  sUSDe:  { grad: "linear-gradient(135deg,#5B5B6E,#1A1A24)", glyph: "$" },
  DAI:    { grad: "linear-gradient(135deg,#F5AC37,#A6701C)", glyph: "◈" },
};

const FALLBACK: TokenMeta = {
  grad: "linear-gradient(135deg,var(--primary),var(--accent))",
  glyph: "?",
};

interface TokenIconProps {
  sym: string;
  size?: number;
  style?: CSSProperties;
}

export function TokenIcon({ sym, size = 26, style }: TokenIconProps) {
  const t = TOKENS[sym] ?? FALLBACK;

  if ("img" in t) {
    // Plain <img> — these are 32–48px sources, no point in next/image
    // optimization. White circular border matches the gradient variant.
    return (
      <img
        src={t.img}
        alt={sym}
        width={size}
        height={size}
        className="tokicon"
        style={{
          width: size,
          height: size,
          objectFit: "cover",
          background: "#fff",
          ...style,
        }}
      />
    );
  }

  const glyph = t.glyph === "?" ? sym.charAt(0) : t.glyph;
  return (
    <span
      className="tokicon"
      style={{
        width: size,
        height: size,
        background: t.grad,
        fontSize: Math.round(size * 0.46),
        ...style,
      }}
    >
      {glyph}
    </span>
  );
}

interface TokenPairProps {
  a: string;
  b: string;
  size?: number;
}

export function TokenPair({ a, b, size = 26 }: TokenPairProps) {
  return (
    <span className="tokpair">
      <TokenIcon sym={a} size={size} />
      <TokenIcon
        sym={b}
        size={size}
        style={{ marginLeft: -size * 0.34, boxShadow: "0 0 0 2px var(--surface)" }}
      />
    </span>
  );
}
