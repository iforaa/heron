/**
 * Evaluation: the pose of every part at a given point in the cycle.
 *
 * `evaluate` is a pure function of time. Nothing accumulates between calls, so
 * any frame can be computed in any order — which is what lets the agent jump
 * straight to t=0.62 to see what push-off looks like.
 */

import {
  type Channel, type Character, type ChannelName, type Node, type Track, type Vec2,
  CHANNELS, NEUTRAL,
} from './scene.ts';

export type NodePose = Record<ChannelName, number>;

export const REST: NodePose = { ...NEUTRAL };

/** One entry per part, holding one pose per authored layer of motion on it. */
export type Pose = Map<string, NodePose[]>;

export function restPose(node: Node): NodePose {
  return { ...REST, ...node.transform };
}

/** Value of one channel at cycle time t (0..1). */
export function channelAt(ch: Channel, t: number): number {
  if (ch.kind === 'fn') return ch.fn(t);
  const ks = ch.keys;
  if (t <= ks[0].t) return ks[0].v;
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v;
  // t is strictly inside the range, so the first key that reaches it ends the
  // segment it falls in.
  const i = ks.findIndex((k) => k.t >= t);
  const a = ks[i - 1];
  const b = ks[i];
  if (b.t === a.t) return b.v;
  return a.v + (b.v - a.v) * a.ease.fn((t - a.t) / (b.t - a.t));
}

export function trackAt(track: Track | undefined, t: number): NodePose {
  if (!track) return { ...REST };
  // A phase offset means this part runs *ahead* of the others, matching the
  // negative animation-delay the compiler emits. Exactly 1 is kept as the end
  // of the cycle rather than wrapped to the start, so inspecting t=1 shows the
  // final pose instead of silently showing the first one.
  const shifted = t + (track.phase ?? 0);
  const local = shifted === 1 ? 1 : ((shifted % 1) + 1) % 1;
  const pose = { ...REST };
  for (const name of CHANNELS) {
    const channel = track[name];
    if (channel !== undefined) pose[name] = channelAt(channel, local);
  }
  return pose;
}

export function evaluate(ch: Character, t: number): Pose {
  const pose: Pose = new Map();
  for (const node of ch.nodes()) pose.set(node.path, node.tracks.map((tr) => trackAt(tr, t)));
  return pose;
}

/**
 * The net effect of a part's layers, per channel.
 *
 * For display and for the common case only. Rotations and translations add and
 * scales multiply, which is exact when the layers share a pivot and is what a
 * reader wants to see either way — but it is not matrix composition, so nothing
 * geometric may be built on it. Use the matrices for that.
 */
export function netPose(poses: NodePose[] | undefined): NodePose {
  const out = { ...REST };
  for (const p of poses ?? []) {
    out.rotate += p.rotate;
    out.x += p.x;
    out.y += p.y;
    out.skewX += p.skewX;
    out.skewY += p.skewY;
    out.scaleX *= p.scaleX;
    out.scaleY *= p.scaleY;
    out.opacity *= p.opacity;
    // Dash offset is inherited rather than composed, so the innermost layer that
    // sets it is the one the shapes actually see.
    out.draw = p.draw;
  }
  return out;
}

/** Static rest state composed with the net authored motion for inspection. */
export function nodePose(node: Node, poses: NodePose[] | undefined): NodePose {
  return netPose([restPose(node), ...(poses ?? [])]);
}

// --- matrices ----------------------------------------------------------------
// [a c e]
// [b d f]

export type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Mat, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** Inverse of an affine matrix, for turning world targets back into rig space. */
export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error('heron: cannot invert a singular transform');
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [
    a,
    b,
    c,
    d,
    -(a * m[4] + c * m[5]),
    -(b * m[4] + d * m[5]),
  ];
}

/**
 * A part's local transform: translate, then rotate, skew and scale about the pivot.
 *
 * This order is fixed and must stay identical to the CSS the compiler emits
 * (`transform: translate() rotate() skewX() skewY() scale()` with `transform-origin` at the
 * pivot), because that equivalence is what makes a snapshot trustworthy.
 */
export function localMatrix(pose: NodePose, pivot?: Vec2): Mat {
  const [px, py] = pivot ?? [0, 0];
  const rad = (pose.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // The linear part: rotate, skew, scale. The three translations around it
  // (move, to pivot, back from pivot) collapse to one offset, and the two skews
  // are almost always zero, so they are only multiplied in when they are not.
  let linear: Mat = [cos * pose.scaleX, sin * pose.scaleX, -sin * pose.scaleY, cos * pose.scaleY, 0, 0];
  if (pose.skewX !== 0 || pose.skewY !== 0) {
    const rot: Mat = [cos, sin, -sin, cos, 0, 0];
    const skewX: Mat = [1, 0, Math.tan((pose.skewX * Math.PI) / 180), 1, 0, 0];
    const skewY: Mat = [1, Math.tan((pose.skewY * Math.PI) / 180), 0, 1, 0, 0];
    const scl: Mat = [pose.scaleX, 0, 0, pose.scaleY, 0, 0];
    linear = mul(mul(mul(rot, skewX), skewY), scl);
  }
  const [a, b, c, d] = linear;
  return [a, b, c, d, pose.x + px - (a * px + c * py), pose.y + py - (b * px + d * py)];
}

/**
 * A part's layers, composed. Outermost first, matching the order the compiled
 * groups nest in, so the matrix and the DOM cannot disagree about which layer
 * sits above which.
 */
function stackMatrix(poses: NodePose[] | undefined, pivot?: Vec2): Mat {
  let m = IDENTITY;
  for (const p of poses ?? []) m = mul(m, localMatrix(p, pivot));
  return m;
}

/** World matrix per part at time t, composed down the tree. */
export function worldMatrices(ch: Character, t: number): Map<string, Mat> {
  return frameAt(ch, t).matrices;
}

/**
 * The whole scene posed at one instant.
 *
 * Anything asking more than one question about a single moment should take a
 * Frame rather than a time: the alternative is re-posing the entire tree per
 * question, which is how a 60-sample lint of a 13-part rig ended up walking the
 * tree hundreds of times.
 */
export interface Frame {
  readonly t: number;
  readonly pose: Pose;
  readonly matrices: Map<string, Mat>;
  /** World position of a point in a part's local (rest-pose) space. */
  point(node: Node, local?: Vec2): Vec2;
}

/**
 * A captured set of tracks, used when a behavior must solve against the pose
 * that existed before it appended its own channels.
 */
export type TrackSnapshot = Map<string, Track[]>;

/**
 * The scene posed at time t — from its live tracks, or from a snapshot taken
 * before a behavior appended its own channels.
 */
export function frameAt(ch: Character, t: number, tracks?: TrackSnapshot): Frame {
  const pose: Pose = new Map();
  for (const node of ch.nodes()) {
    pose.set(node.path, (tracks?.get(node.path) ?? node.tracks).map((track) => trackAt(track, t)));
  }
  const matrices = new Map<string, Mat>();
  const walk = (node: Node, parent: Mat) => {
    const m = mul(mul(parent, localMatrix(restPose(node), node.pivot)), stackMatrix(pose.get(node.path), node.pivot));
    matrices.set(node.path, m);
    for (const item of node.content) if ('node' in item) walk(item.node, m);
  };
  walk(ch.root, IDENTITY);

  return {
    t,
    pose,
    matrices,
    point(node, local) {
      const m = matrices.get(node.path);
      if (!m) throw new Error(`heron: no world transform for "${node.path}"`);
      return apply(m, local ?? node.contact ?? node.pivot ?? [0, 0]);
    },
  };
}

/**
 * A map that computes an entry the first time it is asked for.
 *
 * Iterating or measuring it fills every entry first, so it behaves as the
 * complete map to anything that walks it; only lookups stay cheap.
 */
class LazyMap<V> extends Map<string, V> {
  #filled = false;
  readonly #resolve: (key: string) => V | undefined;
  readonly #all: () => Iterable<string>;
  constructor(resolve: (key: string) => V | undefined, all: () => Iterable<string>) {
    super();
    this.#resolve = resolve;
    this.#all = all;
  }
  override get(key: string): V | undefined {
    if (super.has(key)) return super.get(key);
    const value = this.#resolve(key);
    if (value !== undefined) super.set(key, value);
    return value;
  }
  override has(key: string): boolean {
    return this.get(key) !== undefined;
  }
  #fill(): void {
    if (this.#filled) return;
    for (const key of this.#all()) this.get(key);
    this.#filled = true;
  }
  override get size(): number { this.#fill(); return super.size; }
  override entries(): MapIterator<[string, V]> { this.#fill(); return super.entries(); }
  override keys(): MapIterator<string> { this.#fill(); return super.keys(); }
  override values(): MapIterator<V> { this.#fill(); return super.values(); }
  override forEach(fn: (value: V, key: string, map: Map<string, V>) => void, thisArg?: unknown): void {
    this.#fill();
    super.forEach(fn, thisArg);
  }
  override [Symbol.iterator](): MapIterator<[string, V]> { return this.entries(); }
}

/**
 * The scene at time t, posed only as far as it is asked about.
 *
 * Identical to `frameAt` in what it answers — the same poses, the same
 * matrices — but nothing is evaluated until a part is looked up, and then only
 * that part and its ancestors. A behaviour solving one limb thousands of times
 * (`reach()` samples its chain on a dense grid) asks about a handful of parts
 * each time, and posing a 140-part scene for each of those answers was where
 * a scene's whole compile time went.
 */
export function lazyFrameAt(ch: Character, t: number, tracks?: TrackSnapshot): Frame {
  const byPath = new Map<string, Node>();
  const index = (node: Node) => {
    byPath.set(node.path, node);
    for (const item of node.content) if ('node' in item) index(item.node);
  };
  index(ch.root);
  const paths = () => byPath.keys();

  const pose: Pose = new LazyMap<NodePose[]>((path) => {
    const node = byPath.get(path);
    return node && (tracks?.get(path) ?? node.tracks).map((track) => trackAt(track, t));
  }, paths);
  const matrices: Map<string, Mat> = new LazyMap<Mat>((path) => {
    const node = byPath.get(path);
    if (!node) return undefined;
    const cut = path.lastIndexOf('.');
    const parent = path === '' ? IDENTITY : matrices.get(cut < 0 ? '' : path.slice(0, cut))!;
    return mul(mul(parent, localMatrix(restPose(node), node.pivot)), stackMatrix(pose.get(path), node.pivot));
  }, paths);

  return {
    t,
    pose,
    matrices,
    point(node, local) {
      const m = matrices.get(node.path);
      if (!m) throw new Error(`heron: no world transform for "${node.path}"`);
      return apply(m, local ?? node.contact ?? node.pivot ?? [0, 0]);
    },
  };
}

/** Evenly spaced frames across one cycle, for anything that scans the timeline. */
export function sampleFrames(ch: Character, count: number): Frame[] {
  return Array.from({ length: count }, (_, i) => frameAt(ch, i / count));
}

/** World position of a part's contact point (or pivot) at time t. */
export function pointAt(ch: Character, path: string, t: number, local?: Vec2): Vec2 {
  const node = ch.find(path);
  if (!node) throw new Error(`heron: no part "${path}"`);
  return frameAt(ch, t).point(node, local);
}
