import type { WATER_CONFIG } from "./config";
import type { SurfaceSampler } from "./types";

type SurfaceConfig = (typeof WATER_CONFIG)["surface"];
type ColorConfig = (typeof WATER_CONFIG)["colors"];
type CausticsConfig = (typeof WATER_CONFIG)["caustics"];

/**
 * A single persistent foam streak. Owns its own physics so wrapping is
 * deterministic — when the streak fully exits one side it's recycled
 * off-screen on the opposite side. Continuous flow, zero mid-canvas pop.
 *
 * All streaks share the same direction (right → left) and each is assigned
 * a unique depth lane via `laneIndex` → guaranteed no vertical overlap.
 */
interface FoamStreak {
  /** Center x in canvas pixels. Drifts each frame. */
  x: number;
  /** Drift speed in px/sec — always negative (rightward → leftward). */
  vx: number;
  /** Half-length offset (px) so the whole streak spans `2 * halfLen`. */
  halfLen: number;
  /** Stroke thickness (px). */
  thickness: number;
  /** Depth below the surface line (px). Fixed by laneIndex, not random. */
  depth: number;
  /** Sinusoidal wobble amplitude (px) — gives the line a hand-drawn ripple. */
  wobbleAmp: number;
  /** Wobble frequency (cycles per second). */
  wobbleFreq: number;
  /** Random phase offset (radians). */
  wobblePhase: number;
  /** Spatial wave count along the streak length (visual wave-density). */
  wobbleWaves: number;
  /** 0/1 — 0 picks the bright foam color, 1 the soft foam color. */
  paletteIndex: 0 | 1;
  /** Lane assignment (0..streakCount-1) — locks the depth band. */
  laneIndex: number;
}

/**
 * Spring-coupled 2D water surface. Owns:
 *   • The spring node array (positions + velocities + scratch)
 *   • The persistent foam streaks (drift continuously, dt-integrated)
 *
 * Render methods:
 *   drawBody(ctx)     — gradient water fill, clipped under the live surface
 *   drawCaustics(ctx) — animated foam streaks
 *   drawSurface(ctx)  — bezier-smoothed surface stroke + sub-surface highlight
 */
export class WaterSurface implements SurfaceSampler {
  readonly width: number;
  readonly height: number;
  readonly nodeCount: number;

  /** y-offset of each node from its rest position. */
  private readonly y: Float32Array;
  /** velocity of each node (px / frame at 60fps). */
  private readonly vy: Float32Array;
  /** scratch buffer reused by the smoothing pass. */
  private readonly tmp: Float32Array;

  private readonly surfaceCfg: SurfaceConfig;
  private readonly colors: ColorConfig;
  private readonly cfgCaustics: CausticsConfig;

  /** Rest y in canvas pixels. */
  private readonly restY: number;

  /** Accumulated seconds — used for wobble phases. */
  private elapsed = 0;

  /** Foam streaks — persistent particles, never popped in mid-canvas. */
  private readonly streaks: FoamStreak[];

  constructor(
    width: number,
    height: number,
    surfaceCfg: SurfaceConfig,
    colors: ColorConfig,
    caustics: CausticsConfig
  ) {
    this.width = width;
    this.height = height;
    this.nodeCount = surfaceCfg.nodeCount;
    this.y = new Float32Array(this.nodeCount);
    this.vy = new Float32Array(this.nodeCount);
    this.tmp = new Float32Array(this.nodeCount);
    this.surfaceCfg = surfaceCfg;
    this.colors = colors;
    this.cfgCaustics = caustics;
    this.restY = height * surfaceCfg.restYFraction;
    this.streaks = this.makeStreaks();
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Simulation
  // ════════════════════════════════════════════════════════════════════════

  /** Integrate the spring system + drift the foam streaks. dt in seconds. */
  update(dt: number): void {
    this.elapsed += dt;
    // Normalize dt to a 60fps step so existing tuning numbers still feel right.
    const step = dt * 60;
    const { stiffness, damping, spread } = this.surfaceCfg;

    // ─ Spring force + damping ────────────────────────────────────────────
    for (let i = 0; i < this.nodeCount; i++) {
      this.vy[i] += -stiffness * this.y[i] * step;
      this.vy[i] *= Math.pow(damping, step);
      this.y[i] += this.vy[i] * step;
    }

    // ─ Neighbor coupling (velocity-only, single pass) ────────────────────
    // Previously this loop also mutated `y[i]` directly — that bypasses the
    // damping mechanism and turned out to be the source of the chaotic,
    // recursive wave pattern that filled the screen under sustained stream
    // input. Proper wave-equation behaviour: only inject impulses into vy
    // here, and let the spring-force-then-damp-then-integrate path above
    // handle position evolution next frame.
    for (let i = 0; i < this.nodeCount; i++) this.tmp[i] = 0;
    for (let i = 0; i < this.nodeCount - 1; i++) {
      const d = spread * (this.y[i] - this.y[i + 1]);
      this.tmp[i] -= d;
      this.tmp[i + 1] += d;
    }
    for (let i = 0; i < this.nodeCount; i++) {
      this.vy[i] += this.tmp[i] * step;
    }

    // ─ Foam streak drift + wrap-around ───────────────────────────────────
    const buf = this.cfgCaustics.offscreenBuffer;
    for (const s of this.streaks) {
      s.x += s.vx * dt;
      if (s.vx >= 0 && s.x - s.halfLen > this.width + buf) {
        // Moved off the right edge → wrap to off-screen left, re-randomize
        // depth / phase / wobble so consecutive cycles aren't visually identical.
        this.respawnStreak(s, -s.halfLen - buf);
      } else if (s.vx < 0 && s.x + s.halfLen < -buf) {
        this.respawnStreak(s, this.width + s.halfLen + buf);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Impulses (pointer + droplet impacts)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Wide impulse with gaussian falloff around `x` (canvas px), reaching
   * `radiusPx` to either side. The peak velocity is `velocity`; nodes further
   * from center get scaled exponentially. Use this for any visually obvious
   * impact (pointer click, droplet splash) — the resulting wave is much
   * fuller than a single-node poke.
   */
  impulseRadius(x: number, velocity: number, radiusPx: number): void {
    const centerIdx = (x / this.width) * (this.nodeCount - 1);
    const radiusNodes = Math.max(1, (radiusPx / this.width) * (this.nodeCount - 1));
    const minIdx = Math.max(0, Math.floor(centerIdx - radiusNodes));
    const maxIdx = Math.min(this.nodeCount - 1, Math.ceil(centerIdx + radiusNodes));
    for (let i = minIdx; i <= maxIdx; i++) {
      const d = (i - centerIdx) / radiusNodes;
      // Gaussian-ish bell, normalized so center peaks at velocity.
      const w = Math.exp(-d * d * 2.2);
      this.vy[i] += velocity * w;
    }
  }

  /** Sample surface y at canvas pixel x — linear interpolation between nodes. */
  sampleAtX(x: number): number {
    const t = Math.max(0, Math.min(1, x / this.width));
    const fIdx = t * (this.nodeCount - 1);
    const i = Math.floor(fIdx);
    if (i >= this.nodeCount - 1) return this.restY + this.y[this.nodeCount - 1];
    const frac = fIdx - i;
    return this.restY + this.y[i] + frac * (this.y[i + 1] - this.y[i]);
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Rendering
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Underwater god rays — perspective fan emerging from a SINGLE apex point
   * just outside the upper-left corner. All four rays share the same apex
   * `(sunX, sunY)` and fan out at different angles toward the bottom-right,
   * mimicking the optical geometry of sunlight piercing a water column.
   *
   * No parallel beams. No drift-along-x trick. Each ray is a true triangle
   * sharing the apex with the others — perspective is exact.
   *
   * The triangles extend below the canvas edge, but the surface clip + the
   * vertical fade keep only the in-water portion visible.
   *
   * Call order: AFTER drawBody, BEFORE the underwater bubble/tint pass.
   * Composite mode `screen` brightens whatever the rays overlap.
   */
  drawGodRays(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    this.clipBelowSurface(ctx);
    ctx.globalCompositeOperation = "screen";

    // Single shared apex — just outside the top-left corner, lined up with
    // the sun radial in the body background.
    const sunX = -50;
    const sunY = -150;

    // Each ray: a half-width angular spread around its center angle.
    // Angles measured CW from +x; values picked so the rays fan from the
    // upper-left toward the lower-center / lower-right.
    const rays = [
      { angle: 1.48, halfWidth: 0.04, alpha: 0.22 },
      { angle: 1.24, halfWidth: 0.052, alpha: 0.16 },
      { angle: 1.02, halfWidth: 0.046, alpha: 0.20 },
      { angle: 0.78, halfWidth: 0.06, alpha: 0.13 },
    ];

    for (const ray of rays) {
      // Extent: project past the canvas bottom along the center direction
      // so the triangle definitely covers the visible water column. Sin >= 0.1
      // guard prevents division by near-zero for very shallow rays.
      const sinA = Math.max(Math.sin(ray.angle), 0.1);
      const extentDist = (this.height - sunY + 240) / sinA;

      const leftA = ray.angle - ray.halfWidth;
      const rightA = ray.angle + ray.halfWidth;
      const leftEndX = sunX + Math.cos(leftA) * extentDist;
      const leftEndY = sunY + Math.sin(leftA) * extentDist;
      const rightEndX = sunX + Math.cos(rightA) * extentDist;
      const rightEndY = sunY + Math.sin(rightA) * extentDist;
      const centerEndX = sunX + Math.cos(ray.angle) * extentDist;
      const centerEndY = sunY + Math.sin(ray.angle) * extentDist;

      // Gradient runs along the ray's center axis — bright near the apex,
      // fading to nothing by the time it reaches the tip. The fade-off
      // doubles as "water absorbs light with depth".
      const grad = ctx.createLinearGradient(sunX, sunY, centerEndX, centerEndY);
      grad.addColorStop(0, `rgba(255, 250, 220, ${ray.alpha})`);
      grad.addColorStop(0.42, `rgba(255, 250, 220, ${ray.alpha * 0.55})`);
      grad.addColorStop(0.85, `rgba(255, 250, 220, ${ray.alpha * 0.1})`);
      grad.addColorStop(1, `rgba(255, 250, 220, 0)`);
      ctx.fillStyle = grad;

      // Triangle: apex + two far-end points.
      ctx.beginPath();
      ctx.moveTo(sunX, sunY);
      ctx.lineTo(leftEndX, leftEndY);
      ctx.lineTo(rightEndX, rightEndY);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  /** Gradient pool body. Clipped to area below the live surface. */
  drawBody(ctx: CanvasRenderingContext2D): void {
    const grad = ctx.createLinearGradient(0, this.restY, 0, this.height);
    grad.addColorStop(0, this.colors.gradientTop);
    grad.addColorStop(0.45, this.colors.gradientMid);
    grad.addColorStop(1, this.colors.gradientDeep);

    ctx.save();
    this.clipBelowSurface(ctx);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  /**
   * Animated foam streaks — each streak is a persistent particle with its own
   * sinusoidal wobble. Smooth across frames (dt-integrated), wraps fully
   * off-screen, never pops in the visible area.
   */
  drawCaustics(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    this.clipBelowSurface(ctx);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const t = this.elapsed;
    for (const s of this.streaks) {
      ctx.strokeStyle = s.paletteIndex === 0 ? this.colors.foam : this.colors.foamSoft;
      ctx.lineWidth = s.thickness;
      this.traceStreak(ctx, s, t);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Two-sided horizon halo — the seam between sky and water needs to be
   * BLENDED, not striped. The previous single-band variant still read as a
   * ruler line because all the fade happened on the sky side.
   *
   *   • UP — 94 px tall fade in the sky from transparent → cream-warm,
   *     dissolving into the warm gradient sky.
   *   • DOWN — 36 px tall fade in the water from cream-warm → transparent,
   *     dissolving into the seafoam water top.
   *
   * Drawn BEFORE drawSurface so the dynamic foam stroke still caps the
   * spring's live wave edge on top of the static blend.
   */
  drawHorizonGlow(ctx: CanvasRenderingContext2D): void {
    const rgb = this.colors.horizonHalo;
    const restY = this.restY;

    // ─── Sky-side fade (above the surface) ───────────────────────────────
    const skyGrad = ctx.createLinearGradient(0, restY - 90, 0, restY + 4);
    skyGrad.addColorStop(0.0, `rgba(${rgb}, 0)`);
    skyGrad.addColorStop(0.5, `rgba(${rgb}, 0.10)`);
    skyGrad.addColorStop(0.85, `rgba(${rgb}, 0.40)`);
    skyGrad.addColorStop(1.0, `rgba(${rgb}, 0.62)`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, restY - 90, this.width, 94);

    // ─── Water-side fade (below the surface) ─────────────────────────────
    const waterGrad = ctx.createLinearGradient(0, restY, 0, restY + 36);
    waterGrad.addColorStop(0.0, `rgba(${rgb}, 0.50)`);
    waterGrad.addColorStop(0.45, `rgba(${rgb}, 0.18)`);
    waterGrad.addColorStop(1.0, `rgba(${rgb}, 0)`);
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, restY, this.width, 36);
  }

  /**
   * Stylized surface line — bezier-smoothed path through the spring nodes,
   * plus a soft highlight strip just beneath it.
   */
  drawSurface(ctx: CanvasRenderingContext2D): void {
    const pts = this.surfacePoints();

    // Sub-surface highlight band — warm cream sliver under the surface.
    ctx.save();
    ctx.beginPath();
    this.tracePath(ctx, pts);
    ctx.lineTo(this.width, this.height);
    ctx.lineTo(0, this.height);
    ctx.closePath();
    ctx.clip();

    const highlightHeight = 18;
    const hi = ctx.createLinearGradient(0, this.restY - 4, 0, this.restY + highlightHeight);
    hi.addColorStop(0, this.colors.surfaceHighlight);
    hi.addColorStop(1, "rgba(255,245,220,0)");
    ctx.fillStyle = hi;
    ctx.fillRect(0, this.restY - 4, this.width, highlightHeight + 4);
    ctx.restore();

    // Foam stroke — slightly thicker and warmer than the previous icy white.
    ctx.save();
    ctx.beginPath();
    this.tracePath(ctx, pts);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.0;
    ctx.strokeStyle = this.colors.foam;
    ctx.stroke();
    ctx.restore();
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Internal helpers
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Trace a single streak path through bezier-smoothed wobble points.
   * The streak's center x is snapped to `stepSizePx` multiples — this
   * produces the deliberate "stepped" feel instead of buttery flow.
   */
  private traceStreak(ctx: CanvasRenderingContext2D, s: FoamStreak, t: number): void {
    const N = 12;
    const samples: { x: number; y: number }[] = [];
    const step = this.cfgCaustics.stepSizePx;
    const snappedX = Math.round(s.x / step) * step;
    const leftX = snappedX - s.halfLen;
    const len = s.halfLen * 2;

    const phaseTime = t * s.wobbleFreq * Math.PI * 2 + s.wobblePhase;

    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const x = leftX + f * len;
      const surfY = this.sampleAtX(x);
      // Two-frequency wobble — gives the line an organic, hand-drawn flow.
      const w1 = Math.sin(phaseTime + f * Math.PI * 2 * s.wobbleWaves) * s.wobbleAmp;
      const w2 = Math.sin(phaseTime * 1.4 + f * Math.PI * 2 * s.wobbleWaves * 2) * s.wobbleAmp * 0.35;
      samples.push({ x, y: surfY + s.depth + w1 + w2 });
    }

    ctx.beginPath();
    this.tracePath(ctx, samples);
  }

  /** Generate the initial streak pool — one streak per depth lane. */
  private makeStreaks(): FoamStreak[] {
    const cfg = this.cfgCaustics;
    const out: FoamStreak[] = [];
    for (let i = 0; i < cfg.streakCount; i++) {
      const s = this.spawnStreak(i);
      // Initial position: spread across the visible width so the scene
      // is populated immediately, not a slow build from off-screen.
      s.x = ((i + 0.4) / cfg.streakCount) * this.width;
      out.push(s);
    }
    return out;
  }

  /**
   * Build a streak with randomized properties. Depth is locked by laneIndex
   * (each lane spans an equal slice of [depthMin, depthMax]) so two streaks
   * are never at the same vertical position. All streaks drift right→left.
   */
  private spawnStreak(laneIndex: number): FoamStreak {
    const cfg = this.cfgCaustics;
    // Lane → depth mapping. Lane 0 = shallowest (closest to surface),
    // lane (N-1) = deepest. Equal spacing keeps the scene balanced.
    const laneT =
      cfg.streakCount > 1 ? laneIndex / (cfg.streakCount - 1) : 0.5;
    const depth = cfg.depthMin + laneT * (cfg.depthMax - cfg.depthMin);
    const speed = rand(cfg.speedMin, cfg.speedMax);

    return {
      x: 0,
      vx: -speed, // Always right → left for uniform flow.
      halfLen: rand(cfg.lengthMin, cfg.lengthMax) / 2,
      thickness: rand(cfg.thicknessMin, cfg.thicknessMax),
      depth,
      wobbleAmp: rand(cfg.wobbleAmplitudeMin, cfg.wobbleAmplitudeMax),
      wobbleFreq: rand(cfg.wobbleFreqMin, cfg.wobbleFreqMax),
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleWaves: 1.5 + Math.random() * 2,
      paletteIndex: Math.random() < 0.55 ? 0 : 1,
      laneIndex,
    };
  }

  /**
   * Re-randomize an existing streak in place at the given off-screen x.
   * Depth + laneIndex are preserved so the lane assignment is permanent —
   * preventing any visual reshuffle and guaranteeing no overlap.
   */
  private respawnStreak(s: FoamStreak, newX: number): void {
    const cfg = this.cfgCaustics;
    s.x = newX;
    // depth + laneIndex intentionally left untouched
    s.wobblePhase = Math.random() * Math.PI * 2;
    s.wobbleAmp = rand(cfg.wobbleAmplitudeMin, cfg.wobbleAmplitudeMax);
    s.wobbleFreq = rand(cfg.wobbleFreqMin, cfg.wobbleFreqMax);
    s.halfLen = rand(cfg.lengthMin, cfg.lengthMax) / 2;
    s.thickness = rand(cfg.thicknessMin, cfg.thicknessMax);
    s.paletteIndex = Math.random() < 0.55 ? 0 : 1;
    // vx stays negative (right → left), already set at spawn.
  }

  /** Clip subsequent drawing to the area at or below the surface line. */
  private clipBelowSurface(ctx: CanvasRenderingContext2D): void {
    const pts = this.surfacePoints();
    ctx.beginPath();
    this.tracePath(ctx, pts);
    ctx.lineTo(this.width, this.height);
    ctx.lineTo(0, this.height);
    ctx.closePath();
    ctx.clip();
  }

  /** Build the (x, y) sample points along the live surface. */
  private surfacePoints(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const step = this.width / (this.nodeCount - 1);
    for (let i = 0; i < this.nodeCount; i++) {
      out.push({ x: i * step, y: this.restY + this.y[i] });
    }
    return out;
  }

  /**
   * Trace a quadratic-smoothed path through points (midpoint method).
   * Produces the "hand-drawn" continuous feel without sharp segments.
   */
  private tracePath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
    if (pts.length === 0) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const cx = (pts[i].x + pts[i + 1].x) / 2;
      const cy = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, cx, cy);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
