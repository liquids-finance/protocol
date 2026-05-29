import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import "./globals.css";

/**
 * Inter — the de-facto premium Web3 / DeFi typeface (Uniswap, Aave, Optimism,
 * Compound, etc.). Loaded with the full weight range so the hero can reach
 * 900 for that razor-sharp display weight, while body UI sticks to 400–700.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = "https://liquids.finance";
const TITLE = "Liquids.finance — Pool-native lending on Uniswap V4";
const DESCRIPTION =
  "Each registered pool is its own isolated lending market. LP shares earn swap fees plus lending interest from the same dollar of capital.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  applicationName: "Liquids",
  keywords: [
    "Uniswap V4",
    "Uniswap hook",
    "DeFi lending",
    "pool-native lending",
    "concentrated liquidity",
    "X Layer",
    "Liquids.finance",
  ],
  authors: [{ name: "Liquids" }],
  openGraph: {
    title: "Liquids.finance",
    description: "Pool-native lending on Uniswap V4 — same dollar, both yields.",
    url: SITE_URL,
    siteName: "Liquids",
    type: "website",
    images: [{ url: "/logo.svg", width: 1024, height: 1024, alt: "Liquids" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Liquids.finance",
    description: "Pool-native lending on Uniswap V4 — same dollar, both yields.",
    site: "@liquidsfinance",
    creator: "@liquidsfinance",
    images: ["/logo.svg"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#d8b191",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
