/**
 * The scene model: a tree of named parts with joints.
 *
 * The whole point of this module is that a character is declared as anatomy,
 * not as geometry. A merged path has no leg to rotate; a Heron tree has
 * `legs.near.thigh` with a pivot at the hip. Everything downstream — animation,
 * inspection, lints — addresses parts by name because of what happens here.
 */

import type { Easing } from './easing.ts';
import { linear } from './easing.ts';

export type Vec2 = [number, number];
export type ViewBox = [number, number, number, number];

export interface ShapeSpec {
  tag: string;
  attrs: Record<string, string | number>;
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
export const CHANNELS = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'opacity'] as const;

export type ChannelName = (typeof CHANNELS)[number];

/** The value of each channel when nothing is animating it. */
export const NEUTRAL: Record<ChannelName, number> = {
  rotate: 0,
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
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
  /** Point that is expected to meet the ground, in rest-pose coordinates. */
  contact?: Vec2;
  /** Shapes and child parts interleaved, preserving declaration (z) order. */
  content: Array<{ shape: ShapeSpec } | { node: Node }>;
  track?: Track;
}

export interface CharacterOptions {
  viewBox: ViewBox;
  /** Seconds per cycle. Only affects playback speed, never the model. */
  duration?: number;
  /** Y coordinate of the ground plane, used by the contact lints. */
  ground?: number;
}

export class Character {
  readonly name: string;
  readonly viewBox: ViewBox;
  readonly duration: number;
  readonly ground?: number;
  readonly root: Node;

  constructor(name: string, opts: CharacterOptions, root: Node) {
    this.name = name;
    this.viewBox = opts.viewBox;
    this.duration = opts.duration ?? 1;
    this.ground = opts.ground;
    this.root = root;
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
}

export class PartHandle {
  readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  animate(track: Track): this {
    this.node.track = { ...this.node.track, ...track };
    return this;
  }
}

// --- builder -----------------------------------------------------------------
// Declarative construction via an implicit stack, so scene code reads as a
// drawing rather than as tree plumbing.

let stack: Node[] = [];

function current(): Node {
  const n = stack[stack.length - 1];
  if (!n) throw new Error('heron: shapes and parts must be declared inside character()');
  return n;
}

function makeNode(name: string, parentPath: string): Node {
  return { name, path: parentPath ? `${parentPath}.${name}` : name, content: [] };
}

export function character(name: string, opts: CharacterOptions, body: () => void): Character {
  const root: Node = { name, path: '', content: [] };
  // Save and restore rather than assign, so a character built inside another
  // character's body cannot silently capture the outer scene's parts.
  const outer = stack;
  stack = [root];
  try {
    body();
  } finally {
    stack = outer;
  }
  return new Character(name, opts, root);
}

export interface PartOptions {
  pivot?: Vec2;
  contact?: Vec2;
}

/** Declares a named part. Nesting parts makes a rig: children follow parents. */
export function part(name: string, opts: PartOptions | (() => void), body?: () => void): void {
  const options = typeof opts === 'function' ? {} : opts;
  const fn = typeof opts === 'function' ? opts : body;
  const parent = current();
  const node = makeNode(name, parent.path);
  node.pivot = options.pivot;
  node.contact = options.contact;
  parent.content.push({ node });
  if (fn) {
    stack.push(node);
    try {
      fn();
    } finally {
      stack.pop();
    }
  }
}

/** Alias for `part`, for grouping that carries no joint. */
export const layer = part;

function shape(tag: string, attrs: Record<string, string | number>): void {
  current().content.push({ shape: { tag, attrs } });
}

// --- primitives --------------------------------------------------------------

type Fill = { fill?: string; opacity?: number };
type Stroke = { stroke?: string; width?: number; cap?: 'round' | 'butt' | 'square' };

function paint(o: Fill & Stroke): Record<string, string | number> {
  const a: Record<string, string | number> = {};
  if (o.fill !== undefined) a.fill = o.fill;
  if (o.opacity !== undefined) a.opacity = o.opacity;
  if (o.stroke !== undefined) {
    a.stroke = o.stroke;
    a.fill = o.fill ?? 'none';
    a['stroke-width'] = o.width ?? 1;
    a['stroke-linecap'] = o.cap ?? 'round';
    a['stroke-linejoin'] = 'round';
  }
  return a;
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

export function line(o: { from: Vec2; to: Vec2 } & Stroke): void {
  shape('line', {
    x1: o.from[0], y1: o.from[1], x2: o.to[0], y2: o.to[1],
    ...paint({ stroke: o.stroke ?? '#000', width: o.width, cap: o.cap }),
  });
}

export function path(o: { d: string } & Fill & Stroke): void {
  shape('path', { d: o.d, ...paint(o) });
}

export function polygon(o: { points: Vec2[] } & Fill & Stroke): void {
  shape('polygon', { points: o.points.map((p) => p.join(',')).join(' '), ...paint(o) });
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

/**
 * Keyframes over the cycle, times normalised to 0..1. A key's easing governs
 * the segment that *starts* at that key, matching CSS keyframe semantics.
 */
export function keys(list: KeyTuple[], defaultEase: Easing = linear): Channel {
  if (list.length < 2) throw new Error('heron: keys() needs at least two keyframes');
  const ks = list
    .map(([t, v, e]) => ({ t, v, ease: e ?? defaultEase }))
    .sort((a, b) => a.t - b.t);
  for (const k of ks) {
    if (k.t < 0 || k.t > 1) throw new Error(`heron: keyframe time ${k.t} is outside 0..1`);
  }
  return { kind: 'keys', keys: ks };
}

/**
 * A property driven by an arbitrary function of cycle time. Cannot be expressed
 * in CSS directly, so the compiler bakes it to sampled keyframes.
 */
export function sampled(fn: (t: number) => number, samples = 48): Channel {
  return { kind: 'fn', fn, samples };
}
