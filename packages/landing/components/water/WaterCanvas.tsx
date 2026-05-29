"use client";

import { useEffect, useRef } from "react";

import { AmbientDust } from "./ambientDust";
import { WATER_CONFIG } from "./config";
import { ParticleSystem } from "./particleSystem";
import { IndustrialPipes } from "./pipes";
import { StreamSystem } from "./streamSystem";
import { UnderwaterScene } from "./underwater";
import { WaterSurface } from "./waterSurface";

/**
 * Canvas mount + animation loop. All simulation/rendering state lives in
 * refs so React never re-renders during animation.
 *
 * Z-order (back → front):
 *   ① gradient body
 *   ② underwater stones + plants
 *   ③ foam streaks
 *   ④ streams (opaque filled paths, pipe mouth → live surface y)
 *   ⑤ surface foam line (visually caps the bottom of each stream)
 *   ⑥ pipes (cover the seam at the stream emission point)
 *   ⑦ splashes + sparkles (sharp impact feedback above all)
 */
export function WaterCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let surface: WaterSurface | null = null;
    let underwater: UnderwaterScene | null = null;
    let pipes: IndustrialPipes | null = null;
    let streams: StreamSystem | null = null;
    let dust: AmbientDust | null = null;
    // ParticleSystem survives resize — its state is canvas-agnostic.
    const particles = new ParticleSystem(
      WATER_CONFIG.splashes,
      WATER_CONFIG.sparkles,
      WATER_CONFIG.limits
    );

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = Math.max(1, Math.floor(rect.height));
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      surface = new WaterSurface(
        cssW,
        cssH,
        WATER_CONFIG.surface,
        WATER_CONFIG.colors,
        WATER_CONFIG.caustics
      );
      underwater = new UnderwaterScene(
        cssW,
        cssH,
        cssH * WATER_CONFIG.surface.restYFraction,
        WATER_CONFIG.underwater,
        WATER_CONFIG.colors
      );
      pipes = new IndustrialPipes(
        cssW,
        cssH,
        WATER_CONFIG.pipes,
        WATER_CONFIG.colors,
        WATER_CONFIG.streams.leftColor,
        WATER_CONFIG.streams.rightColor
      );
      // StreamSystem reads pipe emit points — must be (re)built after pipes.
      streams = new StreamSystem(WATER_CONFIG.streams, pipes.emitters);

      // Ambient dust — pre-allocates all motes on first build; on resize we
      // just reuse the existing instance and refresh its canvas bounds so
      // motes already in flight don't snap to new positions.
      const restY = cssH * WATER_CONFIG.surface.restYFraction;
      if (!dust) {
        dust = new AmbientDust(cssW, restY, WATER_CONFIG.dust);
      } else {
        dust.resize(cssW, restY);
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ─── Pointer interaction (soft hover + click) ─────────────────────────
    let lastHoverMs = 0;
    const onPointerMove = (e: PointerEvent) => {
      if (!surface) return;
      const now = performance.now();
      if (now - lastHoverMs < WATER_CONFIG.pointer.hoverThrottleMs) return;
      lastHoverMs = now;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const sY = surface.sampleAtX(x);
      if (Math.abs(y - sY) < WATER_CONFIG.pointer.hoverDistanceThresholdPx) {
        surface.impulseRadius(
          x,
          WATER_CONFIG.pointer.impulseHover,
          WATER_CONFIG.pointer.impulseRadius
        );
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!surface) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      surface.impulseRadius(
        x,
        WATER_CONFIG.pointer.impulseClick,
        WATER_CONFIG.pointer.impulseRadius
      );
      const sY = surface.sampleAtX(x);
      particles.addSparkleBurst(x, sY, 4);
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);

    let paused = document.hidden;
    const onVisibility = () => {
      paused = document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);

    // ─── Animation loop ───────────────────────────────────────────────────
    let prevTs = performance.now();
    let rafId = 0;
    const tick = (ts: number) => {
      rafId = requestAnimationFrame(tick);
      if (paused) {
        prevTs = ts;
        return;
      }
      const dtMs = Math.min(48, ts - prevTs);
      prevTs = ts;
      const dt = dtMs / 1000;

      if (!surface || !underwater || !pipes || !streams || !dust) return;
      const s = surface;
      const u = underwater;
      const p = pipes;
      const st = streams;
      const d = dust;

      // ─── Simulation ──────────────────────────────────────────────────
      s.update(dt);
      u.update(dtMs, s);
      st.update(dtMs, s, particles);
      particles.update(dtMs);
      d.update(dtMs);

      // ─── Render ──────────────────────────────────────────────────────
      ctx.clearRect(0, 0, s.width, s.height);

      // ① body gradient
      s.drawBody(ctx);

      // ②a god rays — sunlight piercing from the upper-left sun, drawn
      //    above the body but below the underwater particles so bubbles
      //    appear in front of the beams.
      s.drawGodRays(ctx);

      // ②b underwater (clipped below the rest line)
      ctx.save();
      ctx.beginPath();
      const restY = s.height * WATER_CONFIG.surface.restYFraction;
      ctx.rect(0, restY - 4, s.width, s.height - restY + 8);
      ctx.clip();
      u.draw(ctx);
      ctx.restore();

      // ③ foam streaks
      s.drawCaustics(ctx);

      // ④ streams — opaque filled paths with soft halo
      st.draw(ctx, s);

      // ⑤ horizon halo — warm cream glow above the surface line, fuses sky into water
      s.drawHorizonGlow(ctx);

      // ⑥ surface foam stroke (lands on top of the halo for a crisp foam edge)
      s.drawSurface(ctx);

      // ⑦ ambient dust — Ghibli motes drifting in the upper sky band.
      //    Drawn AFTER the surface so the warm halo from drawHorizonGlow
      //    sits behind the motes, and BEFORE pipes so trunks cover any motes
      //    that happen to drift across them.
      d.draw(ctx);

      // ⑧ pipes — cover the emission seam
      p.draw(ctx);

      // ⑧ splashes + sparkles
      particles.drawSplashes(ctx);
      particles.drawSparkles(ctx);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="block size-full touch-none"
      aria-hidden
      style={{ background: "transparent" }}
    />
  );
}
