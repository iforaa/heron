/**
 * Two-bone IK is small geometry with expensive failure modes: a sign error or
 * world/local angle mix-up produces a plausible limb that misses its target.
 * These tests pose a real nested Heron rig and measure where its end arrived.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, keys, line, part, frameAt, reach, solveTwoBone, type Vec2,
} from '../src/index.ts';

const close = (a: number, b: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(a - b) <= epsilon, `${a} is not within ${epsilon} of ${b}`);

const pointClose = (a: Vec2, b: Vec2, epsilon = 1e-8) => {
  close(a[0], b[0], epsilon);
  close(a[1], b[1], epsilon);
};

function posedEnd(target: Vec2, lengths: [number, number], bend: 1 | -1): {
  actual: Vec2;
  solved: ReturnType<typeof solveTwoBone>;
} {
  const root: Vec2 = [140, 90];
  const [upperLength, lowerLength] = lengths;
  const joint: Vec2 = [root[0], root[1] + upperLength];
  const end: Vec2 = [root[0], joint[1] + lowerLength];
  const scene = character('ik', { viewBox: [-300, -300, 900, 900] }, () => {
    part('upper', { pivot: root }, () => {
      line({ from: root, to: joint, stroke: '#000', width: 4 });
      part('lower', { pivot: joint }, () => {
        line({ from: joint, to: end, stroke: '#000', width: 4 });
        circle({ cx: end[0], cy: end[1], r: 3, fill: '#000' });
      });
    });
  });
  const solved = solveTwoBone({ root, target, lengths, bend });
  scene.part('upper').animate({ rotate: keys([[0, solved.upper], [1, solved.upper]]) });
  scene.part('lower').animate({ rotate: keys([[0, solved.lower], [1, solved.lower]]) });
  const actual = frameAt(scene, 0).point(scene.find('lower')!, end);
  return { actual, solved };
}

test('two-bone IK reaches targets in every quadrant with local Heron angles', () => {
  for (const target of [
    [230, 170], [40, 180], [220, 20], [55, 15], [140, 245],
  ] as Vec2[]) {
    for (const bend of [1, -1] as const) {
      const { actual, solved } = posedEnd(target, [105, 85], bend);
      assert.equal(solved.status, 'reachable');
      assert.equal(solved.clamped, false);
      pointClose(actual, target);
      pointClose(solved.reached, target);
    }
  }
});

test('bend chooses the other valid joint without changing the reached point', () => {
  const root: Vec2 = [0, 0];
  const target: Vec2 = [0, 120];
  const left = solveTwoBone({ root, target, lengths: [90, 80], bend: 1 });
  const right = solveTwoBone({ root, target, lengths: [90, 80], bend: -1 });
  assert.ok(left.joint[0] < 0, `bend 1 put the joint at x=${left.joint[0]}`);
  assert.ok(right.joint[0] > 0, `bend -1 put the joint at x=${right.joint[0]}`);
  pointClose(left.reached, target);
  pointClose(right.reached, target);
});

test('unreachable targets clamp to the nearest boundary and say why', () => {
  const far = solveTwoBone({ root: [10, 20], target: [410, 20], lengths: [70, 50] });
  assert.equal(far.status, 'too-far');
  assert.equal(far.clamped, true);
  close(far.reach, 120);
  pointClose(far.reached, [130, 20]);
  pointClose(posedEnd([540, 90], [70, 50], 1).actual, [260, 90]);

  const near = solveTwoBone({ root: [10, 20], target: [14, 20], lengths: [90, 40] });
  assert.equal(near.status, 'too-close');
  assert.equal(near.clamped, true);
  close(near.reach, 50);
  pointClose(near.reached, [60, 20]);
});

test('a coincident target gives an exact, finite fully folded solution', () => {
  for (const bend of [1, -1] as const) {
    const solved = solveTwoBone({ root: [30, 40], target: [30, 40], lengths: [75, 75], bend });
    assert.equal(solved.status, 'reachable');
    assert.equal(solved.reach, 0);
    pointClose(solved.reached, [30, 40]);
    for (const value of [solved.upper, solved.lower, ...solved.joint]) {
      assert.ok(Number.isFinite(value), `coincident solve returned ${value}`);
    }
    const { actual } = posedEnd([140, 90], [75, 75], bend);
    pointClose(actual, [140, 90]);
  }
});

test('two-bone IK validates lengths and coordinates', () => {
  assert.throws(
    () => solveTwoBone({ root: [0, 0], target: [1, 1], lengths: [0, 2] }),
    /lengths must be finite numbers greater than zero/,
  );
  assert.throws(
    () => solveTwoBone({ root: [0, 0], target: [Number.NaN, 1], lengths: [1, 2] }),
    /target must contain finite coordinates/,
  );
});

function reachRig(): {
  scene: ReturnType<typeof character>;
  root: Vec2;
  end: Vec2;
  lengths: [number, number];
} {
  const root: Vec2 = [180, 210];
  const lengths: [number, number] = [120, 105];
  const joint: Vec2 = [root[0], root[1] + lengths[0]];
  const end: Vec2 = [root[0], joint[1] + lengths[1]];
  const scene = character('reach', { viewBox: [-100, -100, 800, 700] }, () => {
    part('carrier', { pivot: root }, () => {
      part('upper', { pivot: root }, () => {
        line({ from: root, to: joint, stroke: '#000', width: 5 });
        part('lower', { pivot: joint }, () => {
          line({ from: joint, to: end, stroke: '#000', width: 5 });
          circle({ cx: end[0], cy: end[1], r: 4 });
        });
      });
    });
  });
  return { scene, root, end, lengths };
}

test('reach() drives an animated world target without stretching the chain', () => {
  const { scene, end, lengths } = reachRig();
  const targetAt = (t: number): Vec2 => [
    320 + Math.cos(t * Math.PI * 2) * 42,
    260 + Math.sin(t * Math.PI * 2) * 55,
  ];
  const motion = reach(scene, {
    chain: ['upper', 'lower'],
    lengths,
    target: targetAt,
    bend: 1,
    samples: 160,
  });

  let worst = 0;
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const actual = frameAt(scene, t).point(scene.find('lower')!, end);
    const target = targetAt(t);
    worst = Math.max(worst, Math.hypot(actual[0] - target[0], actual[1] - target[1]));
    assert.equal(motion.at(t).solution.status, 'reachable');
  }
  assert.ok(worst < 1e-8, `animated reach missed by ${worst}`);
});

test('reach() layers over existing joint and ancestor motion', () => {
  const { scene, end, lengths } = reachRig();
  scene.part('carrier').animate({
    x: keys([[0, 0], [0.5, 35], [1, 0]]),
    rotate: keys([[0, -12], [0.5, 24], [1, -12]]),
  });
  scene.part('upper').animate({ rotate: keys([[0, 8], [0.5, -16], [1, 8]]) });
  scene.part('lower').animate({ rotate: keys([[0, 18], [0.5, 34], [1, 18]]) });
  const target: Vec2 = [315, 275];

  reach(scene, { chain: ['upper', 'lower'], lengths, target, bend: -1 });
  for (let i = 0; i <= 40; i++) {
    const actual = frameAt(scene, i / 40).point(scene.find('lower')!, end);
    pointClose(actual, target, 1e-8);
  }
});

test('reach() measures a crooked traced rest chain and gives target callbacks the frame', () => {
  const root: Vec2 = [100, 100];
  const joint: Vec2 = [104, 180];
  const upperLength = Math.hypot(joint[0] - root[0], joint[1] - root[1]);
  const lowerLength = 70;
  const end: Vec2 = [
    joint[0] + (joint[0] - root[0]) / upperLength * lowerLength,
    joint[1] + (joint[1] - root[1]) / upperLength * lowerLength,
  ];
  const scene = character('measured', { viewBox: [0, 0, 400, 400] }, () => {
    part('upper', { pivot: root }, () => {
      line({ from: root, to: joint, stroke: '#000' });
      part('lower', { pivot: joint }, () => line({ from: joint, to: end, stroke: '#000' }));
    });
    part('target', { pivot: [220, 170] }, () => circle({ cx: 220, cy: 170, r: 2 }));
  });
  let receivedFrame = false;
  reach(scene, {
    chain: ['upper', 'lower'], lengths: [upperLength, lowerLength], bend: 1,
    target: (_t, frame) => {
      receivedFrame = true;
      return frame.point(scene.find('target')!);
    },
  });
  pointClose(frameAt(scene, 0.37).point(scene.find('lower')!, end), [220, 170], 1e-8);
  assert.equal(receivedFrame, true);
});

test('reach() can follow a point carried by another animated part', () => {
  const marker: Vec2 = [340, 250];
  // The target must belong to the same character, so build a second rig with
  // the marker declared alongside the arm.
  const root: Vec2 = [150, 260];
  const chain: [number, number] = [130, 120];
  const joint: Vec2 = [root[0], root[1] + chain[0]];
  const chainEnd: Vec2 = [root[0], joint[1] + chain[1]];
  const tracked = character('tracked', { viewBox: [0, 0, 600, 600] }, () => {
    part('armUpper', { pivot: root }, () => {
      line({ from: root, to: joint, stroke: '#000' });
      part('armLower', { pivot: joint }, () => circle({ cx: chainEnd[0], cy: chainEnd[1], r: 2 }));
    });
    part('marker', { pivot: marker }, () => circle({ cx: marker[0], cy: marker[1], r: 5 }));
  });
  tracked.part('marker').animate({
    x: keys([[0, 0], [0.5, 34], [1, 0]]),
    y: keys([[0, 0], [0.5, -28], [1, 0]]),
  });
  reach(tracked, {
    chain: ['armUpper', 'armLower'],
    lengths: chain,
    target: { part: 'marker' },
    bend: 1,
  });

  for (let i = 0; i <= 40; i++) {
    const f = frameAt(tracked, i / 40);
    const actual = f.point(tracked.find('armLower')!, chainEnd);
    const target = f.point(tracked.find('marker')!, marker);
    pointClose(actual, target, 1e-8);
  }
});

test('reach() validates that the named parts form a standard Heron chain', () => {
  const { scene, lengths } = reachRig();
  assert.throws(
    () => reach(scene, { chain: ['lower', 'upper'], lengths, target: [200, 200] }),
    /is not inside/,
  );
  assert.throws(
    () => reach(scene, { chain: ['missing', 'lower'], lengths, target: [200, 200] }),
    /no upper part/,
  );
});
