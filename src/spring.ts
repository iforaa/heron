/**
 * One physical primitive, in place of a shelf of hand-drawn envelopes.
 *
 * Anticipation, overshoot, follow-through and settle are not four effects. They
 * are one damped oscillator seen at four values of one parameter, and writing
 * them separately is how a scene ends up with `amp * exp(-4u) * sin(4*PI*u)`
 * inline and a comment apologising for the constants. A spring says the same
 * thing as three numbers a person can reason about — how heavy, how stiff, how
 * much friction — and says it the way the thing being animated actually behaves.
 *
 * Two properties earn it its place over an easing curve:
 *
 *   - IT CARRIES VELOCITY. `velocity` starts the spring already moving, which is
 *     what a limb does when the body it hangs off stops abruptly. An easing
 *     curve always starts from rest, so follow-through has to be faked.
 *
 *   - ITS DURATION IS A RESULT, NOT A GUESS. `settleTime` computes when the
 *     motion is actually over. Every hand-tuned envelope in this project had a
 *     window length picked by eye and then quietly disagreed with its own decay.
 *
 * This is deliberately in seconds rather than cycle fractions. Stiffness and
 * damping are physical, and a spring that changed character when a scene's
 * duration changed would not be one. `during()` in `score.ts` is what places it
 * on a timeline.
 *
 * Springs are procedural, so they compile through the sampler. That is the
 * argument for layers: on its own layer a spring bakes alone and leaves the
 * keyframed motion underneath it exact.
 */

export interface SpringOptions {
  /** Heavier is slower to start and slower to stop. */
  mass?: number;
  /** Stronger pull towards the target: faster, and bouncier. */
  stiffness?: number;
  /** Friction. Raise it until the bounce goes away; `criticalDamping` is the edge. */
  damping?: number;
  from?: number;
  to?: number;
  /** Starting speed, in units per second. This is what follow-through is made of. */
  velocity?: number;
  /**
   * Follow-through, stated as how far it swings rather than how hard it is hit.
   *
   * Sets `from` and `to` to zero and solves `velocity` for a first peak of this
   * size — so the whole motion departs from rest and returns to it, and is
   * silent outside its own beat. That is what a limb actually does when the body
   * carrying it stops: it is not held displaced beforehand, it is still moving
   * afterwards. Holding it displaced instead — a spring from 26 to 0 — leaves
   * the part visibly cocked for the entire scene before the beat it belongs to,
   * which `loop-seam` catches and a still frame does not.
   */
  swing?: number;
}

/** Damping that arrives fastest without overshooting at all. */
export function criticalDamping(o: Pick<SpringOptions, 'mass' | 'stiffness'> = {}): number {
  return 2 * Math.sqrt((o.stiffness ?? 100) * (o.mass ?? 1));
}

interface Solved {
  /** Displacement from the target at `t` seconds. */
  disp: (t: number) => number;
  /** Bound such that |disp(t)| <= scale * exp(-rate * t). */
  rate: number;
  scale: number;
}

/** Largest excursion, found by scanning the response until it has died away. */
function peakOf(s: Solved): number {
  const bound = Math.log(Math.max(s.scale, 1e-9) / 1e-9) / s.rate;
  let peak = 0;
  for (let i = 0; i <= 2048; i++) {
    const v = s.disp((bound * i) / 2048);
    if (Math.abs(v) > Math.abs(peak)) peak = v;
  }
  return peak;
}

/**
 * Turns `swing` into the `velocity` that produces it.
 *
 * The system is linear, so the response to a unit kick scales exactly: measure
 * its peak once and divide. No search, no tuning.
 */
function resolve(o: SpringOptions): SpringOptions {
  if (o.swing === undefined) return o;
  const unit = { ...o, swing: undefined, from: 0, to: 0, velocity: 1 };
  const peak = peakOf(raw(unit));
  return { ...unit, velocity: peak === 0 ? 0 : o.swing / peak };
}

function raw(o: SpringOptions): Solved {
  const m = o.mass ?? 1;
  const k = o.stiffness ?? 100;
  const c = o.damping ?? 10;
  if (m <= 0 || k <= 0) throw new Error('heron: spring() needs positive mass and stiffness');

  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (zeta <= 1e-6) {
    throw new Error('heron: a spring with no damping never settles - give it a positive damping');
  }

  const x0 = (o.from ?? 0) - (o.to ?? 1);
  const v0 = o.velocity ?? 0;

  if (zeta < 1 - 1e-9) {
    // Underdamped: it overshoots and rings. The envelope is a plain exponential.
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const a = x0;
    const b = (v0 + zeta * w0 * x0) / wd;
    return {
      disp: (t) => Math.exp(-zeta * w0 * t) * (a * Math.cos(wd * t) + b * Math.sin(wd * t)),
      rate: zeta * w0,
      scale: Math.hypot(a, b),
    };
  }

  if (zeta <= 1 + 1e-9) {
    // Critically damped: the fastest approach with no overshoot. The `t` factor
    // is not an exponential, so the bound uses `t*exp(-w0*t/2) <= 2/(w0*e)`.
    const a = x0;
    const b = v0 + w0 * x0;
    return {
      disp: (t) => (a + b * t) * Math.exp(-w0 * t),
      rate: w0 / 2,
      scale: Math.abs(a) + (2 * Math.abs(b)) / (w0 * Math.E),
    };
  }

  // Overdamped: two decaying exponentials, and the slower one sets the pace.
  const gap = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + gap;
  const r2 = -zeta * w0 - gap;
  const a = (v0 - r2 * x0) / (r1 - r2);
  const b = x0 - a;
  return {
    disp: (t) => a * Math.exp(r1 * t) + b * Math.exp(r2 * t),
    rate: -r1,
    scale: Math.abs(a) + Math.abs(b),
  };
}

/**
 * The spring's value `seconds` after release.
 *
 * Solved in closed form rather than integrated step by step, so it is a pure
 * function of time like everything else here — the agent can ask for t=0.62
 * without replaying what came before, and the compiler can sample it in any
 * order it likes.
 */
export function spring(o: SpringOptions = {}): (seconds: number) => number {
  const r = resolve(o);
  const { disp } = raw(r);
  const from = r.from ?? 0;
  const to = r.to ?? 1;
  return (t) => {
    if (t <= 0) return from;
    return to + disp(t);
  };
}

/**
 * When the spring has finished, in seconds.
 *
 * This is the number that stops beat lengths being guesses. The analytic
 * envelope gives a time by which the motion is provably below `tolerance`; the
 * scan then finds the last moment it was actually above it, because the envelope
 * is an upper bound and using it directly would reserve more time than the
 * motion needs.
 */
export function settleTime(o: SpringOptions = {}, tolerance = 0.002): number {
  const { disp, rate, scale } = raw(resolve(o));
  const span = Math.abs(o.swing ?? (o.to ?? 1) - (o.from ?? 0)) || 1;
  const eps = tolerance * span;
  const bound = scale <= eps ? 0 : Math.log(scale / eps) / rate;

  const steps = 2048;
  const step = bound / steps;
  let last = 0;
  for (let i = 1; i <= steps; i++) {
    if (Math.abs(disp(i * step)) > eps) last = i * step;
  }
  return last + step;
}
