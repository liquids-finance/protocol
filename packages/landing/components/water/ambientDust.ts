import type { WATER_CONFIG } from "./config";

type DustConfig = (typeof WATER_CONFIG)["dust"];

/**
 * A single ambient mote — pre-allocated at construction, recycled in place
 * when it drifts out of the sky band. No GC pressure, fixed memory footprint.
 */
interface Mote {
  /** Rest position (mote sways around this). */
  baseX: number;
  baseY: number;
  /** Render-time position (base + sway). */
  x: number;
  y: number;
  size: number;
  /** Sine-sway phase + per-mote frequency + amplitude. */
  swayPhase: number;
  swayFreq: number;
  swayAmp: number;
  /** Vertical drift (px/sec). Positive = down, negative = up. */
  vyDrift: number;
  opacity: number;
  /** "r, g, b" string ready for `rgba(${color}, alpha)`. */
  color: string;
}

/**
 * Floating "magic dust" particles in the upper-half sky band. They drift
 * slowly + sine-sway, painted with a wider glow halo behind a brighter core
 * for that Ghibli ambient lighting feel.
 *
 * Confined to the sky region (above `surfaceRestY`). When a mote drifts past
 * either bound it gets recycled in place to the opposite edge — never
 * allocated again after construction.
 */
export class AmbientDust {
  private readonly motes: Mote[];
  private elapsed = 0;
  private width: number;
  private surfaceRestY: number;
  private readonly cfg: DustConfig;

  constructor(width: number, surfaceRestY: number, cfg: DustConfig) {
    this.width = width;
    this.surfaceRestY = surfaceRestY;
    this.cfg = cfg;
    this.motes = [];
    for (let i = 0; i < cfg.count; i++) {
      this.motes.push(this.makeMote(true));
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.elapsed += dt;

    for (const m of this.motes) {
      // Slow vertical drift.
      m.baseY += m.vyDrift * dt;
      // Sine sway around base.
      m.swayPhase += m.swayFreq * dt;
      m.x = m.baseX + Math.sin(m.swayPhase * Math.PI * 2) * m.swayAmp;
      m.y = m.baseY + Math.cos(m.swayPhase * Math.PI * 1.5) * m.swayAmp * 0.7;

      // Recycle when leaving the sky band.
      if (m.baseY < -8 || m.baseY > this.surfaceRestY - 6) {
        this.recycleMote(m);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const m of this.motes) {
      // Soft outer glow halo — wider, much more transparent.
      ctx.fillStyle = `rgba(${m.color}, ${m.opacity * 0.32})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size * 2.6, 0, Math.PI * 2);
      ctx.fill();

      // Bright core.
      ctx.fillStyle = `rgba(${m.color}, ${m.opacity})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Refresh the canvas-bound state — call from resize. */
  resize(width: number, surfaceRestY: number): void {
    this.width = width;
    this.surfaceRestY = surfaceRestY;
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Internal — mote factory + recycling
  // ════════════════════════════════════════════════════════════════════════

  private makeMote(scatter: boolean): Mote {
    const colors = this.cfg.colors;
    const baseX = Math.random() * this.width;
    // Either scatter (initial fill) or spawn at top edge (recycle from above).
    const baseY = scatter ? Math.random() * this.surfaceRestY * 0.95 : -4;
    return {
      baseX,
      baseY,
      x: baseX,
      y: baseY,
      size: this.cfg.sizeMin + Math.random() * (this.cfg.sizeMax - this.cfg.sizeMin),
      swayPhase: Math.random() * Math.PI * 2,
      swayFreq: this.cfg.swayFreqMin + Math.random() * (this.cfg.swayFreqMax - this.cfg.swayFreqMin),
      swayAmp: this.cfg.swayAmpMin + Math.random() * (this.cfg.swayAmpMax - this.cfg.swayAmpMin),
      vyDrift: (Math.random() - 0.5) * this.cfg.driftSpeedMax * 2,
      opacity: this.cfg.opacityMin + Math.random() * (this.cfg.opacityMax - this.cfg.opacityMin),
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  }

  /** Reset a mote in place — keeps the same Mote object reference, no alloc. */
  private recycleMote(m: Mote): void {
    const colors = this.cfg.colors;
    m.baseX = Math.random() * this.width;
    // Enter from the side the mote was drifting from so the band stays full.
    m.baseY = m.vyDrift > 0 ? -4 : this.surfaceRestY - 8;
    m.x = m.baseX;
    m.y = m.baseY;
    m.size = this.cfg.sizeMin + Math.random() * (this.cfg.sizeMax - this.cfg.sizeMin);
    m.swayPhase = Math.random() * Math.PI * 2;
    m.swayFreq =
      this.cfg.swayFreqMin + Math.random() * (this.cfg.swayFreqMax - this.cfg.swayFreqMin);
    m.swayAmp = this.cfg.swayAmpMin + Math.random() * (this.cfg.swayAmpMax - this.cfg.swayAmpMin);
    m.vyDrift = (Math.random() - 0.5) * this.cfg.driftSpeedMax * 2;
    m.opacity = this.cfg.opacityMin + Math.random() * (this.cfg.opacityMax - this.cfg.opacityMin);
    m.color = colors[Math.floor(Math.random() * colors.length)];
  }
}
