import { WaterCanvas } from "./WaterCanvas";

const APP_URL = "https://app.liquids.finance";
const GITHUB_URL = "https://github.com/liquids-finance";
const X_URL = "https://x.com/liquidsfinance";
const EMAIL_URL = "mailto:hello@liquids.finance";

/**
 * Landing hero — Web3 minimalist treatment.
 *
 *   • Fullscreen water canvas behind the overlay.
 *   • Headline: pure-white Space Grotesk with a wide soft white/blue glow.
 *     No stroke, no comic offset shadow — clean and trustworthy.
 *   • Floating "Launch App" button: glassmorphism panel with backdrop blur
 *     so the underwater scene smears through it. Inset turquoise glow ties
 *     it to the water.
 *   • Footer: three social icons, semi-transparent white over the deep
 *     navy band at the bottom of the canvas.
 */
export function Hero() {
  return (
    <section className="relative h-screen w-full overflow-hidden">
      {/* Canvas */}
      <div className="absolute inset-0 z-0">
        <WaterCanvas />
      </div>

      {/* Brand pill — top-center glassmorphism header. Heavy backdrop blur
       *  smears the underwater + sun scene through it; the white pill rim
       *  ties it to the glass language of the rest of the page. */}
      <div className="pointer-events-none absolute inset-x-0 top-5 z-30 flex justify-center">
        <a
          href="/"
          aria-label="Liquids — home"
          className="pointer-events-auto inline-flex items-center gap-1 px-3 py-2"
          style={{
            // Darker translucent slate base (matches the headline's #0F172A
            // family) so the pill reads as a piece of smoked glass rather
            // than a frosted-white chip.
            background: "rgba(98, 98, 98, 0.42)",
            backdropFilter: "blur(16px) saturate(150%)",
            WebkitBackdropFilter: "blur(16px) saturate(150%)",
            border: "1px solid rgba(255, 255, 255, 0.18)",
            borderRadius: "50px",
            boxShadow: [
              "0 8px 24px rgba(10, 25, 45, 0.32)",
              "inset 0 1px 0 rgba(255, 255, 255, 0.22)",
            ].join(", "),
          }}
        >
          {/* Plain <img> — the file is a tiny 4-path SVG, no need for
           *  next/image's optimizer overhead for a single hero mark. */}
          <img
            src="/liquids-mark.svg"
            alt=""
            width={28}
            height={28}
            style={{ display: "block" }}
          />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "17px",
              letterSpacing: "-0.015em",
              color: "rgba(255, 255, 255, 0.96)",
              lineHeight: 1,
            }}
          >
            liquids
          </span>
        </a>
      </div>

      {/* Title — anchored in the upper sky band. Clean deep-slate Inter 900;
       *  no gradient fill, no stroke, no shadow — minimal Web3 treatment. */}
      <div className="pointer-events-none absolute inset-x-0 top-[6vh] z-20 flex h-[44vh] items-center justify-center px-4 sm:px-6">
        <h1
          className="text-center text-5xl sm:text-6xl md:text-8xl lg:text-9xl xl:text-[10rem]"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "-0.04em",
            lineHeight: 1.1,
          }}
        >
          <span className="block">LP Once</span>
          <span className="block">Earn Twice.</span>
        </h1>
      </div>

      {/* Floating glassmorphism Launch App button — just below the surface */}
      <div className="pointer-events-none absolute inset-x-0 top-[56vh] z-20 flex justify-center">
        <a
          href={APP_URL}
          className="pointer-events-auto inline-flex items-center gap-3 px-7 py-3.5 text-xs font-semibold uppercase tracking-[0.16em] transition-transform hover:scale-[1.03] active:scale-[0.98] sm:px-9 sm:py-4 sm:text-sm sm:tracking-[0.18em]"
          style={{
            fontFamily: "var(--font-display)",
            color: "rgba(255, 255, 255, 0.96)",
            background: "rgba(255, 255, 255, 0.08)",
            backdropFilter: "blur(12px) saturate(135%)",
            WebkitBackdropFilter: "blur(12px) saturate(135%)",
            border: "1px solid rgba(255, 255, 255, 0.18)",
            borderRadius: "14px",
            boxShadow: [
              "0 12px 36px rgba(15, 35, 60, 0.28)",
              "inset 0 1px 0 rgba(255, 255, 255, 0.28)",
              // Inset turquoise glow — the visual cue that the panel is held
              // underwater, picking up the pool's color from inside.
              "inset 0 0 38px rgba(127, 227, 221, 0.10)",
            ].join(", "),
            textShadow: "0 1px 2px rgba(15, 35, 60, 0.4)",
            animation: "underwaterFloat 5s ease-in-out infinite",
          }}
        >
          Launch App
          <span aria-hidden style={{ fontSize: "1.05em" }}>
            →
          </span>
        </a>
      </div>

      {/* Footer — minimal social icons over the deep navy band */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-6 sm:px-6 sm:pb-8">
        <nav
          className="pointer-events-auto mx-auto flex w-fit items-center justify-center gap-7"
          aria-label="Social links"
        >
          <SocialLink href={GITHUB_URL} label="GitHub">
            <GitHubIcon />
          </SocialLink>
          <SocialLink href={X_URL} label="X (Twitter)">
            <XIcon />
          </SocialLink>
          <SocialLink href={EMAIL_URL} label="Email">
            <EmailIcon />
          </SocialLink>
        </nav>
      </footer>
    </section>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      target="_blank"
      rel="noreferrer"
      className="text-white/60 transition hover:text-white focus:text-white focus:outline-none"
      style={{ filter: "drop-shadow(0 2px 6px rgba(10, 20, 30, 0.5))" }}
    >
      {children}
    </a>
  );
}

function GitHubIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0a12 12 0 0 0-3.8 23.4c.6.11.82-.26.82-.58v-2.02c-3.34.73-4.04-1.6-4.04-1.6-.55-1.4-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.3-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.82 5.62-5.5 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 0z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}
