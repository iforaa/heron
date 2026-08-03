import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

test('frames writes every playback frame in readable batches with a manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heron-frames-'));
  try {
    const run = spawnSync(process.execPath, [
      CLI, 'frames', 'examples/crane.ts', '-o', dir,
      '--fps', '4', '--per-sheet', '3', '--cols', '3', '--cell', '100', '--svg',
    ], { cwd: REPO, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /5 frame\(s\) at 4fps in 2 sheet\(s\)/);

    const manifest = JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8'));
    assert.equal(manifest.frameCount, 5);
    assert.equal(manifest.sheets.length, 2);
    assert.deepEqual(
      manifest.sheets.flatMap((sheet: { frames: Array<{ index: number }> }) =>
        sheet.frames.map((frame) => frame.index)),
      [0, 1, 2, 3, 4],
    );
    assert.equal(manifest.sheets[0].frames[2].column, 2);
    assert.equal(manifest.sheets[1].frames[0].cell, 0);
    assert.match(readFileSync(join(dir, 'frames-001.svg'), 'utf8'), /#0000 · 0.000s/);
    assert.match(readFileSync(join(dir, 'frames-002.svg'), 'utf8'), /#0004 · 1.000s/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('frames validates batch layout before rendering', () => {
  const run = spawnSync(process.execPath, [
    CLI, 'frames', 'examples/crane.ts', '--per-sheet', '0', '--svg',
  ], { cwd: REPO, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /--per-sheet must be an integer from 1 to 120/);
});

test('the CLI rejects misspelled flags and malformed numbers instead of using defaults', () => {
  const typo = spawnSync(process.execPath, [
    CLI, 'sheet', 'examples/crane.ts', '--colls', '3', '--svg', '-o', '/tmp/heron-typo.svg',
  ], { cwd: REPO, encoding: 'utf8' });
  assert.notEqual(typo.status, 0);
  assert.match(typo.stderr, /unknown flag --colls\. Did you mean --cols/);

  const malformed = spawnSync(process.execPath, [
    CLI, 'sheet', 'examples/crane.ts', '-n', 'nope', '--svg', '-o', '/tmp/heron-number.svg',
  ], { cwd: REPO, encoding: 'utf8' });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /expected a finite number/);

  const negative = spawnSync(process.execPath, [
    CLI, 'snapshot', 'examples/crane.ts', '-t', '-0.5', '--svg', '-o', '/tmp/heron-negative.svg',
  ], { cwd: REPO, encoding: 'utf8' });
  assert.notEqual(negative.status, 0);
  assert.match(negative.stderr, /-t must be from 0 to 1, got -0.5/);
});

test('build fails on lint errors unless explicitly allowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heron-build-gate-'));
  try {
    const blocked = spawnSync(process.execPath, [
      CLI, 'build', 'test/fixtures/bad-loop.ts', '-o', join(dir, 'blocked.svg'),
    ], { cwd: REPO, encoding: 'utf8' });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stdout, /ERROR \[loop-seam\]/);
    assert.equal(existsSync(join(dir, 'blocked.svg')), false, 'a failed gate must not write a shippable artifact');

    const allowed = spawnSync(process.execPath, [
      CLI, 'build', 'test/fixtures/bad-loop.ts', '-o', join(dir, 'allowed.svg'), '--allow-errors',
    ], { cwd: REPO, encoding: 'utf8' });
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Lottie real-player parity is a delivery gate and failed checks write nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heron-lottie-gate-'));
  try {
    const out = join(dir, 'loader.json');
    const run = spawnSync(process.execPath, [
      CLI, 'lottie', 'examples/crane-loader.ts', '-o', out,
      '--check', '-t', '0', '--min-overlap', '100', '--json',
    ], { cwd: REPO, encoding: 'utf8' });
    assert.notEqual(run.status, 0, run.stdout + run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.verification.renderer, 'Skia Skottie');
    assert.ok(report.verification.worstOverlap < 100);
    assert.equal(existsSync(out), false, 'failed real-player parity must not leave a deliverable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
