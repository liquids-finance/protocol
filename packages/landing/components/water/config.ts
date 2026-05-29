/**
 * Single source of truth for every visual + physical knob of the water pool.
 * Tune values here without diving into the engine.
 */
export const WATER_CONFIG = {
  /**
   * Spring-coupled water surface.
   *
   * Steady-state depression under each stream (constant impulse per frame):
   *   y_eq ≈ impactForce / stiffness
   *        = 0.18 / 0.022 ≈ 8.2 px peak sag at the impact center.
   *
   * Damping is strong (0.88^60 ≈ 0.0005 → 99.95% energy gone after 1 second)
   * so any transient mouse/click ripple decays before crossing the surface,
   * and the constant stream impulse never accumulates into chaos.
   */
  surface: {
    nodeCount: 220,
    stiffness: 0.022,
    damping: 0.88,
    spread: 0.1,
    restYFraction: 0.5,
  },

  colors: {
    /* Water gradient — top is intentionally a warm seafoam (not a neon
     * turquoise) so it picks up the sky's teal-low stop and the horizon
     * reads as a continuous gradient instead of a sharp seam. */
    gradientTop: "#a8d6cc",
    gradientMid: "#4391bc",
    gradientDeep: "#0e2a50",
    foam: "rgba(255, 250, 235, 0.95)",
    foamSoft: "rgba(230, 245, 240, 0.55)",
    sparkle: "#FFFFFF",
    surfaceHighlight: "rgba(255, 245, 220, 0.6)",
    /** Warm cream halo painted just above the surface line — the visual
     *  bridge that fuses the sky into the water without a hard seam. */
    horizonHalo: "255, 240, 210",

    stoneShadow: "#1f4759",
    stoneFill: "#3c7a8a",
    stoneHighlight: "#5fa3b2",
    stoneDot: "rgba(8, 27, 45, 0.55)",

    ribbonStroke: "#2a6b50",
    ribbonHighlight: "rgba(120, 200, 160, 0.32)",

    kelpFill: "#2d6e44",
    kelpShadow: "#194a2a",
    kelpVein: "rgba(8, 35, 22, 0.6)",

    coralFill: "#587a3c",
    coralShadow: "#34491f",
    coralAccent: "rgba(160, 200, 110, 0.45)",

    underwaterTint: "#082040",

    // ─ Anime-style cel-shaded pastel copper pipes ─────────────────────
    pipeEdge: "#a25f30",
    pipeMid: "#d4855a",
    pipeHighlight: "#f7c69a",
    flangeEdge: "#7a4a25",
    flangeMid: "#b56e44",
    flangeHighlight: "#deaf83",
    rivetColor: "#3d1f10",
    pipeOutline: "#5a2a18",
    /** Soft warm ground-anchor shadow under each flange. */
    pipeShadow: "rgba(80, 40, 20, 0.25)",
  },

  /** Foam streaks drifting right → left in unique depth lanes. */
  caustics: {
    streakCount: 10,
    speedMin: 16,
    speedMax: 30,
    lengthMin: 70,
    lengthMax: 220,
    thicknessMin: 0.8,
    thicknessMax: 2.0,
    depthMin: 10,
    depthMax: 150,
    wobbleAmplitudeMin: 1.2,
    wobbleAmplitudeMax: 4.5,
    wobbleFreqMin: 0.3,
    wobbleFreqMax: 1.1,
    offscreenBuffer: 80,
    stepSizePx: 2,
  },

  /**
   * Continuous liquid streams — pure path rendering, 100% opaque, breathing
   * width. NO particle emission, NO blur filter, NO compositing tricks.
   *
   * The surface impulse is applied EVERY FRAME at the impact x. With the
   * spring tuning above this lands in the "sweet spot": a small sustained
   * depression + gentle outgoing ripples, no chaotic build-up.
   */
  streams: {
    /**
     * Stream palette tuned to the Ghibli sky. The previous values (#ff37c7,
     * #2973ff) were straight neon — they read as a UI library, not as
     * liquid living in this scene. These are still bright enough to pop
     * but desaturated toward warmer hues so they sit naturally against
     * the cream/peach background.
     */
    leftColor: "#e258b8",
    leftCenterColor: "#fbc6dc",
    rightColor: "#5680d2",
    rightCenterColor: "#b6c8e9",
    /** shadowBlur (px) applied per stream — soft halo of the edge color. */
    glowBlur: 14,

    /** Base stream thickness (px) — bumped from the previous slim version
     *  so the column reads as a proper liquid hose, not a thin marker line. */
    widthBase: 26,
    /** Sine-wave amplitude on top of the base width (px). */
    widthAmp: 2.2,
    /** Width-breathing frequency (Hz). */
    widthFreq: 1.4,

    /** Maximum horizontal sway of the column centerline (px). The whole
     *  stream snakes gently as it descends — sells the "liquid not stick"
     *  feel without any per-particle overhead. */
    centerSwayAmp: 4,
    /** Centerline sway frequency (Hz). */
    centerSwayFreq: 0.9,

    /** Vertical sample points per stream. */
    silhouetteSegments: 12,

    /** Per-frame downward impulse injected at the stream's impact x. */
    impactForce: 0.18,
    /** Gaussian falloff radius (px) for the impact impulse. */
    impactRadius: 22,

    /** ms between splash spawns per stream. */
    splashIntervalMs: 140,

    /** Depth (px) the stream visually fades into the water below the surface.
     *  Above-surface = opaque 3D cylinder; below = vertical alpha gradient
     *  that dissolves into the pool gradient color. */
    underwaterFadeDepth: 75,
  },

  /**
   * Splash droplets — cartoon-style fully opaque bits thrown sideways from
   * each stream's contact point. NOT used for any blurred merge anymore.
   */
  /**
   * Stylized splash bits thrown off at each stream impact.
   *
   * Splash particles need to clear the surface and arc visibly into the
   * sky band — that's how the warm-peach above and the seafoam below stop
   * feeling like two separate layers. So the upward kick is intentionally
   * strong (5.5–9.0 px/frame), gravity is softer (0.32) than air-style
   * gravity would be, and life is long enough (520–880 ms) for the arc
   * to play out before the bit fades.
   */
  splashes: {
    perImpactMin: 2,
    perImpactMax: 4,
    /** Horizontal speed range (px/frame at 60fps). */
    speedMin: 2.2,
    speedMax: 4.8,
    /** Vertical upward velocity range at spawn — high enough that bits
     *  cross the horizon and visibly enter the warm sky band. */
    upwardSpeedMin: 5.5,
    upwardSpeedMax: 9.0,
    sizeMin: 1.6,
    sizeMax: 3.0,
    /** Gentler than airborne gravity so the sky-bound bits linger. */
    gravity: 0.32,
    lifeMsMin: 520,
    lifeMsMax: 880,
  },

  /** Anime four-point sparkles — pointer click feedback only. */
  sparkles: {
    perImpactMin: 2,
    perImpactMax: 3,
    sizeMin: 4,
    sizeMax: 8,
    speed: 1.2,
    lifeMs: 480,
  },

  pointer: {
    impulseHover: 2,
    impulseClick: 9,
    impulseRadius: 55,
    hoverDistanceThresholdPx: 80,
    hoverThrottleMs: 28,
  },

  /**
   * Underwater scene — bubbles + pop rings only. Tokens have been removed.
   *
   * Bubbles are lean (max 15) with randomized per-bubble opacity and a 30%
   * chance of dying mid-water for depth variety. A vertical "depth tint"
   * gradient is laid over everything (darker at the floor, near-clear just
   * below the surface) so the column reads as actual depth, not a flat fill.
   */
  underwater: {
    // ─ Rising bubbles with sine sway ──────────────────────────────────
    bubbleMaxActive: 15,
    bubbleSpawnIntervalMinMs: 380,
    bubbleSpawnIntervalMaxMs: 900,
    bubbleSizeMin: 4,
    bubbleSizeMax: 9,
    bubbleRiseSpeedMinPxPerSec: 22,
    bubbleRiseSpeedMaxPxPerSec: 55,
    bubbleSwayAmpPx: 7,
    bubbleSwayFreqMin: 0.5,
    bubbleSwayFreqMax: 1.3,
    /** Per-bubble alpha range. Each bubble picks its own. */
    bubbleOpacityMin: 0.1,
    bubbleOpacityMax: 0.4,
    /** Probability a spawned bubble will pop somewhere mid-water rather
     *  than reaching the surface. Creates depth variety. */
    bubbleEarlyDeathChance: 0.3,

    // ─ Pop ring effects ───────────────────────────────────────────────
    popRingDurationMs: 360,

    // ─ Depth tint (vertical gradient) ─────────────────────────────────
    /** Alpha at the bottom of the depth gradient (deepest water). */
    depthTintDeepAlpha: 0.32,
    /** Alpha just below the surface (near-clear). */
    depthTintSurfaceAlpha: 0.04,
  },

  pipes: {
    inset: 0.18,
    trunkWidth: 64,
    trunkHeight: 42,
    flangeHeight: 14,
    flangeOverhang: 10,
    rivetCount: 5,
    rivetRadius: 1.7,
  },

  /**
   * Ambient dust motes — slow-drifting magical particles in the upper-half
   * sky band. Fills the space between the title and the horizon with
   * gentle motion so the whole layer feels alive.
   */
  dust: {
    /** Total active motes — pre-allocated, recycled in place when they
     *  drift out of the sky band. */
    count: 40,
    sizeMin: 0.7,
    sizeMax: 2.2,
    /** Per-mote sine sway frequency (cycles per second). */
    swayFreqMin: 0.06,
    swayFreqMax: 0.18,
    /** Per-mote sine sway amplitude (px). */
    swayAmpMin: 4,
    swayAmpMax: 14,
    /** Maximum vertical drift speed (px/sec). Mix of upward + downward
     *  drifters since direction is randomized per mote. */
    driftSpeedMax: 8,
    opacityMin: 0.15,
    opacityMax: 0.45,
    /** Color palette — warm cream/gold tones picked off the sun radial. */
    colors: ["255, 240, 210", "255, 248, 220", "255, 235, 180", "255, 250, 235"] as const,
  },

  /** Pooled population caps — splash bits stay well under 20 in flight per
   *  the spawn-rate × lifetime math, so 40 is plenty of headroom. */
  limits: {
    maxSplashes: 40,
    maxSparkles: 80,
  },
} as const;

export type WaterConfig = typeof WATER_CONFIG;
