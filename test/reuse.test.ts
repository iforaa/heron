import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, line, part, rasterise, renderContext, renderStatic,
} from '../src/index.ts';

test('repeated translated primitives serialize as shared definitions and uses', () => {
  const scene = character('reuse', { viewBox: [0, 0, 100, 30] }, () => {
    part('dots', () => {
      for (let i = 0; i < 5; i++) circle({ cx: 10 + i * 20, cy: 10, r: 4, fill: '#08f' });
    });
    part('type-like-lines', () => {
      line({ from: [10, 22], to: [20, 22], stroke: '#111', width: 2 });
      line({ from: [40, 22], to: [50, 22], stroke: '#111', width: 2 });
    });
  });

  const context = renderContext(scene);
  assert.equal(context.symbols.length, 2);
  assert.equal(context.uses.size, 7);

  const svg = renderStatic(scene, 0);
  assert.equal((svg.match(/<circle /g) ?? []).length, 1);
  assert.equal((svg.match(/<line /g) ?? []).length, 1);
  assert.equal((svg.match(/<use /g) ?? []).length, 7);
  assert.match(svg, /<circle id="h-auto-0" cx="0" cy="0"/);
});

test('one-off primitives remain direct and repeated uses rasterize in place', () => {
  const scene = character('reuse raster', { viewBox: [0, 0, 60, 20] }, () => {
    circle({ cx: 10, cy: 10, r: 5, fill: '#f00' });
    circle({ cx: 30, cy: 10, r: 5, fill: '#f00' });
    circle({ cx: 50, cy: 10, r: 3, fill: '#00f' });
  });
  const svg = renderStatic(scene, 0);
  assert.equal((svg.match(/<use /g) ?? []).length, 2);
  assert.equal((svg.match(/<circle /g) ?? []).length, 2, 'one symbol and one unique direct circle');

  const { rgba, width } = rasterise(svg, 60, 20);
  const rgb = (x: number) => [...rgba.slice((10 * width + x) * 4, (10 * width + x) * 4 + 3)];
  assert.deepEqual(rgb(10), [255, 0, 0]);
  assert.deepEqual(rgb(30), [255, 0, 0]);
  assert.deepEqual(rgb(50), [0, 0, 255]);
});

test('authored definition names cannot collide with generated symbols', async () => {
  const { linearGradient } = await import('../src/index.ts');
  const scene = character('ids', { viewBox: [0, 0, 30, 10] }, () => {
    const fill = linearGradient('h-auto-0', {
      stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }],
    });
    circle({ cx: 5, cy: 5, r: 2, fill });
    circle({ cx: 15, cy: 5, r: 2, fill });
  });
  const svg = renderStatic(scene, 0);
  assert.match(svg, /linearGradient id="h-auto-0"/);
  assert.match(svg, /<circle id="h-auto-1"/);
});
