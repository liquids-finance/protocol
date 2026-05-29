"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { LiquidsMark } from "./LiquidsMark";

const TABS = [
  { href: "/swap", label: "Swap" },
  { href: "/markets", label: "Markets" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

/**
 * Top app bar — glass pill with brand, tab switcher, network chip + wallet
 * button on the right. Uses RainbowKit's Custom render-prop so we keep
 * connect/switch/account modals while skinning the visible chip ourselves.
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="appnav">
      <div className="appnav-inner">
        <Link href="/" className="appnav-brand" aria-label="Liquids — home">
          <LiquidsMark size={36} />
          <span className="display appnav-name">liquids</span>
        </Link>

        <nav className="appnav-tabs" aria-label="Primary">
          {TABS.map((t) => {
            const isActive = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`appnav-tab${isActive ? " is-active" : ""}`}
              >
                {t.label}
              </Link>
            );
          })}
          <a
            className="appnav-tab appnav-tab-ext"
            href="https://github.com/liquids-finance"
            target="_blank"
            rel="noreferrer"
          >
            Docs ↗
          </a>
        </nav>

        <div className="appnav-right">
          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
              const ready = mounted;
              const connected = ready && account && chain;

              if (!ready) {
                return (
                  <div style={{ opacity: 0, pointerEvents: "none" }} aria-hidden>
                    <button className="btn btn-primary">Connect Wallet</button>
                  </div>
                );
              }

              if (!connected) {
                return (
                  <button className="btn btn-primary" onClick={openConnectModal} type="button">
                    Connect Wallet
                  </button>
                );
              }

              // Network selector intentionally omitted from the bar —
              // wrong-network state surfaces via the full-width NetworkBanner
              // below the nav, and clicking the wallet button opens the
              // account modal which also exposes chain switching.
              return chain.unsupported ? (
                <button className="net-chip net-chip-bad" onClick={openChainModal} type="button">
                  <span className="dot" /> Wrong network <em>→ Switch</em>
                </button>
              ) : (
                <button
                  className="appnav-wallet"
                  onClick={openAccountModal}
                  type="button"
                  title="Manage wallet"
                >
                  <span className="wallet-avatar" />
                  <span className="wallet-info">
                    <span className="mono wallet-addr">{account.displayName}</span>
                    <span className="mono wallet-bal">
                      {account.displayBalance ?? "—"}
                    </span>
                  </span>
                </button>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
    </header>
  );
}
