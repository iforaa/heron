/**
 * Recognising the shape a run of points is really made of.
 *
 * This is an accuracy step before it is a tidiness one, which is the opposite of
 * how it looks. A ring traced as forty points is forty independent measurements,
 * each carrying its own share of lattice and thinning noise, and simplification
 * makes it worse: Douglas-Peucker guarantees a maximum deviation but always
 * takes it on one side of a convex curve, so every simplified arc is inscribed
 * inside the true one and comes out systematically small.
 *
 * A circle fitted through all of those points has three parameters solved from
 * hundreds of samples, so the noise averages away and the result is a better
 * estimate of the artwork than any of the points it was fitted to. The residual
 * is reported so the caller can refuse a fit rather than trust one blindly.
 *
 * It happens to also produce a scene an agent can reason about — `arc({ cx, cy,
 * r })` says "a ring" where a point list says nothing — but that is the bonus,
 * not the point.
 */

import type { Vec2 } from './scene.ts';
import { median } from './num.ts';

/**
 * Both fits reject outliers before trusting themselves, and it is not optional.
 *
 * Where two strokes cross, the medial axis of the *union* is not the centreline
 * of either: the largest circle that fits inside the intersection is bigger than
 * the one that fits inside a single stroke, so the skeleton bulges away from the
 * true path for as long as the overlap lasts. On the crane's ring those few
 * contaminated samples took the circle's worst residual to 5.8 pixels while the
 * arc itself is true to well under one.
 *
 * Discarding them is therefore not the fit flattering itself. The fitted arc
 * runs where the ring runs, including straight through the crossing, which is
 * exactly where the skeleton could not.
 */
const KEEP = 2.5;
/** Rounds of trim-and-refit. Three is well past where the inlier set stops moving. */
const ROUNDS = 3;

/**
 * Fits a model, drops the points it cannot explain, and refits until the set
 * settles.
 *
 * Both fits need exactly this and only differ in their algebra, so the
 * robustness policy — how much slack, how many rounds, how few points is too
 * few — is stated once here rather than twice in two shapes that can drift.
 */
function refit<T>(
  pts: Vec2[],
  least: number,
  solve: (sample: Vec2[]) => T | null,
  residual: (model: T, p: Vec2) => number,
): { model: T; inliers: Vec2[] } | null {
  let use = pts;
  let model: T | null = null;

  for (let round = 0; round < ROUNDS; round++) {
    model = solve(use);
    if (!model) return null;
    const limit = Math.max(1, KEEP * median(use.map((p) => residual(model!, p))));
    const keep = use.filter((p) => residual(model!, p) <= limit);
    // Settled: either nothing was rejected this round, or rejecting more would
    // leave too few points to solve from.
    if (keep.length === use.length || keep.length < least) break;
    use = keep;
  }
  return model ? { model, inliers: use } : null;
}


/**
 * The largest `f` over the points, by a plain loop.
 *
 * Not `Math.max(...xs.map(f))`: a ridge is a full-density centreline, and
 * spreading one of those throws `RangeError` on a large reference rather than
 * degrading.
 */
function worst(pts: Vec2[], f: (p: Vec2) => number): number {
  let out = 0;
  for (const p of pts) out = Math.max(out, f(p));
  return out;
}

export interface LineFit {
  from: Vec2;
  to: Vec2;
  /** Largest distance from an inlying point to the fitted line, in pixels. */
  error: number;
  /** Share of the run the fit actually describes. Low means it is not a line. */
  inliers: number;
}

export interface CircleFit {
  cx: number;
  cy: number;
  r: number;
  /** Degrees, 0 at 3 o'clock and increasing clockwise, as `arc()` takes them. */
  from: number;
  to: number;
  /** Largest distance from an inlying point to the fitted circle, in pixels. */
  error: number;
  /** Share of the run the fit actually describes. Low means it is not a circle. */
  inliers: number;
}

function centroid(pts: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

/**
 * The best straight line through the points, by total least squares.
 *
 * Fitting y against x would be wrong here for a reason that bites in practice: a
 * vertical run has no function of x to fit, and a crane's leg is vertical.
 * Minimising the perpendicular distance has no preferred axis.
 */
interface Axis { mx: number; my: number; ux: number; uy: number }

/** Perpendicular distance from a point to an infinite line. */
function offLine(a: Axis, p: Vec2): number {
  return Math.abs((p[0] - a.mx) * -a.uy + (p[1] - a.my) * a.ux);
}

export function fitLine(pts: Vec2[]): LineFit | null {
  if (pts.length < 4) return null;

  const found = refit<Axis>(pts, 4, (sample) => {
    const [mx, my] = centroid(sample);
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const [x, y] of sample) {
      const dx = x - mx;
      const dy = y - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    // Principal axis of the scatter: the direction the points vary along most.
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { mx, my, ux: Math.cos(angle), uy: Math.sin(angle) };
  }, offLine);
  if (!found) return null;
  const { model: a, inliers } = found;

  // The extent spans every point, so the line covers the whole run even where a
  // crossing pushed a few samples off it.
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of pts) {
    const t = (x - a.mx) * a.ux + (y - a.my) * a.uy;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  if (!Number.isFinite(lo) || hi - lo < 1e-6) return null;

  return {
    from: [a.mx + a.ux * lo, a.my + a.uy * lo],
    to: [a.mx + a.ux * hi, a.my + a.uy * hi],
    error: worst(inliers, (p) => offLine(a, p)),
    inliers: inliers.length / pts.length,
  };
}

/** Solves a 3x3 system by Gaussian elimination with partial pivoting. */
function solve3(m: number[][], v: number[]): number[] | null {
  const a = m.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < 3; c++) {
    let best = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[best][c])) best = r;
    if (Math.abs(a[best][c]) < 1e-12) return null;
    [a[c], a[best]] = [a[best], a[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/**
 * The best circle through the points, by algebraic (Kasa) least squares.
 *
 * Coordinates are shifted to their centroid before solving. On a 1024-pixel
 * image the raw normal equations carry terms in x^4, which is where a
 * least-squares fit quietly loses its precision to floating point.
 */
interface Ring { cx: number; cy: number; r: number }

/** How far a point sits off a circle, inside or out. */
function offCircle(c: Ring, p: Vec2): number {
  return Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r);
}

export function fitCircle(pts: Vec2[]): CircleFit | null {
  if (pts.length < 8) return null;

  const found = refit<Ring>(pts, 8, (sample) => {
    const [mx, my] = centroid(sample);
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let sx = 0;
    let sy = 0;
    let sxz = 0;
    let syz = 0;
    let sz = 0;
    for (const [px, py] of sample) {
      const x = px - mx;
      const y = py - my;
      const z = x * x + y * y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      sx += x;
      sy += y;
      sxz += x * z;
      syz += y * z;
      sz += z;
    }

    const sol = solve3(
      [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, sample.length]],
      [-sxz, -syz, -sz],
    );
    if (!sol) return null;
    const [d, e, f] = sol;
    const inner = (d / 2) * (d / 2) + (e / 2) * (e / 2) - f;
    if (!(inner > 0)) return null;
    const r = Math.sqrt(inner);
    if (!Number.isFinite(r) || r <= 0) return null;
    return { cx: -d / 2 + mx, cy: -e / 2 + my, r };
  }, offCircle);
  if (!found) return null;
  const { model: { cx, cy, r }, inliers: use } = found;

  const error = worst(use, (p) => offCircle({ cx, cy, r }, p));

  // Angles are unwrapped along the run rather than taken absolutely, so an arc
  // crossing the 180-degree seam stays one continuous sweep instead of jumping
  // the long way round, and a run past a full turn keeps going. Every point
  // counts here, including the ones the radius fit rejected: a crossing pushes a
  // sample off the circle radially, which barely moves the angle it sits at.
  const deg = (p: Vec2) => (Math.atan2(p[1] - cy, p[0] - cx) * 180) / Math.PI;
  let from = deg(pts[0]);
  let total = 0;
  let prev = from;
  for (let i = 1; i < pts.length; i++) {
    let step = deg(pts[i]) - prev;
    while (step > 180) step -= 360;
    while (step < -180) step += 360;
    total += step;
    prev += step;
  }

  return { cx, cy, r, from, to: from + total, error, inliers: use.length / pts.length };
}

export type { Ring, Axis };
