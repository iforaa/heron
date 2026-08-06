import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { character, circle, part } from '../src/index.ts';
import { diffTakes, divergentTimes } from '../src/diff.ts';
import { renderOverlaySheet } from '../src/render.ts';
import { take } from './fixtures/diff-scene.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

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

test('heron diff reports the changed part and writes an overlay sheet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heron-diff-'));
  try {
    const out = join(dir, 'diff.svg');
    const run = spawnSync(process.execPath, [
      CLI, 'diff', 'test/fixtures/diff-a.ts', 'test/fixtures/diff-b.ts',
      '--fps', '4', '-n', '2', '-o', out, '--svg',
    ], { cwd: REPO, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /dot\s+rotate Δ20.0° at t=0.50/);
    assert.match(run.stdout, /\+ added: tail/);
    assert.match(readFileSync(out, 'utf8'), /#b9c2c9/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('heron diff --json carries the full report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heron-diff-json-'));
  try {
    const run = spawnSync(process.execPath, [
      CLI, 'diff', 'test/fixtures/diff-a.ts', 'test/fixtures/diff-b.ts',
      '--fps', '4', '-o', join(dir, 'diff.svg'), '--svg', '--json',
    ], { cwd: REPO, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.parts[0].path, 'dot');
    assert.equal(report.parts[0].deltas[0].channel, 'rotate');
    assert.equal(report.parts[0].deltas[0].series.length, report.frameCount);
    assert.deepEqual(report.added, ['tail']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('durationMismatch flags takes of different length, viewBoxMismatch stays false', () => {
  const a = character('a', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
    part('p', () => { circle({ cx: 5, cy: 5, r: 2, fill: '#000' }); });
  });
  const b = character('b', { viewBox: [0, 0, 100, 100], duration: 2 }, () => {
    part('p', () => { circle({ cx: 5, cy: 5, r: 2, fill: '#000' }); });
  });
  const report = diffTakes(a, b, { fps: 4 });
  assert.equal(report.durationMismatch, true);
  assert.equal(report.viewBoxMismatch, false);
});

test('viewBoxMismatch flags takes with different viewBoxes', () => {
  const a = character('a', { viewBox: [0, 0, 100, 100] }, () => {
    part('p', () => { circle({ cx: 5, cy: 5, r: 2, fill: '#000' }); });
  });
  const b = character('b', { viewBox: [0, 0, 200, 100] }, () => {
    part('p', () => { circle({ cx: 5, cy: 5, r: 2, fill: '#000' }); });
  });
  assert.equal(diffTakes(a, b, { fps: 4 }).viewBoxMismatch, true);
});

test('a once take extends the grid to hold the last frame at t=1', () => {
  const once = character('once', { viewBox: [0, 0, 100, 100], duration: 1, once: true }, () => {
    part('p', () => { circle({ cx: 5, cy: 5, r: 2, fill: '#000' }); });
  });
  const report = diffTakes(once, once, { fps: 4 });
  assert.equal(report.times.at(-1), 1);
});

test('removed parts are named without being diffed', () => {
  const report = diffTakes(take(10, true), take(10), { fps: 4 });
  assert.deepEqual(report.removed, ['tail']);
  assert.deepEqual(report.added, []);
});

// When two takes differ only by an added or removed part, no pose channel
// ever moves, so every grid instant ties at zero divergence. Array.sort is
// stable, so divergentTimes falls back to the grid's declared order and
// returns its first `count` instants rather than an arbitrary selection.
test('divergentTimes falls back to grid order when every instant ties', () => {
  const report = diffTakes(take(10), take(10, true), { fps: 4 });
  assert.ok(report.divergence.every((d) => d === 0), 'no pose channel moved');
  const top = divergentTimes(report, 2);
  assert.deepEqual(top, report.times.slice(0, 2));
});

test('heron diff refuses a single scene file', () => {
  const run = spawnSync(process.execPath, [
    CLI, 'diff', 'test/fixtures/diff-a.ts',
  ], { cwd: REPO, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /diff needs two scene files/);
});
