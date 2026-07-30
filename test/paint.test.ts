import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, compile, linearGradient, radialGradient, rasterise, rect,
  renderSheet, renderStatic,
} from '../src/index.ts';

test('gradient references compile into one self-contained SVG definition', () => {
  const scene = character('paint', { viewBox: [0, 0, 100, 20] }, () => {
    const sky = linearGradient('sky', {
      stops: [
        { at: 0, color: '#ff0000' },
        { at: 1, color: '#0000ff', opacity: 0.75 },
      ],
    });
    rect({ x: 0, y: 0, w: 100, h: 20, fill: sky });
  });

  for (const svg of [renderStatic(scene, 0), compile(scene).svg]) {
    assert.match(svg, /<linearGradient id="sky"/);
    assert.match(svg, /fill="url\(#sky\)"/);
    assert.match(svg, /stop-opacity="0.75"/);
  }

  const sheet = renderSheet(scene, [0, 0.5, 1]);
  assert.equal((sheet.match(/<linearGradient id="sky"/g) ?? []).length, 1);
  assert.equal((sheet.match(/fill="url\(#sky\)"/g) ?? []).length, 3);
});

test('linear gradients render as paint rather than a flat fallback', () => {
  const scene = character('spectrum', { viewBox: [0, 0, 100, 20] }, () => {
    const spectrum = linearGradient('spectrum', {
      stops: [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }],
    });
    rect({ x: 0, y: 0, w: 100, h: 20, fill: spectrum });
  });
  const { rgba, width } = rasterise(renderStatic(scene, 0), 100, 20);
  const pixel = (x: number) => [...rgba.slice((10 * width + x) * 4, (10 * width + x) * 4 + 4)];
  const left = pixel(5);
  const right = pixel(94);
  assert.ok(left[0] > left[2], `left side should be red: ${left}`);
  assert.ok(right[2] > right[0], `right side should be blue: ${right}`);
});

test('radial gradients expose focal coordinates, units, spread and transform', () => {
  const scene = character('radial', { viewBox: [0, 0, 20, 20] }, () => {
    const glow = radialGradient('glow', {
      units: 'userSpaceOnUse',
      spread: 'reflect',
      transform: 'rotate(12 10 10)',
      cx: 10,
      cy: 10,
      r: 8,
      fx: 7,
      fy: 8,
      stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#00f', opacity: 0 }],
    });
    circle({ cx: 10, cy: 10, r: 9, fill: glow, stroke: glow, width: 1 });
  });
  const svg = renderStatic(scene, 0);
  assert.match(svg, /<radialGradient[^>]*gradientUnits="userSpaceOnUse"/);
  assert.match(svg, /spreadMethod="reflect"/);
  assert.match(svg, /gradientTransform="rotate\(12 10 10\)"/);
  assert.match(svg, /fx="7" fy="8"/);
  assert.match(svg, /stroke="url\(#glow\)"/);
});

test('gradient definitions reject mistakes at construction time', () => {
  assert.throws(
    () => linearGradient('outside', { stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }] }),
    /inside character/,
  );
  assert.throws(
    () => character('bad', { viewBox: [0, 0, 10, 10] }, () => {
      linearGradient('bad name', { stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }] });
    }),
    /valid SVG id/,
  );
  assert.throws(
    () => character('bad', { viewBox: [0, 0, 10, 10] }, () => {
      radialGradient('g', { stops: [{ at: 0.8, color: '#000' }, { at: 0.2, color: '#fff' }] });
    }),
    /ascending order/,
  );
  assert.throws(
    () => character('bad', { viewBox: [0, 0, 10, 10] }, () => {
      linearGradient('same', { stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }] });
      radialGradient('same', { stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }] });
    }),
    /duplicate definition/,
  );
});
