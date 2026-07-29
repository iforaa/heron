---
name: heron
description: Use when animating an icon, character or logo as SVG - declares a rig of named parts with joints, then compiles to a self-contained animated SVG. Includes a render-and-look feedback loop for checking the motion.
---

# Heron

Animate a character by writing code, then **look at what you made**. Writing
keyframes blind is why this library exists; the inspection commands are not
optional extras, they are the workflow.

## The loop

```
write scene.ts  ->  heron sheet scene.ts  ->  look at the image  ->  fix  ->  repeat
                    heron lint scene.ts       read the findings
```

Never ship a scene you have not looked at and linted.

## 1. Draw the character in code

Do **not** trace an existing SVG or PNG into a single path. A merged path has no
leg to rotate, which is the whole problem. Look at any reference image and
*redraw* it as named parts:

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

## 2. Animate

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

Part paths may be shortened: `legNear.foot` resolves to
`body.legNear.thigh.shin.foot`. Ambiguous shorthands are an error, never a guess.

Animatable channels are `rotate`, `x`, `y`, `scaleX`, `scaleY`, `opacity`. That
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

## 3. Look at it

```bash
heron sheet scene.ts -n 8 -o sheet.png     # eight poses tiled - the default check
heron snapshot scene.ts -t 0.62 -o f.png   # one pose, e.g. the push-off frame
heron inspect scene.ts -t 0.3              # the same pose as numbers
heron lint scene.ts                        # defects invisible in a still frame
heron build scene.ts -o out.svg            # the deliverable
```

`sheet` is the one to reach for. Motion is a relationship between frames, so a
single screenshot cannot tell you whether a walk works. `inspect` is better than
an image when the question is geometric ("is the foot actually reaching the
ground?") — it prints world coordinates, contact points and bounding boxes.

## 4. Fix what lint reports

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
