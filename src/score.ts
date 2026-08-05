/**
 * Timing as structure, instead of as arithmetic.
 *
 * A scene that goes somewhere is a list of beats: run, stop, recover, look, bow,
 * hold. Written directly against cycle time that becomes a chain of additions —
 * `LOOK_FROM = RUN_END + RING + 0.01`, `BOW_FROM = LOOK_TO + 0.01` — where every
 * constant depends on the ones before it, nothing can be reordered, and changing
 * one duration silently moves everything after it. It is also unreadable as a
 * plan, which is what it actually is.
 *
 * A `score` is that plan, stated once in seconds. It resolves to windows, and
 * `during()` places a curve inside one *in the curve's own local time*, so a
 * beat never has to know where it sits. That is what makes acting reusable: the
 * same recoil is the same three lines whether it happens at 0.2 or 0.9, and
 * moving it is editing the score rather than the motion.
 *
 * Seconds, not fractions, because that is the unit a person judges timing in and
 * the unit `spring` works in. The cycle's own duration converts.
 */

import { type Channel, type Character, type KeyTuple, keys, sampled } from './scene.ts';
import { type Easing, easeInOut, linear } from './easing.ts';

export interface Beat {
  name: string;
  /** Cycle fractions, 0 to 1. */
  from: number;
  to: number;
  /** Wall-clock length, which is what a local curve is handed. */
  seconds: number;
}

/**
 * A curve in a beat's own time.
 *
 * Seconds come first because the physical primitives — `spring` above all — are
 * functions of elapsed time, and they must drop in without an adapter. `u` is
 * the same instant as a fraction of the beat, for curves that are about shape
 * rather than about physics.
 *
 * A shape that happens to *be* a pair of keyframes says so with `keys`, and
 * `during` then emits it verbatim instead of sampling it. Without that, every
 * move written as a beat would bake — a glance held for four tenths of a second
 * would cost six fitted keyframes to say what two express exactly — and the
 * exactness that layering was built to preserve would be lost on the way in.
 */
export interface Shape {
  (seconds: number, u: number): number;
  /** The keyframes this curve is, if CSS can express it. */
  keys?: (b: Beat) => KeyTuple[];
  /**
   * How finely this curve has to be sampled, if the usual density is not enough.
   *
   * A shape that repeats inside its beat is the case that needs it: the default
   * spends a fixed budget on the beat, which a curve with six gestures in it
   * divides six ways without saying so.
   */
  samples?: (b: Beat) => number;
}

/**
 * Places a two-key move across a beat, holding at both ends of the cycle.
 *
 * Shared by every shape that is a straight interpolation, so the rule for what
 * happens outside the beat is written once and matches what `during` does when
 * it has to sample instead.
 */
function span(b: Beat, from: number, to: number, ease: Easing): KeyTuple[] {
  const out: KeyTuple[] = [];
  if (b.from > 0) out.push([0, from]);
  out.push([b.from, from, ease], [b.to, to]);
  if (b.to < 1) out.push([1, to]);
  return out;
}

/**
 * The query surface both timing models share.
 *
 * Where a window came from — a strict sequence that accounts for the whole
 * cycle, or an overlapping cue sheet — changes how it is declared and
 * validated, never how a curve is placed inside it. So the asking side is
 * written once, and the two classes below differ only in their constructors.
 */
export abstract class Windows {
  readonly duration: number;
  /** The resolved windows, in declaration order. */
  readonly windows: Beat[];
  private readonly noun: string;

  protected constructor(duration: number, windows: Beat[], noun: string) {
    this.duration = duration;
    this.windows = windows;
    this.noun = noun;
  }

  /** The named window, in normalized cycle time and wall-clock seconds. */
  at(name: string): Beat {
    const b = this.windows.find((x) => x.name === name);
    if (!b) {
      throw new Error(
        `heron: no ${this.noun} "${name}". Available: ${this.windows.map((x) => x.name).join(', ')}`,
      );
    }
    return b;
  }

  /** Local progress through a window: 0 before it starts, 1 after it ends. */
  progress(name: string, t: number): number {
    const b = this.at(name);
    if (t <= b.from) return 0;
    if (t >= b.to) return 1;
    return (t - b.from) / (b.to - b.from);
  }

  /** Cycle time of a point inside a window, `u` from 0 (its start) to 1 (its end). */
  time(name: string, u = 0): number {
    if (!Number.isFinite(u) || u < 0 || u > 1) {
      throw new Error(`heron: window progress must be inside 0..1, got ${u}`);
    }
    const b = this.at(name);
    return b.from + (b.to - b.from) * u;
  }

  /** One window spanning from the start of `from` through the end of `to`. */
  span(from: string, to: string): Beat {
    const a = this.at(from);
    const b = this.at(to);
    if (b.to <= a.from) {
      throw new Error(`heron: cannot span "${from}" through earlier window "${to}"`);
    }
    return {
      name: `${from}..${to}`,
      from: a.from,
      to: b.to,
      seconds: (b.to - a.from) * this.duration,
    };
  }

  /** A normalized sub-window of one named beat/cue. */
  slice(name: string, from = 0, to = 1): Beat {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > 1 || to <= from) {
      throw new Error(`heron: slice() needs 0 <= from < to <= 1, got [${from}, ${to}]`);
    }
    const b = this.at(name);
    const width = b.to - b.from;
    return {
      name: `${name}[${from}..${to}]`,
      from: b.from + width * from,
      to: b.from + width * to,
      seconds: b.seconds * (to - from),
    };
  }

  /** Places a local channel inside this window and holds its ends outside it. */
  place(name: string, channel: Channel): Channel {
    return within(this.at(name), channel);
  }

  /** Places a procedural shape inside this window. */
  during(name: string, shape: Shape, samples?: number): Channel {
    return during(this.at(name), shape, samples);
  }

  /** Places a channel as a self-contained additive layer, neutral outside. */
  additive(name: string, channel: Channel, o: AdditiveOptions = {}): Channel {
    return withinAdditive(this.at(name), channel, o);
  }

  /** Places a procedural shape as a self-contained additive layer, neutral outside. */
  duringAdditive(name: string, shape: Shape, o: AdditiveOptions & { samples?: number } = {}): Channel {
    return duringAdditive(this.at(name), shape, o);
  }

  /** Gives one field instance its staggered sub-window inside this window. */
  stagger(name: string, i: number, n: number, o: StaggerOptions = {}): Beat {
    return stagger(this.at(name), i, n, o);
  }

  toString(): string {
    return this.windows
      .map((b) => `${b.name} ${b.seconds.toFixed(2)}s [${b.from.toFixed(3)}..${b.to.toFixed(3)}]`)
      .join('\n');
  }
}

export class Score extends Windows {
  constructor(duration: number, beats: Beat[]) {
    super(duration, beats, 'beat');
  }

  get beats(): Beat[] {
    return this.windows;
  }
}

export type CueSpan = [fromSeconds: number, toSeconds: number];

/**
 * Named windows on a film timeline.
 *
 * A `Score` is a sequence: its beats sit one after another and account for the
 * whole duration. A cue sheet is deliberately not a sequence. Shots, dialogue,
 * transitions and effects overlap, leave gaps, and often describe different
 * aspects of the same instant. Keeping the two models separate means neither
 * has to weaken its useful guarantees to impersonate the other.
 */
export class CueSheet extends Windows {
  constructor(duration: number, cues: Beat[]) {
    super(duration, cues, 'cue');
  }

  get cues(): Beat[] {
    return this.windows;
  }
}

/**
 * Declares overlapping named windows in seconds.
 *
 * Object insertion order is preserved for display only; unlike `score()`, cue
 * order has no semantic effect. Every cue is independently validated against
 * the film duration and may overlap any other cue.
 */
export function cueSheet(
  of: number | Character,
  spans: Record<string, CueSpan>,
): CueSheet {
  const duration = typeof of === 'number' ? of : of.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`heron: cueSheet() needs a positive finite duration, got ${duration}`);
  }

  const cues: Beat[] = [];
  for (const [name, [from, to]] of Object.entries(spans)) {
    if (!name) throw new Error('heron: cueSheet() cue names cannot be empty');
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new Error(`heron: cue "${name}" must use finite times`);
    }
    if (from < 0 || to > duration || to <= from) {
      throw new Error(
        `heron: cue "${name}" [${from}, ${to}] must be a positive window inside a ${duration}s film`,
      );
    }
    cues.push({ name, from: from / duration, to: to / duration, seconds: to - from });
  }
  if (!cues.length) throw new Error('heron: cueSheet() needs at least one cue');
  return new CueSheet(duration, cues);
}

/**
 * Divides a cycle into named beats.
 *
 * Exactly one beat may ask for zero seconds, and it absorbs whatever is left
 * over — a hold is almost always "the rest of it", and making that explicit
 * stops the durations from being tuned against each other to sum correctly. If
 * they overrun, that is an error with the arithmetic shown, because a score that
 * does not fit its cycle is a mistake and not a thing to silently rescale.
 */
export function score(of: number | Character, spans: Array<[string, number]>): Score {
  const duration = typeof of === 'number' ? of : of.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`heron: score() needs a positive finite duration, got ${duration}`);
  }
  const names = new Set<string>();
  for (const [name, seconds] of spans) {
    if (!name) throw new Error('heron: score() beat names cannot be empty');
    if (names.has(name)) throw new Error(`heron: score() has duplicate beat "${name}"`);
    names.add(name);
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`heron: beat "${name}" seconds must be finite and at least zero`);
    }
  }
  const slack = duration - spans.reduce((n, [, s]) => n + Math.max(0, s), 0);
  const fillers = spans.filter(([, s]) => s <= 0).length;
  if (fillers > 1) throw new Error('heron: score() takes at most one beat sized 0, to absorb the remainder');
  if (slack < -1e-9) {
    throw new Error(`heron: the score runs ${(-slack).toFixed(3)}s past a ${duration}s cycle`);
  }
  if (!fillers && slack > 1e-9) {
    throw new Error(
      `heron: the score leaves ${slack.toFixed(3)}s of a ${duration}s cycle unaccounted for`
      + ' - give one beat a length of 0 to absorb it',
    );
  }

  const beats: Beat[] = [];
  let at = 0;
  for (const [name, want] of spans) {
    const seconds = want > 0 ? want : slack;
    beats.push({ name, from: at / duration, to: (at + seconds) / duration, seconds });
    at += seconds;
  }
  return new Score(duration, beats);
}

/**
 * Places a local curve into the cycle.
 *
 * Outside its beat the curve holds its own end values, which is one rule that
 * covers both things a beat can be. A transient starts and finishes at zero, so
 * holding leaves it silent everywhere else; a move that should stay put finishes
 * somewhere else, so holding is exactly the intent. Nothing has to say which
 * kind it is.
 *
 * A shape that can name its own keyframes is emitted as keyframes; only curves
 * that genuinely need sampling get sampled.
 */
export function during(b: Beat, shape: Shape, samples?: number): Channel {
  validateBeat(b, 'during');
  if (shape.keys && samples === undefined) return keys(shape.keys(b));
  const width = Math.max(1e-6, b.to - b.from);
  const before = shape(0, 0);
  const after = shape(b.seconds, 1);
  return sampled((t) => {
    if (t <= b.from) return before;
    if (t >= b.to) return after;
    const u = (t - b.from) / width;
    return shape(u * b.seconds, u);
  }, samples ?? shape.samples?.(b) ?? density(width));
}

/**
 * Places an existing local 0..1 channel inside a beat.
 *
 * `during()` does this job for a procedural `Shape`; `within()` does it for a
 * channel that already has its own authored keyframes. Film choreography needs
 * both: a wipe with three deliberately timed poses should stay those exact
 * three poses when it is moved from one shot to another, not be rewritten
 * against global cycle fractions or sampled into an approximation.
 *
 * The channel holds its first value before the window and its last value after
 * it. Keyed input stays keyed, with its easing attached to the same local
 * segment. Procedural input stays procedural and receives enough global samples
 * to preserve the density it requested inside the narrower window.
 */
export function within(b: Beat, channel: Channel): Channel {
  validateBeat(b, 'within');
  const width = b.to - b.from;

  if (channel.kind === 'fn') {
    const before = channel.fn(0);
    const after = channel.fn(1);
    return {
      kind: 'fn',
      fn: (t) => {
        if (t <= b.from) return before;
        if (t >= b.to) return after;
        return channel.fn((t - b.from) / width);
      },
      // Decimal window boundaries rarely subtract to their printed value
      // exactly (`0.6 - 0.4` is slightly below 0.2). Keep that representation
      // noise from inventing one extra sample.
      samples: Math.ceil(channel.samples / width - 1e-9),
    };
  }

  const first = channel.keys[0];
  const last = channel.keys[channel.keys.length - 1];
  const mapped: typeof channel.keys = [];
  const push = (key: (typeof channel.keys)[number]) => {
    const previous = mapped[mapped.length - 1];
    if (previous && Math.abs(previous.t - key.t) < 1e-12) mapped[mapped.length - 1] = key;
    else mapped.push(key);
  };

  // A held segment before the window. The value is constant, so its easing has
  // no visible effect; the key at `b.from` below owns the first moving segment.
  if (b.from > 0) push({ t: 0, v: first.v, ease: linear });
  if (first.t > 0) push({ t: b.from, v: first.v, ease: first.ease });

  for (const key of channel.keys) {
    push({ ...key, t: b.from + key.t * width });
  }

  // A local channel may end before its own t=1 and rely on channelAt's hold.
  // Name that hold explicitly at the window boundary before extending it.
  if (last.t < 1) push({ t: b.to, v: last.v, ease: linear });
  if (b.to < 1) push({ t: 1, v: last.v, ease: linear });

  return { kind: 'keys', keys: mapped };
}

export interface AdditiveOptions {
  /** Neutral for this layer: 0 for additive transforms, 1 for scale/opacity. */
  neutral?: number;
  /** Fraction of the local window used to enter the channel's first value. */
  attack?: number;
  /** Fraction used to return from its last value to neutral. */
  release?: number;
}

/**
 * Places a continuous, self-contained layer inside a beat.
 *
 * Unlike within(), which deliberately holds its edge values, this adds explicit
 * neutral ramps at both sides. The caller chooses the neutral because additive
 * rotation/translation use 0 while multiplicative scale and opacity use 1.
 */
export function withinAdditive(b: Beat, channel: Channel, o: AdditiveOptions = {}): Channel {
  validateBeat(b, 'withinAdditive');
  const neutral = o.neutral ?? 0;
  const attack = o.attack ?? 0.08;
  const release = o.release ?? 0.08;
  if (![neutral, attack, release].every(Number.isFinite) || attack < 0 || release < 0
      || attack + release >= 1) {
    throw new Error('heron: withinAdditive() needs finite neutral and non-negative attack/release whose sum is below 1');
  }
  const active = 1 - attack - release;
  let local: Channel;
  if (channel.kind === 'fn') {
    const first = channel.fn(0);
    const last = channel.fn(1);
    local = sampled((t) => {
      if (attack > 0 && t < attack) return neutral + (first - neutral) * t / attack;
      if (release > 0 && t > 1 - release) {
        return last + (neutral - last) * (t - (1 - release)) / release;
      }
      return channel.fn(Math.max(0, Math.min(1, (t - attack) / active)));
    }, Math.ceil(channel.samples / active));
  } else {
    const first = channel.keys[0];
    const last = channel.keys.at(-1)!;
    const tuples: KeyTuple[] = [[0, neutral, linear]];
    if (attack > 0) tuples.push([attack, first.v, first.ease]);
    for (const key of channel.keys) {
      const tuple: KeyTuple = [attack + key.t * active, key.v, key.ease];
      const previous = tuples.at(-1)!;
      if (Math.abs(previous[0] - tuple[0]) < 1e-12) tuples[tuples.length - 1] = tuple;
      else tuples.push(tuple);
    }
    if (release > 0 && Math.abs(tuples.at(-1)![0] - (1 - release)) > 1e-12) {
      tuples.push([1 - release, last.v, linear]);
    }
    if (release > 0) tuples.push([1, neutral, linear]);
    else if (tuples.at(-1)![1] !== neutral) {
      throw new Error('heron: withinAdditive() release must be positive when the channel does not end at neutral');
    }
    local = keys(tuples);
  }
  return within(b, local);
}

/**
 * Places a procedural shape inside a beat as a self-contained additive layer.
 *
 * `during()` and `within()` are one pair: shape in, channel in. `withinAdditive`
 * had no shape-taking twin, so a procedural gesture could not be layered without
 * hand-sampling it first. The shape is sampled in its own local time — seconds
 * first, exactly as `during()` hands them over — and the neutral-ramp policy is
 * withinAdditive's, written once.
 *
 * Unlike `during()`, which emits a shape's exact keyframes when it carries
 * `.keys`, this always samples: a keyed shape trades its exactness for the
 * additive attack/release ramps, which only sampling can produce.
 */
export function duringAdditive(
  b: Beat, shape: Shape, o: AdditiveOptions & { samples?: number } = {},
): Channel {
  validateBeat(b, 'duringAdditive');
  const { samples, ...additive } = o;
  const width = Math.max(1e-6, b.to - b.from);
  const local = sampled(
    (u: number) => shape(u * b.seconds, u),
    samples ?? shape.samples?.(b) ?? density(width),
  );
  return withinAdditive(b, local, additive);
}

function validateBeat(b: Beat, fn: string): void {
  if (!b || typeof b.name !== 'string' || !Number.isFinite(b.from) || !Number.isFinite(b.to)
      || b.from < 0 || b.to > 1 || b.to <= b.from
      || !Number.isFinite(b.seconds) || b.seconds <= 0) {
    throw new Error(
      `heron: ${fn}() needs a positive window inside 0..1 with positive finite seconds`,
    );
  }
}

export interface StaggerOptions {
  /**
   * How much of the beat is spent handing out start times, 0 to 1. At 0 every
   * instance moves together; at 1 the last one starts as the first one finishes.
   */
  spread?: number;
  /** Order to go in. Default is index order; pass a shuffle for a dissolve. */
  order?: number[];
}

/**
 * Instance `i` of `n`, given its own slice of a beat.
 *
 * Returns a `Beat`, which is the whole point: a stagger is not a new kind of
 * timing, it is `n` ordinary beats packed into one, so everything that already
 * places a curve in a beat places a curve in one of these. Eight hundred dots
 * leaving at eight hundred slightly different moments is `during(stagger(...))`
 * and nothing else.
 *
 * This is what makes a dissolve read as a dissolve rather than as a fade. All
 * together is one object becoming transparent; one after another is an object
 * coming apart, and the only difference between them is here.
 */
export function stagger(b: Beat, i: number, n: number, o: StaggerOptions = {}): Beat {
  validateBeat(b, 'stagger');
  const spread = Math.max(0, Math.min(1, o.spread ?? 0.6));
  const rank = o.order ? o.order.indexOf(i) : i;
  const at = n > 1 ? Math.max(0, rank) / (n - 1) : 0;
  const width = (b.to - b.from) * (1 - spread);
  const from = b.from + (b.to - b.from) * spread * at;
  return { name: `${b.name}[${i}]`, from, to: from + width, seconds: b.seconds * (1 - spread) };
}

/**
 * Grid density for a curve that has to be sampled.
 *
 * Sized from the beat rather than from the cycle: a recoil lasting three per
 * cent of a cycle sampled at the usual density would be four points long, and
 * the compiler would faithfully bake a curve that was never there.
 */
export function density(span: number): number {
  return Math.ceil(48 / Math.max(1e-6, span));
}

// --- local curves ------------------------------------------------------------
// The handful of shapes that are about form rather than physics. Anything with
// weight to it wants `spring` instead.

/** Out and back: peaks in the middle, zero at both ends. A gesture. */
export const swell = (amount: number): Shape => (_, u) => amount * Math.sin(Math.PI * u);

/** Straight from one value to another, eased. */
export function ramp(from: number, to: number, ease: Easing = easeInOut): Shape {
  const f: Shape = (_, u) => from + (to - from) * ease.fn(u);
  f.keys = (b) => span(b, from, to, ease);
  return f;
}

/** Moves there and stays. Needs a matching move back if the cycle must close. */
export const shift = (amount: number, ease: Easing = easeInOut): Shape => ramp(0, amount, ease);

/** Holds one value for the whole beat. */
export const hold = (value: number): Shape => ramp(value, value, linear);
