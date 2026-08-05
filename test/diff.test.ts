import { test } from 'node:test';
import assert from 'node:assert/strict';

import { character, circle, keys, part } from '../src/index.ts';
import { diffTakes, divergentTimes } from '../src/diff.ts';
import { renderOverlaySheet } from '../src/render.ts';

const take = (swing: number, extra = false) => {
  const c = character('take', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
    part('dot', { pivot: [50, 50] }, () => {
      circle({ cx: 50, cy: 50, r: 10, fill: '#123' });
    });
    part('still', () => {
      circle({ cx: 20, cy: 20, r: 4, fill: '#456' });
    });
    if (extra) part('tail', () => { circle({ cx: 80, cy: 80, r: 3, fill: '#789' }); });
  });
  c.part('dot').animate({ rotate: keys([[0, 0], [0.5, swing], [1, 0]]) });
  return c;
};

test('diffTakes finds the changed part, channel, magnitude and instant', () => {
  const report = diffTakes(take(10), take(30), { fps: 4 });
  assert.equal(report.parts.length, 1);
  assert.equal(report.parts[0].path, 'dot');
  const delta = report.parts[0].deltas[0];
  assert.equal(delta.channel, 'rotate');
  assert.ok(Math.abs(delta.peak - 20) < 1e-9, `peak ${delta.peak}`);
  assert.equal(delta.at, 0.5);
  assert.ok(report.unchanged.includes('still'));
  assert.equal(report.durationMismatch, false);
});

test('identical takes are entirely unchanged', () => {
  const report = diffTakes(take(10), take(10), { fps: 4 });
  assert.equal(report.parts.length, 0);
  assert.deepEqual(report.added, []);
  assert.deepEqual(report.removed, []);
});

test('added and removed parts are named, not diffed', () => {
  const report = diffTakes(take(10), take(10, true), { fps: 4 });
  assert.deepEqual(report.added, ['tail']);
  assert.deepEqual(report.removed, []);
});

test('geometry changes are flagged rather than faked into a number', () => {
  const a = character('g', { viewBox: [0, 0, 10, 10] }, () => {
    part('p', () => { circle({ cx: 5, cy: 5, r: 2, fill: '#000' }); });
  });
  const b = character('g', { viewBox: [0, 0, 10, 10] }, () => {
    part('p', () => { circle({ cx: 5, cy: 5, r: 4, fill: '#000' }); });
  });
  const report = diffTakes(a, b, { fps: 4 });
  assert.equal(report.parts[0]?.path, 'p');
  assert.equal(report.parts[0]?.geometryChanged, true);
  assert.deepEqual(report.parts[0]?.deltas, []);
});

test('series comes only when asked, one [a, b] pair per grid instant', () => {
  const bare = diffTakes(take(10), take(30), { fps: 4 });
  assert.equal(bare.parts[0].deltas[0].series, undefined);
  const full = diffTakes(take(10), take(30), { fps: 4, series: true });
  assert.equal(full.parts[0].deltas[0].series?.length, full.frameCount);
});

test('divergentTimes ranks instants by total delta and returns them in time order', () => {
  const report = diffTakes(take(10), take(30), { fps: 4 });
  const top = divergentTimes(report, 2);
  assert.equal(top.length, 2);
  assert.ok(top[0] < top[1], 'chronological order');
  assert.ok(top.includes(0.5), 'the peak instant is in the selection');
});

test('renderOverlaySheet draws the old take grey under the new take', () => {
  const svg = renderOverlaySheet(take(10), take(30), [0.25, 0.5]);
  assert.match(svg, /^<svg /);
  assert.match(svg, /t=0.50/);
  // The under-take is recoloured grey; the over-take keeps its own ink.
  assert.match(svg, /#b9c2c9/);
  assert.match(svg, /#123/);
  // Two cells, each holding both takes: the dot's circle appears four times.
  const circles = svg.match(/<circle /g) ?? [];
  assert.ok(circles.length >= 4, `expected two takes in two cells, saw ${circles.length} circles`);
});
