/**
 * Letting the reference correct the trace.
 *
 * Everything upstream measures the artwork once and commits to the answer. This
 * closes the loop: draw what was measured, compare it against the reference, and
 * move the geometry the way the difference points.
 *
 * The gradient is analytic, not sampled, and that is what makes it affordable.
 * Pushing an edge outward by a small amount adds exactly that much ink along it,
 * so the derivative of the score with respect to that motion is the residual
 * read off the edge itself — no perturb-and-re-render per parameter. Every
 * control point of every shape gets its gradient from a single render, which is
 * the difference between one frame per step and several hundred.
 *
 * Two motions per control point, and they are the two mistakes a traced stroke
 * actually makes:
 *
 *   - both edges want to move outward: the stroke is too narrow there
 *   - one edge wants out and the other in: the centreline is off to one side
 *
 * The first is the width, the second is the position, and reading them as a sum
 * and a difference separates them cleanly.
 *
 * This only works because the score is coverage rather than a threshold. A
 * binary overlap is a staircase — a third of a pixel of improvement changes
 * nothing at all until a pixel finally flips — so there is no slope to follow.
 */

import { type Coverage, coverage, rasterise } from './raster.ts';
import { ribbonPath } from './scene.ts';
import type { Vec2 } from './scene.ts';

export interface Ribbon {
  points: Vec2[];
  /** Half-width at each point. */
  widths: number[];
  closed: boolean;
  cap: 'round' | 'butt';
}

export interface RefineOptions {
  /** Passes over the geometry. Each one costs a single render. */
  rounds?: number;
  /** Starting step, in pixels per unit of residual. Backtracks when it overshoots. */
  step?: number;
}

export interface RefineReport {
  before: number;
  after: number;
  rounds: number;
  /** Largest distance any control point moved, in pixels. */
  moved: number;
}

/** Bilinear sample of a coverage field, clamped at the edges. */
function at(c: Coverage, x: number, y: number): number {
  const cx = Math.max(0, Math.min(c.width - 1.001, x));
  const cy = Math.max(0, Math.min(c.height - 1.001, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * c.width + x0;
  return (
    c.data[i] * (1 - fx) * (1 - fy) + c.data[i + 1] * fx * (1 - fy) +
    c.data[i + c.width] * (1 - fx) * fy + c.data[i + c.width + 1] * fx * fy
  );
}

function normalAt(points: Vec2[], i: number, closed: boolean): Vec2 {
  const n = points.length;
  const get = (k: number) => (closed ? points[((k % n) + n) % n] : points[Math.max(0, Math.min(n - 1, k))]);
  const a = get(i - 1);
  const b = get(i + 1);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

/**
 * A three-tap blur along the run.
 *
 * The residual on any single edge pixel carries the raster's noise as well as
 * the error, and a control point pulled by one noisy sample puts a kink in a
 * line that was smooth. Neighbouring points are measuring the same stroke, so
 * averaging over them keeps the signal and drops most of the noise.
 */
function smooth(g: number[], passes = SMOOTH): number[] {
  let out = g;
  for (let p = 0; p < passes; p++) {
    const prev = out;
    out = prev.map((_, i) =>
      (prev[Math.max(0, i - 1)] + 2 * prev[i] + prev[Math.min(prev.length - 1, i + 1)]) / 4);
  }
  return out;
}

/**
 * How hard the correction is blurred along each run.
 *
 * This is the dial between two things worth having, and it is not a free
 * parameter. A correction applied point by point buys local accuracy and spends
 * structure: the points end up very slightly ragged, and a circle can no longer
 * be fitted through them inside a pixel, so a ring stops being expressible as a
 * ring. Blurring keeps the part of the correction that is a real shift of the
 * whole edge and discards the part that is per-pixel raster noise, which is the
 * part that was destroying the fit.
 */
const SMOOTH = 8;

/** `statics` arrive as finished SVG elements; the ribbons are drawn as fills. */
function svgOf(statics: string[], ribbons: Ribbon[], ink: string, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + statics.join('')
    + ribbons.map((r) =>
      `<path d="${ribbonPath(r.points, r.widths, { closed: r.closed, cap: r.cap })}" fill="${ink}"/>`).join('')
    + '</svg>';
}

function score(ref: Coverage, c: Coverage): number {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < ref.data.length; i++) {
    lo += Math.min(ref.data[i], c.data[i]);
    hi += Math.max(ref.data[i], c.data[i]);
  }
  return hi ? lo / hi : 0;
}

function clone(rs: Ribbon[]): Ribbon[] {
  return rs.map((r) => ({ ...r, points: r.points.map((p): Vec2 => [p[0], p[1]]), widths: [...r.widths] }));
}

/**
 * Nudges the ribbons until the reference stops asking for changes.
 *
 * `statics` are shapes that are already exact — a fitted circle solved from
 * hundreds of samples, a traced outline — which are rendered so the comparison
 * sees the whole drawing, but never moved.
 */
export function refine(
  statics: string[], ribbons: Ribbon[], reference: Coverage, ink: string, o: RefineOptions = {},
): { ribbons: Ribbon[]; report: RefineReport } {
  const w = reference.width;
  const h = reference.height;
  const rounds = o.rounds ?? 12;

  let best = clone(ribbons);
  let bestScore = score(reference, coverage(rasterise(svgOf(statics, best, ink, w, h), w, h)));
  const before = bestScore;
  let step = o.step ?? 0.8;
  let used = 0;

  for (let round = 0; round < rounds; round++) {
    const scene = coverage(rasterise(svgOf(statics, best, ink, w, h), w, h));
    const next = clone(best);

    for (const r of next) {
      const wide: number[] = [];
      const side: number[] = [];
      for (let i = 0; i < r.points.length; i++) {
        const [nx, ny] = normalAt(r.points, i, r.closed);
        const [px, py] = r.points[i];
        const hw = r.widths[i];
        // Read the residual just outside each edge, where a small expansion
        // would actually land, rather than on the edge itself.
        const probe = (sign: number) => {
          const ex = px + nx * sign * (hw + 0.5);
          const ey = py + ny * sign * (hw + 0.5);
          return at(reference, ex, ey) - at(scene, ex, ey);
        };
        const left = probe(1);
        const right = probe(-1);
        wide.push(left + right);
        side.push(left - right);
      }

      const dW = smooth(wide);
      const dP = smooth(side);
      for (let i = 0; i < r.points.length; i++) {
        const [nx, ny] = normalAt(r.points, i, r.closed);
        r.widths[i] = Math.max(0, r.widths[i] + step * dW[i] * 0.5);
        r.points[i] = [r.points[i][0] + step * dP[i] * 0.5 * nx, r.points[i][1] + step * dP[i] * 0.5 * ny];
      }
    }

    const got = score(reference, coverage(rasterise(svgOf(statics, next, ink, w, h), w, h)));
    used = round + 1;
    if (got > bestScore) {
      bestScore = got;
      best = next;
      // Still descending, so lengthen the stride. Without this the run creeps at
      // whatever the opening guess happened to be and stops early with the
      // reference still asking for more.
      step = Math.min(4, step * 1.4);
    } else {
      // Overshot: the same direction is still right, so halve the stride rather
      // than abandoning the step.
      step /= 2;
      if (step < 0.02) break;
    }
  }

  let moved = 0;
  best.forEach((r, k) => r.points.forEach((p, i) => {
    moved = Math.max(moved, Math.hypot(p[0] - ribbons[k].points[i][0], p[1] - ribbons[k].points[i][1]));
  }));

  return {
    ribbons: best,
    report: { before: before * 100, after: bestScore * 100, rounds: used, moved },
  };
}
