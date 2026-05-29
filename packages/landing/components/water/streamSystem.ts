import type { WATER_CONFIG } from "./config";
import type { ParticleSystem } from "./particleSystem";
import type { EmitPoint } from "./pipes";
import type { WaterSurface } from "./waterSurface";

type StreamsCfg = (typeof WATER_CONFIG)["streams"];

/**
 * Per-stream runtime state. The two color stops are picked at construction
 * (one stream is brand-pink, the other brand-blue) so the draw method can
 * build a horizontal gradient quickly each frame.
 */
interface Stream {
  emitX: number;
  emitY: number;
  edgeColor: string;
  centerColor: string;
  /** Color used by the splash-particle factory. */
  splashColor: string;
  splashAccumMs: number;
}

/**
 * Continuous liquid stream renderer + surface impact driver.
 *
 *   • Each frame: applies a small capped impulse at the surface impact x
 *     (Gaussian-spread → soft dimple, no chaotic build-up).
 *   • Renders the column as a single closed path filled with a horizontal
 *     gradient (edge-dark → center-bright → edge-dark) → fake 3D cylinder.
 *   • The path's centerline gently snakes left/right with a low-amplitude
 *     sine wave so the stream reads as flowing liquid, not a rigid bar.
 *   • A separate "underwater fade" path continues below the surface with a
 *     vertical alpha gradient — the column dissolves into the pool color
 *     rather than getting sliced flat at the water line.
 *   • Splash particles are spawned on a throttled timer.
 *
 * Performance: 4 fill() calls per frame (2 streams × above + below water) +
 * 2 impulseRadius() calls. No blur, no compositing, no per-pixel work.
 */
export class StreamSystem {
  private elapsed = 0;
  private readonly cfg: StreamsCfg;
  private readonly streams: Stream[];

  constructor(cfg: StreamsCfg, emitters: readonly EmitPoint[]) {
    this.cfg = cfg;
    // Pair each emit point with its center-color sibling. The emit order
    // matches pipes.emitters: [left, right].
    const centerColors = [cfg.leftCenterColor, cfg.rightCenterColor];
    this.streams = emitters.map((e, i) => ({
      emitX: e.x,
      emitY: e.y,
      edgeColor: e.color,
      centerColor: centerColors[i],
      splashColor: e.color,
      splashAccumMs: Math.random() * cfg.splashIntervalMs, // de-sync streams
    }));
  }

  update(dtMs: number, surface: WaterSurface, particles: ParticleSystem): void {
    this.elapsed += dtMs / 1000;

    for (const s of this.streams) {
      // Continuous downward force at the contact point.
      surface.impulseRadius(s.emitX, this.cfg.impactForce, this.cfg.impactRadius);

      // Throttled splash spawn at the LIVE surface y.
      s.splashAccumMs += dtMs;
      if (s.splashAccumMs >= this.cfg.splashIntervalMs) {
        s.splashAccumMs -= this.cfg.splashIntervalMs;
        const sY = surface.sampleAtX(s.emitX);
        particles.spawnStreamSplash(s.emitX, sY, s.splashColor);
      }
    }
  }

  /**
   * Render each stream as two filled paths:
   *   1. Above-surface 3D cylinder (horizontal gradient).
   *   2. Below-surface fade (vertical alpha gradient that vanishes into water).
   *
   * Caller should invoke this AFTER body/underwater/caustics so the underwater
   * fade lays over the pool gradient, and BEFORE the surface foam stroke so
   * the surface line caps the visual cleanly at the impact point.
   */
  draw(ctx: CanvasRenderingContext2D, surface: WaterSurface): void {
    for (const s of this.streams) this.drawStream(ctx, s, surface);
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Internal — path builders + dual-section fill
  // ════════════════════════════════════════════════════════════════════════

  /** Sample (x, y) points for the left and right edges of the stream over a
   *  vertical range. Edges include centerline sway + width breathing. */
  private buildSilhouette(
    s: Stream,
    yTop: number,
    yBottom: number,
    segs: number
  ): { left: { x: number; y: number }[]; right: { x: number; y: number }[] } {
    const left: { x: number; y: number }[] = [];
    const right: { x: number; y: number }[] = [];
    const totalH = yBottom - yTop;
    const widthPhase = this.elapsed * this.cfg.widthFreq * Math.PI * 2;
    const swayPhase = this.elapsed * this.cfg.centerSwayFreq * Math.PI * 2;

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = yTop + t * totalH;
      // Width modulation (breathing along + time).
      const w = this.cfg.widthBase + Math.sin(widthPhase + t * Math.PI * 2.4) * this.cfg.widthAmp;
      // Centerline sway — phase varies with depth so the column snakes.
      const cx = s.emitX + Math.sin(swayPhase + t * Math.PI * 1.4) * this.cfg.centerSwayAmp;
      left.push({ x: cx - w * 0.5, y });
      right.push({ x: cx + w * 0.5, y });
    }
    return { left, right };
  }

  private drawStream(ctx: CanvasRenderingContext2D, s: Stream, surface: WaterSurface): void {
    const yTop = s.emitY;
    const ySurface = surface.sampleAtX(s.emitX);

    // ─── Above-water column — opaque 3D cylinder ─────────────────────────
    if (ySurface > yTop + 2) {
      this.drawAboveWater(ctx, s, yTop, ySurface);
    }

    // ─── Below-water fade — vertical alpha gradient ──────────────────────
    this.drawBelowWater(ctx, s, ySurface);
  }

  private drawAboveWater(
    ctx: CanvasRenderingContext2D,
    s: Stream,
    yTop: number,
    yBottom: number
  ): void {
    const { left, right } = this.buildSilhouette(s, yTop, yBottom, this.cfg.silhouetteSegments);

    // Horizontal gradient bounds: cover the whole possible width including sway.
    const halfRange = this.cfg.widthBase * 0.5 + this.cfg.widthAmp + this.cfg.centerSwayAmp;
    const grad = ctx.createLinearGradient(
      s.emitX - halfRange,
      0,
      s.emitX + halfRange,
      0
    );
    grad.addColorStop(0.0, s.edgeColor);
    grad.addColorStop(0.5, s.centerColor);
    grad.addColorStop(1.0, s.edgeColor);

    // Soft halo around the column — shadowBlur is GPU-accelerated in modern
    // browsers and far cheaper than ctx.filter for a single shape. Isolated
    // in save/restore so it doesn't leak into anything drawn later.
    ctx.save();
    ctx.shadowColor = s.edgeColor;
    ctx.shadowBlur = this.cfg.glowBlur;
    ctx.fillStyle = grad;
    this.tracePath(ctx, left, right);
    ctx.fill();
    ctx.restore();
  }

  private drawBelowWater(ctx: CanvasRenderingContext2D, s: Stream, ySurface: number): void {
    const yBottom = ySurface + this.cfg.underwaterFadeDepth;
    const { left, right } = this.buildSilhouette(s, ySurface, yBottom, this.cfg.silhouetteSegments);

    // Vertical alpha gradient: opaque at the surface, fully transparent at
    // the fade depth — the liquid dissolves into the pool color.
    const grad = ctx.createLinearGradient(0, ySurface, 0, yBottom);
    grad.addColorStop(0.0, withAlpha(s.edgeColor, 0.92));
    grad.addColorStop(0.35, withAlpha(s.centerColor, 0.55));
    grad.addColorStop(0.75, withAlpha(s.edgeColor, 0.18));
    grad.addColorStop(1.0, withAlpha(s.edgeColor, 0));

    // Lighter glow under the surface — keeps the cohesion but doesn't bleed
    // out into the deep pool gradient.
    ctx.save();
    ctx.shadowColor = s.edgeColor;
    ctx.shadowBlur = this.cfg.glowBlur * 0.6;
    ctx.fillStyle = grad;
    this.tracePath(ctx, left, right);
    ctx.fill();
    ctx.restore();
  }

  /** Trace the closed silhouette path: down the left edge, then up the right. */
  private tracePath(
    ctx: CanvasRenderingContext2D,
    left: { x: number; y: number }[],
    right: { x: number; y: number }[]
  ): void {
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
  }
}

// ──────────────────────────────────────────────────────────────────────────
//   Local color alpha helper — kept inline so this module is import-light.
// ──────────────────────────────────────────────────────────────────────────

function withAlpha(color: string, a: number): string {
  if (color.startsWith("#")) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return color.replace(/rgba?\(([^)]+)\)/, (_match, body: string) => {
    const parts = body.split(",").map((p: string) => p.trim());
    return `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`;
  });
}
