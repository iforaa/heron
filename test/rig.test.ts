import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeRig, keys, measuredRun, rig } from '../src/index.ts';
import { renderStatic } from '../src/render.ts';
import { evaluate, nodePose } from '../src/timeline.ts';

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

const flat = measuredRun([[0, 0], [10, 0]], [2, 2]);           // constant width
const tapered = measuredRun([[10, 0], [10, 20], [20, 20]], [2, 3, 4]); // varying width

test('rig builds a nested character from an assignment', () => {
  const bird = rig('bird', { viewBox: [0, 0, 100, 100] }, {
    body: { runs: [flat], stroke: '#123456' },
    leg: { runs: [tapered], parent: 'body', pivot: [10, 0], fill: '#123456' },
  });
  assert.equal(bird.find('body.leg')?.path, 'body.leg');
  assert.deepEqual(bird.find('body.leg')?.pivot, [10, 0]);
  // The whole thing renders through the ordinary pipeline.
  const svg = renderStatic(bird, 0);
  assert.match(svg, /stroke="#123456"/);   // constant-width run became a stroke
  assert.match(svg, /fill="#123456"/);     // varying-width run became a ribbon fill
});

test('rig keeps declaration order as paint order among siblings', () => {
  const c = rig('order', { viewBox: [0, 0, 10, 10] }, {
    back: { runs: [flat], fill: '#aaa' },
    front: { runs: [flat], fill: '#bbb' },
  });
  const names = c.root.content.flatMap((i) => ('node' in i ? [i.node.name] : []));
  assert.deepEqual(names, ['back', 'front']);
});

test('rig refuses an unknown parent, a missing pivot, and a parent cycle', () => {
  assert.throws(
    () => rig('x', { viewBox: [0, 0, 10, 10] }, { a: { runs: [flat], parent: 'ghost', pivot: [0, 0] } }),
    /unknown parent "ghost"/,
  );
  assert.throws(
    () => rig('x', { viewBox: [0, 0, 10, 10] }, {
      a: { runs: [flat] }, b: { runs: [flat], parent: 'a' },
    }),
    /needs a pivot/,
  );
  assert.throws(
    () => rig('x', { viewBox: [0, 0, 10, 10] }, {
      a: { runs: [flat], parent: 'b', pivot: [0, 0] }, b: { runs: [flat], parent: 'a', pivot: [0, 0] },
    }),
    /cycle/,
  );
  assert.throws(
    () => rig('x', { viewBox: [0, 0, 10, 10] }, { a: { runs: [] } }),
    /at least one run/,
  );
});

test('a rigged character animates through the standard pipeline', () => {
  const bird = rig('bird', { viewBox: [0, 0, 100, 100], duration: 1 }, {
    body: { runs: [flat], fill: '#000' },
    leg: { runs: [tapered], parent: 'body', pivot: [10, 0], fill: '#000' },
  });
  bird.part('body.leg').animate({ rotate: keys([[0, 0], [0.5, 30], [1, 0]]) });
  const pose = nodePose(bird.find('body.leg')!, evaluate(bird, 0.5).get('body.leg'));
  assert.equal(pose.rotate, 30);
});
