# Rig builder, take diff, and hygiene — design

Three improvements to the speed and quality of producing animation with Heron,
approved 2026-08-05. They are independent; each ships with its own tests.

## 1. `rig()` — runtime rig builder

**Problem.** `heron trace` recovers geometry as data (`RUNS` of `measuredRun`s,
candidate `JOINTS`), and `heron rig` reports where to cut runs at joints. But
turning an *assignment* — "this run, cut here, is the thigh, child of body" —
into a rigged `Character` still means hand-writing a module of `part()` and
`ribbon()` calls. That step is mechanical and should be one declarative call.

**API.** In `src/rig.ts`, exported from the index:

```ts
const [thigh, shin] = cutRun(RUNS.s4, 0.3812);   // from `heron rig` suggestions

export const crane = rig('crane', { viewBox: [0, 0, 1024, 1024], duration: 2 }, {
  body:  { runs: [RUNS.s0, RUNS.s1], fill: INK },
  thigh: { runs: [thigh], parent: 'body', pivot: JOINTS[2], fill: INK },
  shin:  { runs: [shin],  parent: 'thigh', pivot: [402, 223], fill: INK },
});
```

- `rig(name, options, assignment)` returns an ordinary `Character` built with
  the existing `character()`/`part()` machinery; `options` is the same object
  `character()` takes. Everything downstream — `animate`, scores, compile,
  lint, lottie, the instruments — works unchanged.
- Each assignment entry becomes a `part()` with the entry's key as its name
  (subject to the existing part-name validation).
- `parent: 'name'` nests the part under that entry. An unknown parent name or
  a parent cycle is an error naming the offending entries. Entries without a
  parent are children of the root.
- Declaration order is paint order among siblings, matching how `part()`
  bodies read.
- `pivot` is **required when `parent` is set**; the error message points the
  author at `heron rig`'s cut suggestions instead of silently guessing a
  joint. Without `parent`, `pivot` is optional and behaves exactly as in
  `part()`.
- Each `MeasuredRun` in `runs` renders using the same rules `trace` uses when
  it emits source: a run with a varying width profile becomes a `ribbon` over
  its points and widths, a constant-width run becomes a `through()` stroke at
  that width; caps and `closed` come from the run. Paint fields (`fill` for
  ribbons, stroke colour for constant-width runs) apply per entry.
- Re-tracing regenerates `RUNS`; the assignment is source and survives. There
  is no code generation and nothing to merge.

**Tests.** Hierarchy and paint order land in the built character; unknown
parent, cycle, and missing-pivot errors; a rigged character compiles and
animates through the standard pipeline.

## 2. `heron diff a.ts b.ts` — compare two takes

**Problem.** The iteration loop is edit → render → judge, and nothing today
answers "what did this tweak actually change?" textually. The agent re-reads
whole cue sheets to find out.

**Command.** `heron diff a.ts b.ts [--fps N] [-o diff.png] [--svg] [--json]`
in `src/diff.ts` plus a CLI case. Both files load as scenes; comparison
runs on the delivery frame grid (`playbackTimes`, same clock the viewer
sees), in normalized time.

**Comparison.** For every part path present in both scenes and every pose
channel (`rotate`, `x`, `y`, `scaleX`, `scaleY`, `skewX`, `skewY`, `opacity`,
`draw`), evaluate both takes at each grid instant and record the delta. The
report keys on the peak delta per part × channel and the instant it occurs.
Also reported:

- parts present in only one take (added/removed);
- a duration mismatch, when the two scenes disagree (the grid uses the finer
  of the two);
- geometry differences (per-part shape counts), because path morphs and
  redrawn shapes are geometry, not pose — the report says "geometry changed"
  rather than pretending a numeric delta exists. This limitation is printed,
  not hidden.

**Output.**

- Text: parts sorted by peak delta — `leg.shin  rotate Δ18.3° at t=0.42` —
  with unchanged parts collapsed to a single summary line.
- `--json`: the full per-frame series for every changed part × channel.
- Overlay sheet at the most-diverged instants (default `diff.png`, `-o` to
  move it, `--svg` for exact vectors): take A in grey under take B in colour,
  using the existing shared sheet layout and the batch rasterizer.

**Tests.** Two synthetic takes with a known injected difference: report finds
the right part, channel, magnitude, and instant; unchanged parts collapse;
added/removed parts and geometry changes surface; a CLI-level test in the
style of the existing command tests.

## 3. Hygiene

- `package.json`: `"test": "tsc --noEmit && node --test test/*.test.ts"` — the
  suite cannot pass on code that does not typecheck.
- `duringAdditive()` in `src/score.ts`, mirroring `withinAdditive()` exactly
  (same `neutral`/`attack`/`release` semantics and neutral ramps at both
  edges), taking a `Beat` and a procedural `Shape` exactly as `during()` does,
  sampling the shape locally and delegating the neutral-ramp policy to
  `withinAdditive()`; also available as `Windows.duringAdditive(name, shape,
  o)`. Exported next to `withinAdditive`; documented in SKILL.md where
  `withinAdditive` already appears.

**Tests.** `duringAdditive` agrees with `withinAdditive` when handed the beat
it names; unknown beat name errors like `during()` does.

## Out of scope

- Automatic pivot inference (nearest joint / nearest parent endpoint) — the
  explicit-pivot error keeps rigging honest; revisit only if it proves noisy.
- Diffing against git revisions or saved baselines — two explicit files was
  the chosen input model.
- Pixel-space diffing — pose space plus the overlay sheet covers the need
  without a new image-comparison metric.
