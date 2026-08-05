/**
 * What one edit actually changed, part by part and instant by instant.
 *
 * The iteration loop is edit, render, judge — and judging from sheets means
 * re-reading every frame to find the difference. This instrument answers the
 * question directly, in pose space, on the same frame grid the viewer sees.
 * Geometry edits (a redrawn shape, a path morph) are not poses, so they are
 * reported as the fact "geometry changed" instead of being forced into a
 * number that would mean nothing.
 */

import type { Character, Node } from './scene.ts';
import { evaluate, nodePose } from './timeline.ts';
import { playbackTimes } from './delivery.ts';

export interface ChannelDelta {
  channel: string;
  peak: number;
  at: number;
  /** One [a, b] value pair per grid instant; present only when asked for. */
  series?: Array<[number, number]>;
}

export interface PartDiff {
  path: string;
  deltas: ChannelDelta[];
  geometryChanged: boolean;
}

export interface DiffReport {
  fps: number;
  frameCount: number;
  times: number[];
  parts: PartDiff[];
  unchanged: string[];
  added: string[];
  removed: string[];
  durationMismatch: boolean;
  /** Summed absolute delta across every part and channel, per grid index. */
  divergence: number[];
}

const POSE_CHANNELS = [
  'rotate', 'x', 'y', 'scaleX', 'scaleY', 'skewX', 'skewY', 'opacity', 'draw',
] as const;

/** A part's own geometry, stable across identical declarations. */
function ownShapes(node: Node): string {
  return JSON.stringify(node.content.flatMap((item) => ('shape' in item ? [item.shape] : [])));
}

function partsOf(ch: Character): Map<string, Node> {
  const out = new Map<string, Node>();
  for (const node of ch.nodes()) if (node.path) out.set(node.path, node);
  return out;
}

export function diffTakes(
  a: Character, b: Character, o: { fps?: number; series?: boolean } = {},
): DiffReport {
  const fps = o.fps ?? 60;
  // The longer take's grid, so neither take is sampled coarser than it plays.
  const times = playbackTimes(Math.max(a.duration, b.duration), fps);
  // A film holds its last frame, which the end-exclusive grid never shows.
  if ((a.once || b.once) && times[times.length - 1] < 1) times.push(1);

  const aParts = partsOf(a);
  const bParts = partsOf(b);
  const added = [...bParts.keys()].filter((p) => !aParts.has(p));
  const removed = [...aParts.keys()].filter((p) => !bParts.has(p));

  const aFrames = times.map((t) => evaluate(a, t));
  const bFrames = times.map((t) => evaluate(b, t));

  const parts: PartDiff[] = [];
  const unchanged: string[] = [];
  const divergence = times.map(() => 0);

  for (const [path, aNode] of aParts) {
    const bNode = bParts.get(path);
    if (!bNode) continue;
    const deltas: ChannelDelta[] = [];
    for (const channel of POSE_CHANNELS) {
      let peak = 0;
      let at = times[0];
      const series: Array<[number, number]> = [];
      times.forEach((t, i) => {
        const va = nodePose(aNode, aFrames[i].get(path))[channel];
        const vb = nodePose(bNode, bFrames[i].get(path))[channel];
        if (o.series) series.push([va, vb]);
        const d = Math.abs(vb - va);
        divergence[i] += d;
        if (d > peak) { peak = d; at = t; }
      });
      if (peak > 1e-9) deltas.push({ channel, peak, at, ...(o.series ? { series } : {}) });
    }
    deltas.sort((x, y) => y.peak - x.peak);
    const geometryChanged = ownShapes(aNode) !== ownShapes(bNode);
    if (deltas.length || geometryChanged) parts.push({ path, deltas, geometryChanged });
    else unchanged.push(path);
  }
  parts.sort((x, y) => (y.deltas[0]?.peak ?? 0) - (x.deltas[0]?.peak ?? 0));

  return {
    fps, frameCount: times.length, times, parts, unchanged, added, removed,
    durationMismatch: a.duration !== b.duration, divergence,
  };
}

/** The grid instants where the takes disagree most, back in time order. */
export function divergentTimes(report: DiffReport, count: number): number[] {
  return report.times
    .map((t, i) => ({ t, d: report.divergence[i] }))
    .sort((x, y) => y.d - x.d)
    .slice(0, Math.max(1, count))
    .map((e) => e.t)
    .sort((x, y) => x - y);
}
