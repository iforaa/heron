---
name: heron
description: Author, inspect, and deliver rigged SVG character or logo animation with measured geometry and an agent-readable feedback loop.
---

# Heron agent workflow

Heron’s product is the feedback loop. Do not infer that a scene works because it
compiled. Typecheck it, inspect delivered frames, read the motion measurements,
and lint on the delivery frame rate.

## Fast path

```bash
# Existing vector art: preserve it. Raster art: measure it.
heron import logo.svg -o logo.ts
heron trace logo.png -o logo.ts
heron match logo.ts logo.png --json

# Understand and rig the rest pose.
heron shapes logo.ts -o shapes.png
heron rig logo.ts -o logo.rig.json
heron inspect logo.ts -t 0 --json

# Review motion, then run the combined gate.
heron sheet logo.ts -n 8 -o sheet.png
heron curves logo.ts -t 0,0.25,0.5,0.75,1 --json
heron motion logo.ts --part body.foot --no-json
heron frames logo.ts -o frames --fps 30
heron check logo.ts --fps 30 --reference logo.png --json

# Deliver only after check is clean.
heron build logo.ts -o logo.svg --fps 30
```

`build` does not write an artifact when an error-level lint fails. Use
`--allow-errors` only when the reported condition is intentional and reviewed.

## Geometry intake

- Use `import` for SVG. It preserves source path data, group order, paint, and
  inherited transforms. Unsupported vector features are refused, not flattened
  silently.
- Use `trace` for raster references. Its named `RUNS.s0`, `RUNS.s1`, … are data;
  group those into anatomy without retyping coordinates.
- `cutRun(run, at)` splits at normalized arc length and interpolates the matching
  measured width. `joinRuns(a, b)` orients endpoints and moves widths with points.
- `rig` relates named runs to traced skeleton joints and prints candidate
  `cutRun(RUNS.name, at)` calls. It proposes cuts; it does not invent anatomy.
- `match` is the warrant that the rest pose still agrees with the reference.
  Grey is shared ink, red is missing scene ink, blue is extra scene ink.

Turn an assignment into a character with `rig()` — no hand-written module:

```ts
const [thigh, shin] = cutRun(RUNS.s4, 0.3812);   // from heron rig's suggestions
export const crane = rig('crane', { viewBox: [0, 0, 1024, 1024], duration: 2 }, {
  body:  { runs: [RUNS.s0, RUNS.s1], fill: INK },
  thigh: { runs: [thigh], parent: 'body', pivot: JOINTS[2], fill: INK },
  shin:  { runs: [shin],  parent: 'thigh', pivot: [402, 223], fill: INK },
});
```

A child part must state its pivot — the joint it rotates about. Re-tracing
regenerates RUNS; the assignment survives.

See [geometry metrology](docs/geometry-metrology.md) for interpreting match and
for choosing strokes, ribbons, paths, and arcs.

## Rig model

Nesting is the rig. Children inherit every parent transform. Pivots are absolute
coordinates in the authored rest-pose coordinate system.

```ts
import { character, part, line, circle } from '@heron/core';

const bird = character('bird', {
  viewBox: [0, 0, 240, 180], duration: 1.2, ground: 165,
}, () => {
  part('body', { pivot: [110, 90], transform: { x: 4, rotate: -2 } }, () => {
    circle({ cx: 110, cy: 90, r: 35, fill: '#eef3f6' });
    part('leg', { pivot: [100, 112] }, () => {
      line({ from: [100, 112], to: [100, 150], stroke: '#334', width: 5 });
      part('foot', { pivot: [100, 150], contact: [118, 164] }, () => {
        line({ from: [92, 164], to: [118, 164], stroke: '#334', width: 4 });
      });
    });
  });
});
```

Use `transform` on a part for static rest state. It supports `x`, `y`, `rotate`,
`skewX`, `skewY`, `scaleX`, `scaleY`, and `opacity`; it does not create fake
keyframes or pollute compile reports.

Part names may contain letters, digits, underscores, and hyphens. Dots are
reserved for rig paths. Duplicate siblings and ambiguous lookups are errors.

## Motion

Animatable channels are:

`rotate`, `x`, `y`, `skewX`, `skewY`, `scaleX`, `scaleY`, `opacity`, `draw`

Unknown channels, non-finite values, malformed key order, and invalid phase are
errors. Prefer `keys()` when motion can be authored exactly; use `sampled()` for
genuinely procedural curves.

```ts
import { keys, easeInOut, sampled } from '@heron/core';

bird.part('body').animate({
  x: keys([[0, 0, easeInOut], [0.5, 80, easeInOut], [1, 0]]),
  skewY: keys([[0, 0], [0.5, -5], [1, 0]]),
});
bird.part('body.leg').animate({
  rotate: sampled((t) => Math.sin(t * Math.PI * 2) * 18, 96),
});
```

Tracks on one part are layers, outermost first. Transform channels sharing one
layer must share timing to compile exactly; otherwise only that group is baked.
The compiler verifies rounded, serialized baked keys against `EPSILON` before it
certifies them.

## Films, beats, and cues

Use `score()` for sequential beats that cover a duration and `cueSheet()` for
overlapping film windows. Do not forge beat objects by hand.

```ts
const beats = score(scene, [['run', 1.4], ['skid', 0.45], ['hold', 0]]);
const stop = beats.span('skid', 'hold');
const earlySkid = beats.slice('skid', 0, 0.4);

scene.part('body').animate({
  x: beats.place('run', keys([[0, 0], [1, 400]])),
  rotate: beats.during('skid', spring({ swing: -12, damping: 24 })),
});
```

`within()`/`.place()` hold the channel’s first and last values outside the
window. Use `withinAdditive()` or `beats.additive()` for a separate layer that
ramps from neutral and returns to it; pass `neutral: 1` for scale/opacity and
leave the default 0 for translation/rotation/skew. For a procedural `Shape`
instead of an authored channel, `duringAdditive()` or `beats.duringAdditive()`
is the same ramp applied to `during()`'s input.

## World-space targets

`frameAt(scene, t).point(node, local?)` is the authoritative world-space
accessor. Target callbacks receive the same already-computed frame.

```ts
reach(scene, {
  chain: ['body.arm.upper', 'body.arm.upper.lower'],
  lengths: [72, 64],
  target: (_t, frame) => frame.point(scene.find('target')!),
  bend: 1,
});
```

`reach()` measures a crooked traced rest direction rather than requiring a
perfectly vertical chain. Apply it after base joint and target motion.

## What to inspect

- `snapshot`: one raster pose.
- `sheet`: relationships between selected poses.
- `frames`: every delivered frame, exact CFR timestamps, readable batches, and
  `frames.json` mapping every cell.
- `inspect --json`: transforms, contacts, world boxes, and one exact instant.
- `curves --json`: every animated channel’s range and exact values at several
  instants.
- `motion`: world trajectory, spacing, speed, holds, reversals, and clearance.
- `lint --json`: structural failures on the same frame clock as delivery.
- `diff old.ts new.ts`: what one edit changed: per part and channel, the peak
  delta and when (`dot  rotate Δ20.0° at t=0.50`), plus an overlay sheet of the
  most-diverged instants, old take grey under the new. `--json` for the full
  per-frame series. Run it after a tweak instead of re-reading whole sheets.
- `studio`: the real compiled CSS paused and scrubbed by animation delay.
- `variants`: fresh scene builds across a parameter grid.

For loops, first and last visual poses must close. Full rotations such as
0→−360 are a closed orientation. Films declared `once: true` may end elsewhere.

## Delivery contracts

- SVG is the primary verified backend.
- Lottie carries paths, hierarchy, transforms, opacity, draw, and timeline
  markers. It refuses unsupported clips, masks, gradients, skew, and morphs.
  Once-only scenes emit a warning because player looping must be configured
  with `loop: false` outside the JSON file. Deliver with `lottie --check`: it
  rasterizes representative frames through Skia Skottie and blocks the artifact
  when they differ from the SVG evaluator.
- Video and `frames` share exact encoder-frame timestamps.
- Path morphs must have identical command topology and cannot live inside a
  reusable mask or clip definition.

See [delivery and compatibility](docs/delivery.md) for backend limits and review
requirements.

## Handoff

Run `heron check scene.ts --fps <delivery fps> --json`. If a raster reference
exists, add `--reference reference.png`. Preserve its report with the review
artifacts. Every CLI command accepts `--json`; errors use `{ ok: false, error }`
instead of falling back to unstructured prose. `serializeScene()` provides versioned JSON-safe IR when another
process needs scene structure; procedural functions cross that boundary as
sampled data.
