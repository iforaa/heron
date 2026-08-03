import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shapeBox, shapeLength } from '../src/index.ts';

test('raw SVG polylines participate in bounds and keep their path open', () => {
  const polyline = { tag: 'polyline', attrs: { points: '0,0 3,4 6,4', 'stroke-width': 2 } };
  assert.deepEqual(shapeBox(polyline), { x0: -1, y0: -1, x1: 7, y1: 5 });
  assert.equal(shapeLength(polyline), 8);

  const polygon = { ...polyline, tag: 'polygon' };
  assert.equal(shapeLength(polygon), 8 + Math.hypot(6, 4));
});
