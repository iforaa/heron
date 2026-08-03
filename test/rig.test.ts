import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeRig, measuredRun } from '../src/index.ts';

test('rig analysis names runs and proposes normalized cuts near measured joints', () => {
  const report = analyzeRig({
    neckLeg: measuredRun([[0, 0], [0, 20], [20, 20]], [2, 3, 4]),
  }, [[1, 15], [100, 100]]);
  assert.equal(report.runs[0].name, 'neckLeg');
  assert.equal(report.runs[0].length, 40);
  assert.deepEqual(report.runs[0].width, { min: 4, max: 8 });
  assert.equal(report.runs[0].cuts.length, 1);
  assert.ok(Math.abs(report.runs[0].cuts[0].at - 0.375) < 1e-9);
});
