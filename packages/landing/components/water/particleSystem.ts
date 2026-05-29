import type { WATER_CONFIG } from "./config";
import type { Splash, Sparkle } from "./types";

type SplashesConfig = (typeof WATER_CONFIG)["splashes"];
type SparklesConfig = (typeof WATER_CONFIG)["sparkles"];
type LimitsConfig = (typeof WATER_CONFIG)["limits"];

/**
 * Pooled particle system for stylized cartoon splashes + sparkles only.
 * Falling/sinking droplets are gone — streams are now drawn as continuous
 * opaque paths, so there's no need for a metaball blur layer or per-frame
 * radial-gradient costs.
 *
 * Two populations, each backed by an active + free pool:
 *   • Splashes — opaque colored bits thrown sideways from stream impacts
 *   • Sparkles — four-point stars from pointer clicks
 *
 * Acquire / release use swap-and-pop for O(1) churn and zero GC.
 */
export class ParticleSystem {
  private readonly splashCfg: SplashesConfig;
  private readonly sparkleCfg: SparklesConfig;
  private readonly limits: LimitsConfig;

  private readonly splashesActive: Splash[] = [];
  private readonly splashesFree: Splash[] = [];
  private readonly sparklesActive: Sparkle[] = [];
  private readonly sparklesFree: Sparkle[] = [];

  constructor(splashCfg: SplashesConfig, sparkleCfg: SparklesConfig, limits: LimitsConfig) {
    this.splashCfg = splashCfg;
    this.sparkleCfg = sparkleCfg;
    this.limits = limits;
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Spawn API — called from StreamSystem + pointer handler
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Throw a small burst of splash bits sideways from the stream's contact
   * point at (x, y). Side bias intentionally drives the velocity away from
   * vertical so the splash spreads to the left and right, never straight up
   * into the stream column.
   */
  spawnStreamSplash(x: number, y: number, color: string): void {
    const n = randInt(this.splashCfg.perImpactMin, this.splashCfg.perImpactMax);
    for (let i = 0; i < n; i++) {
      const s = this.acquireSplash();
      if (!s) break;
      // Side bias: each particle picks left OR right (50/50) then deflects
      // slightly toward vertical for an arc trajectory.
      const side: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      const horizontal = rand(this.splashCfg.speedMin, this.splashCfg.speedMax);
      // Strong upward kick — config now owns this so we can tune the
      // sky-arc visibility without touching the engine. Bits fly above
      // the horizon and arc back through it, gluing the sky and water
      // layers together.
      const upward = rand(this.splashCfg.upwardSpeedMin, this.splashCfg.upwardSpeedMax);
      s.x = x;
      s.y = y - 2;
      s.vx = side * horizontal;
      s.vy = -upward;
      s.size = rand(this.splashCfg.sizeMin, this.splashCfg.sizeMax);
      s.color = color;
      s.life = 0;
      s.maxLife = rand(this.splashCfg.lifeMsMin, this.splashCfg.lifeMsMax);
      this.splashesActive.push(s);
    }
  }

  /** Four-point sparkle burst for click feedback. */
  addSparkleBurst(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const sp = this.acquireSparkle();
      if (!sp) break;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
      const speed = this.sparkleCfg.speed * (0.7 + Math.random() * 0.6);
      sp.x = x + (Math.random() - 0.5) * 14;
      sp.y = y - 2;
      sp.vx = Math.cos(angle) * speed;
      sp.vy = Math.sin(angle) * speed;
      sp.size = rand(this.sparkleCfg.sizeMin, this.sparkleCfg.sizeMax);
      sp.rotation = Math.random() * Math.PI;
      sp.life = 0;
      sp.maxLife = this.sparkleCfg.lifeMs;
      this.sparklesActive.push(sp);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Update
  // ════════════════════════════════════════════════════════════════════════

  update(dtMs: number): void {
    const step = (dtMs / 1000) * 60;

    // ─── Splashes ────────────────────────────────────────────────────────
    for (let i = this.splashesActive.length - 1; i >= 0; i--) {
      const s = this.splashesActive[i];
      s.vy += this.splashCfg.gravity * step;
      s.x += s.vx * step;
      s.y += s.vy * step;
      s.life += dtMs;
      if (s.life >= s.maxLife) this.releaseSplash(i);
    }

    // ─── Sparkles ────────────────────────────────────────────────────────
    for (let i = this.sparklesActive.length - 1; i >= 0; i--) {
      const sp = this.sparklesActive[i];
      sp.x += sp.vx * step;
      sp.y += sp.vy * step;
      sp.vy += 0.05 * step;
      sp.rotation += 0.04 * step;
      sp.life += dtMs;
      if (sp.life >= sp.maxLife) this.releaseSparkle(i);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Rendering — both populations 100% opaque until late-life quick fade
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Stylized cartoon splashes. Solid opaque fill until the last 30% of life,
   * then a fast linear alpha-out — produces the "pop and vanish" feel
   * without any per-pixel blending tricks.
   */
  drawSplashes(ctx: CanvasRenderingContext2D): void {
    for (const s of this.splashesActive) {
      const t = s.life / s.maxLife;
      const alpha = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
      ctx.beginPath();
      ctx.fillStyle = alpha === 1 ? s.color : withAlpha(s.color, alpha);
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawSparkles(ctx: CanvasRenderingContext2D): void {
    for (const sp of this.sparklesActive) {
      const t = sp.life / sp.maxLife;
      const alpha = Math.sin(t * Math.PI) * 0.95;
      const len = sp.size * (1 - t * 0.5);

      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(sp.rotation);
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";

      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(len, 0);
      ctx.moveTo(0, -len);
      ctx.lineTo(0, len);
      ctx.stroke();

      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(0, 0, len * 0.18, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Object pool — swap-and-pop release for O(1) churn, zero GC
  // ════════════════════════════════════════════════════════════════════════

  private acquireSplash(): Splash | null {
    const s = this.splashesFree.pop();
    if (s) return s;
    if (this.splashesActive.length >= this.limits.maxSplashes) return null;
    return makeEmptySplash();
  }
  private releaseSplash(activeIdx: number): void {
    const last = this.splashesActive.length - 1;
    const s = this.splashesActive[activeIdx];
    if (activeIdx !== last) this.splashesActive[activeIdx] = this.splashesActive[last];
    this.splashesActive.pop();
    this.splashesFree.push(s);
  }

  private acquireSparkle(): Sparkle | null {
    const sp = this.sparklesFree.pop();
    if (sp) return sp;
    if (this.sparklesActive.length >= this.limits.maxSparkles) return null;
    return makeEmptySparkle();
  }
  private releaseSparkle(activeIdx: number): void {
    const last = this.sparklesActive.length - 1;
    const sp = this.sparklesActive[activeIdx];
    if (activeIdx !== last) this.sparklesActive[activeIdx] = this.sparklesActive[last];
    this.sparklesActive.pop();
    this.sparklesFree.push(sp);
  }
}

// ──────────────────────────────────────────────────────────────────────────
//   Factories for empty pool objects
// ──────────────────────────────────────────────────────────────────────────

function makeEmptySplash(): Splash {
  return { x: 0, y: 0, vx: 0, vy: 0, size: 0, color: "#fff", life: 0, maxLife: 0 };
}
function makeEmptySparkle(): Sparkle {
  return { x: 0, y: 0, vx: 0, vy: 0, size: 0, rotation: 0, life: 0, maxLife: 0 };
}

// ──────────────────────────────────────────────────────────────────────────
//   Helpers
// ──────────────────────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function withAlpha(color: string, a: number): string {
  if (color.startsWith("#")) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return color.replace(/rgba?\(([^)]+)\)/, (_match, body: string) => {
    const parts = body.split(",").map((s: string) => s.trim());
    return `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`;
  });
}
