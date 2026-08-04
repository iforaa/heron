import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { frameAt, nodePose, type Frame } from '../src/timeline.ts';

/**
 * `crane-golf.ts` reads the shipped app asset at authoring time, so it can only
 * be imported where the sibling app repository is checked out. Skipping keeps
 * the suite portable instead of failing on a machine that has only this repo.
 */
const PRODUCTION_LOGO = new URL(
  '../../tenfore_crane_rn_template/assets/images/crane-logo.svg', import.meta.url,
);
const available = existsSync(PRODUCTION_LOGO);

// Why the far remnant has its own reveal is explained at the `ringGap` part in
// examples/crane-golf.ts: `draw` reveals strokes only, and this fill sits at
// the far end of the shorter arc, so it must wait for the pen to arrive.
test('crane-golf holds the far ring remnant until the pen reaches it', { skip: !available }, async () => {
  const { craneGolf } = await import('../examples/crane-golf.ts');

  const opacityIn = (frame: Frame, path: string): number => {
    const node = craneGolf.find(path);
    assert.ok(node, `expected a "${path}" part`);
    return nodePose(node, frame.pose.get(node.path!)).opacity;
  };

  // Nothing of the ring exists during the performance.
  assert.equal(opacityIn(frameAt(craneGolf, 0.5), 'ringGap'), 0);

  // The write-on has started and the arcs are visible, but the pen is still far
  // from the far remnant, so it must not have appeared yet.
  const writing = frameAt(craneGolf, 0.83);
  assert.equal(opacityIn(writing, 'ringGap'), 0);
  assert.ok(opacityIn(writing, 'ring') > 0.9, 'the arcs should already be writing on');

  // Shortly after the pen reaches it, it is fully laid down.
  assert.ok(opacityIn(frameAt(craneGolf, 0.88), 'ringGap') > 0.99, 'the remnant should be down once the pen has passed');

  // And it dissolves with the rest of the reconstruction at the lockup.
  assert.ok(opacityIn(frameAt(craneGolf, 1), 'ringGap') < 0.01, 'the remnant should dissolve into the production mark');
});
