import { test } from 'node:test';
import assert from 'node:assert/strict';

import { importSvgSource } from '../src/index.ts';

test('SVG intake preserves paths, order, named groups, paint and inherited transforms', () => {
  const result = importSvgSource(`
    <svg viewBox="10 20 200 100" fill="#123456">
      <title>Accessible logo</title><desc>A bird mark</desc>
      <g id="bird-body" transform="translate(4 5)">
        <path d="M10 20 C30 0 50 40 70 20 Z"/>
        <g id="eye" opacity="0.5" transform="rotate(12 30 20)">
          <circle cx="30" cy="20" r="4" fill="#fff"/>
        </g>
      </g>
    </svg>
  `, { name: 'logo', importFrom: '../src/index.ts' });

  assert.deepEqual(result.viewBox, [10, 20, 200, 100]);
  assert.equal(result.parts, 2);
  assert.equal(result.shapes, 2);
  assert.match(result.source, /part\("bird-body"/);
  assert.match(result.source, /part\("eye"/);
  assert.match(result.source, /M10 20 C30 0 50 40 70 20 Z/);
  assert.ok(result.source.indexOf('svgShape("path"') < result.source.indexOf('part("eye"'));
  assert.match(result.source, /translate\(4 5\) rotate\(12 30 20\)/);
  assert.match(result.source, /"opacity":"0.5"/);
});

test('SVG intake refuses vector features it cannot preserve', () => {
  assert.throws(
    () => importSvgSource('<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs></svg>'),
    /<defs> is not yet supported/,
  );
});
