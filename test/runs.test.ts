import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cutRun, joinRuns, measuredRun } from '../src/index.ts';

test('cutRun splits points and widths together at measured arc length', () => {
  const run = measuredRun([[0, 0], [10, 0], [10, 30]], [2, 4, 10]);
  const [a, b] = cutRun(run, 0.5);
  assert.deepEqual(a.points, [[0, 0], [10, 0], [10, 10]]);
  assert.deepEqual(a.widths, [2, 4, 6]);
  assert.deepEqual(b.points, [[10, 10], [10, 30]]);
  assert.deepEqual(b.widths, [6, 10]);
});

test('joinRuns finds endpoint orientation and reverses widths with points', () => {
  const a = measuredRun([[0, 0], [10, 0]], [1, 2]);
  const b = measuredRun([[20, 0], [10, 0]], [4, 3]);
  const joined = joinRuns(a, b);
  assert.deepEqual(joined.points, [[0, 0], [10, 0], [20, 0]]);
  assert.deepEqual(joined.widths, [1, 2, 4]);
});
