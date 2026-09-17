/**
 * The crane runs down a flight of stairs and pulls up beside its own name.
 *
 * This file is meant to read as a set of decisions, not as machinery. What is
 * left in it is: how the bird moves, what the stairs look like, how the letters
 * are drawn, and when each thing happens. Everything that used to sit alongside
 * those — the distance-driven gait, the inverted camera, the stand-blend at both
 * ends, the damped oscillators, the loop-seam bookkeeping — moved into the
 * library, because none of it was a decision about *this* scene.
 *
 * The three ideas it is built on, each now one call:
 *
 *   `journey()` travels. The gait is driven by distance rather than by the
 *   clock, so the cadence falls off with the speed and contact stays exact
 *   through the whole deceleration; the scroll speed is measured off the rig, so
 *   it cannot disagree with the legs; and the stairs are terrain, so a riser can
 *   only ever land in a flight phase.
 *
 *   `score()` is the timing. Beats in seconds, in the order they happen, and
 *   `during()` places a curve inside one in the beat's own local time — so
 *   moving the bow later means editing the score, not re-deriving four offsets.
 *
 *   Layers are the acting. A run, a recoil, a glance and a bow are four separate
 *   things stacked on one joint, and they stay four things all the way into the
 *   compiled file rather than being summed into an opaque closure first.
 */

import {
  arc, character, keys, layer, line, part, polygon, path, rect,
  aim, during, noise, score, shift, spring, settleTime,
  swell, easeOut, type Character, type Vec2,
} from '../src/index.ts';
import { walkCycle } from './lib/walk.ts';
import { journey, stairs, strideLength } from './lib/journey.ts';
import { GROUND, INK, SEGMENTS, craneAlone, craneRig, offsetFarLeg } from './lib/crane-rig.ts';

// --- the gait ----------------------------------------------------------------
// Stance below 0.5 is what makes this a run and not a fast walk: the two stance
// phases stop overlapping, and the gap between them is a flight phase.

const STANCE = 0.36;

const gait = walkCycle({
  stance: STANCE,
  reach: 32,
  // The beak points left, so the bird runs left.
  facing: -1,
  segments: SEGMENTS,
  clearance: 96,
  // A running leg lands bent and absorbs, where a walking leg lands locked.
  stanceKnee: 15,
  kneeBreak: 62,
  toeTuck: -46,
});

// --- the ground --------------------------------------------------------------

/**
 * Every distance in this scene is a multiple of the stride, and the stride is
 * measured off the rig rather than chosen. Stairs sized this way cannot put a
 * riser under a planted foot, at any reach or leg length.
 */
export const STRIDE = strideLength(craneAlone('strideProbe', 1), 'legNear', gait, STANCE);

/** One stair per footfall, so no tread boundary can fall mid-stance. */
const TREAD = STRIDE / 2;
const RISE = 130;
const STEPS = 10;
const TREADS = 13;
const TRAVEL = TREADS * TREAD;

const terrain = stairs({ tread: TREAD, rise: RISE, steps: STEPS, stance: STANCE });
const FLOOR = STEPS * RISE;

// --- the timeline ------------------------------------------------------------
// Named beats in the order they happen. Nothing below computes an offset.

const DURATION = 7;

/**
 * The recoil is a spring, so its beat is a measurement rather than a guess.
 *
 * Everything above the legs carries no weight, so when the feet stop it keeps
 * going. `settleTime` says how long that takes at this stiffness, and that is
 * then how long the beat is. It is also a check on the physics: the first
 * stiffness tried here rang for 1.8 seconds, which the score refused to fit —
 * correctly, because a bird's neck does not wobble for two seconds. Tuning it
 * until it fit was tuning it until it was right.
 */
const RECOIL = { swing: 26, stiffness: 420, damping: 18 };
const RUN = 3.8;
const beats = score(DURATION, [
  ['run', RUN],
  ['recover', settleTime(RECOIL)],
  ['look', 0.4],
  ['bow', 0.5],
  ['hold', 0],
  ['fade', 0.4],
  ['reset', 0.3],
  ['rise', 0.4],
]);

// --- the drawing -------------------------------------------------------------

const SKY = '#f2f7f4';
const STONE = '#dceee4';
const EDGE = '#b4d8c4';
/** The bird's ankle at rest. The world's coordinates are anchored to it. */
const ANCHOR = 507.5;

/** The staircase, drawn from the same profile the camera and the gait read. */
function staircase(): void {
  const right = ANCHOR + 3 * TREAD;
  const left = ANCHOR - 19 * TREAD;
  const top: Vec2[] = [[right, GROUND]];
  // Drawn from the terrain's own edges, so the silhouette cannot disagree with
  // the ground the feet are standing on.
  terrain.edges.forEach((d, k) => {
    top.push([ANCHOR - d, GROUND + k * RISE], [ANCHOR - d, GROUND + (k + 1) * RISE]);
  });
  top.push([left, GROUND + FLOOR]);

  const deep = GROUND + FLOOR + 4000;
  polygon({ points: [...top, [left, deep], [right, deep]], fill: STONE });
  path({ d: `M${top.map((p) => p.join(',')).join(' L')}`, stroke: EDGE, width: 14 });
}

// --- the wordmark ------------------------------------------------------------
// Drawn rather than typeset, for the same reason the bird is: a self-contained
// SVG cannot carry a font, and `font-family` is a request the viewer's machine
// is free to decline. Same monoline geometry as the mark — circles, one radius,
// one pen — so the two sit together as one lockup. Being strokes is also what
// lets the word draw itself on.

const PEN = 40;
const CAP = 260;
const XH = 182;
const TRACK = 58;
const WIDTHS = [CAP, 78, XH, XH, XH];
const WORD_W = WIDTHS.reduce((a, b) => a + b) + TRACK * (WIDTHS.length - 1);

function wordCrane(x0: number, base: number): void {
  const stroke = INK;
  const width = PEN;
  const r = XH / 2;
  let x = x0;
  let letter = 0;
  const next = () => { x += WIDTHS[letter++] + TRACK; };

  arc({ cx: x + CAP / 2, cy: base - CAP / 2, r: CAP / 2, from: 55, to: 305, stroke, width });
  next();

  line({ from: [x, base], to: [x, base - XH], stroke, width });
  arc({ cx: x + 62, cy: base - XH + 62, r: 62, from: 180, to: 285, stroke, width });
  next();

  arc({ cx: x + r, cy: base - r, r, stroke, width });
  line({ from: [x + XH, base], to: [x + XH, base - XH], stroke, width });
  next();

  line({ from: [x, base], to: [x, base - XH], stroke, width });
  arc({ cx: x + r, cy: base - r, r, from: 180, to: 360, stroke, width });
  line({ from: [x + XH, base - r], to: [x + XH, base], stroke, width });
  next();

  arc({ cx: x + r, cy: base - r, r, from: 45, to: 360, stroke, width });
  line({ from: [x, base - r], to: [x + XH, base - r], stroke, width });
}

// --- the scene ---------------------------------------------------------------

/**
 * Where the wordmark's right edge finishes.
 *
 * Further right than the bird's leftmost ink, deliberately. The beak reaches
 * x=260 but does so 600 units above the wordmark's cap line; the only thing
 * beside the word is the legs, at x=470. Setting this from a bounding box would
 * leave a gap the size of the empty space above the bird's own back.
 */
const WORD_END = 250;
const WORD_X = WORD_END - WORD_W;
/**
 * Where it comes to rest *on screen*, which is the same line the bird stands on.
 *
 * Worth naming, because the word is drawn somewhere else entirely: `TRAVEL` to
 * the left and `FLOOR` further down, in the world's own coordinates, and carried
 * here by the scroll. Anything outside the world — the bird, and where it looks
 * — is in screen coordinates, and mixing the two is a mistake with no symptom
 * until something aims at the wrong place.
 */
const WORD_BASE = GROUND;

/**
 * Wide, and deliberately not centred on the final lockup.
 *
 * The bird sits where its own measured coordinates put it, right of centre,
 * which is where a character travelling left belongs: the room in front of it is
 * room to see what it is running towards. That room is also what buys the
 * wordmark its entrance.
 */
const VIEW: [number, number, number, number] = [-1258, -200, 2338, 1500];

export const craneStairs: Character = character(
  'craneStairs',
  { viewBox: VIEW, duration: DURATION, ground: GROUND },
  () => {
    // Outside the fading layer, so the scene dissolves into the sky rather than
    // into a hole.
    rect({ x: VIEW[0], y: VIEW[1], w: VIEW[2], h: VIEW[3], fill: SKY });
    layer('scene', () => {
      layer('world', { offstage: true }, () => {
        staircase();
        // Its own part, so the word can draw itself independently of the scroll.
        part('word', () => wordCrane(WORD_X - TRAVEL, WORD_BASE + FLOOR));
      });
      craneRig();
    });
  },
);

// --- motion ------------------------------------------------------------------

offsetFarLeg(craneStairs);

/**
 * The whole of the travelling: legs, camera, stairs and bob, from one number.
 *
 * The bird never translates — the world does, which is what keeps `ground` a
 * single value while a staircase descends 1300 units past it.
 */
const run = journey(craneStairs, {
  gait,
  stance: STANCE,
  legs: ['legNear', 'legFar'],
  world: 'world',
  // One stretch of travelling, and it is the `run` beat: the whole distance
  // between the moments the beat already names. The cadence follows from the
  // two, which is why there is no stride rate written down anywhere here.
  moves: [{ ...beats.at('run'), distance: TRAVEL, launch: 0.1, brake: 0.2 }],
  terrain,
  stride: STRIDE,
  bob: 34,
  home: [beats.at('reset').from, beats.at('reset').to],
});

craneStairs.part('scene').animate({
  opacity: keys([
    [0, 1],
    [beats.at('fade').from, 1],
    [beats.at('reset').from, 0],
    [beats.at('rise').from, 0],
    [1, 1],
  ]),
});

/**
 * The word writes itself on as the bird runs up to it, one pen from the left.
 *
 * `draw` is `stroke-dashoffset` under the hood, which CSS animates natively — so
 * the whole reveal compiles exact and costs a few hundred bytes. It is also the
 * one effect this wordmark was already built for: every letter is a stroke, so
 * there is a pen path to follow.
 */
craneStairs.part('word').animate({
  draw: keys([
    [0, 0],
    [beats.at('run').to * 0.58, 0],
    [beats.at('look').from, 1],
    [beats.at('reset').from, 1],
    // Un-drawn while the fade covers it, so the cycle opens on a blank floor.
    [beats.at('rise').from, 0],
    [1, 0],
  ], easeOut),
});

// --- the acting --------------------------------------------------------------
// One layer per idea. They stack, so none of them has to know about the others,
// and each compiles on its own terms.

const wing = craneStairs.part('wing');
const neck = craneStairs.part('neck');
const head = craneStairs.part('head');

/**
 * Two flaps a stride, achieving nothing.
 *
 * Small on purpose. The wing is a 250-unit stroke pivoted at one end, so every
 * degree moves the tip four units; at the fifteen degrees this started on the
 * stroke left the body and read as a snapped bone.
 */
wing.animate({ rotate: run.riding(5.5, 2) });

/** The neck lags the legs and the head over-corrects the neck. Both stop with them. */
neck.animate({ rotate: run.riding(17, 1, 0.12) });
head.animate({ rotate: run.riding(-22, 1, 0.22) });

/**
 * The stop rings out through everything that carries no weight.
 *
 * One spring, three amplitudes. The head gets the largest because it is furthest
 * from the feet and has the least holding it — which is the physical reason, and
 * also why it is the funny one.
 */
const recover = beats.at('recover');
neck.animate({ rotate: during(recover, spring(RECOIL)) });
head.animate({ rotate: during(recover, spring({ ...RECOIL, swing: -34 })) });
wing.animate({ rotate: during(recover, spring({ ...RECOIL, swing: 11, damping: 26 })) });

/**
 * Then it looks at the word, and the angle is solved rather than guessed.
 *
 * The beak sits up and to the left of the head's pivot, so the turn that swings
 * it *down* towards a word on the floor is negative — and the positive one that
 * reads like "dip" tucks it back over the bird's own shoulder instead. That sign
 * was wrong for a whole render cycle before `aim` existed to answer it.
 */
const GLANCE: Vec2 = [WORD_END - WORD_W / 2, WORD_BASE - CAP / 2];
const BEAK: Vec2 = [260.6, 63.8];
const turn = aim(craneStairs, 'head', { marker: BEAK, target: GLANCE, t: beats.at('look').from });
head.animate({ rotate: during(beats.at('look'), shift(turn * 0.55)) });
neck.animate({ rotate: during(beats.at('look'), shift(-7)) });

/** And takes a bow. Negative lifts the wing: the tip is down and to the right. */
wing.animate({ rotate: during(beats.at('bow'), swell(-20)) });

/**
 * Nothing alive is ever completely still.
 *
 * Without this the bird is a paused video for the last two seconds. Banded
 * harmonics at whole numbers of cycles per cycle, so it is exactly periodic and
 * closes its own seam; seeded, so every build produces the same drift.
 */
neck.animate({ rotate: noise(1.6, { rate: 2, seed: 11 }) });
head.animate({ rotate: noise(2.4, { rate: 3, seed: 5 }) });

/** Undone while the fade covers it, so the cycle can start where it started. */
const reset = beats.at('reset');
head.animate({ rotate: during(reset, shift(-turn * 0.55)) });
neck.animate({ rotate: during(reset, shift(7)) });

export { beats, run };
export default craneStairs;
