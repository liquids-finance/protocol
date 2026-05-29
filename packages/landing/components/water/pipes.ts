import type { WATER_CONFIG } from "./config";

type PipesConfig = (typeof WATER_CONFIG)["pipes"];
type ColorConfig = (typeof WATER_CONFIG)["colors"];

interface PipeGeometry {
  centerX: number;
  trunkLeft: number;
  trunkRight: number;
  trunkTop: number;
  trunkBottom: number;
  flangeLeft: number;
  flangeRight: number;
  flangeTop: number;
  flangeBottom: number;
  mouthY: number;
  emitColor: string;
}

export interface EmitPoint {
  x: number;
  y: number;
  color: string;
}

/**
 * Anime/cel-shaded industrial pipe pair hanging from the canvas top.
 *
 * The previous "ultra realistic" 5-stop gradient + pitch-black rivets clashed
 * with the new warm Ghibli sky. This version uses a softer warm-copper palette
 * (pastel peach highlight, warm copper mid, warm brown edge) plus a crisp
 * dark-brown vector outline around the silhouette — the cel-shaded vector
 * look that matches the rest of the scene.
 */
export class IndustrialPipes {
  readonly width: number;
  readonly height: number;
  private readonly cfg: PipesConfig;
  private readonly colors: ColorConfig;
  readonly leftPipe: PipeGeometry;
  readonly rightPipe: PipeGeometry;

  constructor(
    width: number,
    height: number,
    cfg: PipesConfig,
    colors: ColorConfig,
    leftStreamColor: string,
    rightStreamColor: string
  ) {
    this.width = width;
    this.height = height;
    this.cfg = cfg;
    this.colors = colors;
    this.leftPipe = this.buildPipe(cfg.inset * width, leftStreamColor);
    this.rightPipe = this.buildPipe((1 - cfg.inset) * width, rightStreamColor);
  }

  get emitters(): readonly EmitPoint[] {
    return [
      { x: this.leftPipe.centerX, y: this.leftPipe.mouthY, color: this.leftPipe.emitColor },
      { x: this.rightPipe.centerX, y: this.rightPipe.mouthY, color: this.rightPipe.emitColor },
    ];
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.drawPipe(ctx, this.leftPipe);
    this.drawPipe(ctx, this.rightPipe);
  }

  // ════════════════════════════════════════════════════════════════════════
  //   Geometry + rendering
  // ════════════════════════════════════════════════════════════════════════

  private buildPipe(centerX: number, emitColor: string): PipeGeometry {
    const tw = this.cfg.trunkWidth;
    const th = this.cfg.trunkHeight;
    const fh = this.cfg.flangeHeight;
    const fo = this.cfg.flangeOverhang;
    return {
      centerX,
      trunkLeft: centerX - tw / 2,
      trunkRight: centerX + tw / 2,
      trunkTop: -2,
      trunkBottom: th,
      flangeLeft: centerX - tw / 2 - fo,
      flangeRight: centerX + tw / 2 + fo,
      flangeTop: th,
      flangeBottom: th + fh,
      mouthY: th + fh,
      emitColor,
    };
  }

  private drawPipe(ctx: CanvasRenderingContext2D, g: PipeGeometry): void {
    const c = this.colors;

    // ─── Trunk fill — cel-shaded gradient ────────────────────────────────
    // 3 hard stops: edge → highlight band → edge. Sharper than a smooth
    // 5-stop because cel-shading prefers blocks of color over photoreal.
    const tg = ctx.createLinearGradient(g.trunkLeft, 0, g.trunkRight, 0);
    tg.addColorStop(0.0, c.pipeEdge);
    tg.addColorStop(0.32, c.pipeMid);
    tg.addColorStop(0.5, c.pipeHighlight);
    tg.addColorStop(0.68, c.pipeMid);
    tg.addColorStop(1.0, c.pipeEdge);
    ctx.fillStyle = tg;
    ctx.fillRect(g.trunkLeft, g.trunkTop, g.trunkRight - g.trunkLeft, g.trunkBottom - g.trunkTop);

    // ─── Flange fill (slightly darker palette) ───────────────────────────
    const fg = ctx.createLinearGradient(g.flangeLeft, 0, g.flangeRight, 0);
    fg.addColorStop(0.0, c.flangeEdge);
    fg.addColorStop(0.32, c.flangeMid);
    fg.addColorStop(0.5, c.flangeHighlight);
    fg.addColorStop(0.68, c.flangeMid);
    fg.addColorStop(1.0, c.flangeEdge);
    ctx.fillStyle = fg;
    ctx.fillRect(g.flangeLeft, g.flangeTop, g.flangeRight - g.flangeLeft, g.flangeBottom - g.flangeTop);

    // ─── Vector outline tracing the combined silhouette ──────────────────
    // Anime/cel-shaded look needs a crisp dark stroke around the shape.
    ctx.beginPath();
    ctx.moveTo(g.trunkLeft, g.trunkTop);
    ctx.lineTo(g.trunkLeft, g.trunkBottom);
    ctx.lineTo(g.flangeLeft, g.flangeTop);
    ctx.lineTo(g.flangeLeft, g.flangeBottom);
    ctx.lineTo(g.flangeRight, g.flangeBottom);
    ctx.lineTo(g.flangeRight, g.flangeTop);
    ctx.lineTo(g.trunkRight, g.trunkBottom);
    ctx.lineTo(g.trunkRight, g.trunkTop);
    ctx.strokeStyle = c.pipeOutline;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.stroke();

    // ─── Rivets — small dark warm-brown circles, mirrored ────────────────
    ctx.fillStyle = c.rivetColor;
    const rivetY = (g.flangeTop + g.flangeBottom) / 2;
    const flangeWidth = g.flangeRight - g.flangeLeft;
    const edgePad = flangeWidth * 0.12;
    const usable = flangeWidth - edgePad * 2;
    for (let i = 0; i < this.cfg.rivetCount; i++) {
      const t = this.cfg.rivetCount > 1 ? i / (this.cfg.rivetCount - 1) : 0.5;
      const rx = g.flangeLeft + edgePad + t * usable;
      ctx.beginPath();
      ctx.arc(rx, rivetY, this.cfg.rivetRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // ─── Soft warm ground shadow below the flange ────────────────────────
    const shadow = ctx.createLinearGradient(0, g.flangeBottom, 0, g.flangeBottom + 6);
    shadow.addColorStop(0, c.pipeShadow);
    shadow.addColorStop(1, "rgba(80, 40, 20, 0)");
    ctx.fillStyle = shadow;
    ctx.fillRect(g.flangeLeft, g.flangeBottom, flangeWidth, 6);
  }
}
