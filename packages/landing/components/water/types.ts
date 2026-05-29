/**
 * Shared types so the engine + render glue agree on contracts without
 * circular imports. Streams are drawn as opaque paths (not particles)
 * so there's no Droplet type — just splash bits and sparkles.
 */

/** Cartoon-style splash droplet thrown off at a stream impact point. */
export interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  /** Lifetime so far (ms). */
  life: number;
  maxLife: number;
}

/** Four-point anime sparkle for click feedback. */
export interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  life: number;
  maxLife: number;
}

/** Used by the stream renderer to sample the live surface y. */
export interface SurfaceSampler {
  sampleAtX(x: number): number;
  readonly width: number;
}
