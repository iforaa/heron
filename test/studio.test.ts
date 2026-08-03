import { test } from 'node:test';
import assert from 'node:assert/strict';

import { character, circle, easeIn, keys, part, sampleCurves } from '../src/index.ts';

test('text curve data answers several exact instants and reports the whole range', () => {
  const scene = character('curves', { viewBox: [0, 0, 20, 20] }, () => {
    part('dot', () => circle({ cx: 5, cy: 5, r: 2 }));
  });
  scene.part('dot').animate({ x: keys([[0, 0, easeIn], [0.5, 10], [1, 0]]) });
  const [curve] = sampleCurves(scene, [0, 0.25, 0.5, 1]);
  assert.equal(curve.label, 'dot · x');
  assert.equal(curve.lo, 0);
  assert.equal(curve.hi, 10);
  assert.deepEqual(curve.values.slice(0, 1), [0]);
  assert.ok(curve.values[1] > 0 && curve.values[1] < 5, 'the exact eased midpoint is not linearized');
  assert.deepEqual(curve.values.slice(2), [10, 0]);
});
