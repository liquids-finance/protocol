import type { WATER_CONFIG } from "./config";
import type { SurfaceSampler } from "./types";

type UnderwaterConfig = (typeof WATER_CONFIG)["underwater"];
type ColorConfig = (typeof WATER_CONFIG)["colors"];

/**
 * Rising bubble — sine sway around `baseX`, pops on hitting `deathY`. Most
 * bubbles die at the surface; the rest pop somewhere in the middle for
 * organic depth variety.
 */
interface Bubble {
  baseX: number;
  x: number;
  y: number;
  rise: number;
  size: number;
  swayPhase: number;
  swayFreq: number;
  opacity: number;
  deathY: number;
}

/** Expanding ring at a bubble pop location. */
interface PopRing {
  x: number;
  y: number;
  startRadius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
}

/**
 * Underwater scene — pooled bubbles + pop rings only, with a vertical
 * "depth tint" overlay drawn LAST so deeper particles read as fading into
 * the navy.
 *
 * Performance:
 *   • Two swap-and-pop object pools (Bubble / PopRing) → zero GC steady-state.
 *   • Spawn intervals randomized per slot → organic pacing.
 */
export class UnderwaterScene {
  readonly width: number;
  readonly height: number;
  readonly surfaceRestY: number;

  private elapsed = 0;
  private readonly cfg: UnderwaterConfig;
  private readonly colors: ColorConfig;

  private readonly bubblesActive: Bubble[] = [];
  private readonly bubblesFree: Bubble[] = [];
  private readonly popsActive: PopRing[] = [];
  private readonly popsFree: PopRing[] = [];

  private bubbleAccumMs = 0;
  private nextBubbleIntervalMs: number;

  constructor(
    width: number,
    height: number,
    surfaceRestY: number,
    cfg: UnderwaterConfig,
    colors: ColorConfig
  ) {
    this.width = width;
    this.height = height;
    this.surfaceRestY = surfaceRestY;
    this.cfg = cfg;
    this.colors = colors;
    this.nextBubbleIntervalMs = this.randomBubbleInterval();
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Update — physics + spawn timers
  // ════════════════════════════════════════════════════════════════════════

  update(dtMs: number, surface: SurfaceSampler): void {
    const dt = dtMs / 1000;
    this.elapsed += dt;

    // ─── Bubble spawning ─────────────────────────────────────────────────
    this.bubbleAccumMs += dtMs;
    while (
      this.bubbleAccumMs >= this.nextBubbleIntervalMs &&
      this.bubblesActive.length < this.cfg.bubbleMaxActive
    ) {
      this.bubbleAccumMs -= this.nextBubbleIntervalMs;
      this.nextBubbleIntervalMs = this.randomBubbleInterval();
      this.spawnBubble();
    }

    // ─── Bubble physics ──────────────────────────────────────────────────
    for (let i = this.bubblesActive.length - 1; i >= 0; i--) {
      const b = this.bubblesActive[i];
      b.y -= b.rise * dt;
      b.swayPhase += b.swayFreq * dt;
      b.x = b.baseX + Math.sin(b.swayPhase * Math.PI * 2) * this.cfg.bubbleSwayAmpPx;

      // Two death conditions — surface (using live spring sample) and the
      // randomized `deathY` set at spawn time. Whichever the bubble hits first.
      const surfY = surface.sampleAtX(b.x);
      const dieAt = Math.max(b.deathY, surfY);
      if (b.y < dieAt + 3) {
        this.spawnPopRing(b.x, b.y, b.size);
        this.releaseBubble(i);
      }
    }

    // ─── Pop rings ───────────────────────────────────────────────────────
    for (let i = this.popsActive.length - 1; i >= 0; i--) {
      const p = this.popsActive[i];
      p.life += dtMs;
      if (p.life >= p.maxLife) this.releasePop(i);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Rendering
  // ════════════════════════════════════════════════════════════════════════

  draw(ctx: CanvasRenderingContext2D): void {
    for (const b of this.bubblesActive) this.drawBubble(ctx, b);
    for (const p of this.popsActive) this.drawPop(ctx, p);
    // Depth tint LAST so it applies the wash uniformly over the bubbles.
    this.drawDepthTint(ctx);
  }

  /**
   * Bubble rendered as a dark-navy refraction lens instead of a bright
   * soap foam dot. The translucent body picks up the deep-water tone, the
   * thin outline pops it slightly, and the inner pip is a muted blue (not
   * pure white) — together they read as "light bending through water".
   */
  private drawBubble(ctx: CanvasRenderingContext2D, b: Bubble): void {
    const r = b.size;
    const a = b.opacity;

    // Body — semi-transparent dark navy.
    ctx.fillStyle = `rgba(10, 28, 58, ${a * 0.95})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Outline — a hair lighter than the body for definition.
    ctx.strokeStyle = `rgba(35, 70, 120, ${Math.min(1, a + 0.18)})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Inner refraction pip — muted cool blue, NOT bright white.
    ctx.fillStyle = `rgba(110, 160, 210, ${a * 0.55})`;
    ctx.beginPath();
    ctx.arc(b.x - r * 0.32, b.y - r * 0.32, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPop(ctx: CanvasRenderingContext2D, p: PopRing): void {
    const t = p.life / p.maxLife;
    const radius = p.startRadius + t * (p.maxRadius - p.startRadius);
    const alpha = (1 - t) * 0.7;
    ctx.strokeStyle = `rgba(150, 200, 230, ${alpha})`;
    ctx.lineWidth = 1.6 * (1 - t * 0.4);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Vertical depth tint — near-clear just below the surface, opaque navy at
   * the deep floor. Sells the "peering down into water" feeling without any
   * per-particle color math.
   */
  private drawDepthTint(ctx: CanvasRenderingContext2D): void {
    const tint = ctx.createLinearGradient(0, this.surfaceRestY, 0, this.height);
    tint.addColorStop(0, `rgba(20, 50, 100, ${this.cfg.depthTintSurfaceAlpha})`);
    tint.addColorStop(0.55, `rgba(15, 40, 80, ${this.cfg.depthTintDeepAlpha * 0.55})`);
    tint.addColorStop(1, `rgba(8, 28, 55, ${this.cfg.depthTintDeepAlpha})`);
    ctx.fillStyle = tint;
    ctx.fillRect(0, this.surfaceRestY, this.width, this.height - this.surfaceRestY);
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Spawners
  // ════════════════════════════════════════════════════════════════════════

  private spawnBubble(): void {
    const b = this.acquireBubble();
    if (!b) return;
    const baseX = randomBetween(40, this.width - 40);
    const size = randomBetween(this.cfg.bubbleSizeMin, this.cfg.bubbleSizeMax);
    b.baseX = baseX;
    b.x = baseX;
    b.y = this.height - 6;
    b.rise = randomBetween(this.cfg.bubbleRiseSpeedMinPxPerSec, this.cfg.bubbleRiseSpeedMaxPxPerSec);
    b.size = size;
    b.swayPhase = Math.random() * Math.PI * 2;
    b.swayFreq = randomBetween(this.cfg.bubbleSwayFreqMin, this.cfg.bubbleSwayFreqMax);
    b.opacity = randomBetween(this.cfg.bubbleOpacityMin, this.cfg.bubbleOpacityMax);

    if (Math.random() < this.cfg.bubbleEarlyDeathChance) {
      const midY = (this.surfaceRestY + this.height) / 2;
      b.deathY = randomBetween(this.surfaceRestY + 40, midY);
    } else {
      b.deathY = this.surfaceRestY;
    }
    this.bubblesActive.push(b);
  }

  private spawnPopRing(x: number, y: number, bubbleSize: number): void {
    const p = this.acquirePop();
    if (!p) return;
    p.x = x;
    p.y = y;
    p.startRadius = bubbleSize * 0.9;
    p.maxRadius = bubbleSize * 2.4 + 4;
    p.life = 0;
    p.maxLife = this.cfg.popRingDurationMs;
    this.popsActive.push(p);
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Object pool — swap-and-pop O(1) acquire/release
  // ════════════════════════════════════════════════════════════════════════

  private acquireBubble(): Bubble | null {
    const b = this.bubblesFree.pop();
    if (b) return b;
    if (this.bubblesActive.length >= this.cfg.bubbleMaxActive) return null;
    return {
      baseX: 0, x: 0, y: 0, rise: 0, size: 0,
      swayPhase: 0, swayFreq: 0, opacity: 0, deathY: 0,
    };
  }
  private releaseBubble(idx: number): void {
    const last = this.bubblesActive.length - 1;
    const b = this.bubblesActive[idx];
    if (idx !== last) this.bubblesActive[idx] = this.bubblesActive[last];
    this.bubblesActive.pop();
    this.bubblesFree.push(b);
  }

  private acquirePop(): PopRing | null {
    const p = this.popsFree.pop();
    if (p) return p;
    return { x: 0, y: 0, startRadius: 0, maxRadius: 0, life: 0, maxLife: 0 };
  }
  private releasePop(idx: number): void {
    const last = this.popsActive.length - 1;
    const p = this.popsActive[idx];
    if (idx !== last) this.popsActive[idx] = this.popsActive[last];
    this.popsActive.pop();
    this.popsFree.push(p);
  }

  private randomBubbleInterval(): number {
    return randomBetween(this.cfg.bubbleSpawnIntervalMinMs, this.cfg.bubbleSpawnIntervalMaxMs);
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
