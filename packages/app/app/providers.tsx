"use client";

import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";

import { SuppressNoisyDevWarnings } from "@/components/SuppressNoisyDevWarnings";
import { TxFlowProvider } from "@/components/TxFlow";
import { wagmiConfig } from "@/lib/wagmi";

/**
 * Root provider stack: wagmi → react-query → RainbowKit (light theme to match
 * the sky-palette app surface).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SuppressNoisyDevWarnings />
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: "#2973FF",
            accentColorForeground: "#FFFFFF",
            borderRadius: "large",
            fontStack: "system",
            // No overlay blur — stacking RainbowKit's full-viewport
            // backdrop-filter on top of the nav/banner/scene composition
            // crashed the GPU on modal close. Plain dim is fine here.
            overlayBlur: "none",
          })}
        >
          <TxFlowProvider>{children}</TxFlowProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
