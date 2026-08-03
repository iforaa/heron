import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, clipPath, compile, keys, part, rasterise, rect, renderSheet, renderStatic,
} from '../src/index.ts';

test('a reusable clip path clips a complete animated part subtree', () => {
  const scene = character('reveal', { viewBox: [0, 0, 100, 20] }, () => {
    const leftHalf = clipPath('left-half', () => {
      rect({ x: 0, y: 0, w: 50, h: 20, fill: '#fff' });
    });
    part('art', { clip: leftHalf }, () => {
      rect({ x: 0, y: 0, w: 100, h: 20, fill: '#f00' });
      circle({ cx: 75, cy: 10, r: 8, fill: '#00f' });
    });
  });
  scene.part('art').animate({ x: keys([[0, 0], [1, -10]]) });

  const still = renderStatic(scene, 0);
  const built = compile(scene).svg;
  for (const svg of [still, built]) {
    assert.match(svg, /<clipPath id="left-half" clipPathUnits="userSpaceOnUse">/);
    assert.match(svg, /clip-path="url\(#left-half\)"/);
  }
  assert.match(built, /class="h-art" clip-path=/);

  const { rgba, width } = rasterise(still, 100, 20);
  const pixel = (x: number) => [...rgba.slice((10 * width + x) * 4, (10 * width + x) * 4 + 4)];
  assert.deepEqual(pixel(20).slice(0, 3), [255, 0, 0]);
  assert.deepEqual(pixel(80).slice(0, 3), [255, 255, 255]);
});

test('clip paths can use grouped ordinary geometry and sheets define them once', () => {
  const scene = character('portholes', { viewBox: [0, 0, 100, 50] }, () => {
    const windows = clipPath('windows', () => {
      part('geometry-only', () => {
        circle({ cx: 25, cy: 25, r: 15, fill: '#fff' });
        circle({ cx: 75, cy: 25, r: 15, fill: '#fff' });
      });
    }, { units: 'userSpaceOnUse' });
    part('sky', { clip: windows }, () => {
      rect({ x: 0, y: 0, w: 100, h: 50, fill: '#0cf' });
    });
  });

  const sheet = renderSheet(scene, [0, 0.5, 1]);
  assert.equal((sheet.match(/<clipPath id="windows"/g) ?? []).length, 1);
  assert.doesNotMatch(sheet, /h-geometry-only/, 'definition-only groups do not leak animation classes');
});

test('review sheets accept exact per-frame labels and reject a mismatched list', () => {
  const scene = character('labels', { viewBox: [0, 0, 20, 20] }, () => {
    circle({ cx: 10, cy: 10, r: 4, fill: '#000' });
  });
  const sheet = renderSheet(scene, [0, 0.5], { labels: ['#0000 · 0.000s', '#0001 · 0.500s'] });
  assert.match(sheet, /#0000 · 0.000s/);
  assert.match(sheet, /#0001 · 0.500s/);
  assert.throws(() => renderSheet(scene, [0, 0.5], { labels: ['one'] }), /2-frame sheet needs 2 labels/);
});

test('clip paths validate scope, identity and non-empty geometry', () => {
  assert.throws(() => clipPath('outside', () => {}), /inside character/);
  assert.throws(
    () => character('empty', { viewBox: [0, 0, 10, 10] }, () => clipPath('empty', () => {})),
    /cannot be empty/,
  );
  assert.throws(
    () => character('duplicate', { viewBox: [0, 0, 10, 10] }, () => {
      clipPath('cut', () => circle({ cx: 5, cy: 5, r: 5 }));
      clipPath('cut', () => rect({ x: 0, y: 0, w: 2, h: 2 }));
    }),
    /duplicate definition/,
  );
});
