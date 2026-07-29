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
 *
 * What moves is not the points. Each run is a handful of B-spline control
 * points (see `smooth.ts`), and the residual is projected onto that basis
 * before anything shifts. Correcting the samples directly was overfitting: the
 * gradient carries the raster's noise as well as the error, and with one free
 * parameter per sample there was nothing to stop the noise being absorbed as
 * shape. Blurring the gradient afterwards helped and cost accuracy, because the
 * freedom was still there. Now a wobble finer than the control spacing cannot
 * be represented, so it cannot be learned, and no blur pass is needed.
 */

import { type Coverage, coverage, rasterise } from './raster.ts';
import { type Model, controlCount, evalScalar, fitScalar, model } from './smooth.ts';
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
  /** Largest distance any sample moved, in pixels. */
  moved: number;
  /** Free parameters the correction had, across every run. */
  controls: number;
  /** Samples those parameters had to explain. The ratio is the regularisation. */
  samples: number;
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
 * A run held as control points, plus the geometry they currently produce.
 *
 * `ribbon` is always the evaluation of `cx`/`cy`/`cw`, never edited directly.
 * Keeping that one-way is what guarantees smoothness: there is no path by which
 * a sample can acquire a shape the basis could not have produced.
 */
interface Fitted {
  ribbon: Ribbon;
  m: Model;
  cx: Float64Array;
  cy: Float64Array;
  cw: Float64Array;
}

function arcLength(pts: Vec2[], closed: boolean): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length) d += Math.hypot(pts[0][0] - pts.at(-1)![0], pts[0][1] - pts.at(-1)![1]);
  return d;
}

/** Rebuilds the sampled ribbon from its control points. */
function evaluate(f: Fitted): void {
  const n = f.ribbon.points.length;
  const xs = evalScalar(f.m, f.cx, n);
  const ys = evalScalar(f.m, f.cy, n);
  const ws = evalScalar(f.m, f.cw, n);
  for (let i = 0; i < n; i++) {
    f.ribbon.points[i] = [xs[i], ys[i]];
    f.ribbon.widths[i] = Math.max(0, ws[i]);
  }
}

/**
 * Fits a run's measurement, replacing it with the closest thing the basis can
 * say. This is where the traced geometry stops being a list of noisy samples
 * and becomes a curve, before the reference is ever consulted.
 */
function fit(r: Ribbon): Fitted {
  const k = controlCount(arcLength(r.points, r.closed), r.points.length, r.closed);
  const m = model(r.points, r.closed, k);
  const f: Fitted = {
    ribbon: { ...r, points: r.points.map((p): Vec2 => [p[0], p[1]]), widths: [...r.widths] },
    m,
    cx: fitScalar(m, r.points.map((p) => p[0])),
    cy: fitScalar(m, r.points.map((p) => p[1])),
    cw: fitScalar(m, r.widths),
  };
  evaluate(f);
  return f;
}

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

/** Only the controls are state; the geometry is recomputed from them. */
function clone(fs: Fitted[]): Fitted[] {
  return fs.map((f) => {
    const c: Fitted = {
      ...f,
      ribbon: { ...f.ribbon, points: f.ribbon.points.map((p): Vec2 => [p[0], p[1]]), widths: [...f.ribbon.widths] },
      cx: Float64Array.from(f.cx),
      cy: Float64Array.from(f.cy),
      cw: Float64Array.from(f.cw),
    };
    return c;
  });
}

const shapes = (fs: Fitted[]): Ribbon[] => fs.map((f) => f.ribbon);

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

  // The score of the raw measurement, before the basis has had a say. Reported
  // as `before` so the number covers everything this pass does, including the
  // accuracy it gives up by refusing to represent noise.
  const before = score(reference, coverage(rasterise(svgOf(statics, ribbons, ink, w, h), w, h)));

  let best = ribbons.map(fit);
  let bestScore = score(reference, coverage(rasterise(svgOf(statics, shapes(best), ink, w, h), w, h)));
  let step = o.step ?? 0.8;
  let used = 0;

  for (let round = 0; round < rounds; round++) {
    const scene = coverage(rasterise(svgOf(statics, shapes(best), ink, w, h), w, h));
    const next = clone(best);

    for (const f of next) {
      const r = f.ribbon;
      const n = r.points.length;
      const wide: number[] = [];
      const dx: number[] = [];
      const dy: number[] = [];
      for (let i = 0; i < n; i++) {
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
        // The sideways pull, already resolved into x and y so that projecting it
        // onto the basis is one least-squares solve per coordinate.
        const move = (left - right) * step * 0.5;
        dx.push(move * nx);
        dy.push(move * ny);
      }

      // Least squares onto the control points: the part of what the reference
      // asked for that this run is actually able to do.
      const gx = fitScalar(f.m, dx);
      const gy = fitScalar(f.m, dy);
      const gw = fitScalar(f.m, wide.map((v) => v * step * 0.5));
      for (let c = 0; c < f.m.k; c++) {
        f.cx[c] += gx[c];
        f.cy[c] += gy[c];
        f.cw[c] += gw[c];
      }
      evaluate(f);
    }

    const got = score(reference, coverage(rasterise(svgOf(statics, shapes(next), ink, w, h), w, h)));
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
  best.forEach((f, k) => f.ribbon.points.forEach((p, i) => {
    moved = Math.max(moved, Math.hypot(p[0] - ribbons[k].points[i][0], p[1] - ribbons[k].points[i][1]));
  }));

  return {
    ribbons: shapes(best),
    report: {
      before: before * 100,
      after: bestScore * 100,
      rounds: used,
      moved,
      controls: best.reduce((n, f) => n + f.m.k, 0),
      samples: best.reduce((n, f) => n + f.ribbon.points.length, 0),
    },
  };
}
