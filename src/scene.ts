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
function normalAt(points: Vec2[], i: number, closed: boolean): Vec2 {
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
  const cap = (from: Vec2, to: Vec2, r: number): string => {
    if (o.cap === 'butt' || r < 0.05) return ` L${xy(to)}`;
    return ` A${n(r)},${n(r)} 0 0 0 ${xy(to)}`;
  };

  const back = [...right].reverse();
  return `M${xy(left[0])}`
    + curveSegments(left, false, tension)
    + cap(left[left.length - 1], back[0], halfWidths[halfWidths.length - 1])
    + curveSegments(back, false, tension)
    + cap(back[back.length - 1], left[0], halfWidths[0])
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
