import { test } from 'node:test';
import assert from 'node:assert/strict';

import { duringAdditive, withinAdditive, score, type Beat } from '../src/index.ts';
import { channelAt } from '../src/timeline.ts';

const beat: Beat = { name: 'sway', from: 0.2, to: 0.7, seconds: 1 };
const wave = (seconds: number, u: number) => Math.sin(u * Math.PI) * 10;

test('duringAdditive is neutral outside its beat and follows the shape inside', () => {
  const ch = duringAdditive(beat, wave, { neutral: 0 });
  // Release-ramp denominator (t - (1 - release)) / release can round 1ulp past 1,
  // leaving ~1e-30 of Math.sin(PI)*10; assert near-neutral instead of exact.
  assert.ok(Math.abs(channelAt(ch, 0)) < 1e-12, `expected near-zero at t=0, got ${channelAt(ch, 0)}`);
  assert.ok(Math.abs(channelAt(ch, 1)) < 1e-12, `expected near-zero at t=1, got ${channelAt(ch, 1)}`);
  assert.ok(Math.abs(channelAt(ch, 0.1)) < 1e-12, `expected near-zero at t=0.1, got ${channelAt(ch, 0.1)}`);
  // Mid-beat, past the default attack ramp, the shape's own value comes through.
  const mid = channelAt(ch, 0.45);
  assert.ok(mid > 8, `expected the sine peak region, got ${mid}`);
});

test('duringAdditive agrees with withinAdditive over the sampled shape', () => {
  const ch = duringAdditive(beat, wave, { neutral: 0, attack: 0.1, release: 0.1 });
  // The same shape, hand-sampled to a local channel, placed by withinAdditive.
  const local = { kind: 'fn' as const, fn: (u: number) => wave(u * beat.seconds, u), samples: 60 };
  const reference = withinAdditive(beat, local, { neutral: 0, attack: 0.1, release: 0.1 });
  for (const t of [0, 0.2, 0.3, 0.45, 0.6, 0.7, 1]) {
    assert.ok(Math.abs(channelAt(ch, t) - channelAt(reference, t)) < 1e-6, `diverged at t=${t}`);
  }
});

test('score windows can place a shape additively by beat name', () => {
  const beats = score(2, [['enter', 0.5], ['sway', 1], ['exit', 0]]);
  const ch = beats.duringAdditive('sway', wave, { neutral: 0 });
  // Release-ramp rounding residue: assert near-neutral at window edges.
  assert.ok(Math.abs(channelAt(ch, 0)) < 1e-12, `expected near-zero at t=0, got ${channelAt(ch, 0)}`);
  assert.ok(Math.abs(channelAt(ch, 1)) < 1e-12, `expected near-zero at t=1, got ${channelAt(ch, 1)}`);
});

test('duringAdditive validates its beat like the rest of the family', () => {
  assert.throws(
    () => duringAdditive({ name: 'bad', from: 0.9, to: 0.1, seconds: 1 }, wave),
    /duringAdditive/,
  );
});
