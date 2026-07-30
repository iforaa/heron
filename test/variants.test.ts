import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  character, circle, clipPath, grid, keys, part, prefixIds, renderStatic, renderVariantSheet,
  seeded, type Character, type Variant,
} from '../src/index.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

/** Runs the CLI the way the repo's own scripts do: node, on the .ts, from the root. */
function heron(...argv: string[]): { status: number | null; said: string } {
  const run = spawnSync(process.execPath, [CLI, ...argv], { cwd: REPO, encoding: 'utf8' });
  return { status: run.status, said: run.stdout + run.stderr };
}

const AXES = { ride: [8, 14, 20], delay: [0.04, 0.08] };

/** A dot whose size is the varied parameter, so a cell's identity is visible in it. */
function dot(p: Variant<typeof AXES>): Character {
  const scene = character('dot', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
    part('mark', { pivot: [50, 50] }, () => circle({ cx: 50, cy: 50, r: p.ride, fill: '#333' }));
  });
  scene.part('mark').animate({ y: keys([[0, 0], [0.5, p.ride], [1, 0]]) });
  return scene;
}

test('combinations are the full product, in declaration order with the first axis slowest', () => {
  const set = grid(dot, AXES);
  assert.equal(set.combinations.length, 6);
  assert.deepEqual(
    set.combinations.map((c) => c.label),
    [
      'ride=8 delay=0.04', 'ride=8 delay=0.08',
      'ride=14 delay=0.04', 'ride=14 delay=0.08',
      'ride=20 delay=0.04', 'ride=20 delay=0.08',
    ],
  );
  // The last axis is what a row of the sheet walks, so it is what `--cols` follows.
  assert.equal(set.columns, 2);
  assert.equal(set.describe(), 'ride (3) x delay (2)');
});

test('the base is the first value of every axis, and every index is its own seed', () => {
  const set = grid(dot, AXES);
  assert.equal(set.base.label, 'ride=8 delay=0.04');
  assert.equal(set.base.index, 0);

  // Stable across calls: a grid re-rendered tomorrow must be the same grid, or two
  // sheets of the same scene cannot be compared.
  const again = grid(dot, AXES);
  assert.deepEqual(
    set.combinations.map((c) => c.seed),
    again.combinations.map((c) => c.seed),
  );
  assert.equal(new Set(set.combinations.map((c) => c.seed)).size, 6);
  // And the seeds actually separate the streams they are handed to.
  assert.notEqual(seeded(set.combinations[0].seed)(), seeded(set.combinations[1].seed)());
});

test('an empty axis is refused rather than silently dropped', () => {
  assert.throws(() => grid(dot, { ride: [] as number[], delay: [1] }), /axis "ride"/);
});

test('--only selects by text, and names the axes when asked for one that is not there', () => {
  const set = grid(dot, AXES);
  assert.deepEqual(set.select(['ride=14']).map((c) => c.label), [
    'ride=14 delay=0.04', 'ride=14 delay=0.08',
  ]);
  assert.equal(set.select(['ride=14', 'delay=0.08']).length, 1);
  assert.equal(set.select(['ride=99']).length, 0);
  assert.throws(() => set.select(['amplitude=3']), /no variant axis "amplitude".*ride, delay/s);
  assert.throws(() => set.select(['ride']), /axis=value/);

  // `plan` is where the refusals live, so the CLI hands it the flag and nothing else.
  assert.equal(set.plan([]).length, 6);
  assert.equal(set.plan(['ride=14']).length, 2);
  assert.throws(() => set.plan(['ride=99']), /no combination matches.*ride \(3\) x delay \(2\)/s);
});

test('one factory built twice gives the same scene, so N builds are independent', () => {
  const set = grid(dot, AXES);
  // The load-bearing assumption of the whole feature: `character()`'s stack
  // save/restore means a second build is not contaminated by the first, and
  // `animate` pushing a layer per call does not accumulate across builds.
  const once = renderStatic(set.build(set.base), 0.25);
  const twice = renderStatic(set.build(set.base), 0.25);
  assert.equal(once, twice);
});

test('an empty prefix changes nothing, so existing output cannot move', () => {
  const svg = renderStatic(grid(dot, AXES).build(grid(dot, AXES).base), 0.3);
  assert.equal(prefixIds(svg, ''), svg);
});

/** A scene whose clip radius is the varied parameter: the exact id collision. */
const CLIP_AXES = { aperture: [10, 45] };

function iris(p: Variant<typeof CLIP_AXES>): Character {
  return character('iris', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
    const hole = clipPath('aperture', () => circle({ cx: 50, cy: 50, r: p.aperture }));
    part('lit', { pivot: [50, 50], clip: hole }, () => {
      circle({ cx: 50, cy: 50, r: 48, fill: '#c33' });
    });
  });
}

test('each build gets its own ids, so a varied clip is not shared with cell 0', () => {
  const set = grid(iris, CLIP_AXES);
  const builds = set.combinations.map((params) => set.build(params));

  // Unprefixed, both builds really do collide — this is the defect, asserted so
  // the fix below cannot be mistaken for a scene that never had the problem.
  const bare = builds.map((ch) => renderStatic(ch, 0));
  assert.ok(bare.every((s) => s.includes('id="aperture"')));
  assert.ok(bare[0].includes('r="10"') && bare[1].includes('r="45"'));

  const sheet = renderVariantSheet(
    set.combinations.map((params, i) => ({
      label: params.label, ch: builds[i], times: [0],
    })),
    { cols: 2 },
  );

  // Both radii survive into the one document...
  assert.ok(sheet.includes('r="10"'), 'the first build\'s clip radius is missing');
  assert.ok(sheet.includes('r="45"'), 'the second build\'s clip radius is missing');
  // ...under distinct ids, each referenced by its own cell and nothing else.
  assert.match(sheet, /id="v0-aperture"/);
  assert.match(sheet, /id="v1-aperture"/);
  assert.match(sheet, /clip-path="url\(#v0-aperture\)"/);
  assert.match(sheet, /clip-path="url\(#v1-aperture\)"/);
  assert.equal((sheet.match(/id="aperture"/g) ?? []).length, 0, 'an unprefixed id survived');
});

test('a strip lays its frames out along the cell without overlapping them', () => {
  const set = grid(dot, AXES);
  const sheet = renderVariantSheet(
    [{ label: set.base.label, ch: set.build(set.base), times: [0, 0.25, 0.5] }],
    { cols: 1 },
  );
  // Three frames, the second and third shifted by whole scene widths.
  assert.match(sheet, /translate\(100 0\)/);
  assert.match(sheet, /translate\(200 0\)/);
  assert.match(sheet, /viewBox="0 0 300 100"/);
});

test('a factory-only module still answers every other command', () => {
  // `resolveCharacter` builds the base, so `lint` (and `sheet`, `build`, `video`)
  // keep working on a scene that exports a grid instead of a Character.
  const run = heron('lint', 'examples/crane-takes.ts');
  assert.equal(run.status, 0, run.said);
  assert.doesNotMatch(run.said, /does not export a Character/);
});

test('too many builds is refused, naming the axes rather than sampling them', () => {
  const run = heron('variants', 'test/fixtures/too-many.ts');
  assert.notEqual(run.status, 0);
  assert.match(run.said, /36 builds is more than 25/);
  assert.match(run.said, /a \(6\) x b \(6\)/);
  assert.match(run.said, /--only/);
});
