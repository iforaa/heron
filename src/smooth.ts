/**
 * Describing a run with a few numbers instead of a few hundred points.
 *
 * A traced centreline arrives as one sample per pixel of skeleton, and every one
 * of those samples carries the raster's noise. Correcting them independently
 * against the reference is overfitting in the ordinary sense: there are far more
 * free parameters than there is real shape, so the spare freedom goes into
 * reproducing noise, and a stroke that should be one smooth curve ends up
 * visibly ragged. Blurring the correction afterwards treats the symptom — the
 * freedom is still there, it is just being talked out of using it.
 *
 * A cubic B-spline removes the freedom instead. The run is a handful of control
 * points, roughly one per `SPAN` pixels of arc, and every sample is a fixed
 * blend of four of them. High-frequency wobble is not smoothed away; it is
 * unrepresentable, because no setting of the controls produces it.
 *
 * The same basis then does double duty. Fitting it to the measurement smooths
 * the geometry we started from, and projecting the reference's pull onto it
 * smooths every correction we make afterwards — so `refine` needs no blur pass
 * of its own, and the dial that used to be "how hard to blur" becomes "how many
 * control points", which is a statement about the shape rather than the noise.
 */

/** Pixels of arc per control point. Fewer means stiffer, and smoother. */
export const SPAN = 26;

/**
 * Weight of the second-difference penalty.
 *
 * Small on purpose. The basis already bounds how sharply the curve can bend, so
 * this is not what keeps the run smooth — it is there to keep the normal
 * equations solvable where samples bunch up and leave a control point with
 * almost nothing pulling on it.
 */
const STIFF = 1e-3;

export interface Model {
  /** Control point count. */
  k: number;
  closed: boolean;
  /** For each sample, the first of its four active controls. */
  first: Int32Array;
  /** For each sample, the four blending weights, in the same order. */
  weight: Float64Array;
  /** Cholesky factor of the normal equations, lower triangular, row-major k*k. */
  chol: Float64Array;
}

/** The four uniform cubic B-spline weights at local parameter `t`. */
function uniform(t: number, into: Float64Array, at: number): void {
  const s = 1 - t;
  into[at] = (s * s * s) / 6;
  into[at + 1] = (3 * t * t * t - 6 * t * t + 4) / 6;
  into[at + 2] = (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6;
  into[at + 3] = (t * t * t) / 6;
}

/**
 * Chord-length parameters, normalised to [0, 1].
 *
 * Uniform spacing would give a long straight stretch the same number of control
 * points as a tight curl of equal sample count, which is backwards: the curl is
 * where the shape actually is.
 */
function parameterise(pts: readonly (readonly [number, number])[], closed: boolean): Float64Array {
  const n = pts.length;
  const u = new Float64Array(n);
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    u[i] = total;
  }
  if (closed) total += Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]);
  if (total <= 0) for (let i = 0; i < n; i++) u[i] = i / Math.max(1, n - 1);
  else for (let i = 0; i < n; i++) u[i] /= total;
  return u;
}

/** Cholesky of a small symmetric positive-definite matrix, in place. */
function cholesky(a: Float64Array, k: number): Float64Array {
  const l = new Float64Array(k * k);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * k + j];
      for (let m = 0; m < j; m++) s -= l[i * k + m] * l[j * k + m];
      if (i === j) l[i * k + j] = Math.sqrt(Math.max(1e-12, s));
      else l[i * k + j] = s / l[j * k + j];
    }
  }
  return l;
}

function solve(l: Float64Array, k: number, b: Float64Array): Float64Array {
  const y = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    let s = b[i];
    for (let m = 0; m < i; m++) s -= l[i * k + m] * y[m];
    y[i] = s / l[i * k + i];
  }
  const x = new Float64Array(k);
  for (let i = k - 1; i >= 0; i--) {
    let s = y[i];
    for (let m = i + 1; m < k; m++) s -= l[m * k + i] * x[m];
    x[i] = s / l[i * k + i];
  }
  return x;
}

/** How many controls a run of this length and sample count can support. */
export function controlCount(length: number, samples: number, closed: boolean): number {
  const want = Math.round(length / SPAN);
  const most = closed ? samples : Math.max(4, samples - 1);
  return Math.max(4, Math.min(most, want));
}

/**
 * Builds the basis for a run, and factors the normal equations once.
 *
 * The factorisation is the reason this is a separate step: the sample
 * parameters do not change while the run is being corrected, so every round of
 * `refine` reuses one Cholesky instead of solving a least-squares problem from
 * scratch. Fitting a correction then costs about as much as blurring one did.
 */
export function model(
  pts: readonly (readonly [number, number])[], closed: boolean, k: number,
): Model {
  const n = pts.length;
  const u = parameterise(pts, closed);
  const first = new Int32Array(n);
  const weight = new Float64Array(n * 4);

  for (let j = 0; j < n; j++) {
    if (closed) {
      // Periodic: the control polygon wraps, so the curve closes with no seam
      // and no special case at the join.
      const x = u[j] * k;
      const s = Math.floor(x);
      uniform(x - s, weight, j * 4);
      first[j] = ((s % k) + k) % k;
    } else {
      // Clamped: the ends of a run are real, measured places — a cap sits there
      // — so the curve has to reach them rather than float short of them.
      const span = k - 3;
      const x = Math.min(u[j] * span, span - 1e-9);
      const s = Math.min(Math.floor(x), span - 1);
      clamped(x - s, s, span, weight, j * 4);
      first[j] = s;
    }
  }

  // Normal equations, with the stiffness penalty folded straight in.
  const a = new Float64Array(k * k);
  for (let j = 0; j < n; j++) {
    for (let p = 0; p < 4; p++) {
      const ip = closed ? (first[j] + p) % k : first[j] + p;
      for (let q = 0; q < 4; q++) {
        const iq = closed ? (first[j] + q) % k : first[j] + q;
        a[ip * k + iq] += weight[j * 4 + p] * weight[j * 4 + q];
      }
    }
  }
  const rows = closed ? k : k - 2;
  for (let r = 0; r < rows; r++) {
    const idx = [r, (r + 1) % k, (r + 2) % k];
    const sign = [1, -2, 1];
    for (let p = 0; p < 3; p++) {
      for (let q = 0; q < 3; q++) a[idx[p] * k + idx[q]] += STIFF * n * sign[p] * sign[q];
    }
  }

  return { k, closed, first, weight, chol: cholesky(a, k) };
}

/**
 * Clamped cubic basis near the ends of an open run.
 *
 * Away from the ends this is the uniform basis; within three spans of either
 * end the knots pile up, which is what pulls the curve onto its first and last
 * control point instead of leaving it hanging inside the polygon.
 */
function clamped(t: number, s: number, span: number, into: Float64Array, at: number): void {
  const k = span + 3;
  // Knot vector: four zeros, evenly spaced interior, four at the end.
  const knot = (i: number) => Math.max(0, Math.min(span, i - 3));
  const u = s + t;
  const n = new Float64Array(k);
  // Degree zero: the single span containing u.
  n[s + 3] = 1;
  for (let d = 1; d <= 3; d++) {
    for (let i = Math.max(0, s + 3 - d); i <= s + 3; i++) {
      const a0 = knot(i);
      const a1 = knot(i + d);
      const b0 = knot(i + 1);
      const b1 = knot(i + d + 1);
      const left = a1 > a0 ? ((u - a0) / (a1 - a0)) * n[i] : 0;
      const right = b1 > b0 && i + 1 < k ? ((b1 - u) / (b1 - b0)) * n[i + 1] : 0;
      n[i] = left + right;
    }
  }
  for (let p = 0; p < 4; p++) into[at + p] = n[s + p] ?? 0;
}

/** Least-squares control points for a scalar sampled at the model's parameters. */
export function fitScalar(m: Model, values: readonly number[]): Float64Array {
  const b = new Float64Array(m.k);
  for (let j = 0; j < values.length; j++) {
    for (let p = 0; p < 4; p++) {
      const i = m.closed ? (m.first[j] + p) % m.k : m.first[j] + p;
      b[i] += m.weight[j * 4 + p] * values[j];
    }
  }
  return solve(m.chol, m.k, b);
}

/** Evaluates a scalar control vector back at every sample. */
export function evalScalar(m: Model, c: Float64Array, n: number): number[] {
  const out = new Array<number>(n);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let p = 0; p < 4; p++) {
      const i = m.closed ? (m.first[j] + p) % m.k : m.first[j] + p;
      s += m.weight[j * 4 + p] * c[i];
    }
    out[j] = s;
  }
  return out;
}
