# Heron — Plan

> Status note (August 2026): this is the founding design record, not the current
> command reference. Several original exclusions were deliberately revisited
> after the evaluator and verification instruments made thin output adapters
> safe. The decisions are recorded in §2; use `SKILL.md` and `docs/delivery.md`
> for the shipped workflow and compatibility contract.

A TypeScript library that compiles animation code into a **self-contained animated SVG file**,
designed so that an AI agent can author, inspect, and iterate on character animation without a
human touching a mouse.

---

## 1. Why this exists

The origin: a coding agent was asked to animate an SVG heron icon so it would walk. It failed —
repeatedly. Two root causes, both structural:

1. **No semantics.** The icon was a single merged `<path>`. There is no "leg" to rotate. Nothing
   in the file says where a joint is. The agent has geometry, not anatomy.
2. **No feedback.** The agent writes keyframes blind. It never sees the result, so it cannot tell
   a good walk cycle from a bird having a seizure. Humans animate by looking; agents were not
   given eyes.

Everything in this plan follows from attacking exactly those two problems and nothing else.

## 2. Scope

**In:** one npm package. Input is TypeScript code declaring a character (named parts, hierarchy,
pivots) and a timeline. Output is one `.svg` file with CSS `@keyframes` inside it, playable in any
browser, `<img>` tag, or GitHub README. Plus a CLI that lets an agent see and measure what it made.

**Founding exclusions and their current disposition:**

| Not doing | Why |
| --- | --- |
| Rust render core | Still out. Resvg is isolated at the process boundary where a native panic could otherwise lose a batch. |
| Video / mp4 / ffmpeg pipeline | Shipped as a thin edge adapter over the verified evaluator. It shares the exact CFR clock with `frames` and adds no animation semantics. |
| Lottie export | Shipped as a constrained second compiler. Unsupported semantics are refused, property parity is tested, and `lottie --check` replays real Skottie rasters against the SVG evaluator. |
| Interactivity runtime / state machines | Would require shipping JS alongside output, killing the "plain file that works forever" property. |
| Preview studio (Vite app, scrubber) | The Vite application remains out. What shipped is one dependency-free HTML artifact that scrubs the real compiled CSS; its curve data is also exposed as CLI text/JSON. |
| Real 3D, shaders, video layers, audio sync | Out of format. |
| Path (`d`) morphing | Shipped as an explicitly compatibility-gated SVG feature. The compiler warns that the target browser set must be verified and masks/clips refuse morphs. It is not part of the cross-browser scalar parity claim. |

**Why this scope is defensible:** the output outlives the tool. If the project is abandoned
tomorrow, every SVG it ever produced keeps working, forever, with zero dependencies. That is an
honest promise for a solo open-source project, and it is the reason to prefer this shape over the
larger platform version.

## 3. The flow

```
crane.png ──▶ agent looks at it (vision)
              │
              ▼
         writes crane.ts   ── character(), layer(), part(), pivots
              │
              ├──▶ heron snapshot / inspect ──▶ looks like the reference? ──┐
              │◀───────────────── iterate ──────────────────────────────────┘
              ▼
         adds timeline     ── keyframes, phases, loop
              │
              ├──▶ heron sheet / lint ──▶ does the walk look right? ────────┐
              │◀───────────────── iterate ──────────────────────────────────┘
              ▼
         heron build ──▶ crane-walking.svg
```

**The PNG remains the reference authority, but can now also seed measured geometry.** `trace`
recovers named centreline runs and width profiles; `rig` proposes topology joints and synchronized
cuts without pretending it inferred anatomy. The agent still supplies semantic grouping and
pivots, then proves the result against the source with `match`.

Note the loop appears twice: once to converge the static model on the reference, once to converge
the motion. Same machinery both times.

## 4. Architecture

Single package, four internal modules:

```
src/
  scene/      character(), layer(), part(), limb(), primitives, pivots
              → builds an immutable scene tree
  timeline/   keyframes, easing, loop, phase offsets, sequencing
              → evaluate(scene, t) → PoseState   (pure function of time)
  serialize/  PoseState → static SVG string      (used by snapshots)
              scene + timeline → animated SVG    (used by build)
  cli/        snapshot, sheet, inspect, lint, build
```

### Data model

A scene is a tree of named nodes. Every node has a local transform and, optionally, a pivot
expressed in its own coordinate space. Names are paths: `crane.leg.left.shin`. That naming is the
whole "semantics" fix — the agent addresses anatomy, not geometry.

```ts
const crane = character("crane", () => {
  layer("body", () => {
    ellipse("torso", { w: 80, h: 50, fill: "#c8d4dc" });
    path("neck", "M60,10 C70,-30 90,-40 95,-45");
    circle("head", { r: 12, at: [95, -45] });
  });

  layer("legs", () => {
    limb("leg.left",  { from: [30, 25], segments: [40, 35] });
    limb("leg.right", { from: [45, 25], segments: [40, 35] });
  });
});

crane.part("leg.left.thigh").animate({
  rotate: keys([[0, -25], [0.5, 25], [1, -25]], ease.inOut),
  loop: true,
});
crane.part("leg.right.thigh").animate({ ...sameAsAbove, phase: 0.5 });
```

### Compile pipeline

```
scene + timeline
   │
   ├─ per animated node: sample the property curve
   ├─ fit sparse keyframes with cubic-bezier easing where error < ε
   │  (fall back to dense sampling only for genuinely procedural motion)
   ├─ emit @keyframes rules, one per node
   └─ phase offsets become negative animation-delay on a shared duration
   ▼
one .svg with <style> inside, no external references, no script
```

### The parity contract (important)

There are two rendering paths: `evaluate(t) → static SVG → PNG` (what the agent sees) and
`compiled CSS → browser` (what the world sees). They must agree, or the feedback loop is lying.

**The keyframe fitter's error tolerance ε *is* that guarantee.** If fitting never deviates from
the evaluator by more than ε, then what the agent inspected is what the browser plays, within a
known bound. This is why easing must be restricted to what CSS can express natively
(`linear`, `cubic-bezier(...)`, `steps()`); anything else — springs, noise — gets baked to samples
rather than approximated. Non-negotiable, and cheap to enforce if enforced from the start.

### Safe CSS subset

Animatable: `transform` (rotate / translate / scale), `opacity`. Pivots via
`transform-box: fill-box` + `transform-origin`. Nothing else in v1. No `d`, no CSS variables (they
need `@property` registration to animate portably), no filters, no external fonts (text is
converted to paths — `<img>` embedding won't load fonts).

## 5. Milestones

### M0 — Hand-author the target *(2–3 evenings, zero library code)*

Manually write `walking-crane.svg` — parts as `<g>` elements, pivots via
`transform-box: fill-box; transform-origin`, CSS keyframes, phases via negative `animation-delay`.
Polish by hand until the walk genuinely looks good.

Verify it plays in: Chrome, Safari, Firefox, inside an `<img>` tag, and in a GitHub README.

- **Deliverable:** a gold-standard fixture + a written list of CSS features confirmed safe.
- **This is the falsification gate for the output format.** If a hand-tuned walk can't look good
  as SVG+CSS, or pivots misbehave across browsers, stop here. No library fixes that.
- Everything downstream converges on this file.

### M1 — Core DSL + static rendering *(~1–1.5k lines)*

`character` / `layer` / `part` / `limb`, primitives (path, ellipse, circle, rect, polygon), fills
and simple gradients, pivot points, scene evaluation at a fixed pose, serializer to static SVG.

- **Deliverable:** the crane written in the DSL renders a static SVG matching frame 0 of M0.

### M2 — Agent loop CLI *(~1k lines)* — built **before** animation

Because the modeling half of the flow needs it first.

- `heron snapshot crane.ts -t 0.4 -o frame.png` — pose → static SVG → PNG via `resvg-js`, so the
  agent can actually see it (agents read PNG, not SVG).
- `heron sheet crane.ts -t 0,0.15,0.3,0.45 -o sheet.png` — several frames in one contact-sheet
  image. Agents judge *motion* far better from frames side by side than from one screenshot.
- `heron inspect crane.ts -t 0.4` — text dump: scene tree, world coordinates, bounding boxes,
  joint angles. Cheap, precise, no vision needed for geometry questions.
- `SKILL.md` in the package so Claude Code picks up the loop automatically.

- **Deliverable:** the PNG→model half works end to end — an agent models the crane from the
  reference photo by iterating against snapshots.

### M3 — Timeline + compiler *(~1–1.5k lines)*

Keyframes over `{rotate, translate, scale, opacity}`, CSS-expressible easing, `loop`, phase
offset, sequencing. Then the compiler: sparse keyframe fitting with ε bound, dense sampling
fallback, `@keyframes` emission, shared duration, negative `animation-delay` for phases.

- **Deliverable:** the library *generates* a walking crane SVG that matches or beats the M0
  fixture. Compiler correctness criterion = converges on the gold file.

### M4 — Lints, walk reference, docs

- Motion lints: foot slides during ground contact; part separated from its joint beyond tolerance;
  geometry escapes the viewBox. Each turns "something looks wrong" into a diagnosis an agent can
  act on.
- `behaviors/walk.ts` — one hand-polished walk cycle, written in the public DSL, documented as a
  **worked example to copy and adapt**, not a universal preset. (A walk tuned for a bird will not
  transfer to a crab. Saying so in the docs costs nothing and prevents the whole class of "I
  applied `walk` and it looks broken" issues.)
- README with the crane animating in it — the output format is its own best advertisement.

- **Acceptance test for the MVP:** a fresh Claude Code session, given only `crane.png` and this
  library, produces a decent walking crane in one conversation. That is the exact task that
  failed and started this project. Done = it stops failing.

## 5a. Status — all milestones built

| Milestone | State | Evidence |
| --- | --- | --- |
| M0 gold fixture | done | `fixtures/m0-walking-crane.svg`, verified animating in-browser |
| M1 DSL + static render | done | `src/scene.ts`, `src/render.ts` |
| M2 agent CLI | done | `snapshot`, `sheet`, `inspect`, `lint`, `build` + `SKILL.md` |
| M3 timeline + compiler | done | `src/timeline.ts`, `src/compile.ts`; output beats the fixture |
| M4 lints + walk + docs | done | `src/lint.ts`, `src/behaviors/walk.ts`, `README.md` |

**The parity contract holds, measured rather than asserted.** The foot's contact
point was sampled in Node and then measured again in a browser playing the
compiled file: worst-case divergence **0.0065 user units** on a 186-unit figure,
which is output rounding, not drift. 14 tests pass, including a continuous
ε-bound check on baked procedural curves.

**The acceptance test passed.** A fresh agent session, given only the library and
`SKILL.md`, animated a character it had never seen (a gopher — deliberately the
opposite body plan to the crane) and shipped a lint-clean walk with every part
compiling exactly, in four render-and-look rounds. That was the task that
failed and started this project.

Its criticism was more valuable than its success, and produced four fixes:

- `walkCycle` angles are scale-dependent in a counter-intuitive way — clearance
  is `shin * (1 - cos lift)`, so **short legs need a bigger knee break than long
  ones**. It now solves flexion from `segments` and a target `clearance` instead
  of offering numbers tuned to one silhouette.
- `settle` conflated two timings; knee extension can now finish early via
  `extendAt`, which a character with a long foot relative to its stride needs.
- The `foot-slip` lint had a genuine blind spot: its contact test was symmetric
  about the ground line, so a foot *hovering* above the ground counted as
  planted. Height alone turns out to be insufficient — a swinging foot descends
  back through the heights it occupied while planted — so contact now requires
  the point to be near its own lowest reach **and** tracking backward.
- Tightening that lint then exposed a real defect in the reference walk: the
  early heel-lift accelerated the toe while it was still down. A single-pivot
  foot cannot roll over its toe, so push-off now begins exactly when stance ends.
  Both examples are clean under the stricter check.

### What the build changed about the design

- **M0's real output was the measurement harness, not the artwork.** The format
  question ("do nested pivots compose, can CSS express a walk") was settled in
  the first twenty minutes; the hours after that were hand-tuning bezier curves
  in raw CSS, which is precisely the labour the library exists to abolish. The
  lesson is to treat M0 as a *benchmark* — a target the generated output must
  match — and move craft work into the DSL as soon as the format is proven.
- **Foot-slip is a velocity criterion, not a position one.** The plan said a
  planted foot "shouldn't move". Wrong: in a walk-in-place cycle it must track
  backward at a *constant* speed, treadmill-style. Constancy is the signal, and
  it is what caught two real defects that were invisible in a still frame.
- **A third gait rule emerged that the plan did not anticipate:** the leg must
  retract before touchdown, swinging slightly past its contact angle so the foot
  is already moving backward when it lands. Sizing that overshoot to the stance
  angular rate also makes velocity continuous across the loop seam. This came
  directly out of the lint's output — the tool designed the behaviour.
- **IK was never needed.** Setting the body bob to the stance leg's vertical
  shortening (`length * (1 - cos(reach))`) keeps the planted foot at constant
  height on its own. IK stays deferred, now with evidence rather than optimism.
- **An ε bound must be verified on a denser grid than the one being fitted**,
  or it bounds the error only at the sample points while the curve drifts
  between them — a guarantee that reads as true and isn't.
- **Scene files must be strip-only TypeScript** (no parameter properties, no
  enums), since Node runs them by erasing types rather than compiling.

## 6. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| `transform-origin` / `transform-box` quirks across browsers | **High** — it's the core trick | M0 validates before any code is written |
| Snapshot ≠ compiled playback (loop lies to the agent) | High | ε-bounded keyframe fitting as a hard contract; restrict easing to CSS-expressible |
| Hand-polished walk doesn't look good even with a perfect rig | High | M0 answers this in week one, for the cost of two evenings |
| Baked output is unreadable write-only XML | Medium | Fit sparse keyframes first, dense-sample only procedural motion; readable output is part of the pitch |
| Agent can't judge motion from stills | Medium | Contact sheets (`sheet`) + geometric lints, not vision alone |
| Scope creep back toward the platform version | Medium | §2 is the boundary: thin verified output/review adapters are allowed; an interactivity runtime, editor platform, 3D, and new animation semantics are not. |
| npm name `heron` is squatted (dead 0.0.1 from 2015) | Low | Ship as `@heron/core` or similar scope |

## 7. Deferred decisions

- **IK.** Not in the MVP. Hand-tuned rotation keyframes suffice for one walk cycle (M0 forces us
  to work them out anyway). It bakes down to rotations regardless, so a two-bone solver slots in
  cleanly later — add it in M3 only if the walk visibly needs it.
- **Noise / procedural helpers.** Architecturally supported via dense sampling; not authored in v1.
- **Package/scope name.** Decide before first publish, not before first commit.

## 8. Prior art

- **Motion Canvas** — TypeScript, generator-based timeline, canvas output, nice preview app.
  Proves the "animation as code + preview loop" model works. Also proves the failure mode: the
  original project is abandoned (site down), community fork is Canvas Commons. No rig, no IK, no
  agent affordances, raster output.
- **Manim** — semantic object tree + interpolation + swappable renderer, video-only output.
  Architecture is a good reference; its Scene/renderer coupling is a documented mistake to avoid.
- **Remotion** — frame-as-pure-function-of-time, which we borrow; renders through headless
  Chromium, which we don't need without video.
- **CSSVG** — exports self-contained CSS-keyframe SVGs. Validates that the *output format* is
  desirable. GUI editor, mouse-driven, no rig, no code, no agents.
- **scriptimate**, **svg2fbf** — scripted SVG → video, and frame-stitching respectively. Adjacent,
  not overlapping.
- **Lottie Creator MCP / RiveMCP** — agent access to proprietary editors. The thing this is
  deliberately not: vendor-locked, cloud, non-git-friendly.

Nobody currently occupies: **code-first rig DSL → self-contained live SVG, built for agents.**
