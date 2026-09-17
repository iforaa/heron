/**
 * The scene model: a tree of named parts with joints.
 *
 * The whole point of this module is that a character is declared as anatomy,
 * not as geometry. A merged path has no leg to rotate; a Heron tree has
 * `legs.near.thigh` with a pivot at the hip. Everything downstream — animation,
 * inspection, lints — addresses parts by name because of what happens here.
 */

import type { Easing } from './easing.ts';
import { easeInOut, linear, steps } from './easing.ts';
import { morph } from './morph.ts';
import type { PathMorph } from './path-morph.ts';
// Type-only, so the cycle with `score.ts` is erased rather than real. A swap
// reads a score's beats; a score knows nothing about swaps.
import type { Beat, Score } from './score.ts';

/**
 * A cut: holds one value for the whole segment and changes at the end of it.
 *
 * `step-end` is the entire mechanism behind swapping. Interpolating opacity
 * between variants would cross-fade them, and a cross-fade is two things on
 * screen at once — which is exactly what a swap is a promise not to do.
 */
const HARD = steps(1, 'end');

export type Vec2 = [number, number];
export type ViewBox = [number, number, number, number];

export interface ShapeSpec {
  tag: string;
  attrs: Record<string, string | number>;
  morph?: PathMorph;
}

/** A colour stop in a linear or radial gradient. */
export interface GradientStop {
  /** Position along the gradient, from 0 to 1. */
  at: number;
  color: string;
  opacity?: number;
}

export type GradientUnits = 'objectBoundingBox' | 'userSpaceOnUse';
export type GradientSpread = 'pad' | 'reflect' | 'repeat';

interface GradientBase {
  name: string;
  stops: GradientStop[];
  units: GradientUnits;
  spread: GradientSpread;
  transform?: string;
}

export type PaintDefinition =
  | (GradientBase & { kind: 'linear'; x1: number; y1: number; x2: number; y2: number })
  | (GradientBase & { kind: 'radial'; cx: number; cy: number; r: number; fx?: number; fy?: number });

/** Parameterized over the node type so interchange formats can reuse the shape. */
export interface ClipDefinition<N = Node> {
  kind: 'clip';
  name: string;
  units: 'userSpaceOnUse' | 'objectBoundingBox';
  root: N;
}

export interface MaskDefinition<N = Node> {
  kind: 'mask';
  name: string;
  units: 'userSpaceOnUse' | 'objectBoundingBox';
  contentUnits: 'userSpaceOnUse' | 'objectBoundingBox';
  mode: 'luminance' | 'alpha';
  root: N;
  region?: { x: number; y: number; width: number; height: number };
}

export type Definition = PaintDefinition | ClipDefinition | MaskDefinition;

/**
 * An SVG paint resource. It is deliberately opaque: shapes can use it, while
 * the renderer remains responsible for producing the matching definition.
 */
export interface PaintRef {
  readonly kind: 'paint';
  readonly id: string;
}

/** An opaque reference to geometry declared by `clipPath()`. */
export interface ClipRef {
  readonly kind: 'clip';
  readonly id: string;
}

/** An opaque reference to luminance/alpha geometry declared by `mask()`. */
export interface MaskRef {
  readonly kind: 'mask';
  readonly id: string;
}

/** One animated property over the cycle. */
export type Channel =
  | { kind: 'keys'; keys: { t: number; v: number; ease: Easing }[] }
  | { kind: 'fn'; fn: (t: number) => number; samples: number };

/**
 * The animatable channels, in one place.
 *
 * Deliberately exactly what CSS can express: the evaluator and the compiled
 * stylesheet have to agree, and a channel CSS cannot animate could not be
 * compiled honestly. Adding one means adding it here and nowhere else — every
 * other module iterates this table rather than restating the list.
 */
export const CHANNELS = [
  'rotate', 'x', 'y', 'skewX', 'skewY', 'scaleX', 'scaleY', 'opacity', 'draw',
] as const;

export type ChannelName = (typeof CHANNELS)[number];
export type PartTransform = Partial<Record<Exclude<ChannelName, 'draw'>, number>>;

/** The value of each channel when nothing is animating it. */
export const NEUTRAL: Record<ChannelName, number> = {
  rotate: 0,
  x: 0,
  y: 0,
  skewX: 0,
  skewY: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  draw: 1,
};

export type Track = Partial<Record<ChannelName, Channel>> & {
  /** Fraction of the cycle this part runs ahead of the others. */
  phase?: number;
};

/** The channels a track actually animates. */
export function activeChannels(track: Track): ChannelName[] {
  return CHANNELS.filter((c) => track[c] !== undefined);
}

export interface Node {
  name: string;
  /** Dotted path from the root, e.g. `legs.near.thigh`. */
  path: string;
  pivot?: Vec2;
  /** Static local pose, composed before motion and omitted from animation reports. */
  transform?: PartTransform;
  /** Point that is expected to meet the ground, in rest-pose coordinates. */
  contact?: Vec2;
  /** This part and everything under it is meant to run past the frame edge. */
  offstage?: boolean;
  /** A reusable geometry definition that clips this whole subtree. */
  clip?: string;
  /** A reusable luminance/alpha mask applied to this whole subtree. */
  mask?: string;
  /**
   * The child parts this node cuts between, in playback order, if it is a swap.
   *
   * Recorded so the lints can hold a swap to the one rule that makes it a swap:
   * exactly one variant showing, always. Nothing else in the model can express
   * that, because to everything else these are ordinary parts with an opacity.
   */
  variants?: string[];
  /** Shapes and child parts interleaved, preserving declaration (z) order. */
  content: Array<{ shape: ShapeSpec } | { node: Node }>;
  /**
   * Stacked motion, outermost first. Each layer becomes its own wrapper group,
   * so they compose the way nested parts do rather than overwriting each other.
   */
  tracks: Track[];
}

export interface CharacterOptions {
  viewBox: ViewBox;
  /** Seconds per cycle. Only affects playback speed, never the model. */
  duration?: number;
  /** Y coordinate of the ground plane, used by the contact lints. */
  ground?: number;
  /**
   * Plays once and holds its last frame, instead of looping forever.
   *
   * The difference between a cycle and a film, and it is not cosmetic. A cycle
   * has to arrive back where it started, which is what `loop-seam` enforces and
   * what half the machinery here exists to make possible. A film is allowed to
   * end somewhere else — that is the whole point of it — so demanding a closed
   * seam of one would be demanding it never go anywhere.
   */
  once?: boolean;
}

export class Character {
  readonly name: string;
  readonly viewBox: ViewBox;
  readonly duration: number;
  readonly ground?: number;
  readonly once: boolean;
  readonly root: Node;
  readonly definitions: Definition[];

  constructor(name: string, opts: CharacterOptions, root: Node, definitions: Definition[] = []) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('heron: character name must be a non-empty string');
    }
    if (!Array.isArray(opts.viewBox) || opts.viewBox.length !== 4
        || !opts.viewBox.every(Number.isFinite)
        || opts.viewBox[2] <= 0 || opts.viewBox[3] <= 0) {
      throw new Error(`heron: character "${name}" needs a finite viewBox with positive width and height`);
    }
    if (opts.duration !== undefined && (!Number.isFinite(opts.duration) || opts.duration <= 0)) {
      throw new Error(`heron: character "${name}" duration must be a positive finite number`);
    }
    if (opts.ground !== undefined && !Number.isFinite(opts.ground)) {
      throw new Error(`heron: character "${name}" ground must be finite`);
    }
    this.name = name;
    this.viewBox = opts.viewBox;
    this.duration = opts.duration ?? 1;
    this.ground = opts.ground;
    this.once = opts.once ?? false;
    this.root = root;
    this.definitions = definitions;
  }

  /** Every node in the tree, depth-first in draw order. */
  nodes(): Node[] {
    const out: Node[] = [];
    const walk = (n: Node) => {
      out.push(n);
      for (const item of n.content) if ('node' in item) walk(item.node);
    };
    walk(this.root);
    return out;
  }

  /**
   * Exact path first, then a forgiving match where the query's segments appear
   * in order somewhere in the full path. This lets `legNear.foot` resolve to
   * `body.legNear.thigh.shin.foot` — rigs nest deeply, and requiring the whole
   * chain is a pointless source of mistakes. Ambiguity is always an error, so
   * the shorthand can never silently pick the wrong part.
   */
  find(path: string): Node | undefined {
    const all = this.nodes();
    const exact = all.find((n) => n.path === path);
    if (exact) return exact;

    const want = path.split('.');
    const leaf = want[want.length - 1];
    const prefix = want.slice(0, -1);
    const loose = all.filter((n) => {
      // The query must name this part itself, not merely one of its ancestors,
      // otherwise "legNear.thigh" would also match everything below the thigh.
      if (n.name !== leaf) return false;
      const ancestors = n.path.split('.').slice(0, -1);
      let i = 0;
      for (const seg of ancestors) if (seg === prefix[i]) i++;
      return i === prefix.length;
    });
    if (loose.length === 1) return loose[0];
    if (loose.length > 1) {
      throw new Error(
        `heron: "${path}" is ambiguous, it matches ${loose.map((n) => n.path).join(', ')}`,
      );
    }
    return undefined;
  }

  /** Handle for animating a part. Throws on typos rather than failing silently. */
  part(path: string): PartHandle {
    const node = this.find(path);
    if (!node) {
      const known = this.nodes().map((n) => n.path).filter(Boolean).join(', ');
      throw new Error(`heron: no part "${path}". Known parts: ${known}`);
    }
    return new PartHandle(node);
  }

  /** Handle for a `field()`: its instances, addressable together or one by one. */
  field(path: string): FieldHandle {
    return new FieldHandle(this.part(path).node);
  }

  /** Handle for a `swap()`: the variants, and when to cut between them. */
  swap(path: string): SwapHandle {
    const node = this.part(path).node;
    if (!node.variants) throw new Error(`heron: "${path}" is a part, not a swap() - it has no variants`);
    return new SwapHandle(node, this.duration);
  }
}

export class PartHandle {
  readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  /**
   * Adds a layer of motion. Calling it again stacks another on top rather than
   * replacing what is there.
   *
   * Acting is layered — a base motion, then adjustments to it — and the single
   * track this used to hold made that impossible to say. Anything built from
   * more than one idea had to be collapsed into arithmetic inside one procedural
   * closure before it could be handed over, which threw away the structure and
   * forced the whole part through the sampler even when most of it was ordinary
   * keyframes. Layers keep the pieces apart: each compiles on its own terms, so
   * a hand-keyed base stays exact under a procedural flourish, and either can be
   * changed without touching the other.
   *
   * They compose exactly the way nested parts do, because they *are* nested
   * groups. Layers about a shared pivot simply add, which is the case almost
   * every rig hits; where they do not commute, declaration order is outermost
   * first, matching how a parent's transform sits above a child's.
   */
  animate(track: Track): this {
    const allowed = new Set<string>([...CHANNELS, 'phase']);
    const unknown = Object.keys(track).filter((name) => !allowed.has(name));
    if (unknown.length) {
      throw new Error(
        `heron: part "${this.node.path || '(root)'}" cannot animate unknown channel`
        + `${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}. Available: ${CHANNELS.join(', ')}`,
      );
    }
    if (track.phase !== undefined
        && (!Number.isFinite(track.phase) || track.phase < 0 || track.phase >= 1)) {
      throw new Error(
        `heron: part "${this.node.path || '(root)'}" phase must be finite and from 0 up to, but not including, 1`,
      );
    }
    for (const name of activeChannels(track)) {
      const channel = track[name] as Channel | undefined;
      if (!channel || (channel.kind !== 'keys' && channel.kind !== 'fn')) {
        throw new Error(`heron: part "${this.node.path || '(root)'}" channel ${name} is not a Heron channel`);
      }
      if (channel.kind === 'keys') validateKeys(channel.keys, `${this.node.path || '(root)'}.${name}`);
      else if (typeof channel.fn !== 'function' || !Number.isInteger(channel.samples) || channel.samples < 2) {
        throw new Error(`heron: part "${this.node.path || '(root)'}" channel ${name} has an invalid sampled curve`);
      }
    }
    this.node.tracks.push(track);
    return this;
  }

  /** Replaces every layer on this part. */
  reset(): this {
    this.node.tracks.length = 0;
    return this;
  }
}

/** The instances of a `field`, addressable together or one at a time. */
export class FieldHandle {
  readonly group: PartHandle;
  readonly count: number;
  private readonly parts: PartHandle[];

  constructor(node: Node) {
    this.group = new PartHandle(node);
    this.parts = node.content.flatMap((item) => ('node' in item ? [new PartHandle(item.node)] : []));
    this.count = this.parts.length;
  }

  at(i: number): PartHandle {
    const p = this.parts[i];
    if (!p) throw new Error(`heron: this field has ${this.count} instances, so there is no ${i}`);
    return p;
  }

  /** Animates every instance, which is the only way a field is ever driven. */
  each(fn: (part: PartHandle, i: number, n: number) => void): this {
    this.parts.forEach((p, i) => fn(p, i, this.count));
    return this;
  }

  /**
   * Moves this field through a sequence of point formations.
   *
   * The first form names where the instances were drawn. Every later point set
   * is assigned with `morph()` so nearby dots keep their identity instead of
   * crossing into visual static. Transform channels are emitted on one aligned
   * key grid per instance, which keeps them exact CSS whenever the forms are
   * keyed rather than procedural.
   */
  morphThrough(forms: FieldForm[], o: MorphThroughOptions = {}): this {
    if (forms.length < 2) throw new Error('heron: morphThrough() needs at least two forms');
    const first = forms[0];
    if (!first.points) throw new Error('heron: morphThrough() first form must provide points');
    if (first.points.length !== this.count) {
      throw new Error(
        `heron: morphThrough() first form has ${first.points.length} points`
        + ` but this field has ${this.count} instances`,
      );
    }
    if (o.window && (o.window.from < 0 || o.window.to > 1 || o.window.to <= o.window.from)) {
      throw new Error('heron: morphThrough() window must be a positive range inside 0..1');
    }

    for (let k = 0; k < forms.length; k++) {
      const form = forms[k];
      if (!Number.isFinite(form.at) || form.at < 0 || form.at > 1) {
        throw new Error(`heron: morphThrough() form time ${form.at} is outside 0..1`);
      }
      if (k && form.at <= forms[k - 1].at) {
        throw new Error('heron: morphThrough() form times must be strictly increasing');
      }
      if (form.stagger !== undefined && form.delay !== undefined) {
        throw new Error('heron: morphThrough() form takes stagger or delay, not both');
      }
      if (form.stagger !== undefined && (form.stagger < 0 || form.at + form.stagger > 1)) {
        throw new Error('heron: morphThrough() stagger must keep every arrival inside 0..1');
      }
    }

    interface State {
      point: Vec2;
      scale: number;
      opacity: number;
      active: boolean;
      form: FieldForm;
      transformKey: boolean;
      opacityKey: boolean;
    }

    const states: State[][] = Array.from({ length: this.count }, () => []);
    let points = first.points.map((p): Vec2 => [...p]);
    let active = Array.from({ length: this.count }, () => true);
    let scales = Array.from({ length: this.count }, () => first.scale ?? 1);
    let opacities = Array.from(
      { length: this.count },
      (_, i) => first.opacity ?? (active[i] ? 1 : 0),
    );

    for (let k = 0; k < forms.length; k++) {
      const form = forms[k];
      const previousActive = [...active];
      if (k && form.points) {
        const moves = morph(points, form.points);
        points = points.map(([x, y], i): Vec2 => [x + moves[i].dx, y + moves[i].dy]);
        active = moves.map((move) => !move.spare);
      }
      scales = scales.map((value) => form.scale ?? value);
      opacities = opacities.map((value, i) =>
        form.opacity ?? (form.points ? (active[i] ? 1 : 0) : value));
      for (let i = 0; i < this.count; i++) {
        states[i].push({
          point: points[i],
          scale: scales[i],
          opacity: opacities[i],
          active: active[i],
          form,
          // Opacity-only beats must not insert a transform hold and change the
          // velocity of a morph already in progress. The reverse is equally
          // important: a scale flourish need not disturb a deliberate fade.
          transformKey: k === 0 || form.points !== undefined || form.scale !== undefined,
          opacityKey: k === 0 || form.opacity !== undefined || active[i] !== previousActive[i],
        });
      }
    }

    const window = o.window ?? { from: 0, to: 1 };
    const width = window.to - window.from;
    const delayOf = (form: FieldForm, i: number): number => {
      if (form.delay) return form.delay(i, this.count);
      if (form.stagger === undefined || this.count < 2) return 0;
      const rank = o.order ? o.order.indexOf(i) : i;
      if (rank < 0) throw new Error(`heron: morphThrough() stagger order does not contain instance ${i}`);
      return form.stagger * rank / (this.count - 1);
    };

    this.parts.forEach((handle, i) => {
      const home = first.points![i];
      // A field instance created by `field()` has no authored joint. Its first
      // formation is the only honest pivot for per-dot scale, so name it here.
      // Existing pivots are preserved for fields built from nested custom rigs.
      handle.node.pivot ??= home;
      const localTimes = states[i].map((state) => {
        const local = state.form.at + delayOf(state.form, i);
        if (!Number.isFinite(local) || local < 0 || local > 1) {
          throw new Error(`heron: morphThrough() delay puts instance ${i} outside 0..1`);
        }
        return window.from + local * width;
      });
      for (let k = 1; k < localTimes.length; k++) {
        if (localTimes[k] <= localTimes[k - 1]) {
          throw new Error(
            `heron: morphThrough() delay makes form ${k} arrive before the previous form for instance ${i}`,
          );
        }
      }

      const transform = states[i].map((state, k): {
        t: number;
        x: number;
        y: number;
        scale: number;
        ease: Easing;
      } => ({
        t: localTimes[k],
        x: state.point[0] - home[0],
        y: state.point[1] - home[1],
        scale: state.scale,
        ease: state.form.ease ?? easeInOut,
      })).filter((_, k) => states[i][k].transformKey);
      const opacity = states[i].map((state, k) => ({
        t: localTimes[k],
        value: state.opacity,
        ease: state.form.opacityEase ?? state.form.ease ?? easeInOut,
      })).filter((_, k) => states[i][k].opacityKey);

      // `keys()` holds outside its first and last authored keys. Explicit cycle
      // endpoints keep the compiled CSS equally honest and make lint output
      // readable without changing that behavior.
      const transformKeys = (pick: (s: typeof transform[number]) => number): KeyTuple[] =>
        padEnds(transform.map((state) => [state.t, pick(state), state.ease]));
      const opacityKeys = padEnds(opacity.map((state) => [state.t, state.value, state.ease]));

      const scale = keys(transformKeys((state) => state.scale));
      handle.animate({
        x: keys(transformKeys((state) => state.x)),
        y: keys(transformKeys((state) => state.y)),
        scaleX: scale,
        scaleY: scale,
      });
      handle.animate({ opacity: keys(opacityKeys) });
    });

    return this;
  }
}

/**
 * A key list extended to both ends of the cycle, holding its first and last
 * values.
 *
 * The evaluator holds the nearest authored value outside the keyed interval.
 * CSS and Lottie would instead synthesize an endpoint from the element's
 * underlying state, so every backend names both endpoints explicitly, and this
 * is the one place that says how.
 */
export function holdEnds<K extends { t: number }>(keys: K[]): K[] {
  const out = [...keys];
  if (out[0].t > 0) out.unshift({ ...out[0], t: 0 });
  if (out[out.length - 1].t < 1) out.push({ ...out[out.length - 1], t: 1 });
  return out;
}

/** `holdEnds` for the tuple form the DSL takes. */
function padEnds(list: KeyTuple[]): KeyTuple[] {
  if (list[0][0] > 0) list.unshift([0, list[0][1]]);
  if (list[list.length - 1][0] < 1) list.push([1, list[list.length - 1][1]]);
  return list;
}

export interface FieldForm {
  /** Local time in the supplied window, 0..1. */
  at: number;
  /** Target formation. Omit to change scale or opacity without reassigning. */
  points?: Vec2[];
  scale?: number;
  opacity?: number;
  /** Easing of the segment that starts at this form, matching `keys()`. */
  ease?: Easing;
  /** Opacity may use a different CSS property and therefore a different ease. */
  opacityEase?: Easing;
  /** Spread this form's arrival over a local fraction of the window. */
  stagger?: number;
  /** Per-instance local arrival offset, for authored rhythms. */
  delay?: (i: number, n: number) => number;
}

export interface MorphThroughOptions {
  /** Place local form times inside this normalized film window. */
  window?: Pick<Beat, 'from' | 'to'>;
  /** Optional instance order used by numeric `stagger`. */
  order?: number[];
}

/**
 * When a swap shows which variant.
 *
 * Every method here ends in the same place: one opacity track per variant, keyed
 * at the cut times with a step easing. Writing that by hand is where a swap goes
 * wrong — two variants showing at once, or none — so it is written once.
 */
export class SwapHandle {
  readonly group: PartHandle;
  readonly names: string[];
  private readonly duration: number;

  constructor(node: Node, duration: number) {
    this.group = new PartHandle(node);
    this.names = node.variants ?? [];
    this.duration = duration;
  }

  /**
   * Cuts to a variant at each time given, or to one variant per beat of a score.
   *
   * A `Score` is accepted directly because a film *is* this: its beats are its
   * shots, in order, with lengths in seconds — so binding the two is one call
   * and there is no second list of times to fall out of step with the first.
   */
  cut(at: Score | Array<[number, string]>): this {
    const list: Array<[number, string]> = Array.isArray(at)
      ? [...at].sort((a, b) => a[0] - b[0])
      : at.beats.map((b): [number, string] => [b.from, b.name]);
    if (!list.length) throw new Error('heron: a swap needs at least one cut');

    for (let i = 0; i < list.length; i++) {
      const time = list[i][0];
      if (!Number.isFinite(time) || time < 0 || time > 1) {
        throw new Error(`heron: swap cut time ${time} must be finite inside 0..1`);
      }
      if (i && time === list[i - 1][0]) {
        throw new Error(`heron: swap has two cuts at t=${time}; each instant can choose only one variant`);
      }
    }

    for (const [, name] of list) {
      if (!this.names.includes(name)) {
        throw new Error(`heron: no variant "${name}" here. This swap has: ${this.names.join(', ')}`);
      }
    }

    // Whatever is showing at the first cut is showing from the start of the
    // cycle too, so nothing is ever on screen with no variant chosen.
    const shown = (t: number): string => {
      let name = list[0][1];
      for (const [at2, n] of list) if (t >= at2 - 1e-9) name = n;
      return name;
    };
    const times = [...new Set([0, ...list.map(([t]) => t).filter((t) => t > 0 && t < 1), 1])];

    for (const item of this.group.node.content) {
      if (!('node' in item)) continue;
      const name = item.node.name;
      new PartHandle(item.node).reset().animate({
        opacity: keys(times.map((t): KeyTuple => [t, shown(t) === name ? 1 : 0, HARD])),
      });
    }
    return this;
  }

  /**
   * Runs through the variants in order, between two cycle times.
   *
   * `ease` is what makes this more than a flipbook. The frame index advances
   * along the curve rather than along the clock, so an `easeInOut` playback
   * gathers speed and loses it again inside its own shot — which is what a
   * galloping figure in a title sequence actually does, and what a constant rate
   * never reads as. The measured reference for this ramps its frame-to-frame
   * change from 3.7 to 20.9 and back to 3.4 across two and a quarter seconds.
   */
  play(o: { from?: number; to?: number; cycles?: number; fps?: number; ease?: Easing } = {}): this {
    const from = o.from ?? 0;
    const to = o.to ?? 1;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > 1 || to <= from) {
      throw new Error(`heron: swap play() needs 0 <= from < to <= 1, got [${from}, ${to}]`);
    }
    if (o.cycles !== undefined && o.fps !== undefined) {
      throw new Error('heron: play() takes cycles or fps, not both - one implies the other');
    }
    for (const [name, value] of [['cycles', o.cycles], ['fps', o.fps]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        throw new Error(`heron: swap play() ${name} must be a positive finite number`);
      }
    }
    const frames = o.fps !== undefined
      ? Math.max(1, Math.round((to - from) * this.duration * o.fps))
      : Math.max(1, Math.round((o.cycles ?? 1) * this.names.length));
    const ease = o.ease ?? linear;
    const cuts: Array<[number, string]> = Array.from({ length: frames }, (_, k) => [
      from + (to - from) * ease.fn(k / frames),
      this.names[k % this.names.length],
    ]);
    return this.cut(cuts);
  }
}

// --- builder -----------------------------------------------------------------
// Declarative construction via an implicit stack, so scene code reads as a
// drawing rather than as tree plumbing.

let stack: Node[] = [];
let definitionStack: Definition[][] = [];

function current(): Node {
  const n = stack[stack.length - 1];
  if (!n) throw new Error('heron: shapes and parts must be declared inside character()');
  return n;
}

function makeNode(name: string, parentPath: string): Node {
  return { name, path: parentPath ? `${parentPath}.${name}` : name, content: [], tracks: [] };
}

export function character(name: string, opts: CharacterOptions, body: () => void): Character {
  const root: Node = { name, path: '', content: [], tracks: [] };
  const definitions: Definition[] = [];
  // Save and restore rather than assign, so a character built inside another
  // character's body cannot silently capture the outer scene's parts.
  const outer = stack;
  const outerDefinitions = definitionStack;
  stack = [root];
  definitionStack = [definitions];
  try {
    body();
  } finally {
    stack = outer;
    definitionStack = outerDefinitions;
  }
  return new Character(name, opts, root, definitions);
}

export interface PartOptions {
  pivot?: Vec2;
  contact?: Vec2;
  /** Static local pose. Use animation tracks only for values that actually move. */
  transform?: PartTransform;
  /**
   * This subtree is meant to be outside the frame, exempting it from the
   * `out-of-view` lint.
   *
   * That lint exists to catch a character being clipped by a viewBox that was
   * sized to the rest pose, which is a defect. Two ordinary things are the
   * opposite case by design: a staircase the camera pans along is wider than the
   * frame at every instant, and a character who walks on from the wings starts
   * the cycle off it. Reporting either drowns the finding that matters. Saying
   * so here is a claim about intent, which is exactly the thing the lint cannot
   * infer from the geometry.
   */
  offstage?: boolean;
  /** Clip this part and all of its children to reusable geometry. */
  clip?: ClipRef;
  /** Mask this part and all of its children with reusable painted geometry. */
  mask?: MaskRef;
}

/** Declares a named part. Nesting parts makes a rig: children follow parents. */
export function part(name: string, opts: PartOptions | (() => void), body?: () => void): Node {
  const options = typeof opts === 'function' ? {} : opts;
  const fn = typeof opts === 'function' ? opts : body;
  const parent = current();
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(
      `heron: part name "${name}" must contain only letters, digits, underscores and hyphens`
      + ' (dots are reserved for rig paths)',
    );
  }
  if (parent.content.some((item) => 'node' in item && item.node.name === name)) {
    throw new Error(`heron: duplicate part "${parent.path ? `${parent.path}.` : ''}${name}"`);
  }
  if (options.transform !== undefined) {
    if (!options.transform || typeof options.transform !== 'object' || Array.isArray(options.transform)) {
      throw new Error(`heron: part "${name}" transform must be an object`);
    }
    const allowed = new Set<string>(CHANNELS.filter((channel) => channel !== 'draw'));
    const unknown = Object.keys(options.transform).filter((channel) => !allowed.has(channel));
    if (unknown.length) {
      throw new Error(`heron: part "${name}" static transform has unknown channel${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`);
    }
    for (const [channel, value] of Object.entries(options.transform)) {
      if (!Number.isFinite(value)) throw new Error(`heron: part "${name}" static ${channel} must be finite`);
    }
  }
  const node = makeNode(name, parent.path);
  node.pivot = options.pivot;
  node.contact = options.contact;
  node.transform = options.transform ? { ...options.transform } : undefined;
  node.offstage = options.offstage ?? parent.offstage;
  node.clip = options.clip?.id;
  node.mask = options.mask?.id;
  parent.content.push({ node });
  if (fn) {
    stack.push(node);
    try {
      fn();
    } finally {
      stack.pop();
    }
  }
  return node;
}

/** Alias for `part`, for grouping that carries no joint. */
export const layer = part;

// --- many of the same thing ---------------------------------------------------

/**
 * `count` numbered copies of something, under one wrapper.
 *
 * Heron's unit is the named anatomical part, which is the right unit for a rig
 * and the wrong one for eight hundred dots: nobody names the four-hundredth of
 * them, and no scene wants to write four hundred declarations. What such a scene
 * does want is an index — the dot's phase, its delay, where it belongs in the
 * lattice are all functions of `i`.
 *
 * Deliberately sugar over `part` rather than a new kind of node. Every instance
 * is an ordinary part, so evaluation, compilation, the lints and the instruments
 * need to know nothing about fields at all; and each instance keeps its own
 * track list, which is what lets a procedural per-index curve be baked to sparse
 * keyframes with the error bound the rest of the library promises.
 *
 * The cost is one wrapper group per instance, so reach for this only where the
 * instances actually move independently. Hundreds of dots that merely sit there
 * are shapes, not parts, and belong in a `swap` variant instead.
 */
export function field(name: string, count: number, place: (i: number, n: number) => void): void {
  part(name, () => {
    for (let i = 0; i < count; i++) part(String(i), () => place(i, count));
  });
}

/**
 * A part that cuts between named variants, exactly one showing at a time.
 *
 * This is the primitive that does not exist anywhere else in the library, and it
 * pays for itself three times over. Frame-by-frame playback is a swap — a dozen
 * dot patterns switched at twelve a second, which is not motion at all and costs
 * a dozen animated opacities rather than eight hundred animated positions. A
 * mouth shape is a swap. And a film is a swap: its shots are variants, cut on
 * the beat, which is why `cut` takes a `Score` directly.
 *
 * The mechanism is nothing more than opacity with a step easing, so it compiles
 * `exact` and inherits the parity contract untouched. What it adds is the
 * *claim* — that these are alternatives — which the lints then hold it to.
 */
export function swap(name: string, variants: Record<string, () => void>): void {
  const names = Object.keys(variants);
  if (names.length < 2) throw new Error(`heron: swap("${name}") needs at least two variants`);
  // Object keys that look like array indices are reordered by the runtime, which
  // would silently shuffle playback order. Refusing them is cheaper than a
  // debugging session about a gallop whose frames arrive in the wrong sequence.
  const numeric = names.filter((k) => /^\d+$/.test(k));
  if (numeric.length) {
    throw new Error(
      `heron: swap("${name}") variant names cannot be plain numbers (${numeric.join(', ')}),`
      + ' because object key order would not survive them - prefix them, as f0, f1',
    );
  }
  const node = part(name, () => {
    for (const key of names) part(key, variants[key]);
  });
  node.variants = names;
}

function shape(tag: string, attrs: Record<string, string | number>): void {
  current().content.push({ shape: { tag, attrs } });
}

/**
 * Low-level vector intake for geometry that already exists as SVG.
 *
 * This is intentionally not a new drawing abstraction: it records one ordinary
 * SVG geometry element verbatim so an importer does not have to translate a
 * faithful path through a lossy convenience API.
 */
export function svgShape(tag: string, attrs: Record<string, string | number>): void {
  const supported = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polygon', 'polyline']);
  if (!supported.has(tag)) throw new Error(`heron: svgShape() does not support <${tag}>`);
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
    throw new Error('heron: svgShape() attributes must be an object');
  }
  shape(tag, { ...attrs });
}

// --- primitives --------------------------------------------------------------

export type PaintValue = string | PaintRef;

type Fill = { fill?: PaintValue; opacity?: number };
type Stroke = { stroke?: PaintValue; width?: number; cap?: 'round' | 'butt' | 'square' };

function paintValue(value: PaintValue): string {
  return typeof value === 'string' ? value : `url(#${value.id})`;
}

function paint(o: Fill & Stroke): Record<string, string | number> {
  const a: Record<string, string | number> = {};
  if (o.fill !== undefined) a.fill = paintValue(o.fill);
  if (o.opacity !== undefined) a.opacity = o.opacity;
  if (o.stroke !== undefined) {
    a.stroke = paintValue(o.stroke);
    a.fill = o.fill === undefined ? 'none' : paintValue(o.fill);
    a['stroke-width'] = o.width ?? 1;
    a['stroke-linecap'] = o.cap ?? 'round';
    a['stroke-linejoin'] = 'round';
  }
  return a;
}

// --- paint definitions -------------------------------------------------------

interface GradientOptions {
  stops: GradientStop[];
  units?: GradientUnits;
  spread?: GradientSpread;
  /** An SVG gradientTransform, useful for rotating object-bounding-box paint. */
  transform?: string;
}

export interface LinearGradientOptions extends GradientOptions {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

export interface RadialGradientOptions extends GradientOptions {
  cx?: number;
  cy?: number;
  r?: number;
  fx?: number;
  fy?: number;
}

function validDefinitionName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
    throw new Error(`heron: definition name "${name}" is not a valid SVG id`);
  }
}

function currentDefinitions(): Definition[] {
  const definitions = definitionStack[definitionStack.length - 1];
  if (!definitions) throw new Error('heron: definitions must be declared inside character()');
  return definitions;
}

function assertNewDefinition(name: string): Definition[] {
  validDefinitionName(name);
  const definitions = currentDefinitions();
  if (definitions.some((d) => d.name === name)) {
    throw new Error(`heron: duplicate definition "${name}"`);
  }
  return definitions;
}

/** The fields every gradient kind shares, validated and defaulted in one place. */
function gradientBase(name: string, o: GradientOptions): GradientBase {
  return {
    name,
    stops: o.stops.map((s) => ({ ...s })),
    units: o.units ?? 'objectBoundingBox',
    spread: o.spread ?? 'pad',
    transform: o.transform,
  };
}

function addGradient(definition: PaintDefinition): PaintRef {
  const definitions = assertNewDefinition(definition.name);
  if (definition.stops.length < 2) {
    throw new Error(`heron: gradient "${definition.name}" needs at least two stops`);
  }
  let previous = -Infinity;
  for (const stop of definition.stops) {
    if (!Number.isFinite(stop.at) || stop.at < 0 || stop.at > 1) {
      throw new Error(`heron: gradient "${definition.name}" stop positions must be from 0 to 1`);
    }
    if (stop.at < previous) {
      throw new Error(`heron: gradient "${definition.name}" stops must be in ascending order`);
    }
    if (stop.opacity !== undefined && (!Number.isFinite(stop.opacity) || stop.opacity < 0 || stop.opacity > 1)) {
      throw new Error(`heron: gradient "${definition.name}" stop opacity must be from 0 to 1`);
    }
    previous = stop.at;
  }
  definitions.push(definition);
  return Object.freeze({ kind: 'paint', id: definition.name });
}

/** Declares a linear gradient and returns a reference usable as fill or stroke. */
export function linearGradient(name: string, o: LinearGradientOptions): PaintRef {
  return addGradient({
    kind: 'linear',
    ...gradientBase(name, o),
    x1: o.x1 ?? 0,
    y1: o.y1 ?? 0,
    x2: o.x2 ?? 1,
    y2: o.y2 ?? 0,
  });
}

/** Declares a radial gradient and returns a reference usable as fill or stroke. */
export function radialGradient(name: string, o: RadialGradientOptions): PaintRef {
  return addGradient({
    kind: 'radial',
    ...gradientBase(name, o),
    cx: o.cx ?? 0.5,
    cy: o.cy ?? 0.5,
    r: o.r ?? 0.5,
    fx: o.fx,
    fy: o.fy,
  });
}

/** Captures a definition body's geometry with the ordinary drawing primitives. */
function definitionRoot(fn: string, name: string, body: () => void): Node {
  const root: Node = { name, path: '', content: [], tracks: [] };
  stack.push(root);
  try {
    body();
  } finally {
    stack.pop();
  }
  if (!root.content.length) throw new Error(`heron: ${fn}("${name}") cannot be empty`);
  const animated = (node: Node): boolean => node.content.some((item) =>
    'shape' in item ? item.shape.morph !== undefined : animated(item.node));
  if (animated(root)) {
    throw new Error(
      `heron: ${fn}("${name}") contains a path morph, but reusable definition geometry is static;`
      + ' animate the part carrying the definition instead',
    );
  }
  return root;
}

/**
 * Declares reusable clipping geometry.
 *
 * The body uses the ordinary Heron shape and part primitives, but is static:
 * motion belongs on the clipped part, which can move behind or carry the clip.
 */
export function clipPath(
  name: string,
  body: () => void,
  o: { units?: 'userSpaceOnUse' | 'objectBoundingBox' } = {},
): ClipRef {
  const definitions = assertNewDefinition(name);
  const root = definitionRoot('clipPath', name, body);
  definitions.push({ kind: 'clip', name, units: o.units ?? 'userSpaceOnUse', root });
  return Object.freeze({ kind: 'clip', id: name });
}

export interface MaskOptions {
  units?: 'userSpaceOnUse' | 'objectBoundingBox';
  contentUnits?: 'userSpaceOnUse' | 'objectBoundingBox';
  mode?: 'luminance' | 'alpha';
  /** Explicit mask region, useful for glows that extend beyond the artwork. */
  region?: { x: number; y: number; width: number; height: number };
}

/** Declares reusable painted mask geometry. White reveals; black conceals. */
export function mask(name: string, body: () => void, o: MaskOptions = {}): MaskRef {
  const definitions = assertNewDefinition(name);
  if (o.region) {
    const { x, y, width, height } = o.region;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      throw new Error(`heron: mask("${name}") region must have finite coordinates and positive size`);
    }
  }
  const root = definitionRoot('mask', name, body);
  definitions.push({
    kind: 'mask',
    name,
    units: o.units ?? 'userSpaceOnUse',
    contentUnits: o.contentUnits ?? 'userSpaceOnUse',
    mode: o.mode ?? 'luminance',
    root,
    region: o.region ? { ...o.region } : undefined,
  });
  return Object.freeze({ kind: 'mask', id: name });
}

export function ellipse(o: { cx: number; cy: number; rx: number; ry: number; rotate?: number } & Fill & Stroke): void {
  const attrs = { cx: o.cx, cy: o.cy, rx: o.rx, ry: o.ry, ...paint(o) };
  if (o.rotate) (attrs as Record<string, string | number>).transform = `rotate(${o.rotate} ${o.cx} ${o.cy})`;
  shape('ellipse', attrs);
}

export function circle(o: { cx: number; cy: number; r: number } & Fill & Stroke): void {
  shape('circle', { cx: o.cx, cy: o.cy, r: o.r, ...paint(o) });
}

export function rect(o: { x: number; y: number; w: number; h: number; radius?: number } & Fill & Stroke): void {
  const attrs: Record<string, string | number> = { x: o.x, y: o.y, width: o.w, height: o.h, ...paint(o) };
  if (o.radius) attrs.rx = o.radius;
  shape('rect', attrs);
}

export function line(o: { from: Vec2; to: Vec2 } & Stroke & Pick<Fill, 'opacity'>): void {
  shape('line', {
    x1: o.from[0], y1: o.from[1], x2: o.to[0], y2: o.to[1],
    ...paint({ stroke: o.stroke ?? '#000', width: o.width, cap: o.cap, opacity: o.opacity }),
  });
}

export function path(o: { d: string | PathMorph } & Fill & Stroke): void {
  if (typeof o.d === 'string') {
    shape('path', { d: o.d, ...paint(o) });
    return;
  }
  const spec: ShapeSpec = { tag: 'path', attrs: { d: o.d.keys[0].d, ...paint(o) }, morph: o.d };
  current().content.push({ shape: spec });
}

// --- curves and arcs ---------------------------------------------------------
// Geometry stated the way you think about it, rather than as an SVG `d` string.
// Both of these exist because writing the string form by hand is where drawing
// code actually goes wrong: arc flags are a coin-flip, and Bezier handles are
// numbers you cannot read off a reference image.

/** Two decimals is finer than any renderer resolves, and keeps `d` readable. */
function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function xy(p: Vec2): string {
  return `${n(p[0])},${n(p[1])}`;
}

export interface ArcOptions {
  cx: number;
  cy: number;
  /** Circular radius. Give `rx`/`ry` instead for an ellipse. */
  r?: number;
  rx?: number;
  ry?: number;
  /**
   * Angles in degrees, 0 at 3 o'clock and increasing clockwise, matching the
   * y-down coordinate system everything else here uses. `to` less than `from`
   * sweeps the other way. Omit both for a closed ring.
   */
  from?: number;
  to?: number;
  /** Rotation of an ellipse's own axes, degrees. */
  rotate?: number;
}

/**
 * An arc as centre, radius and two angles.
 *
 * The SVG form — `A rx ry rot large-arc sweep x y` — needs the endpoints solved
 * by hand and then two flags whose meaning nobody recalls under pressure. This
 * takes what you actually know and emits segments of at most 180 degrees, which
 * makes the large-arc flag unconditionally 0 and lets a full ring be one call.
 */
export function arcPath(o: ArcOptions): string {
  const rx = o.rx ?? o.r;
  const ry = o.ry ?? o.r;
  if (rx === undefined || ry === undefined) {
    throw new Error('heron: arc() needs r, or both rx and ry');
  }
  const from = o.from ?? 0;
  const span = (o.to ?? 360) - from;
  if (!span) throw new Error('heron: arc() from and to are the same angle');

  const rot = o.rotate ?? 0;
  const cosR = Math.cos((rot * Math.PI) / 180);
  const sinR = Math.sin((rot * Math.PI) / 180);
  const at = (deg: number): Vec2 => {
    const a = (deg * Math.PI) / 180;
    const px = rx * Math.cos(a);
    const py = ry * Math.sin(a);
    return [o.cx + px * cosR - py * sinR, o.cy + px * sinR + py * cosR];
  };

  // Splitting at 180 degrees is what removes the flag guesswork: no segment can
  // ever be the "large" one, and a sweep of 360 or more stops being impossible.
  const steps = Math.max(1, Math.ceil(Math.abs(span) / 180));
  const sweep = span > 0 ? 1 : 0;
  let d = `M${xy(at(from))}`;
  for (let i = 1; i <= steps; i++) {
    d += ` A${n(rx)},${n(ry)} ${n(rot)} 0 ${sweep} ${xy(at(from + (span * i) / steps))}`;
  }
  return Math.abs(span) >= 360 ? `${d} Z` : d;
}

export function arc(o: ArcOptions & Fill & Stroke): void {
  shape('path', { d: arcPath(o), ...paint(o) });
}

export interface CurveOptions {
  /** Join the last point back to the first. */
  closed?: boolean;
  /** 1 is a natural curve; 0 collapses to straight segments. */
  tension?: number;
}

/**
 * A smooth curve through every point given.
 *
 * This is the one that changes how a character gets drawn from a reference.
 * A cubic's control points are not on the curve, so they cannot be read off an
 * image — they have to be guessed, checked in a render, and adjusted, which is
 * a slow loop over numbers with no visible meaning. The points here are all on
 * the curve, so they are exactly the positions you can see and correct.
 */
/** The cubic segments of a Catmull-Rom curve, without the opening move. */
function curveSegments(points: Vec2[], closed: boolean, tension: number): string {
  const len = points.length;
  // Open curves clamp at the ends, which makes the first and last segments bend
  // toward their neighbour instead of flicking off in an arbitrary direction.
  const at = (i: number): Vec2 =>
    closed ? points[((i % len) + len) % len] : points[Math.max(0, Math.min(len - 1, i))];

  // Catmull-Rom in Bezier form: the tangent at a point is the direction between
  // its two neighbours, scaled by a sixth to match cubic parameterisation.
  const k = tension / 6;
  let d = '';
  for (let i = 0; i < (closed ? len : len - 1); i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1: Vec2 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2: Vec2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += ` C${xy(c1)} ${xy(c2)} ${xy(p2)}`;
  }
  return d;
}

export function curvePath(points: Vec2[], o: CurveOptions = {}): string {
  if (points.length < 2) throw new Error('heron: through() needs at least two points');
  const closed = o.closed ?? false;
  if (points.length === 2 && !closed) return `M${xy(points[0])} L${xy(points[1])}`;

  const d = `M${xy(points[0])}${curveSegments(points, closed, o.tension ?? 1)}`;
  return closed ? `${d} Z` : d;
}

export function through(points: Vec2[], o: CurveOptions & Fill & Stroke = {}): void {
  shape('path', { d: curvePath(points, o), ...paint(o) });
}

export function polygon(o: { points: Vec2[] } & Fill & Stroke): void {
  shape('polygon', { points: o.points.map((p) => p.join(',')).join(' '), ...paint(o) });
}

// --- ribbons -----------------------------------------------------------------

export interface RibbonOptions {
  /** Join the last point back to the first, making a ring with a hole. */
  closed?: boolean;
  /** How the free ends are finished. A width that reaches zero needs neither. */
  cap?: 'round' | 'butt';
  /** 1 is a natural curve; 0 collapses to straight segments. */
  tension?: number;
}

/** Unit normal at `i`, from the direction between the neighbouring points. */
export function normalAt(points: Vec2[], i: number, closed: boolean): Vec2 {
  const n = points.length;
  const at = (k: number) => (closed ? points[((k % n) + n) % n] : points[Math.max(0, Math.min(n - 1, k))]);
  const a = at(i - 1);
  const b = at(i + 1);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

/**
 * A stroke whose width is a measurement at every point rather than one number.
 *
 * This is what a drawn mark actually is. A pen leaves a ribbon: a path with a
 * width that changes along it, and the two things `stroke-width` can express —
 * one constant width, or nothing — are both approximations of that. Everything
 * else here had to work around the gap. A tapered beak could not be a stroke at
 * all, so it was cut off its own neck and handed to an outline tracer, which
 * returns a boundary with no centreline left in it.
 *
 * Offsetting a measured centreline by a measured half-width gives the exact
 * boundary *and* keeps the centreline, so the same shape stays riggable. The
 * taper stops being a special case and becomes the ordinary one: a constant
 * width is simply a profile that happens not to vary.
 */
export function ribbonPath(points: Vec2[], halfWidths: number[], o: RibbonOptions = {}): string {
  if (points.length < 2) throw new Error('heron: ribbon() needs at least two points');
  if (halfWidths.length !== points.length) {
    throw new Error(`heron: ribbon() needs one half-width per point, got ${halfWidths.length} for ${points.length}`);
  }
  const closed = o.closed ?? false;
  const tension = o.tension ?? 1;

  const side = (sign: number): Vec2[] => points.map((p, i): Vec2 => {
    const [nx, ny] = normalAt(points, i, closed);
    return [p[0] + nx * halfWidths[i] * sign, p[1] + ny * halfWidths[i] * sign];
  });
  const left = side(1);
  const right = side(-1);

  // A closed ribbon is an annulus: the two offsets are separate loops, wound
  // opposite ways so a nonzero fill leaves the middle empty.
  if (closed) {
    return `${curvePath(left, { closed: true, tension })} ${curvePath([...right].reverse(), { closed: true, tension })}`;
  }

  /**
   * Both caps sweep the same way, and it is not arbitrary.
   *
   * The outline runs forward along one offset and back along the other, so at
   * each end it has to cross from one side to the other *around the outside* of
   * the tip. With the normal taken as the tangent turned a quarter turn, that
   * crossing always runs against the direction of increasing angle, in both
   * y-down SVG and at both ends. Half a turn is exactly the ambiguous case for
   * the large-arc flag, which is why it can be left at 0.
   */
  const cap = (to: Vec2, r: number): string => {
    if (o.cap === 'butt' || r < 0.05) return ` L${xy(to)}`;
    return ` A${n(r)},${n(r)} 0 0 0 ${xy(to)}`;
  };

  const back = [...right].reverse();
  return `M${xy(left[0])}`
    + curveSegments(left, false, tension)
    + cap(back[0], halfWidths[halfWidths.length - 1])
    + curveSegments(back, false, tension)
    + cap(left[0], halfWidths[0])
    + ' Z';
}

export function ribbon(points: Vec2[], halfWidths: number[], o: RibbonOptions & Fill = {}): void {
  shape('path', { d: ribbonPath(points, halfWidths, o), ...paint({ fill: o.fill ?? '#000', opacity: o.opacity }) });
}

// --- limb sugar --------------------------------------------------------------

export interface LimbOptions {
  /** Joint the limb hangs from, in rest-pose coordinates. */
  hip: Vec2;
  /** Lengths of the segments, hip outward. Two segments = thigh + shin. */
  segments: [number, number];
  stroke: string;
  /** Stroke widths for thigh, shin, foot. */
  widths?: [number, number, number];
  /** Forward and backward toe offsets from the ankle. Omit for a footless limb. */
  foot?: { toe: Vec2; heel: Vec2 };
}

/**
 * Declares a jointed limb: nested `thigh` > `shin` > `foot` parts, each with its
 * pivot already at the correct joint. This is the shape an agent otherwise gets
 * wrong, so it is worth having as one call.
 */
export function limb(name: string, o: LimbOptions): void {
  const unknown = Object.keys(o).filter((key) =>
    !['hip', 'segments', 'stroke', 'widths', 'foot'].includes(key));
  if (unknown.length) {
    throw new Error(
      `heron: limb("${name}") has unknown option${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`
      + (unknown.includes('width') ? '; use widths: [thigh, shin, foot]' : ''),
    );
  }
  const [hx, hy] = o.hip;
  const [l1, l2] = o.segments;
  const knee: Vec2 = [hx, hy + l1];
  const ankle: Vec2 = [hx, hy + l1 + l2];
  const w = o.widths ?? [5.5, 4, 3.4];

  part(name, () => {
    part('thigh', { pivot: o.hip }, () => {
      line({ from: o.hip, to: knee, stroke: o.stroke, width: w[0] });
      part('shin', { pivot: knee }, () => {
        line({ from: knee, to: ankle, stroke: o.stroke, width: w[1] });
        if (o.foot) {
          const toe: Vec2 = [ankle[0] + o.foot.toe[0], ankle[1] + o.foot.toe[1]];
          const heel: Vec2 = [ankle[0] + o.foot.heel[0], ankle[1] + o.foot.heel[1]];
          part('foot', { pivot: ankle, contact: toe }, () => {
            path({
              d: `M${ankle[0]},${ankle[1]} L${toe[0]},${toe[1]} M${ankle[0]},${ankle[1]} L${heel[0]},${heel[1]}`,
              stroke: o.stroke,
              width: w[2],
            });
          });
        }
      });
    });
  });
}

// --- channels ----------------------------------------------------------------

export type KeyTuple = [number, number] | [number, number, Easing];

function validateKeys(
  list: Array<{ t: number; v: number; ease: Easing }>, label = 'keys()',
): void {
  if (list.length < 2) throw new Error(`heron: ${label} needs at least two keyframes`);
  for (let i = 0; i < list.length; i++) {
    const k = list[i];
    if (!Number.isFinite(k.t) || k.t < 0 || k.t > 1) {
      throw new Error(`heron: ${label} keyframe time ${k.t} is not finite inside 0..1`);
    }
    if (!Number.isFinite(k.v)) {
      throw new Error(`heron: ${label} keyframe at t=${k.t} has non-finite value ${k.v}`);
    }
    if (!k.ease || typeof k.ease.fn !== 'function' || typeof k.ease.css !== 'string') {
      throw new Error(`heron: ${label} keyframe at t=${k.t} has an invalid easing`);
    }
    if (i && k.t <= list[i - 1].t) {
      throw new Error(`heron: ${label} keyframe times must be strictly increasing`);
    }
  }
}

/**
 * Keyframes over the cycle, times normalised to 0..1. A key's easing governs
 * the segment that *starts* at that key, matching CSS keyframe semantics.
 */
export function keys(list: KeyTuple[], defaultEase: Easing = linear): Channel {
  const ks = list
    .map(([t, v, e]) => ({ t, v, ease: e ?? defaultEase }))
    .sort((a, b) => a.t - b.t);
  validateKeys(ks);
  return { kind: 'keys', keys: ks };
}

/**
 * A property driven by an arbitrary function of cycle time. Cannot be expressed
 * in CSS directly, so the compiler bakes it to sampled keyframes.
 */
export function sampled(fn: (t: number) => number, samples = 48): Channel {
  if (typeof fn !== 'function') throw new Error('heron: sampled() needs a function');
  if (!Number.isInteger(samples) || samples < 2 || samples > 100_000) {
    throw new Error('heron: sampled() samples must be an integer from 2 to 100000');
  }
  return { kind: 'fn', fn, samples };
}
