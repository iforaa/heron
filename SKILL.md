---
name: heron
description: Use when animating an icon, character or logo as SVG - declares a rig of named parts with joints, then compiles to a self-contained animated SVG. Includes a render-and-look feedback loop for checking the motion.
---

# Heron

Animate a character by writing code, then **measure and look at what you made**.
Working blind is why this library exists; the `trace`, `match`, `sheet` and
`lint` commands are not optional extras, they are the workflow. Every one of
them was added after eyeballing something produced a defect nobody could see.

## The loop

```
GEOMETRY   heron trace icon.png -o scene.ts   ->  heron match scene.ts icon.png
              measure it, never eyeball it         until it says "shapes line up"

ANATOMY    heron shapes scene.ts  ->  group the strokes into jointed parts  ->  heron match again
              which run is which        this part is judgement, not pixels     the rest pose must not drift

MOTION     animate  ->  heron sheet scene.ts  ->  heron motion --part x  ->  heron lint  ->  fix
              is the pose right?         is the *timing* right?      what a still hides

CHOICE     heron variants scene.ts --motion x  ->  pick the cell that reads best
              when a number has no right answer, do not invent one
```

Never ship a scene you have not looked at, matched and linted.

## The one mistake that matters most

**Do not read coordinates off an image by eye. Measure them.**

This is not a style preference, it is the most expensive error the library has
seen. A logo redrawn by eye — three rounds of looking at renders and adjusting —
had *every stroke in the file 17-20% too thin*. Nobody noticed, because
"slightly narrow everywhere" is invisible to the eye and unmissable to one
scanline. `heron match` found it in one command:

```
overlap 51.2%  ink 0.79x
STROKE WIDTH: every stroke is about 26% too thin (0.74x).
```

Tracing the same file instead took it to 95.6% overlap, with widths measured to
the pixel. If you have a reference image, `heron trace` it. If you are drawing
freehand, still run `heron match` against whatever reference exists. A number you
typed after looking at a picture is a guess.

The same lesson applies one level down, to the measuring itself. The distance
field measures to the nearest *background pixel's centre*, but the edge of the
ink is half a pixel nearer than that, so every width it reported was exactly 1.0
too large. Uniform across a whole scene, that is 2.4% of invented ink — and the
test guarding it allowed ±1.5px, which is wider than the error, so it passed
happily for the error's entire life. **A tolerance looser than the mistake it
guards is not a test.**

## 1. Get the geometry from the reference

```bash
heron trace icon.png -o scene.ts       # centrelines + measured widths
heron match scene.ts icon.png          # score it, and look at match.png
```

`trace` finds the **medial axis** of the ink, so a drawn line comes back as a
centreline plus a width — which is exactly `through(points, { stroke, width })`.
It reports the widths it measured and flags any run whose width *varies*, since
that is a filled shape (a tapered beak, a solid foot) and will look wrong as a
constant-width stroke. Redraw those few by hand with `path` or `polygon`.

`match` is the instrument. Grey means both, **red means the reference has ink
you do not, blue means you invented ink**. Read the ink ratio first — it is one
number for systematic error and it is the one your eye cannot see. Chasing
shape differences while every stroke is 20% thin is wasted work.

### Read the scale line before you read any percentage

```
overlap 93.8%  ink 0.993x   (binary 95.6% / 0.98x)
scale: one pixel of edge error costs 6.5% here, so 6.2% short is about
1.0 pixel(s) of boundary — edges, not placement.
```

A bare percentage is unreadable. On this logo, moving every boundary out by one
pixel — same shape, nothing misplaced — costs 6.5 points, so "93.8%" means the
edges are about a pixel out and *nothing is in the wrong place*. On a chunkier
mark the same 93.8% would mean a limb had gone missing. The scale line is what
tells the two apart, and without it agents chase coordinates that are already
right.

The headline numbers compare **coverage**, not a thresholded yes/no. A threshold
is a cliff and the entire boundary of a mark sits on it: re-cutting the very same
image at 0.22 instead of 0.40 moves the binary score by 5 points. Worse, a binary
score answers in steps, so a genuine sub-pixel improvement can move it by exactly
zero — which makes it useless as something to improve against. Coverage unmixes
each edge pixel back into the fraction of ink covering it and responds smoothly.

It is also the stricter number, and that is the point. The binary score is quoted
in brackets purely so old figures stay comparable; it flatters, because rounding
every edge pixel to 0 or 1 throws away exactly the disagreement that is left.

Two things `trace` deliberately does not do:

- **It does not find anatomy.** It hands you runs of ink, not a leg. Deciding
  which strokes are the leg, and where the hip is, is a judgement about what the
  drawing depicts, and nothing in the pixels carries it. That is step 2.
- **It does not undo a pose.** If the reference shows a bird standing on one leg
  with the other tucked, you get one leg. A walk needs two, so you must draw the
  missing one. Poses are not anatomy.

### Why strokes are skeletonised and filled shapes are not

An outline tracer returns the two *sides* of every stroke as one closed loop.
For a drawn line that is the wrong shape twice over: you would have to take its
medial axis anyway to recover a centreline, and a limb cut out of an outline
needs a new closing edge across the joint that does not exist in the source —
authoring, not extracting. A medial axis already forks where a leg meets a body.

But a *filled* shape has no centreline to find. A tapered beak or a solid foot
has no single width, so `through(points, { width })` flattens it.

So `trace` uses both, and picks per region. Runs that hold one width become
centrelines; runs whose width varies get handed to **potrace** for an exact
outline, one region at a time so each stays one shape and one part. On the
reference logo that is 11 strokes and 8 outlines, and it scores **95.6%** binary
/ 93.8% by coverage, while staying riggable, which whole-image outline tracing is
not.

### A taper hides inside the run it grows out of

A beak is a wedge growing out of a neck, and the medial axis runs from one into
the other without ever forking — so they arrive as a single branch. Measured
together the taper disappears: width statistics discard the ends of a run (a
medial axis really does taper to nothing at a cap, so some trimming is right),
and a wedge over the last tenth of a long neck gets trimmed away with them. The
run then reads as perfectly constant, gets drawn at one width, and the wedge ends
in a blunt round cap two-thirds of the way along its own point.

On the crane that one mistake was **two-thirds of all the ink the scene
invented**, and nothing else in the pipeline could see it. `trace` now cuts a
tapered terminal off at the knee, so each half is measured for what it is: the
constant part stays a stroke and stays riggable, and the wedge becomes its own
region and gets an exact outline.

Two rules follow. Trim ends by a *distance* (one radius, which is how far a cap
reaches), never by a percentage — a tenth of a long run is far more than a cap.
And when a summary statistic exists to detect something, check that it can still
see it after every filter upstream of it.

The rule underneath: **an outline tracer is safe exactly where one traced region
is also one animatable part.** A beak, yes. A whole bird, no.

potrace is optional. Without it those shapes fall back to constant-width strokes
and `trace` says so; install it with `brew install potrace` for the better
result. Note that `magick in.png out.svg` also silently delegates to potrace, so
that route has the same properties.

### A fitted circle beats the points it was fitted to

If a run is really an arc or a line, `trace` emits `arc({ cx, cy, r })` or
`line({ from, to })` instead of a point list. This is an **accuracy** step that
happens to also be tidier, which is the opposite of how it reads.

Forty points are forty independent measurements, each carrying its own lattice
and thinning noise, and simplification makes it worse: Douglas-Peucker bounds the
deviation but always takes it on one side of a convex curve, so every simplified
arc is inscribed inside the true one and comes out systematically small. A circle
has three parameters solved from every sample at once, so the noise averages out
and the result is a better estimate of the artwork than any point it was fitted
to. On the crane the two halves of the ring were fitted *separately* and landed
on the same centre and radius to within a tenth of a pixel; the leg came out
exactly vertical and the foot exactly horizontal. That is the construction
geometry of the original drawing, recovered.

Both fits reject outliers first, and must. Where two strokes cross, the largest
circle that fits inside the *union* is bigger than the one inside either stroke,
so the skeleton bulges off the true path for as long as the overlap lasts. Those
samples are wrong, not merely noisy: on the ring they took the worst residual
from 1.0px to 5.8px and would have rejected a fit that was right. The fitted arc
then runs correctly straight through the crossing, which is exactly where the
skeleton could not.

A fit is accepted on two conditions, and neither covers the other. The residual
catches gross curvature — but trimming cannot, because an arc's distances from
its chord are large yet evenly spread, so nothing stands out as an outlier. The
share of the run described catches a run that is straight and then bends, where
the surviving fit is excellent and only the discarded fraction gives it away.

## 2. Group the strokes into parts

Keep the traced numbers exactly as they are. Anything you retype by eye is a
guess re-entering a file that had measurements in it. Re-run `heron match` when
you are done: the rest pose must not have drifted.

If you are drawing without a reference, write it out directly — the same rules
apply:

```ts
import { character, part, limb, ellipse, circle, path } from '@heron/core';

export const crane = character('crane',
  { viewBox: [18, 8, 180, 186], duration: 1.1, ground: 183 },
  () => {
    part('body', { pivot: [100, 95] }, () => {
      limb('legFar', { hip: [92, 112], segments: [36, 32], stroke: '#8f9ca6',
                       foot: { toe: [13, 3], heel: [-7, 3] } });

      ellipse({ cx: 100, cy: 95, rx: 42, ry: 21, fill: '#eef3f6' });

      part('neck', { pivot: [130, 86] }, () => {
        path({ d: 'M130,86 C137,66 142,48 147,34', stroke: '#eef3f6', width: 7 });
        part('head', { pivot: [148, 32] }, () => {
          circle({ cx: 148, cy: 30, r: 8, fill: '#eef3f6' });
        });
      });

      limb('legNear', { hip: [105, 112], segments: [36, 32], stroke: '#3d4a54',
                        foot: { toe: [13, 3], heel: [-7, 3] } });
    });
  });
```

Rules that matter:

- **A pivot is the joint's coordinate in the rest pose**, written in the same
  space as the artwork. Not an offset, not a percentage.
- **Nesting is the rig.** A part moves with its parent, so `shin` must be
  declared inside `thigh`. `limb()` does this correctly for a leg.
- **Declaration order is z-order.** Draw the far leg before the body, the near
  leg after it.
- Set `ground` if anything should touch the floor; the contact lints need it.
- `layer(name, body)` is `part` without a joint, for pure grouping.
- Give a limb on the far side of the body a lighter stroke than the near one.
  Depth is what stops two legs reading as one, and it costs nothing.
- Paired limbs must differ in more than position: if a foreleg is the same
  colour, length and thickness as the hind leg beneath it, it reads as a second
  hind leg no matter how it is animated.

### Drawing curves: prefer points you can see

Primitives are `ellipse`, `circle`, `rect`, `line`, `polygon`, `arc`, `through`
and `path`. Two of them are worth knowing before you reach for `path`:

```ts
// Centre and two angles. 0 is 3 o'clock, increasing clockwise.
arc({ cx: 513, cy: 424, r: 361, from: 85, to: 234, stroke: '#37995d', width: 30 });
arc({ cx: 50, cy: 50, r: 20, fill: 'none', stroke: '#000' });   // omit angles: full ring

// A smooth curve through every point listed.
through([[368, 378], [462, 347], [566, 376], [652, 466], [706, 606]],
        { stroke: '#37995d', width: 30 });
```

`through` matters more than it looks. A cubic's control points are *not on the
curve*, so they cannot be read off a reference image — they have to be guessed,
rendered, and nudged. Every point you give `through` is a place the curve
actually goes, so tracing an outline becomes reading coordinates rather than
solving for handles, and correcting it after a snapshot is moving a point you
can see. Use it for backs, bellies, necks, wings, tails.

`arc` removes the other reliable mistake. Written as `d`, an arc is
`A rx ry rot large-arc sweep x y`: endpoints you must solve by hand plus two
flags whose meaning nobody recalls. `arc` takes what you know and emits
segments of at most 180 degrees, so the large-arc flag is always 0 and a full
ring is one call.

**Keep using `path({ d })` for two things**, because `through` is worse at both:

- **Corners.** `through` smooths every vertex, so a beak tip or a folded wing
  comes out rounded. Anything with a deliberate point stays a `d` string.
- **Tight curls.** Curvature is exactly what a Bezier handle buys cheaply. A
  small tight hook that two cubics describe in eight numbers needs about nine
  on-curve points to pin down, and still reads rounder.

Long organic runs → `through`. Circles and rings → `arc`. Corners and tight
detail → `path`.

## 3. Animate

Times are fractions of one cycle, 0 to 1. A key's easing governs the segment
that *starts* at that key.

```ts
import { keys, easeInOut, walkCycle, bodyBob, sway, pulse, applyGait } from '@heron/core';

// Pass `segments` so knee flexion is solved for your character's proportions.
const gait = walkCycle({ stance: 0.62, reach: 18, segments: [36, 32] });

applyGait(crane, 'legNear', gait);          // drives thigh, shin and foot
applyGait(crane, 'legFar', gait, 0.5);      // same motion, half a cycle later

crane.part('body').animate(bodyBob({ stance: 0.62, legLength: 68, reach: 18 }));
crane.part('neck').animate(sway(2.4, { stance: 0.62 }));

// `pulse` is the twice-per-stride envelope shared by bob, sway and shadows:
// high at contact, low over mid-stance.
crane.part('shadow').animate({ scaleX: pulse(1.06, 0.94), opacity: pulse(0.5, 0.38) });

// Or drive any channel directly.
crane.part('tail').animate({ rotate: keys([[0, 2], [0.5, -2], [1, 2]], easeInOut) });
```

For a film, author a move in its own local `0..1` time and place it inside a
named beat with `within()`. Its first and last values hold outside the beat, and
keyed motion stays exact:

```ts
const reveal = { name: 'reveal', from: 0.4, to: 0.6, seconds: 1.2 };
scene.part('mark').animate({
  scaleX: within(reveal, keys([[0, 0], [0.7, 1.08, easeOut], [1, 1]])),
  scaleY: within(reveal, keys([[0, 0], [0.7, 1.08, easeOut], [1, 1]])),
});
```

When shots and transitions overlap, name their windows in seconds with a cue
sheet. A cue sheet does not require windows to be sequential or cover the whole
film:

```ts
const film = cueSheet(scene, {
  runner: [0, 2.9],
  wipe: [2.7, 4.0],
  voice: [3.9, 6.2],
});

scene.part('wipe').animate({
  scaleX: film.place('wipe', keys([[0, 0], [1, 10]])),
  scaleY: film.place('wipe', keys([[0, 0], [1, 10]])),
});
```

For a field of dots reorganising through several formations, keep the first
point list identical to where the dots were drawn and use `morphThrough()`.
Nearest-target assignment is carried from one form into the next, transform
times stay aligned, and spare dots fade:

```ts
scene.field('dots').morphThrough([
  { at: 0, points: signal, scale: 0.3, opacity: 0 },
  { at: 0.25, points: signal, scale: 1, opacity: 1, stagger: 0.08 },
  { at: 0.6, points: burst },
  { at: 1, points: logo },
], { window: film.at('voice') });
```

Titles should use deterministic vector geometry rather than system SVG text.
The built-in uppercase face is self-contained and works with `draw`:

```ts
layer('title', () => strokeText('EVERY IDEA STARTS HERE', {
  x: 640, y: 600, size: 18, align: 'center',
  tracking: 0.4, stroke: '#fff', width: 2,
}));
scene.part('title').animate({ draw: film.place('voice', keys([[0, 0], [1, 1]])) });
```

When typography must match a real brand font, convert the font to filled path
geometry at authoring time. This preserves kerning and shaping without leaving
a system-font dependency in the SVG:

```ts
const brand = loadOutlineFont('./assets/Brand-Regular.otf');
layer('wordmark', () => outlineText('NEXA AI', {
  font: brand, x: 640, y: 560, size: 70, align: 'center', fill: '#fff',
}));
```

Use named paint and reveal resources for commercial graphics:

```ts
const glow = radialGradient('glow', {
  stops: [
    { at: 0, color: '#5ee7ff', opacity: 0.9 },
    { at: 1, color: '#1688ff', opacity: 0 },
  ],
});
const window = clipPath('window', () =>
  circle({ cx: 640, cy: 360, r: 180, fill: '#fff' }));
const feather = mask('feather', () =>
  circle({ cx: 640, cy: 360, r: 220, fill: glow }), { mode: 'alpha' });

part('reveal', { clip: window, mask: feather }, () => {
  rect({ x: 0, y: 0, w: 1280, h: 720, fill: '#fff' });
});
```

`clipPath()` is binary geometry. `mask()` is painted luminance/alpha and is the
one for feathered reveals. Both are static definitions carried by an animated
part; move or scale that part to animate the reveal.

Use `pathMorph()` only when every key has the same command topology. It will not
guess point correspondence, and arcs must be converted to cubic curves:

```ts
path({ d: pathMorph([
  [0, 'M20 20 C40 0 80 0 100 20 C80 60 40 60 20 20 Z', easeInOut],
  [1, 'M10 30 C35 5 90 10 110 40 C75 70 30 65 10 30 Z'],
]), fill: '#fff' });
```

Part paths may be shortened: `legNear.foot` resolves to
`body.legNear.thigh.shin.foot`. Ambiguous shorthands are an error, never a guess.

For an arm or leg following a moving target, use world-space `reach()` instead
of solving two joint angles independently on every frame:

```ts
reach(scene, {
  upper: 'body.arm.upper',
  lower: 'body.arm.lower',
  target: { part: 'target' }, // or (t) => [x, y]
  bend: 1,
});
```

The upper/lower parts must be a nested positive-Y rest chain. `reach()` layers
over motion already on the joints and their ancestors; unreachable targets
clamp without stretching.

Animatable channels are `rotate`, `x`, `y`, `scaleX`, `scaleY`, `opacity`, and
`draw`. That
list is deliberately what CSS can express; anything else could not be compiled
honestly. `sampled(fn, n)` drives a channel from an arbitrary function of cycle
time, but it has to be baked, so prefer `keys()` when you can.

Channels compiling to the same CSS property must agree on keyframe times and
easings, since CSS allows one timing function per keyframe. `opacity` is its own
property, so it may disagree with the transform channels freely; `rotate`, `x`,
`y` and the scales all share `transform` and must line up to stay exact.

### `walkCycle` angles do not transfer between characters

This is the most common way a gait breaks, and it is not obvious. Ground
clearance is `shinLength * (1 - cos(lift))`, so the knee flexion that lifts a
long-legged bird's foot clear of the floor barely moves a stubby one's. **Short
legs need a bigger knee break than long legs, not a smaller one** — the opposite
of what scaling down every number would suggest.

So do not copy angles from another character. Pass `segments` (the same array
you gave `limb()`) and let `lift` be solved for a real clearance:

```ts
walkCycle({ segments: [13, 13], clearance: 4 })   // short-legged rodent
walkCycle({ segments: [36, 32] })                 // clearance defaults to 15% of leg length
```

### A gait has a direction, and no lint can check it

`walkCycle` produces angles for a character facing **right**. Drive a
left-facing one with them and every joint is mirrored: the planted foot tracks
toward the head instead of away from it, so the character moonwalks and its
knees bend the wrong way.

Nothing catches this for you. `foot-slip` only asks whether a planted contact
holds a constant speed — a backwards walk holds it perfectly. So check which way
the artwork points and say so:

```ts
walkCycle({ segments: [175, 172], facing: -1 })   // beak points left
```

This mirrors the motion, not the drawing: the artwork must already face that
way, and an asymmetric foot has to be drawn mirrored too.

Other options worth knowing when a gait misbehaves:

- `stance` — fraction of the cycle the foot is down. Above 0.5 gives the
  double-support overlap that makes a walk read as walking rather than marching.
- `reach` — thigh swing either side of vertical, so stride length.
- `settle` — when the leg reaches its forward extreme before retracting.
- `extendAt` — when knee extension finishes, if it must finish *before*
  `settle`. Needed when the foot is long relative to the stride, otherwise
  unwinding the toe tuck drives the toe into the floor.

## 4. Look at it

```bash
heron shapes scene.ts -o shapes.png       # one cell per run - which ink is which part
heron sheet scene.ts -n 8 -o sheet.png     # eight poses tiled - the default check
heron sheet film.ts --cues -n 3 -o cues.png # start/middle/end of every exported cue
heron motion scene.ts --part legNear.foot   # one part's arc and spacing, plus a JSON report
heron variants scene.ts --motion head       # the same scene under several parameters
heron snapshot scene.ts -t 0.62 -o f.png   # one pose, e.g. the push-off frame
heron inspect scene.ts -t 0.3              # the same pose as numbers
heron match scene.ts icon.png              # the rest pose against the reference
heron lint scene.ts                        # defects invisible in a still frame
heron build scene.ts -o out.svg            # the deliverable
heron video film.ts -o film.mp4 --fps 30 --audio mix.wav
```

`sheet` is the one to reach for. Motion is a relationship between frames, so a
single screenshot cannot tell you whether a walk works. `inspect` is better than
an image when the question is geometric ("is the foot actually reaching the
ground?") — it prints world coordinates, contact points and bounding boxes.

### Spacing is how timing is read

`heron motion` follows one part and draws where it went, with a dot per sample.
The *gaps between the dots* are the reading, and they are the chart animators have
drawn for a century: bunched dots are slow, spread dots are fast.

```
heron motion examples/crane.ts --part legNear.foot -n 24
  path 112.12   speed 65.57/s median, 354.51/s peak, 5.41x   reversals 2x/8y
```

That 5.4x is the walk. The foot holds a dead-constant speed while planted — the
treadmill belt the ground contact demands — and then travels five times faster
through the swing. A gait whose ratio is near 1.0 is a foot sliding at one speed
for the whole cycle, which reads as skating no matter how correct the poses are.

Track a point that is neither a joint nor a contact with `part@x,y`:

```
heron motion examples/crane.ts --part head@188,30
```

That is the beak tip, and it is the example to reach for first, because the
defect that motivated this instrument was a chick's beak folding over its own
back twice per step. It is invisible in every still frame and unmissable as a
loop in the trajectory.

Useful flags: `--cues` gives one cell per shot, `--compare other.part` measures
ink-to-ink clearance between two parts (does the hop actually clear the beak?),
`--zoom` crops to the action, and `-n` sets the sample count — raise it for long
films, since the default 24 is tuned to a one-second cycle.

Every run also writes a JSON sidecar. Read the image when the question is "does
this read"; read the JSON when it is "how much" — it carries path length, speeds
in units per second, holds, direction reversals, decelerations and clearances.
Speeds are per second deliberately, so two runs at different `-n` stay comparable.

Two honest limits. A hollow dot means the part is **faded out** — `clip`, `mask`
and `offstage` hide artwork without touching opacity, so it is not a claim that
nothing was seen. And the instrument only reports: it sets no thresholds and never
fails a build. `lint` is the only judge.

### Choose constants, do not invent them

Some numbers have no right answer. How far a neck swings as a bird walks, how high
a hop goes, how long a follow-through lags — these are chosen because the result
reads well, and no amount of reasoning gets there. Guessing one, rendering it once
and accepting it is the single most common way a generated scene ends up merely
adequate.

Make the scene a function of those numbers and declare the values worth trying:

```ts
const AXES = { neck: [6, 9, 13], head: [-8, -11, -15] };

function take(p: Variant<typeof AXES>): Character {
  const ch = craneAlone(`crane-${p.index}`, 1.1);
  ch.part('body.neck').animate(sway(p.neck, { stance: STANCE }));
  return ch;
}

export const takes = grid(take, AXES);
```

Then look at all of them at once, with the trajectory drawn in every cell:

```
heron variants examples/crane-takes.ts --motion body.neck.head@260,64 --zoom
  #0  neck=6  head=-8    path 107.4  med  84.3/s  peak 153.1/s
  #6  neck=13 head=-8    path 329.9  med 257.3/s  peak 461.9/s
  widest travel #6 (329.9), tightest #0 (107.4)
```

Three times the beak travel across the grid, and the interaction is visible too:
#3 travels *further* than #4 even though its head swings less, because the neck and
head fight each other. That is why both belong in the grid — varying one alone finds
a threshold that moves as soon as the other changes.

Notes that matter:

- Every cell builds a **fresh** Character, and gets a stable `p.seed` so any `noise`
  or `shuffle` is reproducible per cell rather than reshuffling between renders.
- Other commands keep working on a grid module: `sheet`, `build`, `lint` and `video`
  all use the **base** build, the first value of every axis.
- The cells share one crop and one scale, always. A cell rescaled to fit itself
  would be a lie about amplitude, which is usually the thing being compared.
- `--strip 3` puts three moments in each cell when the question is timing rather
  than pose; `--cue landing` or `--range 1.2..2.4` narrows the window; `--only
  neck=9` slices a grid too large to draw. More than 25 builds is refused, not
  sampled — a biased subsample is worse than no comparison.
- The sidecar carries every cell's parameters, seed and motion stats, so the grid
  can be **ranked numerically** and not only eyeballed.

Then write the chosen number into the scene with a comment saying what it beat.

## 5. Fix what lint reports

- **loop-seam** — a channel ends somewhere other than where it started, so the
  animation visibly jumps once per loop. Make the first and last key equal.
- **foot-slip** — a planted contact point changes speed, which reads as the foot
  skating. Usually caused by an intermediate keyframe inside the ground-contact
  phase: contact should be one uninterrupted segment.
- **ground-penetration** — a contact point passes through the floor.
- **no-ground-contact** — a foot never reaches the ground, so the character
  appears to hover.
- **out-of-view** — artwork leaves the viewBox mid-cycle and will be clipped.

`foot-slip` reports how far the speed strays from the median, the limit it must
stay under, and the ground speed itself, so you can tell whether you are close
or nowhere near. A very large percentage usually does not mean a subtle timing
problem — it usually means the foot never leaves the ground at all, or lands
while still reaching forward. Check with `inspect` at a few times, or print
`pointAt(scene, 'legNear.foot', t)` across the cycle, before touching easings.

For handoff to another process, `serializeScene(scene)` returns versioned,
JSON-safe IR. Procedural channels are baked to explicit keys; do not expect a
closure to survive JSON. `parseScene(json)` rehydrates a normal Character.

Video is optional delivery, not the source of truth. `heron video` evaluates
static frames through the same path used by snapshots, streams RGBA to ffmpeg,
and muxes an optional soundtrack. Always judge timing with `studio` and
cue-aware sheets before paying the cost of a full-resolution encode.

## Making a walk look right

If you write a gait by hand rather than using `walkCycle`, three rules do most
of the work:

1. **One segment through stance.** No intermediate keyframe while the foot is
   planted; any change of angular rate reads as skating.
2. **The sole stays flat while planted**, so the foot's own rotation is the
   negation of everything above it: `foot = -(thigh + shin)`.
3. **Retract before touchdown.** The leg should swing slightly past its contact
   angle and already be sweeping backward when the foot lands, otherwise the
   foot arrives moving forward and skids. Sizing the overshoot to match the
   stance angular rate also makes the loop seam continuous.

## Output

`heron build` writes one SVG with the animation inside it. No JavaScript, no
external references, no runtime. It works in an `<img>` tag and in a GitHub
README, and it honours `prefers-reduced-motion`.

`build` reports any part whose motion had to be baked to sampled keyframes
(which happens for procedural motion, or when channels sharing a CSS property
disagree about timing). Baked motion stays within a bounded error of what `snapshot`
showed, so the feedback loop remains trustworthy — but exact is better, so
prefer `keys()` over `sampled()` where you can.
