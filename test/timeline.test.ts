import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, keys, part, sampled, frameAt, lazyFrameAt, localMatrix, type Mat,
} from '../src/index.ts';
import { REST } from '../src/timeline.ts';

/** The textbook composition the closed-form local matrix must agree with. */
function naiveLocalMatrix(pose: typeof REST, pivot: [number, number]): Mat {
  const mul = (m: Mat, n: Mat): Mat => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const rad = (pose.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const t: Mat = [1, 0, 0, 1, pose.x, pose.y];
  const toPivot: Mat = [1, 0, 0, 1, pivot[0], pivot[1]];
  const rot: Mat = [cos, sin, -sin, cos, 0, 0];
  const skewX: Mat = [1, 0, Math.tan((pose.skewX * Math.PI) / 180), 1, 0, 0];
  const skewY: Mat = [1, Math.tan((pose.skewY * Math.PI) / 180), 0, 1, 0, 0];
  const scl: Mat = [pose.scaleX, 0, 0, pose.scaleY, 0, 0];
  const fromPivot: Mat = [1, 0, 0, 1, -pivot[0], -pivot[1]];
  return mul(mul(mul(mul(mul(mul(t, toPivot), rot), skewX), skewY), scl), fromPivot);
}

test('the local matrix equals translate·pivot·rotate·skew·scale·unpivot, with and without skew', () => {
  const poses = [
    { ...REST },
    { ...REST, rotate: 37, x: 12, y: -5, scaleX: 1.4, scaleY: 0.6 },
    { ...REST, rotate: -120, x: -30, y: 8, skewX: 15, skewY: -8, scaleX: 0.5, scaleY: 2 },
    { ...REST, rotate: 400, skewY: 30 },
  ];
  for (const pose of poses) {
    for (const pivot of [[0, 0], [100, 95], [-12.5, 40]] as [number, number][]) {
      const want = naiveLocalMatrix(pose, pivot);
      const got = localMatrix(pose, pivot);
      for (let i = 0; i < 6; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-9, `${JSON.stringify(pose)} @${pivot} [${i}]`);
    }
  }
});

test('a lazy frame answers exactly what a full frame answers, on demand and when walked', () => {
  const ch = character('lazy', { viewBox: [0, 0, 200, 200], duration: 1 }, () => {
    part('body', { pivot: [100, 100], transform: { rotate: -4, x: 3 } }, () => {
      circle({ cx: 100, cy: 100, r: 20, fill: '#000' });
      part('arm', { pivot: [110, 90] }, () => {
        part('hand', { pivot: [130, 90], contact: [140, 90] }, () => {
          circle({ cx: 135, cy: 90, r: 4, fill: '#000' });
        });
      });
      part('leg', { pivot: [100, 120] }, () => {
        circle({ cx: 100, cy: 140, r: 4, fill: '#000' });
      });
    });
  });
  ch.part('body').animate({ x: keys([[0, 0], [1, 40]]), rotate: sampled((t) => Math.sin(t * 6.28) * 10) });
  ch.part('body.arm').animate({ rotate: keys([[0, 0], [0.5, 60], [1, 0]]) });
  ch.part('body.arm.hand').animate({ rotate: keys([[0, 10], [1, -10]]), scaleX: keys([[0, 1], [1, 1.5]]) });

  for (const t of [0, 0.31, 0.5, 0.77, 1]) {
    const full = frameAt(ch, t);
    const lazy = lazyFrameAt(ch, t);
    const hand = ch.find('body.arm.hand')!;
    // A single lookup, before anything else, must not need the rest of the tree.
    assert.deepEqual(lazy.point(hand), full.point(hand));
    assert.deepEqual(lazy.matrices.get('body.leg'), full.matrices.get('body.leg'));
    assert.deepEqual(lazy.pose.get('body'), full.pose.get('body'));
    // Walking it is the whole frame, in the same order.
    assert.deepEqual([...lazy.matrices], [...full.matrices]);
    assert.deepEqual([...lazy.pose], [...full.pose]);
    assert.equal(lazy.matrices.size, full.matrices.size);
    assert.equal(lazy.matrices.get('nowhere'), undefined);
    assert.equal(lazy.matrices.has('nowhere'), false);
  }
});
