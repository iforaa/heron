# Rig Builder, Take Diff, and Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three improvements approved in `docs/superpowers/specs/2026-08-05-rig-diff-hygiene-design.md`: a runtime `rig()` builder that turns a traced-runs assignment into a `Character`, a `heron diff a.ts b.ts` instrument comparing two takes in pose space with an overlay sheet, and two hygiene items (`tsc` chained into `test`, `duringAdditive()`).

**Architecture:** Everything composes existing machinery. `rig()` (in `src/rig.ts`) drives `character()`/`part()`/`ribbon()`/`through()` from data. `diffTakes()` (new `src/diff.ts`) samples both takes with `evaluate()`/`nodePose()` on the `playbackTimes` grid; `renderOverlaySheet()` (in `src/render.ts`, next to the private `tile()` layout it reuses) draws take A grey under take B; a new CLI `diff` case wires them. `duringAdditive()` (in `src/score.ts`) samples a `Shape` into a local channel and delegates to `withinAdditive()`.

**Tech Stack:** TypeScript (Node 22, `node --test`, type-stripping — tests import `.ts` directly). No new dependencies.

## Global Constraints

- Run all commands from the repo root `/Users/igorkuznetsov/Documents/tenfore/heron`.
- Tests: `node --test test/<file>.test.ts` for one file; `pnpm test` for the suite; `pnpm typecheck` must stay clean.
- Commit messages: one short imperative line, no Co-Authored-By/Generated-with tags (repo convention).
- Error messages start with `heron: ` (existing convention).
- Comments explain *why*, essay style matching the codebase; no narrating-the-code comments.
- Never use `cd` chained with `&&`; run commands with the repo root as working directory.

---

### Task 1: Chain typecheck into the test script

**Files:**
- Modify: `package.json` (the `scripts.test` line)

**Interfaces:**
- Consumes: existing `tsc --noEmit` and `node --test` scripts.
- Produces: `pnpm test` fails on type errors. No API surface.

- [ ] **Step 1: Edit the script**

In `package.json`, change:

```json
"test": "node --test test/*.test.ts",
```

to:

```json
"test": "tsc --noEmit && node --test test/*.test.ts",
```

- [ ] **Step 2: Verify both halves run**

Run: `pnpm test 2>&1 | tail -8`
Expected: the `tsc` step runs first (no output on success), then the suite summary reports `pass 187` (or more), `fail 0`.

- [ ] **Step 3: Verify the chain actually gates**

Add a deliberate type error to any test file (e.g. append `const _x: number = 'no';` to `test/runs.test.ts`), run `pnpm test 2>&1 | head -5`, confirm it fails in `tsc` without running tests, then **revert the deliberate error** and re-run `pnpm typecheck` to confirm clean.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "gate the test suite on a clean typecheck"
```

---

### Task 2: duringAdditive()

**Files:**
- Modify: `src/score.ts` (new function after `withinAdditive`, ~line 440; new method on `Windows` next to `additive()`, ~line 167)
- Modify: `src/index.ts` (export next to `withinAdditive`, line 52)
- Test: `test/during-additive.test.ts` (create)

**Interfaces:**
- Consumes: `Beat`, `Shape`, `AdditiveOptions`, `withinAdditive(b, channel, o)`, module-private `validateBeat(b, name)` and `density(width)`, and `sampled(fn, samples)` from `./scene.ts` (already imported in score.ts).
- Produces: `duringAdditive(b: Beat, shape: Shape, o?: AdditiveOptions & { samples?: number }): Channel`, and `Windows.duringAdditive(name: string, shape: Shape, o?: AdditiveOptions & { samples?: number }): Channel`. Task 7 documents both.

- [ ] **Step 1: Write the failing test**

Create `test/during-additive.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { duringAdditive, withinAdditive, score, type Beat } from '../src/index.ts';
import { channelAt } from '../src/timeline.ts';

const beat: Beat = { name: 'sway', from: 0.2, to: 0.7, seconds: 1 };
const wave = (seconds: number, u: number) => Math.sin(u * Math.PI) * 10;

test('duringAdditive is neutral outside its beat and follows the shape inside', () => {
  const ch = duringAdditive(beat, wave, { neutral: 0 });
  assert.equal(channelAt(ch, 0), 0);
  assert.equal(channelAt(ch, 1), 0);
  assert.equal(channelAt(ch, 0.1), 0);
  // Mid-beat, past the default attack ramp, the shape's own value comes through.
  const mid = channelAt(ch, 0.45);
  assert.ok(mid > 8, `expected the sine peak region, got ${mid}`);
});

test('duringAdditive agrees with withinAdditive over the sampled shape', () => {
  const ch = duringAdditive(beat, wave, { neutral: 0, attack: 0.1, release: 0.1 });
  // The same shape, hand-sampled to a local channel, placed by withinAdditive.
  const local = { kind: 'fn' as const, fn: (u: number) => wave(u * beat.seconds, u), samples: 60 };
  const reference = withinAdditive(beat, local, { neutral: 0, attack: 0.1, release: 0.1 });
  for (const t of [0, 0.2, 0.3, 0.45, 0.6, 0.7, 1]) {
    assert.ok(Math.abs(channelAt(ch, t) - channelAt(reference, t)) < 1e-6, `diverged at t=${t}`);
  }
});

test('score windows can place a shape additively by beat name', () => {
  const beats = score(2, [['enter', 0.5], ['sway', 1], ['exit', 0]]);
  const ch = beats.duringAdditive('sway', wave, { neutral: 0 });
  assert.equal(channelAt(ch, 0), 0);
  assert.equal(channelAt(ch, 1), 0);
});

test('duringAdditive validates its beat like the rest of the family', () => {
  assert.throws(
    () => duringAdditive({ name: 'bad', from: 0.9, to: 0.1, seconds: 1 }, wave),
    /duringAdditive/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/during-additive.test.ts`
Expected: FAIL — `duringAdditive` is not exported.

- [ ] **Step 3: Implement**

In `src/score.ts`, directly after `withinAdditive` (its closing brace, ~line 440), add:

```ts
/**
 * Places a procedural shape inside a beat as a self-contained additive layer.
 *
 * `during()` and `within()` are one pair: shape in, channel in. `withinAdditive`
 * had no shape-taking twin, so a procedural gesture could not be layered without
 * hand-sampling it first. The shape is sampled in its own local time — seconds
 * first, exactly as `during()` hands them over — and the neutral-ramp policy is
 * withinAdditive's, written once.
 */
export function duringAdditive(
  b: Beat, shape: Shape, o: AdditiveOptions & { samples?: number } = {},
): Channel {
  validateBeat(b, 'duringAdditive');
  const { samples, ...additive } = o;
  const width = Math.max(1e-6, b.to - b.from);
  const local = sampled(
    (u: number) => shape(u * b.seconds, u),
    samples ?? shape.samples?.(b) ?? density(width),
  );
  return withinAdditive(b, local, additive);
}
```

(If `validateBeat` or `density` sit *below* this point in the file, function hoisting makes that fine — both are plain `function` declarations.)

In the `Windows` class, next to the existing `additive()` method (~line 165), add:

```ts
  /** Places a procedural shape as a self-contained additive layer, neutral outside. */
  duringAdditive(name: string, shape: Shape, o: AdditiveOptions & { samples?: number } = {}): Channel {
    return duringAdditive(this.at(name), shape, o);
  }
```

In `src/index.ts` line 52, add `duringAdditive` to the export list that already carries `withinAdditive`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/during-additive.test.ts`
Expected: PASS (4 tests). Also run `pnpm typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/score.ts src/index.ts test/during-additive.test.ts
git commit -m "add duringAdditive: place a shape as an additive layer"
```

---

### Task 3: rig() runtime builder

**Files:**
- Modify: `src/rig.ts` (append the builder below `analyzeRig`)
- Modify: `src/index.ts` (export `rig` and `RigPart` next to the line 151 runs exports)
- Test: `test/rig.test.ts` (extend)

**Interfaces:**
- Consumes: `character(name, opts, body)`, `part(name, opts, body)`, `ribbon(points, halfWidths, o)`, `through(points, o)`, `CharacterOptions`, `Vec2` from `./scene.ts`; `MeasuredRun` from `./runs.ts`.
- Produces:

```ts
export interface RigPart {
  runs: MeasuredRun[];
  parent?: string;
  pivot?: Vec2;
  contact?: Vec2;
  fill?: string;
  stroke?: string;
  opacity?: number;
}
export function rig(name: string, opts: CharacterOptions, assignment: Record<string, RigPart>): Character
```

Task 7 documents it in SKILL.md.

- [ ] **Step 1: Write the failing tests**

Append to `test/rig.test.ts`:

```ts
import { rig } from '../src/index.ts';
import { renderStatic } from '../src/render.ts';
// (merge these into the existing import lines from '../src/index.ts' if present)

const flat = measuredRun([[0, 0], [10, 0]], [2, 2]);           // constant width
const tapered = measuredRun([[10, 0], [10, 20], [20, 20]], [2, 3, 4]); // varying width

test('rig builds a nested character from an assignment', () => {
  const bird = rig('bird', { viewBox: [0, 0, 100, 100] }, {
    body: { runs: [flat], stroke: '#123456' },
    leg: { runs: [tapered], parent: 'body', pivot: [10, 0], fill: '#123456' },
  });
  assert.equal(bird.find('body.leg')?.path, 'body.leg');
  assert.deepEqual(bird.find('body.leg')?.pivot, [10, 0]);
  // The whole thing renders through the ordinary pipeline.
  const svg = renderStatic(bird, 0);
  assert.match(svg, /stroke="#123456"/);   // constant-width run became a stroke
  assert.match(svg, /fill="#123456"/);     // varying-width run became a ribbon fill
});

test('rig keeps declaration order as paint order among siblings', () => {
  const c = rig('order', { viewBox: [0, 0, 10, 10] }, {
    back: { runs: [flat], fill: '#aaa' },
    front: { runs: [flat], fill: '#bbb' },
  });
  const names = c.root.content.flatMap((i) => ('node' in i ? [i.node.name] : []));
  assert.deepEqual(names, ['back', 'front']);
});

test('rig refuses an unknown parent, a missing pivot, and a parent cycle', () => {
  assert.throws(
    () => rig('x', { viewBox: [0, 0, 10, 10] }, { a: { runs: [flat], parent: 'ghost', pivot: [0, 0] } }),
    /unknown parent "ghost"/,
  );
  assert.throws(
    () => rig('x', { viewBox: [0, 0, 10, 10] }, {
      a: { runs: [flat] }, b: { runs: [flat], parent: 'a' },
    }),
    /needs a pivot/,
  );
  assert.throws(
    () => rig('x', { viewBox: [0, 0, 10, 10] }, {
      a: { runs: [flat], parent: 'b', pivot: [0, 0] }, b: { runs: [flat], parent: 'a', pivot: [0, 0] },
    }),
    /cycle/,
  );
  assert.throws(
    () => rig('x', { viewBox: [0, 0, 10, 10] }, { a: { runs: [] } }),
    /at least one run/,
  );
});

test('a rigged character animates through the standard pipeline', () => {
  const bird = rig('bird', { viewBox: [0, 0, 100, 100], duration: 1 }, {
    body: { runs: [flat], fill: '#000' },
    leg: { runs: [tapered], parent: 'body', pivot: [10, 0], fill: '#000' },
  });
  bird.part('body.leg').animate({ rotate: keys([[0, 0], [0.5, 30], [1, 0]]) });
  const pose = nodePose(bird.find('body.leg')!, evaluate(bird, 0.5).get('body.leg'));
  assert.equal(pose.rotate, 30);
});
```

Add whatever imports the file does not already have (`keys` from `../src/index.ts`, `evaluate, nodePose` from `../src/timeline.ts`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/rig.test.ts`
Expected: FAIL — `rig` is not exported.

- [ ] **Step 3: Implement**

In `src/rig.ts`, extend the imports and append below `analyzeRig`:

```ts
import { type Character, type CharacterOptions, character, part, ribbon, through } from './scene.ts';
```

```ts
export interface RigPart {
  runs: MeasuredRun[];
  parent?: string;
  /** Required when parent is set: a child rotates about a joint, not nowhere. */
  pivot?: Vec2;
  contact?: Vec2;
  fill?: string;
  stroke?: string;
  opacity?: number;
}

/**
 * Builds a character directly from an assignment over measured runs.
 *
 * `trace` recovers geometry and `heron rig` suggests where to cut it, but the
 * judgement — which run is the thigh, which joint it hangs from — is the
 * author's. This is where that judgement is stated, as data rather than as a
 * hand-written module: re-tracing regenerates RUNS, the assignment survives,
 * and there is nothing to merge.
 */
export function rig(
  name: string, opts: CharacterOptions, assignment: Record<string, RigPart>,
): Character {
  const entries = Object.entries(assignment);
  if (!entries.length) throw new Error('heron: rig() needs at least one part');
  for (const [partName, spec] of entries) {
    if (!Array.isArray(spec.runs) || !spec.runs.length) {
      throw new Error(`heron: rig part "${partName}" needs at least one run`);
    }
    if (spec.parent !== undefined && !(spec.parent in assignment)) {
      throw new Error(`heron: rig part "${partName}" names unknown parent "${spec.parent}"`);
    }
    if (spec.parent !== undefined && spec.pivot === undefined) {
      throw new Error(
        `heron: rig part "${partName}" has a parent and therefore needs a pivot`
        + ' — heron rig <traced>.ts suggests cut points to use',
      );
    }
  }

  const children = new Map<string | undefined, string[]>();
  for (const [partName, spec] of entries) {
    const siblings = children.get(spec.parent) ?? [];
    siblings.push(partName);
    children.set(spec.parent, siblings);
  }

  const emitted = new Set<string>();
  const emit = (partName: string): void => {
    const spec = assignment[partName];
    emitted.add(partName);
    part(partName, { pivot: spec.pivot, contact: spec.contact }, () => {
      for (const run of spec.runs) {
        const shared = {
          ...(run.cap === 'butt' ? { cap: 'butt' as const } : {}),
          ...(run.closed ? { closed: true } : {}),
          ...(spec.opacity !== undefined ? { opacity: spec.opacity } : {}),
        };
        // The same rule trace applies when it emits source: a width profile that
        // actually varies is a ribbon, a flat one is the stroke it really is.
        if (run.widths.every((w) => w === run.widths[0])) {
          through(run.points, { stroke: spec.stroke ?? spec.fill ?? '#000', width: run.widths[0] * 2, ...shared });
        } else {
          ribbon(run.points, run.widths, { fill: spec.fill ?? '#000', ...shared });
        }
      }
      for (const child of children.get(partName) ?? []) emit(child);
    });
  };

  const built = character(name, opts, () => {
    for (const root of children.get(undefined) ?? []) emit(root);
  });

  // An entry whose parent chain never reaches the root is unreachable, and the
  // only way that happens with validated parent names is a cycle.
  const missed = entries.map(([n]) => n).filter((n) => !emitted.has(n));
  if (missed.length) {
    throw new Error(`heron: rig parts ${missed.join(', ')} form a parent cycle and never reach the root`);
  }
  return built;
}
```

If `through()`'s or `ribbon()`'s option types reject a field above (e.g. `opacity`), check `Fill`/`Stroke`/`RibbonOptions` in `src/scene.ts` and pass only what they accept — do not widen the scene types.

In `src/index.ts`, next to line 151 (`export { measuredRun, cutRun, joinRuns } from './runs.ts';`), add:

```ts
export { analyzeRig, rig } from './rig.ts';
export type { RigPart, RigReport, RigRunReport, RigCutSuggestion } from './rig.ts';
```

(If `analyzeRig`/report types are already exported elsewhere in the file, only add the missing names — no duplicates.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/rig.test.ts` then `pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/rig.ts src/index.ts test/rig.test.ts
git commit -m "add rig(): build a character from a runs assignment"
```

---

### Task 4: diffTakes() engine

**Files:**
- Create: `src/diff.ts`
- Modify: `src/index.ts` (export)
- Test: `test/diff.test.ts` (create)

**Interfaces:**
- Consumes: `Character` from `./scene.ts`; `evaluate`, `nodePose` from `./timeline.ts`; `playbackTimes` from `./delivery.ts`.
- Produces (Task 6's CLI consumes exactly these):

```ts
export interface ChannelDelta { channel: string; peak: number; at: number; series?: Array<[number, number]> }
export interface PartDiff { path: string; deltas: ChannelDelta[]; geometryChanged: boolean }
export interface DiffReport {
  fps: number; frameCount: number; times: number[];
  parts: PartDiff[];            // changed parts, sorted by peak delta desc
  unchanged: string[];
  added: string[]; removed: string[];
  durationMismatch: boolean;
  divergence: number[];         // summed |delta| per grid index, for picking sheet instants
}
export function diffTakes(a: Character, b: Character, o?: { fps?: number; series?: boolean }): DiffReport
export function divergentTimes(report: DiffReport, count: number): number[]
```

- [ ] **Step 1: Write the failing tests**

Create `test/diff.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { character, circle, keys, part } from '../src/index.ts';
import { diffTakes, divergentTimes } from '../src/diff.ts';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/diff.test.ts`
Expected: FAIL — `src/diff.ts` does not exist.

- [ ] **Step 3: Implement**

Create `src/diff.ts`:

```ts
/**
 * What one edit actually changed, part by part and instant by instant.
 *
 * The iteration loop is edit, render, judge — and judging from sheets means
 * re-reading every frame to find the difference. This instrument answers the
 * question directly, in pose space, on the same frame grid the viewer sees.
 * Geometry edits (a redrawn shape, a path morph) are not poses, so they are
 * reported as the fact "geometry changed" instead of being forced into a
 * number that would mean nothing.
 */

import type { Character, Node } from './scene.ts';
import { evaluate, nodePose } from './timeline.ts';
import { playbackTimes } from './delivery.ts';

export interface ChannelDelta {
  channel: string;
  peak: number;
  at: number;
  /** One [a, b] value pair per grid instant; present only when asked for. */
  series?: Array<[number, number]>;
}

export interface PartDiff {
  path: string;
  deltas: ChannelDelta[];
  geometryChanged: boolean;
}

export interface DiffReport {
  fps: number;
  frameCount: number;
  times: number[];
  parts: PartDiff[];
  unchanged: string[];
  added: string[];
  removed: string[];
  durationMismatch: boolean;
  /** Summed absolute delta across every part and channel, per grid index. */
  divergence: number[];
}

const POSE_CHANNELS = [
  'rotate', 'x', 'y', 'scaleX', 'scaleY', 'skewX', 'skewY', 'opacity', 'draw',
] as const;

/** A part's own geometry, stable across identical declarations. */
function ownShapes(node: Node): string {
  return JSON.stringify(node.content.flatMap((item) => ('shape' in item ? [item.shape] : [])));
}

function partsOf(ch: Character): Map<string, Node> {
  const out = new Map<string, Node>();
  for (const node of ch.nodes()) if (node.path) out.set(node.path, node);
  return out;
}

export function diffTakes(
  a: Character, b: Character, o: { fps?: number; series?: boolean } = {},
): DiffReport {
  const fps = o.fps ?? 60;
  // The longer take's grid, so neither take is sampled coarser than it plays.
  const times = playbackTimes(Math.max(a.duration, b.duration), fps);
  // A film holds its last frame, which the end-exclusive grid never shows.
  if ((a.once || b.once) && times[times.length - 1] < 1) times.push(1);

  const aParts = partsOf(a);
  const bParts = partsOf(b);
  const added = [...bParts.keys()].filter((p) => !aParts.has(p));
  const removed = [...aParts.keys()].filter((p) => !bParts.has(p));

  const aFrames = times.map((t) => evaluate(a, t));
  const bFrames = times.map((t) => evaluate(b, t));

  const parts: PartDiff[] = [];
  const unchanged: string[] = [];
  const divergence = times.map(() => 0);

  for (const [path, aNode] of aParts) {
    const bNode = bParts.get(path);
    if (!bNode) continue;
    const deltas: ChannelDelta[] = [];
    for (const channel of POSE_CHANNELS) {
      let peak = 0;
      let at = times[0];
      const series: Array<[number, number]> = [];
      times.forEach((t, i) => {
        const va = nodePose(aNode, aFrames[i].get(path))[channel];
        const vb = nodePose(bNode, bFrames[i].get(path))[channel];
        if (o.series) series.push([va, vb]);
        const d = Math.abs(vb - va);
        divergence[i] += d;
        if (d > peak) { peak = d; at = t; }
      });
      if (peak > 1e-9) deltas.push({ channel, peak, at, ...(o.series ? { series } : {}) });
    }
    deltas.sort((x, y) => y.peak - x.peak);
    const geometryChanged = ownShapes(aNode) !== ownShapes(bNode);
    if (deltas.length || geometryChanged) parts.push({ path, deltas, geometryChanged });
    else unchanged.push(path);
  }
  parts.sort((x, y) => (y.deltas[0]?.peak ?? 0) - (x.deltas[0]?.peak ?? 0));

  return {
    fps, frameCount: times.length, times, parts, unchanged, added, removed,
    durationMismatch: a.duration !== b.duration, divergence,
  };
}

/** The grid instants where the takes disagree most, back in time order. */
export function divergentTimes(report: DiffReport, count: number): number[] {
  return report.times
    .map((t, i) => ({ t, d: report.divergence[i] }))
    .sort((x, y) => y.d - x.d)
    .slice(0, Math.max(1, count))
    .map((e) => e.t)
    .sort((x, y) => x - y);
}
```

If `Node` is not exported from `./scene.ts` as a type, export it there (it already appears in exported signatures like `strokeLength(node: Node)`, so it almost certainly is).

In `src/index.ts`, add near the other instrument exports:

```ts
export { diffTakes, divergentTimes } from './diff.ts';
export type { DiffReport, PartDiff, ChannelDelta } from './diff.ts';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/diff.test.ts` then `pnpm typecheck`
Expected: PASS (6 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/diff.ts src/index.ts test/diff.test.ts
git commit -m "add diffTakes: pose-space comparison of two takes"
```

---

### Task 5: renderOverlaySheet()

**Files:**
- Modify: `src/render.ts` (new export after `renderSheet`, ~line 562)
- Modify: `src/index.ts` (export next to `renderSheet`, line ~105)
- Test: `test/diff.test.ts` (extend)

**Interfaces:**
- Consumes: private `tile()`, `nodeSvg`, `renderContext`, `definitionsSvg`, `prefixIds`, `block`, `SHEET_CELL`, `evaluate`, `Paint` — all already in `src/render.ts`'s scope.
- Produces: `renderOverlaySheet(under: Character, over: Character, times: number[], opts?: { cols?: number; cellWidth?: number }): string` — an SVG string. Task 6's CLI consumes it.

- [ ] **Step 1: Write the failing test**

Append to `test/diff.test.ts`:

```ts
import { renderOverlaySheet } from '../src/render.ts';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/diff.test.ts`
Expected: the new test FAILS — `renderOverlaySheet` is not exported.

- [ ] **Step 3: Implement**

In `src/render.ts`, after `renderSheet` (~line 562), add:

```ts
/**
 * Two takes of the same scene in one cell: the old one greyed and faded under,
 * the new one in its own ink on top. This is `heron diff`'s visual half — the
 * numbers say which part moved, the overlay says whether it moved well.
 *
 * The under-take's ids are prefixed so two characters' defs can share one
 * document, the same trick the variants sheet uses.
 */
export function renderOverlaySheet(
  under: Character,
  over: Character,
  times: number[],
  opts: { cols?: number; cellWidth?: number } = {},
): string {
  const underContext = renderContext(under);
  const overContext = renderContext(over);
  const grey: Paint = (shape) => {
    const attrs = { ...shape.attrs };
    if (attrs.fill !== undefined && attrs.fill !== 'none') attrs.fill = '#b9c2c9';
    if (attrs.stroke !== undefined && attrs.stroke !== 'none') attrs.stroke = '#b9c2c9';
    return { ...shape, attrs };
  };
  const cells = times.map((t) => ({
    label: `t=${t.toFixed(2)}`,
    body: block(
      prefixIds(nodeSvg(under.root, evaluate(under, t), '      ', grey, underContext, t, { fade: 0.55 }), 'was-'),
      nodeSvg(over.root, evaluate(over, t), '      ', undefined, overContext, t),
    ),
  }));
  return tile(over, cells, opts.cols ?? Math.min(4, times.length), opts.cellWidth ?? SHEET_CELL, {
    context: overContext,
    defs: block(
      prefixIds(definitionsSvg(under, '  ', underContext), 'was-'),
      definitionsSvg(over, '  ', overContext),
    ),
  });
}
```

Check `prefixIds(svg, prefix)`'s exact signature at `src/render.ts:197` before wiring — if the prefix argument differs (e.g. it derives its own), follow the variants sheet's usage as the precedent.

In `src/index.ts`, add `renderOverlaySheet` to the render exports around line 105.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/diff.test.ts` then `pnpm typecheck`
Expected: PASS (7 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/index.ts test/diff.test.ts
git commit -m "add renderOverlaySheet: two takes in one cell"
```

---

### Task 6: heron diff CLI command

**Files:**
- Modify: `src/cli.ts` (FLAGS table ~line 330; new case in the command switch, modelled on `case 'match'` at ~line 575; usage/help text if a command list is printed anywhere in the file)
- Create: `test/fixtures/diff-a.ts`, `test/fixtures/diff-b.ts`
- Test: `test/diff.test.ts` (extend with CLI tests)

**Interfaces:**
- Consumes: `diffTakes`, `divergentTimes` from `./diff.ts`; `renderOverlaySheet`, `sheetWidth` from `./render.ts`; existing CLI helpers `loadScene`, `resolveCharacter`, `write`, `toPng`, `num`.
- Produces: `heron diff a.ts b.ts [--fps N] [-n COUNT] [--cols N] [-o FILE] [--svg] [--json]`.

- [ ] **Step 1: Create the fixtures**

`test/fixtures/diff-a.ts`:

```ts
import { character, circle, keys, part } from '../../src/index.ts';

export const take = character('take', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
  part('dot', { pivot: [50, 50] }, () => {
    circle({ cx: 50, cy: 50, r: 10, fill: '#123' });
  });
});
take.part('dot').animate({ rotate: keys([[0, 0], [0.5, 10], [1, 0]]) });
```

`test/fixtures/diff-b.ts`: identical except the swing key is `[0.5, 30]` and after the `dot` part add:

```ts
  part('tail', () => {
    circle({ cx: 80, cy: 80, r: 3, fill: '#789' });
  });
```

(inside the `character` body, after the `dot` part).

- [ ] **Step 2: Write the failing CLI tests**

Append to `test/diff.test.ts` (reuse the `CLI`/`REPO` constants pattern from `test/frames.test.ts`; add the needed `node:` imports):

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

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

test('heron diff refuses a single scene file', () => {
  const run = spawnSync(process.execPath, [
    CLI, 'diff', 'test/fixtures/diff-a.ts',
  ], { cwd: REPO, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /diff needs two scene files/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/diff.test.ts`
Expected: the three CLI tests FAIL (unknown command `diff`).

- [ ] **Step 4: Implement the CLI case**

In `src/cli.ts`:

1. Imports: add `diffTakes, divergentTimes` from `'./diff.ts'` and `renderOverlaySheet` (plus `sheetWidth` if not already imported) from `'./render.ts'`.

2. FLAGS table (~line 330), add:

```ts
  diff: ['fps', 'n', 'cols', 'o', 'svg', 'json'],
```

3. New case, placed next to `case 'match'` (after the character `ch` is resolved at ~line 573, since diff uses `ch` as take A — the same slot `match` occupies):

```ts
  if (cmd === 'diff') {
    const otherFile = (args._ as string[])[2];
    if (!otherFile) throw new Error('heron: diff needs two scene files - the old take, then the new');
    const other = resolveCharacter(await loadScene(otherFile), otherFile);
    const fps = args.fps ? Math.trunc(num(args.fps, 60)) : 60;
    const report = diffTakes(ch, other, { fps, series: Boolean(args.json) });
    const count = args.n ? Math.trunc(num(args.n, 6)) : 6;
    const instants = divergentTimes(report, Math.min(count, report.frameCount));
    const cols = args.cols ? Math.trunc(num(args.cols, 3)) : Math.min(3, instants.length);
    const sheet = renderOverlaySheet(ch, other, instants, { cols });
    const out = String(args.o ?? (args.svg ? 'diff.svg' : 'diff.png'));
    if (args.svg) write(out, sheet);
    else write(out, toPng(sheet, sheetWidth(cols)));

    if (args.json) {
      console.log(JSON.stringify({ a: file, b: otherFile, sheet: out, ...report }, null, 2));
      return;
    }
    const unit = (channel: string) => (channel === 'rotate' || channel.startsWith('skew') ? '°' : '');
    console.log(`${ch.name} vs ${other.name}  ${report.frameCount} frames at ${report.fps}fps${report.durationMismatch ? '  (durations differ)' : ''}`);
    for (const p of report.parts) {
      const bits = p.deltas.map((d) => `${d.channel} Δ${d.peak.toFixed(1)}${unit(d.channel)} at t=${d.at.toFixed(2)}`);
      if (p.geometryChanged) bits.push('geometry changed');
      console.log(`  ${p.path}  ${bits.join('  ')}`);
    }
    if (report.unchanged.length) console.log(`  (${report.unchanged.length} part(s) unchanged)`);
    if (report.added.length) console.log(`  + added: ${report.added.join(', ')}`);
    if (report.removed.length) console.log(`  - removed: ${report.removed.join(', ')}`);
    console.log(`  ${out}  ${instants.length} most-diverged instant(s), old grey under new colour`);
    return;
  }
```

Match the surrounding code's structure exactly: if `match` lives as `if (cmd === 'match') {...}` before the `switch`, place `diff` beside it the same way; if usage text lists commands (search for a usage/help string near the top of `main`), add `diff` there with a one-line description.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/diff.test.ts` then `pnpm typecheck`
Expected: PASS (10 tests), typecheck clean. If the delta line's exact spacing differs from the regex, fix the test regex to match the actual (correct) output — the assertion's substance is part, channel, Δ20.0°, t=0.50.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts test/fixtures/diff-a.ts test/fixtures/diff-b.ts test/diff.test.ts
git commit -m "add heron diff: compare two takes with an overlay sheet"
```

---

### Task 7: Documentation and final verification

**Files:**
- Modify: `SKILL.md` (three insertions)
- Modify: `docs/superpowers/specs/2026-08-05-rig-diff-hygiene-design.md` (one corrected sentence)

**Interfaces:**
- Consumes: everything shipped in Tasks 2-6.
- Produces: agent-facing docs; no API.

- [ ] **Step 1: Document rig() in SKILL.md**

Read `SKILL.md` first. In the tracing/rigging section (near where `heron rig` and `cutRun` are described — search for `cutRun` or `RUNS`), add a compact example:

```md
Turn an assignment into a character with `rig()` — no hand-written module:

    const [thigh, shin] = cutRun(RUNS.s4, 0.3812);   // from heron rig's suggestions
    export const crane = rig('crane', { viewBox: [0, 0, 1024, 1024], duration: 2 }, {
      body:  { runs: [RUNS.s0, RUNS.s1], fill: INK },
      thigh: { runs: [thigh], parent: 'body', pivot: JOINTS[2], fill: INK },
      shin:  { runs: [shin],  parent: 'thigh', pivot: [402, 223], fill: INK },
    });

A child part must state its pivot — the joint it rotates about. Re-tracing
regenerates RUNS; the assignment survives.
```

Match the file's existing formatting conventions (it may use fenced code blocks rather than indentation — follow what's there).

- [ ] **Step 2: Document heron diff in SKILL.md**

In the instruments/commands section (near `heron lint` / `heron motion`), add:

```md
`heron diff old.ts new.ts` — what one edit changed: per part and channel, the
peak delta and when (`dot  rotate Δ20.0° at t=0.50`), plus an overlay sheet of
the most-diverged instants, old take grey under the new. `--json` for the full
per-frame series. Run it after a tweak instead of re-reading whole sheets.
```

- [ ] **Step 3: Document duringAdditive in SKILL.md**

Find the line mentioning `withinAdditive()` / `beats.additive()` (~line 130) and extend it to mention `duringAdditive()` / `beats.duringAdditive()` for procedural shapes.

- [ ] **Step 4: Correct the spec's during() sentence**

In `docs/superpowers/specs/2026-08-05-rig-diff-hygiene-design.md`, the hygiene section says duringAdditive resolves "its window through `during()`'s beat lookup" — `during()` takes a `Beat` object directly, there is no lookup. Rewrite that clause to: "taking a `Beat` and a procedural `Shape` exactly as `during()` does, sampling the shape locally and delegating the neutral-ramp policy to `withinAdditive()`; also available as `Windows.duringAdditive(name, shape, o)`."

- [ ] **Step 5: Full verification**

Run: `pnpm test` (which now typechecks first)
Expected: everything passes — around 200 tests, `fail 0`.

Then a live smoke test of the new instrument:

Run: `node src/cli.ts diff test/fixtures/diff-a.ts test/fixtures/diff-b.ts --fps 12 -o out/diff-smoke.png`
Expected: exit 0, a readable report naming `dot rotate Δ20.0°`, and `out/diff-smoke.png` exists (out/ is gitignored).

- [ ] **Step 6: Commit**

```bash
git add SKILL.md docs/superpowers/specs/2026-08-05-rig-diff-hygiene-design.md
git commit -m "document rig(), heron diff and duringAdditive"
```
