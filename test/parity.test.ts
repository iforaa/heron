/**
 * The parity contract, checked mechanically.
 *
 * The project's central claim is that what the agent inspects is what the
 * browser plays. That claim lives in the seam between `trackAt` (the evaluator)
 * and the CSS `compile` emits, and it is worth exactly as much as the test that
 * holds it. So this file parses the compiled stylesheet back into keyframes,
 * replays it the way CSS would, and compares against the evaluator for every
 * animated part of every scene — in both the exact and baked branches, across
 * every channel, including easing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, part, circle, line, keys, sampled, compile, trackAt, keyframeName, strokeLength, EPSILON,
  type ChannelName,
  cubicBezier, ease, easeIn, easeOut, easeInOut, linear, glide,
  type Character, type Easing,
} from '../src/index.ts';
import { crane } from '../examples/crane.ts';
import { gopher } from '../examples/gopher.ts';

const NAMED: Record<string, Easing> = {
  linear, ease, 'ease-in': easeIn, 'ease-out': easeOut, 'ease-in-out': easeInOut,
};

function parseEasing(css: string | undefined): Easing {
  if (!css) return linear;
  if (NAMED[css]) return NAMED[css];
  const m = css.match(/cubic-bezier\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/);
  if (m) return cubicBezier(+m[1], +m[2], +m[3], +m[4]);
  throw new Error(`test: unhandled timing function ${css}`);
}

interface Keyframe {
  p: number;
  vals: Record<string, number>;
  ease: Easing;
}

/** Reads `@keyframes NAME { ... }` blocks out of a compiled stylesheet. */
function parseKeyframes(svg: string): Map<string, Keyframe[]> {
  const out = new Map<string, Keyframe[]>();
  for (const block of svg.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\s*\}/g)) {
    const frames: Keyframe[] = [];
    for (const f of block[2].matchAll(/([\d.]+)%\s*\{([^}]*)\}/g)) {
      const body = f[2];
      const vals: Record<string, number> = {};

      const tr = body.match(/transform:\s*([^;]+);/);
      if (tr) {
        const t = tr[1];
        const translate = t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        if (translate) { vals.x = +translate[1]; vals.y = +translate[2]; }
        const rotate = t.match(/rotate\(([-\d.]+)deg\)/);
        if (rotate) vals.rotate = +rotate[1];
        const scale = t.match(/scale\(([-\d.]+),\s*([-\d.]+)\)/);
        if (scale) { vals.scaleX = +scale[1]; vals.scaleY = +scale[2]; }
      }

      const op = body.match(/opacity:\s*([-\d.]+);/);
      if (op) vals.opacity = +op[1];

      // `draw` is emitted as the offset still to be revealed, in user units, so
      // it has to be read back through the same dash length to be compared.
      const dash = body.match(/stroke-dashoffset:\s*([-\d.]+);/);
      if (dash) vals.dashoffset = +dash[1];

      const timing = body.match(/animation-timing-function:\s*([^;]+);/);
      frames.push({ p: +f[1] / 100, vals, ease: parseEasing(timing?.[1]?.trim()) });
    }
    out.set(block[1], frames);
  }
  return out;
}

/** Interpolates a parsed keyframe list the way the browser would. */
function playAt(frames: Keyframe[], t: number, channel: string): number | undefined {
  const present = frames.filter((f) => f.vals[channel] !== undefined);
  if (!present.length) return undefined;
  if (t <= present[0].p) return present[0].vals[channel];
  const last = present[present.length - 1];
  if (t >= last.p) return last.vals[channel];
  const i = present.findIndex((f) => f.p >= t);
  const a = present[i - 1];
  const b = present[i];
  const p = b.p === a.p ? 0 : (t - a.p) / (b.p - a.p);
  return a.vals[channel] + (b.vals[channel] - a.vals[channel]) * a.ease.fn(p);
}

function checkScene(ch: Character, label: string, least = 500): void {
  const { svg } = compile(ch);
  const blocks = parseKeyframes(svg);
  let checked = 0;

  for (const node of ch.nodes()) {
    // Every layer is its own element with its own keyframes, so parity has to
    // hold layer by layer — checking only their net effect would let two of them
    // be wrong in opposite directions and still pass.
    node.tracks.forEach((track, layer) => {
      // Phase becomes animation-delay, which shifts time rather than changing the
      // keyframes, so it is compared out here and covered by its own test.
      const unphased = { ...track, phase: undefined };
      const dashLen = strokeLength(node);

      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const expected = trackAt(unphased, t);
        for (const [channel, want] of Object.entries(expected)) {
          // Which block a channel lands in is the compiler's rule, so it is asked
          // rather than restated: a fourth property group must not quietly make
          // this harness check fewer channels.
          const frames = blocks.get(keyframeName(node.path, layer, channel as ChannelName));
          const raw = frames && playAt(frames, t, channel === 'draw' ? 'dashoffset' : channel);
          const got = channel === 'draw' && raw !== undefined ? 1 - raw / dashLen : raw;
          if (got === undefined) continue;
          const tol = EPSILON[channel as keyof typeof EPSILON] ?? 0.01;
          assert.ok(
            Math.abs(got - want) <= tol,
            `${label} ${node.path}#${layer}.${channel} at t=${t.toFixed(3)}: browser would play ${got.toFixed(4)}, evaluator says ${want.toFixed(4)} (tolerance ${tol})`,
          );
          checked++;
        }
      }
    });
  }
  assert.ok(checked > least, `${label}: expected a substantial number of comparisons, made ${checked}`);
}

test('crane: compiled CSS plays what the evaluator computed', () => {
  checkScene(crane, 'crane');
});

test('gopher: compiled CSS plays what the evaluator computed', () => {
  checkScene(gopher, 'gopher');
});

test('every channel survives the round trip, including baked and mixed parts', () => {
  const scene = character('mixed', { viewBox: [0, 0, 100, 100], duration: 2 }, () => {
    part('exact', { pivot: [50, 50] }, () => circle({ cx: 50, cy: 50, r: 5 }));
    part('procedural', { pivot: [50, 50] }, () => circle({ cx: 50, cy: 50, r: 5 }));
    part('mixedTimes', { pivot: [50, 50] }, () => circle({ cx: 50, cy: 50, r: 5 }));
  });

  // Every channel at once, sharing key times so it stays exact.
  scene.part('exact').animate({
    rotate: keys([[0, 0, glide], [0.5, 45, easeInOut], [1, 0]]),
    x: keys([[0, 0, glide], [0.5, 12, easeInOut], [1, 0]]),
    y: keys([[0, 0, glide], [0.5, -8, easeInOut], [1, 0]]),
    scaleX: keys([[0, 1, glide], [0.5, 1.4, easeInOut], [1, 1]]),
    scaleY: keys([[0, 1, glide], [0.5, 0.7, easeInOut], [1, 1]]),
    opacity: keys([[0, 1, glide], [0.5, 0.3, easeInOut], [1, 1]]),
  });

  scene.part('procedural').animate({
    rotate: sampled((t) => Math.sin(t * Math.PI * 2) * 20 + Math.sin(t * Math.PI * 6) * 4, 96),
    y: sampled((t) => Math.cos(t * Math.PI * 4) * 3, 96),
  });

  // Transform channels and opacity deliberately disagree about timing, which
  // used to force the whole part to bake.
  scene.part('mixedTimes').animate({
    rotate: keys([[0, 0], [0.3, 20], [1, 0]]),
    opacity: keys([[0, 1], [0.7, 0.2], [1, 1]]),
  });

  const { report } = compile(scene);
  const modeOf = (path: string) => report.parts.filter((p) => p.path === path).map((p) => p.mode);
  assert.deepEqual(modeOf('exact'), ['exact', 'exact'], 'aligned channels stay exact');
  assert.ok(modeOf('procedural').every((m) => m === 'baked'), 'procedural motion bakes');
  assert.deepEqual(
    modeOf('mixedTimes'),
    ['exact', 'exact'],
    'transform and opacity are separate CSS properties, so disagreeing about timing must not force a bake',
  );

  checkScene(scene, 'mixed');
});

test('a drawn-on stroke plays back as the evaluator computed it', () => {
  const scene = character('draw', { viewBox: [0, 0, 200, 60], duration: 2 }, () => {
    part('word', () => line({ from: [10, 30], to: [190, 30], stroke: '#000', width: 8 }));
  });
  scene.part('word').animate({ draw: keys([[0, 0], [0.6, 1], [1, 0]]) });
  checkScene(scene, 'draw', 100);
});

test('a hand-written cubic-bezier equal to a keyword curve does not force a bake', () => {
  const scene = character('eq', { viewBox: [0, 0, 10, 10] }, () => {
    part('a', { pivot: [0, 0] }, () => circle({ cx: 0, cy: 0, r: 1 }));
  });
  scene.part('a').animate({
    rotate: keys([[0, 0, easeInOut], [1, 30]]),
    // Numerically identical to easeInOut; only its serialization differs.
    x: keys([[0, 0, cubicBezier(0.42, 0, 0.58, 1)], [1, 5]]),
  });
  const { report } = compile(scene);
  assert.ok(report.parts.every((p) => p.mode === 'exact'), 'equal curves compare equal');
});
