/**
 * A jackrabbit hops three times, and the name arrives.
 *
 * Drawn in the Tenfore mark's own idiom — green monoline, one weight, a lighter
 * tint for whatever is on the far side — so it reads as a sibling of the crane
 * rather than a new character. The film plays once: three hops, a beat of
 * stillness, and TENFORE draws itself under the ground line.
 *
 * The pose is the alert stand, not the sit. An upright hare carries its front
 * paws tucked against the chest, which is not a styling choice here: paws that
 * never approach the floor cannot poke through it at the bottom of a crouch,
 * so the whole front of the animal stays honest without a single keyframe.
 *
 * The hind legs are a real limb chain driven by `jump`, so the crouch folds
 * about the planted foot instead of sliding it. The big haunch circle rides the
 * body and covers the thigh, which is how a rabbit's folded leg actually reads —
 * the silhouette is the haunch, and only the shin and the long foot show.
 */

import {
  character, circle, ellipse, keys, layer, limb, line, part, ribbon, strokeText, through,
  during, score, within,
  easeOut, type Vec2,
} from '../src/index.ts';
import { hops, jump } from './lib/jump.ts';

const GREEN = '#37995d';
const FAR = '#8fc7a8';
const BELLY = '#bfe2cf';
const INK = '#1f5c38';
const W = 26;

const VIEW: [number, number, number, number] = [0, -50, 900, 810];
const GROUND = 580;

// The hind chain, straight down from the hip like every rig here. The visible
// crouch comes from `jump` folding it, not from the rest pose.
const HIP: Vec2 = [370, 430];
const SEGMENTS: [number, number] = [75, 75];

// Long foot, because that is the animal. The toe is most of it.
const FOOT = { toe: [60, 3] as Vec2, heel: [-10, 3] as Vec2 };

const DURATION = 6.2;

const beats = score(DURATION, [
  ['hop', 2.6],
  ['settle', 0.45],
  ['reveal', 1.4],
  ['hold', 1.75],
]);

export const jackrabbit = character(
  'jackrabbit',
  { viewBox: VIEW, duration: DURATION, ground: GROUND, once: true },
  () => {
    part('body', { pivot: [370, 430] }, () => {
      // Far side first: declaration order is z-order.
      limb('legFar', {
        hip: [382, 428], segments: SEGMENTS, stroke: FAR,
        widths: [W - 4, W - 7, W - 8],
        foot: FOOT,
      });

      /**
       * A far ear as a ribbon: narrow at the base, widest through the middle,
       * closing to a near-point. Constant-width strokes here read as antennae —
       * the blade profile is what makes an ear an ear.
       */
      part('earFar', { pivot: [432, 306] }, () => {
        ribbon([[432, 306], [419, 234], [420, 162]], [6.5, 11, 3.5], { fill: FAR });
      });

      /**
       * The body is directional ellipses, not circles — the gopher's lesson,
       * learned here the same way: a chain of discs read as an ant, a mantis
       * and a snowman across three drafts. A wide haunch, a torso rising
       * forward, and a neck strictly narrower than both skull and chest are
       * what let one flat colour carry the anatomy.
       */
      ellipse({ cx: 352, cy: 448, rx: 62, ry: 56, fill: GREEN });   // haunch
      circle({ cx: 296, cy: 445, r: 14, fill: GREEN });             // scut
      ellipse({ cx: 398, cy: 396, rx: 40, ry: 46, fill: GREEN });   // torso
      ellipse({ cx: 403, cy: 444, rx: 14, ry: 18, fill: BELLY });   // belly light
      ellipse({ cx: 428, cy: 340, rx: 15, ry: 14, fill: GREEN });   // neck notch

      // Tucked front paws, hung off the chest — low, and thin enough to stay
      // paws. The near one is the dark ink; a green paw on the green torso
      // simply vanished, and a thick dark one read as a wattle.
      through([[432, 372], [448, 392], [442, 412]], { stroke: FAR, width: 9 });
      through([[420, 378], [436, 398], [430, 418]], { stroke: INK, width: 10 });

      part('head', { pivot: [428, 340] }, () => {
        circle({ cx: 437, cy: 328, r: 12, fill: GREEN });           // fills the neck seam
        ellipse({ cx: 443, cy: 317, rx: 22, ry: 19, fill: GREEN }); // skull, wide and low
        ellipse({ cx: 468, cy: 325, rx: 12, ry: 9, fill: GREEN });  // muzzle
        circle({ cx: 477, cy: 322, r: 3.5, fill: INK });            // nose
        circle({ cx: 448, cy: 311, r: 6.5, fill: '#ffffff' });      // eye
        circle({ cx: 450, cy: 312, r: 3, fill: INK });              // pupil

        part('earNear', { pivot: [448, 303] }, () => {
          ribbon([[448, 303], [464, 230], [463, 158]], [7, 12, 4], { fill: GREEN });
        });
      });

      limb('legNear', {
        hip: HIP, segments: SEGMENTS, stroke: GREEN,
        widths: [W, W - 4, W - 6],
        foot: FOOT,
      });
    });

    layer('groundLine', () => {
      line({ from: [230, GROUND + 14], to: [670, GROUND + 14], stroke: FAR, width: 6 });
    });

    layer('title', () => strokeText('TENFORE', {
      x: 450, y: 690, size: 44, align: 'center', tracking: 0.4,
      stroke: GREEN, width: 5,
    }));
  },
);

// --- the hopping -------------------------------------------------------------

/**
 * Three hops in place. `jump` takes only where the hip goes and solves the fold
 * about the planted feet, so nothing sinks and nothing skates.
 */
const HOP = { height: 150, crouch: 38 };
const hop = beats.at('hop');

jump(jackrabbit, {
  legs: ['body.legNear', 'body.legFar'],
  body: 'body',
  segments: SEGMENTS,
  facing: 1,
  tuck: 30,
  lift: during(hop, hops(3, HOP)),
});

/**
 * The ears trail the hop. Same curve as the body's lift, scaled negative — the
 * ears lay back as the body rises and stand again as it lands, which is the
 * whole of what floppy means. The far ear a touch more, being longer of lever.
 */
const EAR = -16 / HOP.height;
jackrabbit.part('body.head.earNear').animate({
  rotate: during(hop, hops(3, { height: HOP.height * EAR, crouch: HOP.crouch * EAR })),
});
jackrabbit.part('body.earFar').animate({
  rotate: during(hop, hops(3, { height: HOP.height * EAR * 1.35, crouch: HOP.crouch * EAR * 1.35 })),
});

/** A lean into each launch, from the same lift so it can never mistime. */
const LEAN = 7 / HOP.height;
jackrabbit.part('body').animate({
  rotate: during(hop, hops(3, { height: HOP.height * LEAN, crouch: -HOP.crouch * LEAN })),
});

// --- the title ---------------------------------------------------------------

jackrabbit.part('groundLine').animate({
  draw: keys([[0, 0], [0.1, 1, easeOut], [1, 1]]),
});

jackrabbit.part('title').animate({
  draw: within(beats.at('reveal'), keys([[0, 0, easeOut], [1, 1]])),
});
