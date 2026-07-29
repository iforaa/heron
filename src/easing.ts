/**
 * Easing functions that are exactly what CSS will run.
 *
 * This is the foundation of Heron's parity contract: the evaluator (what the
 * agent inspects) and the compiled stylesheet (what the browser plays) must
 * agree. They can only agree if the interpolation math is identical, so every
 * easing here carries both its CSS serialization and a JS implementation of
 * the same curve. Nothing may be added to this module that CSS cannot express.
 */

export interface Easing {
  /** Exact CSS `animation-timing-function` value. */
  readonly css: string;
  /**
   * Identity for comparison, derived from the curve itself rather than from how
   * it prints. `easeInOut` and a hand-written `cubicBezier(.42,0,.58,1)` are the
   * same curve; comparing serializations would call them different and bake a
   * part that did not need baking.
   */
  readonly key: string;
  /** Progress remap, [0,1] -> [0,1]. Must match `css` numerically. */
  readonly fn: (p: number) => number;
}

/** Solves the CSS cubic-bezier curve the same way browsers do. */
function bezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;

    // Newton-Raphson, falling back to bisection when the curve goes flat.
    let t = p;
    for (let i = 0; i < 8; i++) {
      const x = sampleX(t) - p;
      if (Math.abs(x) < 1e-7) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-7) break;
      t -= x / d;
    }
    let lo = 0;
    let hi = 1;
    t = p;
    while (lo < hi) {
      const x = sampleX(t);
      if (Math.abs(x - p) < 1e-7) break;
      if (x < p) lo = t;
      else hi = t;
      t = (hi + lo) / 2;
      if (hi - lo < 1e-7) break;
    }
    return sampleY(t);
  };
}

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  return {
    css: `cubic-bezier(${x1},${y1},${x2},${y2})`,
    key: `b:${x1},${y1},${x2},${y2}`,
    fn: bezier(x1, y1, x2, y2),
  };
}

export function steps(n: number, pos: 'start' | 'end' = 'end'): Easing {
  return {
    css: `steps(${n}, ${pos})`,
    key: `s:${n},${pos}`,
    fn: (p) => {
      const s = pos === 'start' ? Math.ceil(p * n) : Math.floor(p * n);
      return Math.min(1, Math.max(0, s / n));
    },
  };
}

export const linear: Easing = { css: 'linear', key: 'b:0,0,1,1', fn: (p) => p };

/** A curve that prints as a CSS keyword but keeps its control points as identity. */
function keyword(css: string, x1: number, y1: number, x2: number, y2: number): Easing {
  return { ...cubicBezier(x1, y1, x2, y2), css };
}

/** The CSS keyword curves, by their spec-defined control points. */
export const ease = keyword('ease', 0.25, 0.1, 0.25, 1);
export const easeIn = keyword('ease-in', 0.42, 0, 1, 1);
export const easeOut = keyword('ease-out', 0, 0, 0.58, 1);
export const easeInOut = keyword('ease-in-out', 0.42, 0, 0.58, 1);

/**
 * Arrives at the next keyframe with non-zero velocity. Standard ease-out curves
 * land at zero speed, which makes a limb visibly stall at the end of a swing;
 * this is the curve to reach for when motion must flow through a keyframe
 * rather than settle on it.
 */
export const glide: Easing = cubicBezier(0.4, 0, 0.45, 1);

/** Push-off: holds, then releases. The knee breaking at the end of stance. */
export const push: Easing = cubicBezier(0.5, 0, 0.7, 1);

/** Swing: accelerates away and decelerates in. A limb travelling through air. */
export const swing: Easing = cubicBezier(0.3, 0, 0.5, 1);
