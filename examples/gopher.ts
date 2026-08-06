/**
 * A golf-course gopher: short, round, low-slung, with a blunt snout, buck teeth
 * and stubby legs. Drawn as named parts so the walk is a rig, not a redraw.
 *
 * Proportions are the opposite of the crane's: the crane is a tall thin bird
 * balanced on long legs, the gopher is a pear on two 28-unit stumps.
 */

import {
  character, part, limb, ellipse, circle, rect, path, line,
  keys, easeInOut,
  type Character, type Vec2,
} from '../src/index.ts';
import { walkCycle, bodyBob, sway, pulse, applyGait } from './lib/walk.ts';

const FUR = '#c98d4d';
const FUR_DARK = '#a97036';
const BELLY = '#f0d9ab';
const NEAR_LIMB = '#b07c3f';
const FAR_LIMB = '#7d5427';
const CHEEK = '#d69c5e';
const ARM = '#9d6b31';
const DARK = '#463523';
const TOOTH = '#fffaf0';

const GROUND = 178;
const HIP_Y = 142;
const SEGMENTS: [number, number] = [17, 15];
const WIDTHS: [number, number, number] = [12, 10, 7];
// A small paw relative to the leg. A long toe on a short leg swings through the
// floor during the reach for touchdown, which is what the ground lints catch.
const PAW = { toe: [9, 4] as Vec2, heel: [-6, 4] as Vec2 };

export const gopher: Character = character(
  'gopher',
  { viewBox: [26, 8, 142, 184], duration: 0.95, ground: GROUND },
  () => {
    part('shadow', { pivot: [88, 181] }, () => {
      ellipse({ cx: 88, cy: 181, rx: 44, ry: 5, fill: '#c9b189', opacity: 0.45 });
    });

    part('body', { pivot: [90, 140] }, () => {
      // Far side first: it reads as depth because the torso covers it.
      limb('legFar', { hip: [82, HIP_Y], segments: SEGMENTS, stroke: FAR_LIMB, widths: WIDTHS, foot: PAW });

      part('tail', { pivot: [48, 142] }, () => {
        path({ d: 'M48,142 C40,141 34,136 32,128', stroke: FUR_DARK, width: 6 });
      });

      part('armFar', { pivot: [96, 99] }, () => {
        line({ from: [96, 99], to: [100, 110], stroke: FAR_LIMB, width: 7 });
        circle({ cx: 101, cy: 112, r: 5, fill: FAR_LIMB });
      });

      // Torso: a heavy pear, wide at the rump and tucked in at the chest. The
      // dark ellipse sits a few units back and up so it leaves a rim of darker
      // fur along the spine and rump.
      ellipse({ cx: 78, cy: 132, rx: 42, ry: 35, fill: FUR_DARK });
      ellipse({ cx: 83, cy: 135, rx: 39, ry: 32, fill: FUR });
      ellipse({ cx: 100, cy: 118, rx: 25, ry: 25, fill: FUR });
      ellipse({ cx: 102, cy: 131, rx: 20, ry: 26, fill: BELLY });

      // A short neck, narrower than either the skull or the chest. Without this
      // notch the two round masses merge and the whole thing reads as a snowman.
      ellipse({ cx: 106, cy: 92, rx: 15, ry: 12, fill: FUR });

      part('head', { pivot: [106, 92] }, () => {
        // Small round ears set high and well back on the skull. Placed forward
        // or made any larger they immediately read as a rabbit.
        circle({ cx: 86, cy: 32, r: 8, fill: FUR_DARK });

        // Skull: wide and low-browed.
        ellipse({ cx: 112, cy: 56, rx: 32, ry: 29, fill: FUR });

        circle({ cx: 101, cy: 30, r: 8, fill: FUR });
        circle({ cx: 101, cy: 31, r: 3.4, fill: '#d99a8f' });

        // Cheek pouch, the thing that makes a gopher a gopher. A shade lighter
        // than the skull so the pouch reads as a separate mass.
        ellipse({ cx: 122, cy: 70, rx: 20, ry: 15, fill: CHEEK });

        // Blunt snout, jutting forward off the top of the pouch.
        ellipse({ cx: 138, cy: 60, rx: 16, ry: 12, fill: BELLY });

        // Whiskers first, so the teeth cover their roots.
        line({ from: [140, 72], to: [155, 77], stroke: '#b39468', width: 1 });
        line({ from: [141, 67], to: [157, 66], stroke: '#b39468', width: 1 });

        // Dark mouth, drawn wider than the incisors so a rim of it shows all
        // round them. Without it the teeth are cream-on-cream and read as a
        // sticker rather than as teeth.
        ellipse({ cx: 147, cy: 71, rx: 11, ry: 8, fill: '#6f4232' });
        rect({ x: 141, y: 65, w: 6, h: 14, radius: 1.5, fill: TOOTH, stroke: '#c7ac82', width: 0.8 });
        rect({ x: 148, y: 65, w: 6, h: 12, radius: 1.5, fill: TOOTH, stroke: '#c7ac82', width: 0.8 });

        ellipse({ cx: 148, cy: 55, rx: 5, ry: 4, fill: DARK });

        circle({ cx: 106, cy: 40, r: 3.8, fill: DARK });
        circle({ cx: 126, cy: 41, r: 5, fill: DARK });
        circle({ cx: 127.4, cy: 39.4, r: 1.8, fill: '#ffffff' });
      });

      // Short forepaw held high against the chest. Any longer and it reads as a
      // second thigh, because it is the same colour and thickness as the leg
      // that emerges just below it.
      part('armNear', { pivot: [105, 100] }, () => {
        line({ from: [105, 100], to: [111, 111], stroke: ARM, width: 8 });
        circle({ cx: 113, cy: 113, r: 5.5, fill: ARM });
      });

      limb('legNear', { hip: [100, HIP_Y], segments: SEGMENTS, stroke: NEAR_LIMB, widths: WIDTHS, foot: PAW });
    });
  },
);

// --- motion ------------------------------------------------------------------

/*
 * The gait is written out by hand rather than taken from `walkCycle`, because
 * the preset's shape does not survive this leg length. Two things break:
 *
 *   Clearance. Knee flexion lifts the ankle by `shin * (1 - cos(lift))`. On the
 *   crane's 32-unit shin that is 9 units; on this 15-unit shin the same angle
 *   buys 3.5, and the swing paw scrapes the floor for the entire cycle — the
 *   ground lint reports the contact point as planted at all 60 samples. Most of
 *   the lift here has to come from tucking the paw, not from the knee.
 *
 *   Touchdown. `walkCycle` finishes extending the leg at `settle` and lands
 *   there, which works when the stride is long relative to the paw. Here the
 *   paw is a third of the stride, so unwinding the tuck swings the toe down into
 *   the floor while the leg is still travelling forward fast, and it skates on
 *   landing. So the thigh reaches its forward extreme early (TSET) and is
 *   already sweeping backward at the stance rate for the last 15% of the cycle,
 *   with the leg extending into that backward sweep.
 */

const STANCE = 0.6;
const REACH = 22;

/**
 * Short legs need a *larger* knee break than long ones for the same clearance,
 * because clearance is `shin * (1 - cos lift)`. Passing `segments` lets that be
 * solved instead of guessed — copying the crane's angles here would leave the
 * paws dragging along the floor for the whole cycle.
 *
 * `pushLead` reintroduces a small heel-lift before push-off, which this
 * character can afford: its paw is short enough that rotating about the ankle
 * does not drag the toe noticeably. `peak`, `settle` and `extendAt` come early
 * because the stride is short relative to the paw, so the leg has to be
 * straight and retracting well before touchdown.
 */
const gait = walkCycle({
  stance: STANCE,
  reach: REACH,
  segments: SEGMENTS,
  clearance: 5,
  stanceKnee: 8,
  kneeBreak: 45,
  toeTuck: -80,
  pushLead: 0.04,
  peak: 0.72,
  settle: 0.85,
  extendAt: 0.9,
});

applyGait(gopher, 'legNear', gait);
applyGait(gopher, 'legFar', gait, 0.5);

gopher.part('body').animate(bodyBob({ stance: STANCE, legLength: SEGMENTS[0] + SEGMENTS[1], reach: REACH }));

// The head bounces a beat behind the body; the tail flicks with the near leg.
gopher.part('head').animate(sway(3.5, { stance: STANCE }));
gopher.part('tail').animate(sway(-9, { stance: STANCE }));

// Arms counter-swing against the legs on their own side.
gopher.part('armNear').animate({ rotate: keys([[0, 20], [STANCE, -18], [1, 20]], easeInOut) });
gopher.part('armFar').animate({ rotate: keys([[0, -18], [STANCE, 20], [1, -18]], easeInOut) });

gopher.part('shadow').animate({
  scaleX: pulse(1.05, 0.95, STANCE),
  opacity: pulse(0.5, 0.4, STANCE),
});

export default gopher;
