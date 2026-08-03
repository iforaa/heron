/**
 * JSON-safe scene interchange.
 *
 * JavaScript closures are not data. Procedural channels therefore cross this
 * boundary as densely sampled linear keys; authored keys remain authored keys.
 * Everything else—rig structure, resources, shapes and path morphs—is retained.
 */

import { parseEasing, linear } from './easing.ts';
import { pathMorph } from './path-morph.ts';
import {
  Character, type Channel, type ChannelName, type ClipDefinition, type Definition,
  type MaskDefinition, type Node, type PaintDefinition, type ShapeSpec, type Track, CHANNELS,
} from './scene.ts';
import { channelAt } from './timeline.ts';

export interface IRKey {
  t: number;
  v: number;
  ease: string;
}

export interface IRChannel {
  keys: IRKey[];
  /**
   * The sample density of the procedural channel these keys were baked from.
   * Rehydration turns such a channel back into a procedural one, so the
   * compiler's own fitting pass — not the bake — stays the single owner of the
   * keyframe budget and the EPSILON error report.
   */
  sampled?: number;
}

export type IRTrack = Partial<Record<ChannelName, IRChannel>> & { phase?: number };

export interface IRPathMorph {
  keys: Array<{ t: number; d: string; ease: string }>;
}

export interface IRShape {
  tag: string;
  attrs: Record<string, string | number>;
  morph?: IRPathMorph;
}

export interface IRNode {
  name: string;
  path: string;
  pivot?: [number, number];
  transform?: Node['transform'];
  contact?: [number, number];
  offstage?: boolean;
  clip?: string;
  mask?: string;
  variants?: string[];
  tracks: IRTrack[];
  content: Array<{ shape: IRShape } | { node: IRNode }>;
}

export type IRDefinition = PaintDefinition | ClipDefinition<IRNode> | MaskDefinition<IRNode>;

export interface SceneIR {
  version: 1;
  name: string;
  viewBox: [number, number, number, number];
  duration: number;
  ground?: number;
  once: boolean;
  root: IRNode;
  definitions: IRDefinition[];
}

export interface SceneIROptions {
  /** Minimum intervals used to bake each procedural channel. Defaults to 256. */
  samples?: number;
}

function irChannel(channel: Channel, samples: number): IRChannel {
  if (channel.kind === 'keys') {
    return { keys: channel.keys.map((key) => ({ t: key.t, v: key.v, ease: key.ease.css })) };
  }
  const count = Math.max(samples, channel.samples);
  return {
    keys: Array.from({ length: count + 1 }, (_, i) => ({
      t: i / count,
      v: channel.fn(i / count),
      ease: linear.css,
    })),
    sampled: count,
  };
}

function irTrack(track: Track, samples: number): IRTrack {
  const out: IRTrack = {};
  if (track.phase !== undefined) out.phase = track.phase;
  for (const name of CHANNELS) if (track[name]) out[name] = irChannel(track[name]!, samples);
  return out;
}

function irShape(shape: ShapeSpec): IRShape {
  return {
    tag: shape.tag,
    attrs: { ...shape.attrs },
    morph: shape.morph
      ? { keys: shape.morph.keys.map((key) => ({ t: key.t, d: key.d, ease: key.ease.css })) }
      : undefined,
  };
}

function irNode(node: Node, samples: number): IRNode {
  return {
    ...node,
    pivot: node.pivot ? [...node.pivot] : undefined,
    transform: node.transform ? { ...node.transform } : undefined,
    contact: node.contact ? [...node.contact] : undefined,
    variants: node.variants ? [...node.variants] : undefined,
    tracks: node.tracks.map((track) => irTrack(track, samples)),
    content: node.content.map((item) =>
      'shape' in item ? { shape: irShape(item.shape) } : { node: irNode(item.node, samples) }),
  };
}

/**
 * Deep-copies a definition, converting its geometry root with `mapRoot`. Both
 * interchange directions are this one function, so a field added to a
 * definition kind cannot be carried one way and dropped the other.
 */
function mapDefinition<A, B>(
  definition: PaintDefinition | ClipDefinition<A> | MaskDefinition<A>,
  mapRoot: (root: A) => B,
): PaintDefinition | ClipDefinition<B> | MaskDefinition<B> {
  if (definition.kind === 'clip') return { ...definition, root: mapRoot(definition.root) };
  if (definition.kind === 'mask') {
    return {
      ...definition,
      root: mapRoot(definition.root),
      region: definition.region ? { ...definition.region } : undefined,
    };
  }
  return { ...definition, stops: definition.stops.map((stop) => ({ ...stop })) };
}

/** Converts a live Character into JSON-safe data. */
export function toSceneIR(ch: Character, o: SceneIROptions = {}): SceneIR {
  const samples = o.samples ?? 256;
  if (!Number.isInteger(samples) || samples < 2) {
    throw new Error(`heron: scene IR samples must be an integer of at least 2, got ${samples}`);
  }
  const definitions: IRDefinition[] = ch.definitions.map(
    (definition) => mapDefinition(definition, (root) => irNode(root, samples)),
  );
  return {
    version: 1,
    name: ch.name,
    viewBox: [...ch.viewBox],
    duration: ch.duration,
    ground: ch.ground,
    once: ch.once,
    root: irNode(ch.root, samples),
    definitions,
  };
}

function liveChannel(channel: IRChannel): Channel {
  if (!channel.keys?.length) throw new Error('heron: an IR channel needs at least one key');
  const keyed: Channel = {
    kind: 'keys',
    keys: channel.keys.map((key) => ({
      t: key.t,
      v: key.v,
      ease: parseEasing(key.ease),
    })),
  };
  // A baked procedural channel comes back procedural: the dense linear keys
  // become the function, and the compiler refits them within EPSILON exactly as
  // it would have fitted the original. Emitting them verbatim instead would
  // bypass the fitting pass and report a 257-keyframe bake as `exact`.
  if (channel.sampled === undefined) return keyed;
  return { kind: 'fn', fn: (t) => channelAt(keyed, t), samples: channel.sampled };
}

function liveTrack(track: IRTrack): Track {
  const out: Track = {};
  if (track.phase !== undefined) out.phase = track.phase;
  for (const name of CHANNELS) if (track[name]) out[name] = liveChannel(track[name]!);
  return out;
}

function liveShape(shape: IRShape): ShapeSpec {
  return {
    tag: shape.tag,
    attrs: { ...shape.attrs },
    morph: shape.morph
      ? pathMorph(shape.morph.keys.map((key) => [key.t, key.d, parseEasing(key.ease)]))
      : undefined,
  };
}

function liveNode(node: IRNode): Node {
  return {
    ...node,
    pivot: node.pivot ? [...node.pivot] : undefined,
    transform: node.transform ? { ...node.transform } : undefined,
    contact: node.contact ? [...node.contact] : undefined,
    variants: node.variants ? [...node.variants] : undefined,
    tracks: node.tracks.map(liveTrack),
    content: node.content.map((item) =>
      'shape' in item ? { shape: liveShape(item.shape) } : { node: liveNode(item.node) }),
  };
}

/** Rehydrates a Character from versioned interchange data. */
export function fromSceneIR(ir: SceneIR): Character {
  const version: number = ir.version;
  if (version !== 1) throw new Error(`heron: unsupported scene IR version ${version}`);
  const definitions: Definition[] = ir.definitions.map(
    (definition) => mapDefinition(definition, liveNode),
  );
  return new Character(ir.name, {
    viewBox: [...ir.viewBox],
    duration: ir.duration,
    ground: ir.ground,
    once: ir.once,
  }, liveNode(ir.root), definitions);
}

export function serializeScene(ch: Character, o: SceneIROptions = {}, space = 2): string {
  return JSON.stringify(toSceneIR(ch, o), null, space);
}

export function parseScene(json: string): Character {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`heron: invalid scene IR JSON: ${(error as Error).message}`);
  }
  return fromSceneIR(data as SceneIR);
}
