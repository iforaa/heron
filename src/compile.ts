/**
 * Compilation: scene + timeline -> one self-contained animated SVG.
 *
 * Two modes, and the distinction is the parity contract in practice:
 *
 *   exact  - the authored keyframes are already CSS-expressible, so they are
 *            emitted verbatim. The browser runs precisely what the evaluator
 *            computed; error is zero.
 *   baked  - the motion is procedural, or channels on one part disagree about
 *            keyframe times or easing (CSS allows only one timing function per
 *            keyframe). The curve is sampled and refitted to sparse keyframes
 *            with a bounded error, so a snapshot still predicts playback to
 *            within EPSILON.
 *
 * A part is never silently degraded: `compile` reports which parts were baked.
 */

import { type Channel, type Character, type ChannelName, type Node, type Track, CHANNELS, NEUTRAL, activeChannels } from './scene.ts';
import { channelAt } from './timeline.ts';
import type { Easing } from './easing.ts';
import {
  block, cssClass, dashOffset, definitionsSvg, listShapes, nodeSvg, outputSize, renderContext,
  round, strokeLength, svgOpen,
} from './render.ts';

/** Maximum deviation permitted when refitting a sampled curve, per channel. */
export const EPSILON = {
  rotate: 0.4,   // degrees
  x: 0.15,       // user units
  y: 0.15,
  scaleX: 0.004,
  scaleY: 0.004,
  opacity: 0.01,
  draw: 0.004,     // fraction of the stroke revealed
} as const;

type Name = ChannelName;

export interface CompileReport {
  parts: { path: string; layer: number; mode: 'exact' | 'baked'; keyframes: number; reason?: string }[];
}

/**
 * Why a group of channels cannot be emitted verbatim, or null if it can.
 *
 * CSS allows one timing function per keyframe, so channels sharing a keyframe
 * list must agree on both times and easings. Easings compare by `key` — the
 * curve — not by how they print, so `easeInOut` and an identical hand-written
 * cubic-bezier do not force a needless bake.
 */
function bakeReason(chans: Channel[]): string | null {
  if (chans.some((c) => c.kind === 'fn')) return 'procedural channel';
  const [first, ...rest] = chans as Extract<Channel, { kind: 'keys' }>[];
  for (const c of rest) {
    if (c.keys.length !== first.keys.length) return 'channels have different keyframe counts';
    for (let i = 0; i < c.keys.length; i++) {
      if (Math.abs(c.keys[i].t - first.keys[i].t) > 1e-9) return 'channels have different keyframe times';
      if (c.keys[i].ease.key !== first.keys[i].ease.key) return 'channels disagree on easing';
    }
  }
  return null;
}

/** Douglas-Peucker over sampled values: keep the fewest times that reproduce
 *  every channel within EPSILON under linear interpolation. */
function fit(times: number[], series: Map<Name, number[]>): number[] {
  const keep = new Set<number>([0, times.length - 1]);

  const worst = (lo: number, hi: number): { idx: number; err: number } => {
    let idx = -1;
    let err = 0;
    for (let i = lo + 1; i < hi; i++) {
      const p = (times[i] - times[lo]) / (times[hi] - times[lo] || 1);
      for (const [name, vals] of series) {
        const approx = vals[lo] + (vals[hi] - vals[lo]) * p;
        const e = Math.abs(vals[i] - approx) / EPSILON[name];
        if (e > err) { err = e; idx = i; }
      }
    }
    return { idx, err };
  };

  const split = (lo: number, hi: number) => {
    if (hi - lo < 2) return;
    const { idx, err } = worst(lo, hi);
    if (idx < 0 || err <= 1) return;
    keep.add(idx);
    split(lo, idx);
    split(idx, hi);
  };

  split(0, times.length - 1);
  return [...keep].sort((a, b) => a - b);
}

/**
 * Emits every channel the part animates, including at its neutral value. A
 * keyframe that collapsed to `transform: none` would still interpolate, but
 * writing the function out keeps the whole keyframe list in one form: easier to
 * read, and easier for anything (including the test suite) to parse back.
 */
function transformCss(vals: Partial<Record<Name, number>>, names: Name[]): string {
  const parts: string[] = [];
  if (names.includes('x') || names.includes('y')) {
    parts.push(`translate(${round(vals.x ?? 0)}px, ${round(vals.y ?? 0)}px)`);
  }
  if (names.includes('rotate')) parts.push(`rotate(${round(vals.rotate ?? 0)}deg)`);
  if (names.includes('scaleX') || names.includes('scaleY')) {
    parts.push(`scale(${round(vals.scaleX ?? 1)}, ${round(vals.scaleY ?? 1)})`);
  }
  return parts.length ? parts.join(' ') : 'none';
}

/**
 * One CSS property's worth of animation for a part.
 *
 * Channels are grouped by the property they compile to, because CSS's
 * one-timing-function-per-keyframe rule applies *within* a property. `opacity`
 * and `transform` are separate properties and run as separate animations on the
 * same element, so a fade that disagrees with a rotation about keyframe times
 * no longer forces the rotation to be baked along with it.
 *
 * `draw` is the third: a stroke revealing itself is `stroke-dashoffset`, which
 * CSS animates as happily as anything else. `dash` is the part's own stroke
 * length, which is what turns a channel of 0..1 into user units.
 */
interface Group {
  suffix: string;
  channels: readonly Name[];
  render: (vals: Partial<Record<Name, number>>, names: Name[], dash: () => number) => string;
}

/** The keyframes block a part's layer uses for a given channel. */
export function keyframeName(path: string, layer: number, channel: Name): string {
  return `kf-${cssClass(path, layer).slice(2)}${GROUP_OF.get(channel)!.suffix}`;
}

const GROUPS: Group[] = [
  {
    suffix: '',
    channels: CHANNELS.filter((c) => c !== 'opacity' && c !== 'draw'),
    render: (vals, names) => `transform: ${transformCss(vals, names)};`,
  },
  {
    suffix: '-o',
    channels: ['opacity'],
    render: (vals) => `opacity: ${round(vals.opacity ?? NEUTRAL.opacity)};`,
  },
  {
    suffix: '-d',
    channels: ['draw'],
    render: (vals, _names, dash) => `stroke-dashoffset: ${dashOffset(vals.draw ?? 1, dash())};`,
  },
];

/** Every channel belongs to exactly one group; the table above is the authority. */
const GROUP_OF = new Map<Name, Group>(
  GROUPS.flatMap((g) => g.channels.map((c): [Name, Group] => [c, g])),
);

/**
 * A keyframe's timing function, or nothing when CSS's default already says it.
 * The last keyframe never takes one — there is no segment after it to ease.
 * Part of the parity contract, so it is stated once for transforms and morphs.
 */
function easeSuffix(ease: Easing, last: boolean): string {
  return !last && ease.css !== 'linear' ? ` animation-timing-function: ${ease.css};` : '';
}

interface Emitted {
  rule: string;
  keyframes: string[];
}

function keyframeLines(
  track: Track,
  names: Name[],
  group: Group,
  dash: () => number,
  report: CompileReport,
  path: string,
  layer: number,
): { lines: string[]; count: number } {
  const chans = names.map((n) => track[n]!);
  const reason = bakeReason(chans);
  const body = (vals: Partial<Record<Name, number>>) => group.render(vals, names, dash);

  if (!reason) {
    const ref = chans[0] as Extract<Channel, { kind: 'keys' }>;
    const lines = ref.keys.map((k, i) => {
      const vals: Partial<Record<Name, number>> = {};
      for (const n of names) vals[n] = channelAt(track[n]!, k.t);
      const timing = easeSuffix(k.ease, i === ref.keys.length - 1);
      return `      ${round(k.t * 100, 2)}% { ${body(vals)}${timing} }`;
    });
    report.parts.push({ path, layer, mode: 'exact', keyframes: lines.length });
    return { lines, count: lines.length };
  }

  // Fit against a grid several times denser than the requested sampling.
  // Checking error only at the sample points would bound the error *at those
  // points* while the curve between them drifts further, which would make
  // EPSILON a claim the output does not actually honour.
  const requested = Math.max(48, ...chans.map((c) => (c.kind === 'fn' ? c.samples : 0)));
  const n = Math.max(256, requested * 4);
  const times = Array.from({ length: n + 1 }, (_, i) => i / n);
  const series = new Map<Name, number[]>();
  for (const name of names) series.set(name, times.map((t) => channelAt(track[name]!, t)));

  const lines = fit(times, series).map((i) => {
    const vals: Partial<Record<Name, number>> = {};
    for (const [name, arr] of series) vals[name] = arr[i];
    return `      ${round(times[i] * 100, 2)}% { ${body(vals)} }`;
  });
  report.parts.push({ path, layer, mode: 'baked', keyframes: lines.length, reason });
  return { lines, count: lines.length };
}

/**
 * One layer of one part: its own element, its own animations.
 *
 * Keeping layers as separate elements is what makes them worth having. A
 * hand-keyed gait and a procedural flourish stacked on the same joint would,
 * summed into one channel, drag the gait through the sampler with the flourish;
 * as two elements the gait stays `exact` and only the flourish bakes.
 */
function emitLayer(
  node: Node, layer: number, duration: number, repeat: string, report: CompileReport,
): Emitted | null {
  const track = node.tracks[layer];
  const active = activeChannels(track);
  if (active.length === 0) return null;

  const delay = track.phase ? ` ${round(-track.phase * duration, 4)}s` : '';
  const animations: string[] = [];
  const keyframes: string[] = [];

  // Measured lazily: only the `draw` group wants it, and finding it walks the
  // whole subtree and re-parses every path in it.
  let measured: number | undefined;
  const dash = () => (measured ??= strokeLength(node));
  for (const group of GROUPS) {
    const names = active.filter((n) => group.channels.includes(n));
    if (!names.length) continue;
    const anim = keyframeName(node.path, layer, names[0]);
    const { lines } = keyframeLines(track, names, group, dash, report, node.path, layer);
    animations.push(`${anim} ${duration}s linear${delay} ${repeat}`);
    keyframes.push(`    @keyframes ${anim} {\n${lines.join('\n')}\n    }`);
  }

  const origin = node.pivot ? `transform-origin: ${round(node.pivot[0])}px ${round(node.pivot[1])}px;` : '';
  return {
    rule: `    .${cssClass(node.path, layer)} { ${origin} animation: ${animations.join(', ')}; }`,
    keyframes,
  };
}

export interface CompileOptions {
  width?: number;
  /** Emit a prefers-reduced-motion block that freezes the rest pose. */
  reducedMotion?: boolean;
}

export function compile(
  ch: Character, opts: CompileOptions = {},
): { svg: string; report: CompileReport; animated: string[] } {
  const { width, height } = outputSize(ch, opts.width);
  const report: CompileReport = { parts: [] };

  const rules: string[] = [];
  const frames: string[] = [];
  const animated: string[] = [];

  // A film runs its keyframes once and keeps the last one. `forwards` is what
  // holds it: without it the element snaps back to its unanimated state the
  // instant the animation ends, which is a wordmark that appears and vanishes.
  const repeat = ch.once ? '1 forwards' : 'infinite';

  for (const node of ch.nodes()) {
    for (let layer = 0; layer < node.tracks.length; layer++) {
      const e = emitLayer(node, layer, ch.duration, repeat, report);
      if (!e) continue;
      rules.push(e.rule);
      frames.push(...e.keyframes);
      animated.push('.' + cssClass(node.path, layer));
    }
  }

  const context = renderContext(ch);
  let morphIndex = 0;
  for (const { shape } of listShapes(ch)) {
    if (!shape.morph) continue;
    const className = `h-morph-${morphIndex}`;
    const frameName = `kf-morph-${morphIndex++}`;
    context.morphClasses.set(shape, className);
    rules.push(`    .${className} { animation: ${frameName} ${ch.duration}s linear ${repeat}; }`);
    const lines = shape.morph.keys.map((key, i, keys) => {
      const d = key.d.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const timing = easeSuffix(key.ease, i === keys.length - 1);
      return `      ${round(key.t * 100, 2)}% { d: path("${d}");${timing} }`;
    });
    frames.push(`    @keyframes ${frameName} {\n${lines.join('\n')}\n    }`);
    animated.push('.' + className);
  }

  // transform-box: view-box makes transform-origin absolute in viewBox space,
  // which is what lets a pivot be written as the joint's rest-pose coordinate
  // at every depth of the rig.
  const baseRule = animated.length ? `    ${animated.join(', ')} { transform-box: view-box; }` : '';
  const reduced =
    opts.reducedMotion !== false && animated.length
      ? `\n    @media (prefers-reduced-motion: reduce) {\n      ${animated.join(', ')} { animation: none; }\n    }`
      : '';

  const style = [baseRule, ...rules, ...frames].filter(Boolean).join('\n') + reduced;

  const svg = block(
    svgOpen(ch, width, height),
    `  <title>${ch.name}</title>`,
    definitionsSvg(ch, '  ', context),
    style ? `  <style>\n${style}\n  </style>` : '',
    nodeSvg(ch.root, new Map(), '  ', undefined, context),
    '</svg>',
  ) + '\n';
  return { svg, report, animated };
}
