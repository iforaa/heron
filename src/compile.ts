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
import { dashOffset, strokeLength } from './geometry.ts';
import {
  block, cssClass, definitionsSvg, listShapes, nodeSvg, outputSize, renderContext,
  round, svgOpen,
} from './render.ts';

/** Maximum deviation permitted when refitting a sampled curve, per channel. */
export const EPSILON = {
  rotate: 0.4,   // degrees
  x: 0.15,       // user units
  y: 0.15,
  skewX: 0.4,    // degrees
  skewY: 0.4,
  scaleX: 0.004,
  scaleY: 0.004,
  opacity: 0.01,
  draw: 0.004,     // fraction of the stroke revealed
} as const;

type Name = ChannelName;

export interface CompileReport {
  parts: { path: string; layer: number; mode: 'exact' | 'baked'; keyframes: number; reason?: string }[];
  morphs: { index: number; keyframes: number }[];
  warnings: string[];
  /** Evidence about the artifact actually serialized, not only the evaluator. */
  certification: {
    status: 'within-epsilon';
    artifact: 'serialized-css-keyframes';
    exactChannels: number;
    bakedChannels: number;
    replayChecks: number;
    maxError: Partial<Record<ChannelName, number>>;
    epsilon: typeof EPSILON;
  };
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
  // Keep half the published budget in reserve for interpolation between the
  // verification samples and for numeric serialization. Spending the whole
  // EPSILON at sampled instants let a long camera move cross the limit between
  // two of them even after its keyframe percentages were serialized exactly.
  const FIT_BUDGET = 0.5;

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
    if (idx < 0 || err <= FIT_BUDGET) return;
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
  if (names.includes('skewX')) parts.push(`skewX(${round(vals.skewX ?? 0)}deg)`);
  if (names.includes('skewY')) parts.push(`skewY(${round(vals.skewY ?? 0)}deg)`);
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
 * Explains when several authored transform channels cannot remain exact CSS.
 *
 * This is public to diagnostics so `heron lint` and `heron check` can disclose
 * the degradation before a build report scrolls past. A single procedural
 * channel is intentionally omitted: sampling it is its declared representation,
 * whereas two independently authored keyed channels unexpectedly forcing one
 * another through the fitter is the authoring trap this diagnostic names.
 */
export function transformBakeReason(track: Track): string | null {
  const names = activeChannels(track).filter((name) => GROUP_OF.get(name) === GROUPS[0]);
  if (names.length < 2) return null;
  const channels = names.map((name) => track[name]!);
  // A deliberately procedural transform is already authored for sampling. The
  // surprise is losing exact keyed data: either by mixing it with a function or
  // by giving several keyed channels incompatible timing.
  if (channels.every((channel) => channel.kind === 'fn')) return null;
  return bakeReason(channels);
}

/**
 * A keyframe's timing function, or nothing when CSS's default already says it.
 * The last keyframe never takes one — there is no segment after it to ease.
 * Part of the parity contract, so it is stated once for transforms and morphs.
 */
function easeSuffix(ease: Easing, last: boolean): string {
  return !last && ease.css !== 'linear' ? ` animation-timing-function: ${ease.css};` : '';
}

/**
 * A keyframe percentage precise enough that serialization cannot spend the
 * compiler's geometric error budget.
 *
 * Two decimal places of *percent* looked precise and was not: on a long camera
 * move, moving a fitted key by 0.005% moved the shipped drawing many times
 * farther than EPSILON.x. Ten decimal places of percent put the time error below
 * 5e-13 of a cycle while still producing ordinary, portable CSS numbers.
 */
function percentage(t: number): string {
  return (t * 100).toFixed(10)
    .replace(/(\.[0-9]*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '');
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
    // CSS synthesizes an omitted 0%/100% key from the element's underlying
    // style; Heron's evaluator holds the nearest authored value. Name both
    // endpoints explicitly so a channel beginning at t=.5 does not animate from
    // its neutral rest pose for the first half of browser playback.
    const timeline = [...ref.keys];
    if (timeline[0].t > 0) timeline.unshift({ ...timeline[0], t: 0 });
    if (timeline[timeline.length - 1].t < 1) {
      timeline.push({ ...timeline[timeline.length - 1], t: 1 });
    }
    const lines = timeline.map((k, i) => {
      const vals: Partial<Record<Name, number>> = {};
      for (const n of names) vals[n] = channelAt(track[n]!, k.t);
      const timing = easeSuffix(k.ease, i === timeline.length - 1);
      return `      ${percentage(k.t)}% { ${body(vals)}${timing} }`;
    });
    report.parts.push({ path, layer, mode: 'exact', keyframes: lines.length });
    report.certification.exactChannels += names.length;
    return { lines, count: lines.length };
  }

  // Fit against a grid several times denser than the requested sampling.
  // Checking error only at the sample points would bound the error *at those
  // points* while the curve between them drifts further, which would make
  // EPSILON a claim the output does not actually honour.
  const requested = Math.max(48, ...chans.map((c) => (c.kind === 'fn' ? c.samples : 0)));
  // Eight verification intervals per requested sample keep the chord between
  // adjacent samples inside the reserved half-budget on the steepest production
  // camera move. Four still allowed 0.19 units of curvature between retained
  // points against an x budget of 0.15, even when every point was kept.
  const n = Math.max(512, requested * 8);
  const times = Array.from({ length: n + 1 }, (_, i) => i / n);
  const series = new Map<Name, number[]>();
  for (const name of names) {
    const values = times.map((t) => channelAt(track[name]!, t));
    const bad = values.findIndex((value) => !Number.isFinite(value));
    if (bad >= 0) {
      throw new Error(
        `heron: part "${path || '(root)'}" layer ${layer} channel ${name}`
        + ` returned ${values[bad]} at t=${times[bad]}`,
      );
    }
    series.set(name, values);
  }

  const retained = fit(times, series);
  // Verify what is actually serialized: rounded CSS values at rounded percent
  // positions, linearly replayed between retained keys. This is the last seam
  // before disk, and checking ideal floating-point keys here would certify a
  // different artifact than the one a browser receives.
  for (const [name, values] of series) {
    let segment = 0;
    for (let i = 0; i < times.length; i++) {
      while (segment < retained.length - 2 && i > retained[segment + 1]) segment++;
      const ia = retained[segment];
      const ib = retained[Math.min(segment + 1, retained.length - 1)];
      const ta = Number(percentage(times[ia])) / 100;
      const tb = Number(percentage(times[ib])) / 100;
      const u = (times[i] - ta) / (tb - ta || 1);
      const a = round(values[ia]);
      const b = round(values[ib]);
      const replayed = a + (b - a) * Math.max(0, Math.min(1, u));
      const error = Math.abs(replayed - values[i]);
      report.certification.replayChecks++;
      report.certification.maxError[name] = Math.max(report.certification.maxError[name] ?? 0, error);
      if (error > EPSILON[name] + 1e-9) {
        throw new Error(
          `heron: serialized ${path || '(root)'}.${name} exceeds EPSILON at t=${times[i]}`
          + ` (${Math.abs(replayed - values[i])} > ${EPSILON[name]})`,
        );
      }
    }
  }

  const lines = retained.map((i) => {
    const vals: Partial<Record<Name, number>> = {};
    for (const [name, arr] of series) vals[name] = arr[i];
    return `      ${percentage(times[i])}% { ${body(vals)} }`;
  });
  report.parts.push({ path, layer, mode: 'baked', keyframes: lines.length, reason });
  report.certification.bakedChannels += names.length;
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
  if (repeat.startsWith('1 ') && track.phase !== undefined) {
    throw new Error(
      `heron: part "${node.path || '(root)'}" layer ${layer} uses phase in a once-only scene;`
      + ' CSS delay cannot wrap a finite animation the way Heron phase does',
    );
  }
  const active = activeChannels(track);
  if (active.length === 0) return null;

  const delay = track.phase ? ` ${round(-track.phase * duration, 9)}s` : '';
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
  const report: CompileReport = {
    parts: [],
    morphs: [],
    warnings: [],
    certification: {
      status: 'within-epsilon',
      artifact: 'serialized-css-keyframes',
      exactChannels: 0,
      bakedChannels: 0,
      replayChecks: 0,
      maxError: {},
      epsilon: EPSILON,
    },
  };

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
      return `      ${percentage(key.t)}% { d: path("${d}");${timing} }`;
    });
    frames.push(`    @keyframes ${frameName} {\n${lines.join('\n')}\n    }`);
    animated.push('.' + className);
    report.morphs.push({ index: morphIndex - 1, keyframes: lines.length });
  }
  if (report.morphs.length) {
    report.warnings.push(
      'CSS path morphing uses d: path(...); verify the target browser set or retain a non-morph fallback',
    );
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
