import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { frameAt, nodePose } from '../src/timeline.ts';

/**
 * `crane-golf.ts` reads the shipped app asset at authoring time, so it can only
 * be imported where the sibling app repository is checked out. Skipping keeps
 * the suite portable instead of failing on a machine that has only this repo.
 */
const PRODUCTION_LOGO = new URL(
  '../../tenfore_crane_rn_template/assets/images/crane-logo.svg', import.meta.url,
);
const available = existsSync(PRODUCTION_LOGO);

/**
 * The ring writes itself on with `draw`, which compiles to stroke-dashoffset
 * and therefore reveals strokes only. The three measured remnants are fills, so
 * a fill left inside the ring part is painted at full the moment the part turns
 * visible — however far away the pen still is. Two of them sit at the arcs'
 * start points and are correct there; the third sits at the far end of the
 * shorter arc and must wait for the pen to arrive.
 */
test('crane-golf holds the far ring remnant until the pen reaches it', { skip: !available }, async () => {
  const { craneGolf } = await import('../examples/crane-golf.ts');

  const opacityAt = (path: string, t: number): number => {
    const node = craneGolf.find(path);
    assert.ok(node, `expected a "${path}" part`);
    return nodePose(node, frameAt(craneGolf, t).pose.get(node.path!)).opacity;
  };

  // Nothing of the ring exists during the performance.
  assert.equal(opacityAt('ringGap', 0.5), 0);

  // The write-on has started and the arcs are visible, but the pen is still far
  // from the far remnant, so it must not have appeared yet.
  assert.equal(opacityAt('ringGap', 0.83), 0);
  assert.ok(opacityAt('ring', 0.83) > 0.9, 'the arcs should already be writing on');

  // The pen reaches it at t=0.8588; shortly after, it is fully laid down.
  assert.ok(opacityAt('ringGap', 0.88) > 0.99, 'the remnant should be down once the pen has passed');

  // And it dissolves with the rest of the reconstruction at the lockup.
  assert.ok(opacityAt('ringGap', 1) < 0.01, 'the remnant should dissolve into the production mark');
});
