/**
 * Where a part goes, and how fast. The measurement layer.
 *
 * Motion is a relationship between frames, and every defect that survived to a
 * finished render in this project's history was of that kind: a beak folding over
 * a back twice per step, a walk-off that read as diving at the floor, arcs
 * flattening. None of them is visible in a pose, and none of them is visible in a
 * channel plot either — a channel says what a joint did, not where the ink went.
 *
 * A spacing chart says it immediately. Sampling the crane's planted foot gives a
 * dead-constant 3.0 units per sample through stance and 16.25 on the swing; that
 * ratio *is* the timing of the walk, and it reads in one row of numbers.
 *
 * This module only measures. It sets no thresholds and names no defects: `lint`
 * is the only judge. The motion sheet, the variants overlay and the soft
 * diagnostics all read this one pass, so no two of them can disagree about what
 * a scene did — including `lint`'s ground checks, which take their stance
 * decision from `plantedRun` rather than restating it.
 */

import type { Character, Node, Vec2 } from './scene.ts';
import type { CueSheet, Score } from './score.ts';
import { type Frame, frameAt, nodePose } from './timeline.ts';
import { type Box, boxOfCorners, mergeBoxes, subtreeCorners } from './geometry.ts';
import { round } from './render.ts';

/** Which stretch of the cycle was measured. */
export type TrackWindow =
  | { kind: 'cycle' }
  | { kind: 'cue'; name: string }
  | { kind: 'seconds'; from: number; to: number };

/** A part to follow, and optionally the exact local point on it to follow. */
export interface TrackRequest {
  path: string;
  /** Rest-pose coordinates. Overrides the contact/pivot/ink fallback. */
  local?: Vec2;
}

export interface TrackedSample {
  /** Cycle fraction. */
  t: number;
  /** Wall-clock seconds from the start of the animation. */
  seconds: number;
  /** Set when the pass was sampled cue by cue. */
  cue?: string;
  /** World position of the tracked point. */
  point: Vec2;
  /**
   * Whether the part is faded in at this instant.
   *
   * The product of this part's opacity and every ancestor's, because that is how
   * things are actually hidden — a shot group fading out, an iris closing, a swap
   * cutting away all leave the part's own opacity at 1. Note the honest limit:
   * `clip`, `mask` and `offstage` conceal artwork without touching opacity, so
   * false here means "faded out", not "certainly unseen".
   */
  visible: boolean;
  /** First or last sample of a cue. */
  boundary: boolean;
  /** The tracked point is planted: low, and travelling against the direction of travel. */
  planted: boolean;
}

export interface Hold {
  from: number;
  to: number;
  seconds: number;
}

/**
 * A slowing, stated as what happened rather than as a verdict.
 *
 * Whether 420 units/s to 0 in 33ms is a mistake depends on whether something was
 * hit, which this module cannot know. The `abrupt-stop` diagnostic is this
 * measurement plus a threshold and a name; keeping them apart is what lets the
 * instrument stay honest and gives the diagnostic something to stand on.
 */
export interface Deceleration {
  at: number;
  from: number;
  to: number;
  overSeconds: number;
}

/**
 * Ink-to-ink separation between two parts over the window.
 *
 * Measured between subtree bounding boxes, not between tracked points. The
 * question that wants this — "does the chick's beak clear its mother's back" — is
 * about ink: the gap between a beak's point and a body's pivot can close while
 * nothing touches, and stay wide while things overlap.
 */
export interface Clearance {
  minimum: number;
  at: number;
  /** Times at which the two boxes intersect, so the minimum is zero. */
  overlaps: number[];
}

export interface PartTrack {
  part: string;
  /** Whether this part was asked about, or is only here as something to measure against. */
  role: 'tracked' | 'compare';
  trackedAt: { source: 'explicit' | 'contact' | 'pivot' | 'ink'; local: Vec2 };
  /** Summed over visible runs only, so a hide/show teleport is not counted as travel. */
  pathLength: number;
  /** Units per second, so the numbers do not change meaning when `samples` does. */
  speed: { median: number; peak: number; ratio: number };
  holds: Hold[];
  /** Cycle times where horizontal or vertical direction of travel flips. */
  reversals: { x: number[]; y: number[] };
  decelerations: Deceleration[];
  largestJump: { at: number; delta: number };
  /**
   * World bounds of the part's artwork across the whole window.
   *
   * Carried on the report because the sampling pass already computes each frame's
   * box for the clearance measurement. Anything that needs to frame this motion —
   * a zoomed sheet, a variant overlay — then folds these together instead of
   * posing the scene a second time for every sample.
   */
  bounds: Box | null;
  /** Stretches where the part is faded out, as [from, to] cycle times. */
  invisible: Array<[number, number]>;
  /** How many separate visible stretches the path is drawn in. */
  runs: number;
  /** Samples dropped from the statistics because the part was faded out. */
  dropped: number;
  clearance: Record<string, Clearance>;
  samples: TrackedSample[];
}

export interface TrackReport {
  scene: string;
  duration: number;
  samples: number;
  /** Whether the final instant was measured. Inclusive for films and partial windows. */
  endpoints: 'inclusive' | 'exclusive';
  window: { kind: TrackWindow['kind']; name?: string; from: number; to: number; seconds: number };
  parts: PartTrack[];
}

export interface TrackOptions {
  parts: Array<TrackRequest | string>;
  /**
   * A prepared corner map, when the caller already built one.
   *
   * `subtreeCorners` hulls every shape in the tree, and a caller that used it to
   * decide *what* to measure would otherwise pay for it twice.
   */
  corners?: Map<string, Vec2[]>;
  /** Extra parts measured only for clearance against the tracked ones. */
  compare?: Array<TrackRequest | string>;
  samples?: number;
  /** Exact normalized instants to measure, for delivery-frame diagnostics. */
  times?: number[];
  window?: TrackWindow;
  timeline?: Score | CueSheet;
  /** One cell per cue: sample each cue's own window densely. */
  perCue?: boolean;
}

/** Near-zero speed, as a fraction of the part's own median, that reads as a hold. */
const HOLD_FRACTION = 0.06;

/**
 * How close to its own lowest point a tracked point must be to count as planted,
 * as a fraction of the scene's height.
 *
 * Measured against the point's own lowest reach rather than the declared ground
 * line, because a foot passing *above* the ground during a swing is airborne, not
 * in contact — a symmetric test around the ground line quietly classifies a
 * hovering foot as planted and then judges its speed.
 */
export const CONTACT_BAND = 0.02;

function requestOf(value: TrackRequest | string): TrackRequest {
  if (typeof value !== 'string') return value;
  // `head@188,30` names a point that is neither a pivot nor a contact — a beak
  // tip, a fingertip, the corner of a card. Those are exactly the points whose
  // arc matters, so naming one has to be as easy as naming the part.
  const cut = value.lastIndexOf('@');
  if (cut < 0) return { path: value };
  const coords = value.slice(cut + 1).split(',').map(Number);
  if (coords.length !== 2 || !coords.every(Number.isFinite)) {
    throw new Error(`heron: "${value}" should be a part path, or path@x,y to name a point on it`);
  }
  return { path: value.slice(0, cut), local: [coords[0], coords[1]] };
}

/**
 * Finds the part a query names, or fails in a way that helps.
 *
 * The matching itself is `Character.find`'s: exact path first, then a loose match
 * that lets `legNear.foot` reach through intervening parts, with ambiguity
 * reported against the candidates. Only the miss is handled here, and only
 * because a scene with a hundred and fifty parts should not answer "which part?"
 * by printing all of them — the near misses are the useful answer.
 */
export function resolvePart(ch: Character, query: string): Node {
  const found = ch.find(query);
  if (found) return found;

  const paths = ch.nodes().map((n) => n.path).filter(Boolean);
  const needle = query.toLowerCase();
  const near = paths.filter((p) => p.toLowerCase().includes(needle)).slice(0, 6);
  throw new Error(
    `heron: no part "${query}".`
    + (near.length ? ` Did you mean: ${near.join(', ')}` : ` Parts are: ${paths.slice(0, 8).join(', ')}`),
  );
}

/**
 * The point on a part whose path is worth drawing.
 *
 * The ink fallback is the one that matters in practice: a pure transform group
 * holds no shapes of its own, so without it the whole subtree's motion would be
 * reported from the viewBox origin — a confident, meaningless path.
 */
function pointOf(
  node: Node,
  request: TrackRequest,
  corners: Map<string, Vec2[]>,
): { source: PartTrack['trackedAt']['source']; local: Vec2 } {
  if (request.local) return { source: 'explicit', local: request.local };
  if (node.contact) return { source: 'contact', local: node.contact };

  const inkCentre = (): Vec2 | null => {
    const box = corners.get(node.path);
    if (!box?.length) return null;
    const b = box.reduce<Box | null>(
      (acc, [x, y]) => mergeBoxes(acc, { x0: x, y0: y, x1: x, y1: y }),
      null,
    )!;
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  };

  // A pivot is a landmark only on a part that owns artwork — there it is a joint,
  // and the joint is what an animator watches. On a pure transform group it is
  // just the rotation origin its children turn about, and `pivot: [0, 0]` is the
  // common way of saying "this one only translates". Tracking that would compute
  // the group's travel correctly and then draw it through empty space, detached
  // from the ink whose arc is the entire question.
  const ownsInk = node.content.some((item) => 'shape' in item);
  if (!ownsInk) {
    const centre = inkCentre();
    if (centre) return { source: 'ink', local: centre };
  }
  if (node.pivot) return { source: 'pivot', local: node.pivot };
  const centre = inkCentre();
  if (centre) return { source: 'ink', local: centre };

  throw new Error(
    `heron: "${node.path}" has no contact point, pivot or artwork to track.`
    + ` Name a point with ${node.path}@x,y`,
  );
}

/** Visibility as the viewer sees it: this part's opacity times every ancestor's. */
function chainOpacity(
  frame: Frame, path: string, memo: Map<string, number>, nodes: Map<string, Node>,
): number {
  const got = memo.get(path);
  if (got !== undefined) return got;
  const cut = path.lastIndexOf('.');
  const parent = cut < 0 ? '' : path.slice(0, cut);
  const node = nodes.get(path);
  const own = node ? nodePose(node, frame.pose.get(path)).opacity : 1;
  const value = own * (path ? chainOpacity(frame, parent, memo, nodes) : 1);
  memo.set(path, value);
  return value;
}

interface Slot {
  t: number;
  seconds: number;
  cue?: string;
  boundary: boolean;
}

/**
 * The instants to measure.
 *
 * Endpoint handling is not a detail. A cycle sampled inclusively repeats its own
 * first pose at t=1, which shows up as a duplicated dot, a zero-length step and a
 * hold that is not there. A film sampled exclusively never measures its final
 * pose — on an eleven-second film that is the end card, the last thing anyone
 * sees, and the one instant the instrument would be blind to.
 */
function slots(ch: Character, o: TrackOptions): { list: Slot[]; endpoints: 'inclusive' | 'exclusive'; window: TrackReport['window'] } {
  const n = Math.max(2, o.samples ?? 24);
  const timeline = o.timeline;

  if (o.times) {
    if (o.perCue || o.window) {
      throw new Error('heron: exact tracking times cannot be combined with a cue or range');
    }
    if (o.times.length < 2 || o.times.some((t) => !Number.isFinite(t) || t < 0 || t > 1)) {
      throw new Error('heron: exact tracking times need at least two finite values inside 0..1');
    }
    const times = [...new Set(o.times)].sort((a, b) => a - b);
    const endpoints = times[times.length - 1] === 1 ? 'inclusive' : 'exclusive';
    return {
      list: times.map((t, i) => ({
        t, seconds: t * ch.duration, boundary: i === 0 || i === times.length - 1,
      })),
      endpoints,
      window: { kind: 'cycle', from: 0, to: 1, seconds: ch.duration },
    };
  }

  if (o.perCue) {
    if (!timeline) throw new Error('heron: per-cue tracking needs an exported Score or CueSheet');
    guardDuration(ch, timeline);
    const list: Slot[] = [];
    for (const cue of timeline.windows) {
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const seconds = cue.from * timeline.duration + cue.seconds * u;
        list.push({
          t: seconds / timeline.duration,
          seconds,
          cue: cue.name,
          boundary: i === 0 || i === n - 1,
        });
      }
    }
    return {
      list,
      endpoints: 'inclusive',
      window: { kind: 'cue', from: 0, to: 1, seconds: ch.duration },
    };
  }

  const spec = o.window ?? { kind: 'cycle' as const };
  const { from, to, name } = resolveWindow(ch, spec, timeline);
  const { times, endpoints } = windowTimes(ch, spec, n, timeline);
  const list: Slot[] = times.map((t, i) => ({
    t, seconds: t * ch.duration, boundary: i === 0 || i === n - 1,
  }));
  return {
    list,
    endpoints,
    window: { kind: spec.kind, name, from, to, seconds: (to - from) * ch.duration },
  };
}

/**
 * The times a window is sampled at, and which endpoint rule was used.
 *
 * The shareable unit is not "where the window is" but "when it is looked at",
 * and getting that wrong is invisible. `variants --strip 3` re-derived it with
 * inclusive endpoints and drew the *same pose twice* — frames 0 and 2 of a
 * looping cycle came out byte-identical, spending a third of the strip on a
 * picture already on screen. A looping full cycle closes on itself, so it is the
 * one case sampled exclusively; anything narrower, or a `once` film, wants both
 * of its ends.
 */
export function windowTimes(
  ch: Character,
  spec: TrackWindow,
  n: number,
  timeline?: Score | CueSheet,
): { times: number[]; endpoints: 'inclusive' | 'exclusive' } {
  const { from, to } = resolveWindow(ch, spec, timeline);
  const wraps = spec.kind === 'cycle' && !ch.once;
  const span = n < 2 ? [0.5] : Array.from({ length: n }, (_, i) => (wraps ? i / n : i / (n - 1)));
  return {
    times: span.map((u) => from + (to - from) * u),
    endpoints: wraps ? 'exclusive' : 'inclusive',
  };
}

/**
 * A window as a span of cycle fractions.
 *
 * Exported because it has two callers now — the sampler below, and `variants`,
 * which needs the same span to place the poses in a strip. A second reading of
 * `--cue landing` would be a second answer to where the cue is.
 */
export function resolveWindow(
  ch: Character,
  spec: TrackWindow,
  timeline?: Score | CueSheet,
): { from: number; to: number; name?: string } {
  if (spec.kind === 'cue') {
    if (!timeline) throw new Error(`heron: the cue "${spec.name}" needs an exported Score or CueSheet`);
    guardDuration(ch, timeline);
    const cue = timeline.at(spec.name);
    return { from: cue.from, to: cue.to, name: spec.name };
  }
  if (spec.kind === 'seconds') {
    const from = spec.from / ch.duration;
    const to = spec.to / ch.duration;
    if (!(from >= 0 && to <= 1 && to > from)) {
      throw new Error(`heron: range ${spec.from}..${spec.to}s is not inside a ${ch.duration}s animation`);
    }
    return { from, to };
  }
  return { from: 0, to: 1 };
}

function guardDuration(ch: Character, timeline: Score | CueSheet): void {
  // `renderCueSheet` refuses this mismatch and `cueFrames` does not, so a caller
  // reading cues directly would map every one of them to the wrong times and
  // report those times with complete confidence.
  if (Math.abs(ch.duration - timeline.duration) > 1e-9) {
    throw new Error(
      `heron: the timeline is ${timeline.duration}s but "${ch.name}" is ${ch.duration}s,`
      + ' so its cues do not line up with the animation',
    );
  }
}

/**
 * Longest circular run of `true`, as indices into the original array.
 *
 * Tracked by start and length so the growing run is not copied on every
 * extension. Private: `plantedRun` is the shared primitive now, and exporting
 * this as well invited a second stance decision built out of the pieces.
 */
function longestRun(flags: boolean[]): number[] {
  const n = flags.length;
  let bestStart = 0;
  let bestLen = 0;
  let start = 0;
  let len = 0;
  for (let i = 0; i < n * 2 && len < n; i++) {
    if (flags[i % n]) {
      if (len === 0) start = i;
      len++;
      if (len > bestLen) { bestLen = len; bestStart = start; }
    } else len = 0;
  }
  return Array.from({ length: bestLen }, (_, i) => (bestStart + i) % n);
}

/** What the stance decision found, for the one caller that judges the stance. */
export interface PlantedRun {
  /** True where the tracked point is planted. */
  flags: boolean[];
  /** Indices of the longest planted run, in order, treating the cycle as circular. */
  indices: number[];
  /** Horizontal step into each sample. Units per sample, not per second. */
  deltas: number[];
}

export function plantedRun(points: Vec2[], height: number, cyclic: boolean): PlantedRun {
  const n = points.length;
  const band = height * CONTACT_BAND;
  const lowest = points.length ? Math.max(...points.map((p) => p[1])) : 0;
  const deltas = points.map((p, i) => (i === 0 && !cyclic ? 0 : p[0] - points[(i - 1 + n) % n][0]));
  if (n < 4) return { flags: points.map(() => false), indices: [], deltas };
  const low = points.map((p, i) => (p[1] >= lowest - band ? deltas[i] : 0));
  const travel = low.reduce((a, b) => a + b, 0) <= 0 ? -1 : 1;
  const near = points.map((p, i) => p[1] >= lowest - band && deltas[i] * travel >= 0);
  const indices = longestRun(near);
  const run = new Set(indices);
  return { flags: points.map((_, i) => run.has(i)), indices, deltas };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Contiguous stretches of samples for which `flag` holds, as index ranges. */
function runsOf(flags: boolean[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (flags[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

/**
 * Measures one or more parts over one window, in a single pass over the frames.
 *
 * One pass, not one per part: posing a 150-node film costs about 3ms a frame, and
 * a sheet that follows three parts across six cues would otherwise pose the same
 * tree two hundred times over.
 */
/**
 * Every part worth measuring: it carries motion of its own, and it has a point.
 *
 * Lives here rather than in `lint` because it has to agree with `pointOf`'s
 * fallback chain, and a copy in the caller did not — it required ink, where
 * `pointOf` also accepts a pivot, so a pivot-only group was excluded from the
 * diagnostics while being perfectly trackable. Takes the corner map so a caller
 * that already has one does not walk the shape tree twice.
 */
export function trackable(ch: Character, corners = subtreeCorners(ch)): string[] {
  return ch.nodes()
    .filter((n) => n.path && n.tracks.length && (n.contact || n.pivot || corners.has(n.path)))
    .map((n) => n.path);
}

export function trackParts(ch: Character, o: TrackOptions): TrackReport {
  const requests = o.parts.map(requestOf);
  const compares = (o.compare ?? []).map(requestOf);
  if (!requests.length) throw new Error('heron: tracking needs at least one part');

  const corners = o.corners ?? subtreeCorners(ch);
  const all = [...requests, ...compares].map((request) => {
    const node = resolvePart(ch, request.path);
    return { node, request, ...pointOf(node, request, corners) };
  });

  const { list, endpoints, window } = slots(ch, o);
  const cyclic = endpoints === 'exclusive';
  const nodes = new Map(ch.nodes().map((node) => [node.path, node]));

  // The single pass. Everything below reads from what this collected.
  const posed = list.map((slot) => {
    const frame = frameAt(ch, slot.t);
    const memo = new Map<string, number>();
    return {
      slot,
      points: all.map((target) => frame.point(target.node, target.local)),
      visible: all.map((target) => chainOpacity(frame, target.node.path, memo, nodes) > 0.01),
      boxes: all.map((target) => boxOfCorners(corners.get(target.node.path), frame.matrices.get(target.node.path))),
    };
  });

  // Compared parts are measured too, so their path can be drawn alongside and
  // the reader can see what the clearance number is a clearance from.
  const parts = all.map((_, index): PartTrack => {
    const target = all[index];
    const role: PartTrack['role'] = index < requests.length ? 'tracked' : 'compare';
    const points = posed.map((p) => p.points[index]);
    const visible = posed.map((p) => p.visible[index]);
    const planted = plantedRun(points, ch.viewBox[3], cyclic).flags;

    // Statistics are taken run by run, so the chord across a hide/show gap is
    // neither counted as distance nor reported as the largest single-frame jump.
    // That jump is a teleport nobody saw, and it would be the loudest line here.
    const visibleRuns = runsOf(visible);
    const steps: Array<{ at: number; distance: number; seconds: number }> = [];
    let pathLength = 0;
    for (const [lo, hi] of visibleRuns) {
      for (let i = lo + 1; i <= hi; i++) {
        const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        pathLength += d;
        steps.push({
          at: list[i].t,
          distance: d,
          seconds: Math.max(1e-12, list[i].seconds - list[i - 1].seconds),
        });
      }
    }
    if (cyclic && visible[0] && visible[visible.length - 1] && visibleRuns.length === 1) {
      const last = points[points.length - 1];
      const d = Math.hypot(points[0][0] - last[0], points[0][1] - last[1]);
      pathLength += d;
      steps.push({
        at: 1,
        distance: d,
        seconds: Math.max(1e-12, ch.duration - list[list.length - 1].seconds + list[0].seconds),
      });
    }

    const speeds = steps.map((s) => s.distance / s.seconds);
    const med = median(speeds);
    const peak = speeds.length ? Math.max(...speeds) : 0;

    const holds: Hold[] = [];
    const slow = steps.map((s) => med > 0 && s.distance / s.seconds < med * HOLD_FRACTION);
    for (const [lo, hi] of runsOf(slow)) {
      holds.push({
        from: round(steps[lo].at, 4),
        to: round(steps[hi].at, 4),
        seconds: round(steps.slice(lo, hi + 1).reduce((sum, step) => sum + step.seconds, 0), 3),
      });
    }

    const decelerations: Deceleration[] = [];
    for (let i = 1; i < speeds.length; i++) {
      if (speeds[i] < speeds[i - 1] * 0.5 && speeds[i - 1] > med) {
        decelerations.push({
          at: round(steps[i].at, 4),
          from: round(speeds[i - 1], 2),
          to: round(speeds[i], 2),
          overSeconds: round(steps[i].seconds, 4),
        });
      }
    }

    const reversals = { x: [] as number[], y: [] as number[] };
    for (const [lo, hi] of visibleRuns) {
      for (let i = lo + 2; i <= hi; i++) {
        const ax = points[i - 1][0] - points[i - 2][0];
        const bx = points[i][0] - points[i - 1][0];
        const ay = points[i - 1][1] - points[i - 2][1];
        const by = points[i][1] - points[i - 1][1];
        if (ax * bx < 0) reversals.x.push(round(list[i - 1].t, 4));
        if (ay * by < 0) reversals.y.push(round(list[i - 1].t, 4));
      }
    }

    const biggest = steps.reduce(
      (best, s) => (s.distance > best.delta ? { at: s.at, delta: s.distance } : best),
      { at: 0, delta: 0 },
    );

    const clearance: Record<string, Clearance> = {};
    for (let k = 0; role === 'tracked' && k < compares.length; k++) {
      const other = all[requests.length + k];
      let minimum = Infinity;
      let at = 0;
      const overlaps: number[] = [];
      for (let i = 0; i < posed.length; i++) {
        const a = posed[i].boxes[index];
        const b = posed[i].boxes[requests.length + k];
        if (!a || !b || !visible[i] || !posed[i].visible[requests.length + k]) continue;
        const gap = boxGap(a, b);
        if (gap === 0) overlaps.push(round(list[i].t, 4));
        if (gap < minimum) { minimum = gap; at = list[i].t; }
      }
      clearance[other.node.path] = {
        minimum: Number.isFinite(minimum) ? round(minimum, 2) : -1,
        at: round(at, 4),
        overlaps,
      };
    }

    return {
      part: target.node.path,
      role,
      trackedAt: { source: target.source, local: [round(target.local[0], 2), round(target.local[1], 2)] },
      pathLength: round(pathLength, 2),
      speed: {
        median: round(med, 2),
        peak: round(peak, 2),
        ratio: round(med > 0 ? peak / med : 0, 2),
      },
      holds,
      reversals,
      decelerations,
      largestJump: { at: round(biggest.at, 4), delta: round(biggest.delta, 2) },
      bounds: posed.reduce<Box | null>((box, p) => mergeBoxes(box, p.boxes[index]), null),
      invisible: runsOf(visible.map((v) => !v)).map(([lo, hi]) => [round(list[lo].t, 4), round(list[hi].t, 4)]),
      runs: visibleRuns.length,
      dropped: visible.filter((v) => !v).length,
      clearance,
      samples: posed.map((p, i) => ({
        t: round(p.slot.t, 4),
        seconds: round(p.slot.seconds, 3),
        ...(p.slot.cue ? { cue: p.slot.cue } : {}),
        point: [round(points[i][0], 2), round(points[i][1], 2)] as Vec2,
        visible: visible[i],
        boundary: p.slot.boundary,
        planted: planted[i],
      })),
    };
  });

  return {
    scene: ch.name,
    duration: ch.duration,
    samples: list.length,
    endpoints,
    window: {
      ...window,
      from: round(window.from, 4),
      to: round(window.to, 4),
      seconds: round(window.seconds, 3),
    },
    parts,
  };
}

/** Shortest distance between two axis-aligned boxes; zero when they intersect. */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dy = Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1));
  return Math.hypot(dx, dy);
}

/** The report as text, for the terminal. */
/**
 * One part's headline numbers, in the one wording every instrument uses.
 *
 * The variants report re-typed these four fields with its own `toFixed(1)` and
 * printed `path 233.9` for the measurement `heron motion` prints as `path 233.94`
 * — two instruments disagreeing in the digits about the same number. The values
 * are already rounded where they are measured, so nothing here rounds again.
 */
export function partLine(p: PartTrack): string {
  return `path ${p.pathLength}   speed ${p.speed.median}/s median, ${p.speed.peak}/s peak`
    + `, ${p.speed.ratio}x   holds ${p.holds.length}`;
}

export function formatTrackReport(r: TrackReport): string {
  const out: string[] = [];
  const where = r.window.name ? `cue ${r.window.name}` : r.window.kind === 'seconds'
    ? `${(r.window.from * r.duration).toFixed(2)}-${(r.window.to * r.duration).toFixed(2)}s`
    : 'the whole cycle';
  out.push(`  ${r.samples} samples over ${where}, endpoints ${r.endpoints}`);

  for (const p of r.parts) {
    if (p.role === 'compare') {
      out.push(`  ${p.part}  (compared against, at ${p.trackedAt.source})`);
      continue;
    }
    out.push(`  ${p.part}  tracked at ${p.trackedAt.source} (${p.trackedAt.local.join(', ')})`);
    out.push(`    ${partLine(p)}   reversals ${p.reversals.x.length}x/${p.reversals.y.length}y`);
    if (p.dropped) {
      out.push(`    ${p.dropped} sample(s) faded out, drawn as ${p.runs} run(s) - excluded from the speeds above`);
    }
    const longest = p.holds.reduce<Hold | null>((best, h) => (!best || h.seconds > best.seconds ? h : best), null);
    if (longest) out.push(`    longest hold ${longest.seconds}s at t=${longest.from}`);
    for (const d of p.decelerations.slice(0, 3)) {
      out.push(`    slows ${d.from}/s -> ${d.to}/s in ${d.overSeconds}s at t=${d.at}`);
    }
    for (const [other, c] of Object.entries(p.clearance)) {
      out.push(
        c.overlaps.length
          ? `    overlaps ${other} at ${c.overlaps.length} sample(s), first t=${c.overlaps[0]}`
          : `    closest to ${other}: ${c.minimum} units at t=${c.at}`,
      );
    }
  }
  return out.join('\n');
}
