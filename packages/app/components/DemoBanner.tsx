/**
 * Frosted demo warning bar — sits above the AppNav.
 */
export function DemoBanner() {
  return (
    <div className="demo-banner" role="alert">
      <div className="demo-banner-inner">
        <span className="demo-banner-left">
          <span className="demo-icon" aria-hidden>
            <svg viewBox="0 0 16 16" width="13" height="13">
              <path d="M8 1 L 15 14 L 1 14 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M8 6 L 8 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="8" cy="12" r="0.9" fill="currentColor" />
            </svg>
          </span>
          <strong>Demo build</strong>
          <span className="demo-sep" />
          <span>Unaudited — do not use real assets.</span>
        </span>
      </div>
    </div>
  );
}
