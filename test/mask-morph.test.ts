import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, compile, easeIn, mask, part, path, pathAt, pathMorph,
  rasterise, rect, renderStatic,
} from '../src/index.ts';

test('painted masks support soft/luminance composition on part subtrees', () => {
  const scene = character('masked', { viewBox: [0, 0, 100, 20] }, () => {
    const reveal = mask('reveal', () => {
      rect({ x: 0, y: 0, w: 50, h: 20, fill: '#fff' });
      rect({ x: 50, y: 0, w: 50, h: 20, fill: '#000' });
    }, {
      mode: 'luminance',
      region: { x: 0, y: 0, width: 100, height: 20 },
    });
    part('art', { mask: reveal }, () => {
      rect({ x: 0, y: 0, w: 100, h: 20, fill: '#f00' });
      circle({ cx: 25, cy: 10, r: 4, fill: '#fff' });
    });
  });

  const svg = renderStatic(scene, 0);
  assert.match(svg, /<mask id="reveal"[^>]*mask-type="luminance"/);
  assert.match(svg, /x="0" y="0" width="100" height="20"/);
  assert.match(svg, /mask="url\(#reveal\)"/);

  const { rgba, width } = rasterise(svg, 100, 20);
  const rgb = (x: number) => [...rgba.slice((10 * width + x) * 4, (10 * width + x) * 4 + 3)];
  assert.deepEqual(rgb(20), [255, 0, 0]);
  assert.deepEqual(rgb(80), [255, 255, 255]);
});

test('compatible path commands interpolate in static frames and compiled CSS', () => {
  const morph = pathMorph([
    [0, 'M 10 10 L 30 10 L 30 30 L 10 30 Z', easeIn],
    [0.5, 'M 15 7.5 L 32.5 15 L 25 32.5 L 7.5 25 Z'],
    [1, 'M 20 5 L 35 20 L 20 35 L 5 20 Z'],
  ]);
  const expected = 'M 15 7.5 L 32.5 15 L 25 32.5 L 7.5 25 Z';
  assert.equal(pathAt(morph, 0.5), expected);

  const scene = character('morph', { viewBox: [0, 0, 40, 40], duration: 2, once: true }, () => {
    path({ d: morph, fill: '#08f' });
  });
  assert.match(renderStatic(scene, 0.5), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const { svg, animated } = compile(scene);
  assert.deepEqual(animated, ['.h-morph-0']);
  assert.match(svg, /class="h-morph-0"/);
  assert.match(svg, /@keyframes kf-morph-0/);
  assert.match(svg, /d: path\("M 20 5 L 35 20 L 20 35 L 5 20 Z"\)/);
  assert.match(svg, /animation-timing-function: ease-in/);
  assert.match(svg, /2s linear 1 forwards/);
});

test('path morphs validate topology rather than guessing correspondence', () => {
  assert.throws(() => pathMorph([[0, 'M0 0'], [0.5, 'M1 1']]), /start at 0 and end at 1/);
  assert.throws(
    () => pathMorph([[0, 'M0 0 L10 10'], [1, 'M0 0 C1 2 3 4 10 10']]),
    /incompatible commands/,
  );
  assert.throws(
    () => pathMorph([[0, 'M0 0 A10 10 0 0 1 20 0'], [1, 'M0 0 A20 20 0 0 1 40 0']]),
    /does not support arc commands/,
  );
});

test('masks validate scope, geometry and regions', () => {
  assert.throws(() => mask('outside', () => {}), /inside character/);
  assert.throws(
    () => character('empty', { viewBox: [0, 0, 10, 10] }, () => mask('empty', () => {})),
    /cannot be empty/,
  );
  assert.throws(
    () => character('region', { viewBox: [0, 0, 10, 10] }, () => {
      mask('bad', () => circle({ cx: 5, cy: 5, r: 5 }), {
        region: { x: 0, y: 0, width: 0, height: 10 },
      });
    }),
    /positive size/,
  );
});
