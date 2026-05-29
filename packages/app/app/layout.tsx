import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { AppNav } from "@/components/AppNav";
import { DemoBanner } from "@/components/DemoBanner";
import { NetworkBanner } from "@/components/NetworkBanner";
import { SceneBackground } from "@/components/SceneBackground";
import { ViewModeRoot } from "@/components/ViewModeRoot";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jb-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Liquids.finance — App",
  description: "Pool-native lending on Uniswap V4. Demo build on X Layer.",
  metadataBase: new URL("https://app.liquids.finance"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#8FC9EE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-palette="sky"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jbMono.variable}`}
    >
      <body>
        <Providers>
          <ViewModeRoot>
            {/* Scene lives INSIDE the positioned .app-root so its `position:
             *  absolute` anchors to the root (which is min-height: 100vh,
             *  position: relative). It scrolls away with the page instead of
             *  sticking to the viewport like a fixed bg. */}
            <SceneBackground />
            <header className="app-header">
              <DemoBanner />
              <AppNav />
              <NetworkBanner />
            </header>
            <div className="app-shell">
              <main className="app-main">{children}</main>
            </div>
          </ViewModeRoot>
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
