/**
 * Purchase success for the Crane app.
 *
 * The loader resolves by collapsing its complete mark into the centre of the
 * ring. At the instant it becomes a point, that point unfolds into a single
 * check stroke. The zero-size handoff makes a many-shape logo read as one
 * continuous morph while keeping delivery to SVG and Lottie deterministic.
 */

import {
  arc, channelAt, character, easeIn, easeInOut, easeOut, keys, linear, part,
  path, sampled, score, type Channel, type Character,
} from '../src/index.ts';
import { bodyBob, walkCycle } from './lib/walk.ts';
import {
  BIRD, GROUND, SEGMENTS, craneRig, offsetFarLeg,
} from './lib/crane-rig.ts';

const INK = '#2C7C4D';
const FAR = '#84b39a';

const RING = { cx: 513, cy: 427.7, r: 359, width: 35.2 };
const INNER = RING.r - RING.width / 2;
const ANCHOR: [number, number] = [(BIRD.x0 + BIRD.x1) / 2, GROUND];
const FLOOR_Y = RING.cy + INNER - 85;
const SCALE = (2 * INNER) / Math.hypot(BIRD.x1 - BIRD.x0, BIRD.y1 - BIRD.y0);

const DURATION = 1.65;

export const craneSuccess: Character = character(
  'craneSuccess',
  { viewBox: [0, 0, 1024, 1024], duration: DURATION, ground: FLOOR_Y, once: true },
  () => {
    // One common pivot is the essential construction: every piece converges on
    // exactly the same point, rather than individually shrinking in place.
    part('mark', { pivot: [RING.cx, RING.cy] }, () => {
      part('ring', { pivot: [RING.cx, RING.cy] }, () => {
        arc({ cx: 513.1, cy: 427.7, r: 359.2, from: -102.2, to: 83.1, stroke: INK, width: RING.width });
        arc({ cx: 512.9, cy: 427.9, r: 359, from: -129.9, to: -248.6, stroke: INK, width: RING.width });
      });
      part('bird', { pivot: ANCHOR }, () => {
        craneRig({ ink: INK, far: FAR, weight: 1.25 });
      });
    });

    // The check is centred around the same pivot as the collapsing mark. Its
    // first visible fragment is therefore indistinguishable from the last dot
    // of the logo, which sells the handoff as a morph.
    part('check', { pivot: [RING.cx, RING.cy] }, () => {
      path({
        d: 'M 302 450 L 447 595 L 724 269',
        stroke: INK,
        width: 76,
        cap: 'round',
      });
    });
  },
);

export const beats = score(craneSuccess, [
  ['run', 0.38],
  ['collapse', 0.34],
  ['morph', 0.43],
  ['settle', 0.22],
  ['hold', 0],
]);

craneSuccess.part('bird').animate({
  x: keys([[0, RING.cx - ANCHOR[0]], [1, RING.cx - ANCHOR[0]]]),
  y: keys([[0, FLOOR_Y - ANCHOR[1]], [1, FLOOR_Y - ANCHOR[1]]]),
  scaleX: keys([[0, SCALE], [1, SCALE]]),
  scaleY: keys([[0, SCALE], [1, SCALE]]),
});
offsetFarLeg(craneSuccess, 'mark.bird');

const STANCE = 0.38;
const gait = walkCycle({
  stance: STANCE,
  reach: 30,
  facing: -1,
  segments: SEGMENTS,
  clearance: 90,
  stanceKnee: 15,
  kneeBreak: 62,
  toeTuck: -46,
});
const loaderCycles = DURATION / 0.8;
const cycling = (channel: Channel, lead: number): Channel => sampled(
  (t) => channelAt(channel, (t * loaderCycles + lead) % 1),
  180,
);

for (const [leg, lead] of [['legNear', 0], ['legFar', 0.5]] as const) {
  craneSuccess.part(`mark.bird.${leg}.thigh`).animate({ rotate: cycling(gait.thigh.rotate!, lead) });
  craneSuccess.part(`mark.bird.${leg}.shin`).animate({ rotate: cycling(gait.shin.rotate!, lead) });
  craneSuccess.part(`mark.bird.${leg}.foot`).animate({ rotate: cycling(gait.foot.rotate!, lead) });
}
const bob = bodyBob({ stance: STANCE, legLength: SEGMENTS[0] + SEGMENTS[1], reach: 30 });
craneSuccess.part('body').animate({ y: cycling(bob.y!, 0) });
craneSuccess.part('neck').animate({ rotate: keys([[0, -8], [1, -8]]) });

// The loader keeps moving during the opening, then the rotation accelerates a
// little into the collapse so the circle feels pulled into the centre.
craneSuccess.part('ring').animate({
  rotate: keys([
    [0, 0, linear],
    [beats.at('run').to, -171, easeIn],
    [beats.at('collapse').to, -360],
    [1, -360],
  ]),
});

const collapse = beats.at('collapse');
craneSuccess.part('mark').animate({
  scaleX: keys([
    [0, 1],
    [collapse.from, 1, easeIn],
    [collapse.to, 0.018],
    [1, 0.018],
  ]),
  scaleY: keys([
    [0, 1],
    [collapse.from, 1, easeIn],
    [collapse.to, 0.018],
    [1, 0.018],
  ]),
  opacity: keys([
    [0, 1],
    [collapse.to - 0.002, 1],
    [collapse.to, 0],
    [1, 0],
  ]),
});

const morph = beats.at('morph');
const settle = beats.at('settle');
craneSuccess.part('check').animate({
  draw: keys([
    [0, 0],
    [morph.from, 0, easeOut],
    [morph.to, 1],
    [1, 1],
  ]),
  opacity: keys([
    [0, 0],
    [morph.from, 0],
    [morph.from + 0.002, 1],
    [1, 1],
  ]),
  scaleX: keys([
    [0, 0.018],
    [morph.from, 0.018, easeOut],
    [morph.to, 1.08, easeInOut],
    [settle.to, 1],
    [1, 1],
  ]),
  scaleY: keys([
    [0, 0.018],
    [morph.from, 0.018, easeOut],
    [morph.to, 1.08, easeInOut],
    [settle.to, 1],
    [1, 1],
  ]),
  rotate: keys([
    [0, -38],
    [morph.from, -38, easeOut],
    [morph.to, 3, easeInOut],
    [settle.to, 0],
    [1, 0],
  ]),
});

export default craneSuccess;
