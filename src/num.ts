/**
 * Numeric helpers every module reaches for.
 *
 * A leaf: it imports nothing, so measurement code can round a value without
 * depending on the renderer, and one definition of "the middle value" or "an
 * angle folded into (-180, 180]" cannot drift from another.
 */

/** Degrees per radian. */
export const DEG = 180 / Math.PI;

/**
 * `n` to `places` decimals. Never `-0`: it serializes as "-0", which is a
 * byte spent saying nothing and a value `Object.is` refuses to call zero.
 */
export function round(n: number, places = 3): number {
  const f = 10 ** places;
  const out = Math.round(n * f) / f;
  return Object.is(out, -0) ? 0 : out;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** The value at fraction `p` of the sorted list; 0 for an empty list. */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[clamp(Math.floor(s.length * p), 0, s.length - 1)];
}

/** The middle value. Robust where a mean is not. */
export function median(xs: number[]): number {
  return percentile(xs, 0.5);
}

/**
 * An angle folded into (-180, 180], so a full turn compares as no turn.
 *
 * Exactly -180 folds to +180: the fold-over boundary belongs to one side only,
 * so a seam check cannot call the same orientation two different things.
 */
export function wrapDegrees(value: number): number {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(wrapped + 180) < 1e-10 ? 180 : wrapped;
}
