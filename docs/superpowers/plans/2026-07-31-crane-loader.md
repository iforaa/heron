# Crane Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seamlessly looping loading animation — the traced crane runs in place inside its own spinning ring — shipped as both animated SVG and Lottie JSON for the Tenfore RN app.

**Architecture:** A new example scene (`examples/crane-loader.ts`) reuses the measured anatomy from `examples/crane-rig.ts` (given a small optional palette parameter) and drives it with the library's `walkCycle`/`bodyBob` behaviors; the icon's two ring arcs become a rotating spinner part. Artifacts are emitted with the existing `heron build` and `heron lottie` CLI commands.

**Tech Stack:** TypeScript run directly by Node (type stripping — plain `node src/cli.ts …`, no build step), Heron's own DSL, `heron` CLI for lint/sheet/build/lottie. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-crane-loader-design.md` — read it first; it holds the *why* for every decision below.

## Global Constraints

- Colors: production green `#2C7C4D` for all near ink and the ring; far-leg tint starts at `#84b39a` (a lightened `#2C7C4D`; tune by eye only if it reads as a separate hue rather than depth).
- Canvas: `viewBox: [0, 0, 1024, 1024]`, transparent background (no background rect).
- Loop: duration **0.8 s**, one gait cycle per loop, character is cyclic — do NOT set `once`. Every track must start and end at the same value.
- Gait: `facing: -1` (the traced bird faces left). Never "fix" this to the default — `facing: 1` on left-facing artwork produces the moonwalk artifact documented in `src/behaviors/walk.ts`.
- No eye, no blink, no extra acting (wing flaps, head turns). The bird stays the mark.
- Known accepted artifact: planted-foot "skating" is inherent to a run in place; if `heron motion`/lint-style diagnostics flag it, that is expected, not a bug to fix.
- All temporary render outputs go to `out/` (gitignored pattern used by existing npm scripts).
- Commit messages: repo style is short lower-case summaries (see `git log`), each ending with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Palette parameter for `craneRig()`

`crane-rig.ts` hardcodes `INK`/`FAR`. The loader needs production colors without touching geometry. Add an optional palette argument, defaulting to current values so all existing callers (`crane-stairs.ts`, `crane.ts`, `crane-family.ts`, `crane-takes.ts`, `tenfore.ts`, `tenfore-walk.ts`) are unaffected.

**Files:**
- Modify: `examples/crane-rig.ts` (function `craneRig()`, ~line 102, and its body ribbons/`leg()` calls)

**Interfaces:**
- Produces: `craneRig(palette?: { ink?: string; far?: string }): void` — Task 2 calls `craneRig({ ink: '#2C7C4D', far: '#84b39a' })`. Existing exports (`BIRD`, `GROUND`, `SEGMENTS`, `offsetFarLeg`, `craneAlone`) are unchanged.

- [ ] **Step 1: Make the change**

In `examples/crane-rig.ts`, change the `craneRig` signature and replace the internal color references. The function currently reads `export function craneRig(): void {` and uses the module constants `INK`/`FAR` in five places inside it (the `leg('legFar', FAR)` call, three body/wing/neck/head ribbon groups' `{ fill: INK }`, and `leg('legNear', INK)`):

```ts
export function craneRig(palette: { ink?: string; far?: string } = {}): void {
  const ink = palette.ink ?? INK;
  const far = palette.far ?? FAR;
  part('body', { pivot: [500, 470] }, () => {
    // Behind the torso, so it reads as the far side.
    leg('legFar', far);
    ...
```

Then, inside `craneRig` only, replace every `{ fill: INK }` with `{ fill: ink }` and `leg('legNear', INK)` with `leg('legNear', ink)`. Do NOT touch the module-level `export const INK` / `export const FAR` (other files import them) and do NOT change `leg()` itself — it already takes a tint parameter.

- [ ] **Step 2: Verify nothing regressed**

```bash
node src/cli.ts lint examples/crane-stairs.ts
npm test
```

Expected: lint output unchanged from a pre-edit run (run it once before editing to capture the baseline), all existing tests pass. Then render one frame to confirm colors are untouched by the default path:

```bash
node src/cli.ts snapshot examples/crane-stairs.ts -t 0.2 -o out/rig-palette-check.png
```

View `out/rig-palette-check.png` (Read tool): the bird must be the usual `#3ba064` green with the lighter far leg.

- [ ] **Step 3: Commit**

```bash
git add examples/crane-rig.ts
git commit -m "let craneRig take a palette

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The scene — bird placed inside the ring, everything still

Create `examples/crane-loader.ts` with the composition but no motion yet: spinner arcs + scaled, positioned bird. Getting placement right on a still frame first isolates fit problems from gait problems.

**Files:**
- Create: `examples/crane-loader.ts`

**Interfaces:**
- Consumes: `craneRig(palette)` from Task 1; `BIRD`, `GROUND`, `SEGMENTS`, `offsetFarLeg` from `examples/crane-rig.ts`.
- Produces: `craneLoader: Character` (default export) with part paths `spinner`, `bird`, and inside `bird` the rig's own `body`, `legNear`, `legFar`, `neck`, etc. Constants `STANCE`, `REACH` exported for nothing yet (module-local is fine).

- [ ] **Step 1: Write the scene file**

```ts
/**
 * The Tenfore crane as a loading spinner: the bird runs in place at the
 * centre of its own ring, and the ring — the icon's two measured arcs, gaps
 * and all — spins around it. `crane-rig.ts` dropped the ring because a
 * travelling bird trapped in a hoop reads wrong; a bird running in place
 * inside a spinning hoop is exactly the loader idiom, so it comes back for
 * the one case it works in.
 *
 * Production green rather than the examples' ink, because this ships into
 * the app next to assets drawn in #2C7C4D.
 */

import {
  arc, character, keys, linear, part, type Character,
} from '../src/index.ts';
import {
  BIRD, GROUND, SEGMENTS, craneRig, offsetFarLeg,
} from './crane-rig.ts';

const INK = '#2C7C4D';
const FAR = '#84b39a';

/** The icon's ring, measured by `heron trace` (same arcs crane-golf keeps). */
const RING = { cx: 513, cy: 427.7, r: 359, width: 35.2 };
const INNER = RING.r - RING.width / 2;

/**
 * The bird, scaled to fit its whole stride inside the ring's inner edge.
 * `BIRD` is the rig's published ink bounds over a full stride; the diagonal
 * fit is conservative (no ink reaches the box corners), so FIT relaxes it.
 * Tuned on the frame sheet: raise FIT until ink approaches the ring, back
 * off one notch.
 */
const FIT = 1.0;
const SCALE = (2 * INNER * FIT) / Math.hypot(BIRD.x1 - BIRD.x0, BIRD.y1 - BIRD.y0);

/** Scaled about the ground point under the bird's centre, then translated so
 *  that point lands just above the ring's inner bottom edge. */
const ANCHOR: [number, number] = [(BIRD.x0 + BIRD.x1) / 2, GROUND];
const MARGIN = 40;
const FLOOR_Y = RING.cy + INNER - MARGIN;

const DURATION = 0.8;

export const craneLoader: Character = character(
  'craneLoader',
  { viewBox: [0, 0, 1024, 1024], duration: DURATION, ground: FLOOR_Y },
  () => {
    part('spinner', { pivot: [RING.cx, RING.cy] }, () => {
      arc({ cx: 513.1, cy: 427.7, r: 359.2, from: -102.2, to: 83.1, stroke: INK, width: RING.width });
      arc({ cx: 512.9, cy: 427.9, r: 359, from: -129.9, to: -248.6, stroke: INK, width: RING.width });
    });
    part('bird', { pivot: ANCHOR }, () => {
      craneRig({ ink: INK, far: FAR });
    });
  },
);

// Parts carry no static transform; a constant track is how one is placed
// (the offsetFarLeg idiom).
craneLoader.part('bird').animate({
  x: keys([[0, RING.cx - ANCHOR[0]], [1, RING.cx - ANCHOR[0]]]),
  y: keys([[0, FLOOR_Y - ANCHOR[1]], [1, FLOOR_Y - ANCHOR[1]]]),
  scaleX: keys([[0, SCALE], [1, SCALE]]),
  scaleY: keys([[0, SCALE], [1, SCALE]]),
});

offsetFarLeg(craneLoader);

export default craneLoader;
```

- [ ] **Step 2: Render and inspect the still**

```bash
node src/cli.ts snapshot examples/crane-loader.ts -t 0 -o out/crane-loader-still.png -w 520
```

View the PNG (Read tool). Check: (a) whole bird inside the ring's inner edge with visible clearance, (b) bird standing near the ring's bottom, not floating at center, (c) both greens present — `#2C7C4D` bird+ring, lighter far leg, (d) no background rect. If the bird pokes through the ring or looks lost-small, adjust `FIT` (and `MARGIN` if feet crowd the bottom) and re-render — change only those two constants.

- [ ] **Step 3: Lint**

```bash
node src/cli.ts lint examples/crane-loader.ts
```

Expected: no findings beyond any it shares with existing examples (compare against `lint examples/crane-stairs.ts` if unsure what's pre-existing).

- [ ] **Step 4: Commit**

```bash
git add examples/crane-loader.ts
git commit -m "add crane-loader scene: bird composed inside the ring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The motion — run gait, bob, lean, ring spin

**Files:**
- Modify: `examples/crane-loader.ts` (append below the placement track)

**Interfaces:**
- Consumes: `walkCycle`, `applyGait`, `bodyBob` from `../src/index.ts` (add to the existing import), `SEGMENTS` (already imported). `applyGait(ch, limbName, gait, phase?)` resolves `ch.part('legNear.thigh')` etc. — nested part lookup by name works (crane-stairs does `part('wing')`).
- Produces: the finished cyclic animation Task 4 compiles.

- [ ] **Step 1: Add the motion**

Append to `examples/crane-loader.ts` (and add `applyGait, bodyBob, walkCycle` to the `../src/index.ts` import list):

```ts
// --- the run -----------------------------------------------------------------
// Stance below 0.5 is what makes it a run: the two stance phases stop
// overlapping and the gap between them is a flight phase. Values start from
// crane-stairs' proven run gait for this same rig.

const STANCE = 0.38;
const REACH = 30;

const gait = walkCycle({
  stance: STANCE,
  reach: REACH,
  // The beak points left, so the bird runs left. facing: 1 here is the
  // documented moonwalk artifact — do not "fix" it.
  facing: -1,
  segments: SEGMENTS,
  clearance: 90,
  // A running leg lands bent and absorbs, where a walking leg lands locked.
  stanceKnee: 15,
  kneeBreak: 62,
  toeTuck: -46,
});

applyGait(craneLoader, 'legNear', gait);
applyGait(craneLoader, 'legFar', gait, 0.5);

craneLoader.part('body').animate(
  bodyBob({ stance: STANCE, legLength: SEGMENTS[0] + SEGMENTS[1], reach: REACH }),
);

// A runner leans in; a few constant degrees on the neck is the whole
// difference between running and walking fast. Sign checked on the sheet —
// the lean must go toward the beak.
craneLoader.part('neck').animate({ rotate: keys([[0, -8], [1, -8]]) });

// One exact revolution per loop, linear, so the seam is invisible and the
// spin reads as the same mechanism as the run.
craneLoader.part('spinner').animate({ rotate: keys([[0, 0], [1, -360]], linear) });
```

Note the `offsetFarLeg(craneLoader)` call already added in Task 2 — do not add a second one.

- [ ] **Step 2: Render the frame sheet and judge the gait**

```bash
node src/cli.ts sheet examples/crane-loader.ts -n 12 --cols 4 -o out/crane-loader-sheet.png
```

View the PNG. Check each: (a) legs alternate — if both swing together, one `applyGait` is missing its `0.5` phase; (b) the bird runs *leftward* in posture (leg reach toward the beak side) — if the feet track toward the head it's the moonwalk, check `facing`; (c) an aerial moment exists (both feet off the implied ground in at least one frame); (d) the neck lean tips toward the beak — if it leans backward, flip `-8` to `8`; (e) no ink crosses the ring in any frame — if it does, reduce `FIT` in Task 2's block; (f) frame 1 and a `-t 0.999` snapshot match (seamless loop):

```bash
node src/cli.ts snapshot examples/crane-loader.ts -t 0 -o out/loop-a.png -w 400
node src/cli.ts snapshot examples/crane-loader.ts -t 0.999 -o out/loop-b.png -w 400
```

View both; they must be visually identical except ~0.4° of ring rotation. Tune `REACH`/`clearance`/`STANCE` by eye if the run reads stiff — re-render the sheet after each change.

- [ ] **Step 3: Lint**

```bash
node src/cli.ts lint examples/crane-loader.ts
```

Expected: clean, except possibly a planted-foot/skating finding — that one is the accepted in-place-run artifact per the spec; leave it.

- [ ] **Step 4: Commit**

```bash
git add examples/crane-loader.ts
git commit -m "give the loader its run: gait, bob, lean and ring spin

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Compile both targets; fix any Lottie exporter gaps

This is the Lottie exporter's first real consumer. If `heron lottie` reports warnings or emits broken output, the fix belongs in `src/lottie.ts` (with a regression test in `test/lottie.test.ts`), not in the example. Use superpowers:systematic-debugging if a fix is needed.

**Files:**
- Create (generated, not committed): `out/crane-loader.svg`, `out/crane-loader.json`
- Possibly modify: `src/lottie.ts` + Test: `test/lottie.test.ts` (only if warnings/breakage surface)
- Modify: `package.json` (add a `loader` npm script matching the existing `crane`/`stairs`/`family` pattern)

**Interfaces:**
- Consumes: `craneLoader` default export from Task 3.
- Produces: `out/crane-loader.svg` (animated SVG) and `out/crane-loader.json` (Lottie, 60 fps, 48 frames) for Task 5.

- [ ] **Step 1: Compile both targets**

```bash
node src/cli.ts build examples/crane-loader.ts -o out/crane-loader.svg -w 360
node src/cli.ts lottie examples/crane-loader.ts -o out/crane-loader.json --fps 60
```

Expected: both succeed; the lottie command's printed report shows **0 warnings**. Sanity-check the JSON header:

```bash
node -e "const a=require('./out/crane-loader.json'); console.log(a.w, a.h, a.fr, a.op)"
```

Expected: `1024 1024 60 48`.

- [ ] **Step 2: If (and only if) the Lottie report has warnings or wrong output**

For each warning: reproduce it minimally in a new test in `test/lottie.test.ts` (follow the file's existing pattern — build a tiny `character(...)` exercising the failing feature, assert on `compileLottie` output), watch the test fail, fix `src/lottie.ts`, watch it pass, then re-run Step 1 until the report is clean. Commit exporter fixes separately:

```bash
npm test
git add src/lottie.ts test/lottie.test.ts
git commit -m "lottie: <what the loader surfaced>

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Add the npm script**

In `package.json`, after the `family` script:

```json
"loader": "node src/cli.ts build examples/crane-loader.ts -o out/crane-loader.svg && node src/cli.ts lottie examples/crane-loader.ts -o out/crane-loader.json --fps 60"
```

Run `npm run loader` once to confirm it works end to end.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "add loader build script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Visual loop verification and app handoff

**Files:**
- Create: `../tenfore_crane_rn_template/assets/images/crane-loader.svg`, `../tenfore_crane_rn_template/assets/images/crane-loader.json` (copies; the app repo is NOT committed — that's the user's call)

**Interfaces:**
- Consumes: `out/crane-loader.svg`, `out/crane-loader.json` from Task 4.

- [ ] **Step 1: Watch the SVG loop in a browser**

Use the `agent-browser` CLI (per global instructions — not MCP browser tools):

```bash
agent-browser open "file:///Users/igorkuznetsov/Documents/tenfore/heron/out/crane-loader.svg"
agent-browser screenshot
```

Take 2–3 screenshots a second apart and view them. Check: the ring spins, the legs pump, nothing pops at the loop seam (a pop shows as the bird/ring jumping between otherwise-similar screenshots), colors match `#2C7C4D`.

- [ ] **Step 2: Verify the Lottie loops where the SVG does**

Write `out/lottie-preview.html` — a minimal page that plays the JSON with the lottie-web CDN build and `loop: true`:

```html
<!doctype html>
<div id="a" style="width:400px;height:400px"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js"></script>
<script>
  fetch('crane-loader.json').then(r => r.json()).then(data =>
    lottie.loadAnimation({ container: document.getElementById('a'), renderer: 'svg', loop: true, autoplay: true, animationData: data }));
</script>
```

Serve the directory (fetch of a `file://` sibling is blocked): `python3 -m http.server 8765 -d out` (background), then `agent-browser open "http://localhost:8765/lottie-preview.html"`, screenshot twice, and compare against the SVG screenshots: same pose vocabulary, same colors, ring spinning. Kill the server after.

- [ ] **Step 3: Copy into the app**

```bash
cp out/crane-loader.svg out/crane-loader.json /Users/igorkuznetsov/Documents/tenfore/tenfore_crane_rn_template/assets/images/
```

Do not commit in the app repo. Report to the user: files placed, app-side wiring (pointing screens' loading state at the Lottie with `loop`) is app-repo work per the spec's out-of-scope list.

- [ ] **Step 4: Final verification pass**

```bash
npm test
node src/cli.ts lint examples/crane-loader.ts
git status
```

Expected: tests pass, lint as in Task 3, working tree clean except pre-existing uncommitted files (this repo has unrelated uncommitted work — `chessrun-*`, `src/lottie.ts` itself, etc. — leave all of it alone; `src/lottie.ts` should only appear modified if Task 4 Step 2 fixed something, and then it was already committed there).
