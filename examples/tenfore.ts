/**
 * The Tenfore crane mark, redrawn as a rig and walked.
 *
 * The source is a line-art logo: a heron standing on one leg inside a broken
 * ring. Two things had to change to make it move.
 *
 *   - The tucked leg becomes a real second leg. A one-legged bird cannot walk,
 *     and the tuck is a *pose*, not anatomy.
 *   - The ring stays put. It is the frame the bird stands in, not part of the
 *     bird, so it must not bob with the body — hence it lives outside `body`.
 *
 * Everything is drawn in code rather than traced, because a traced path has no
 * leg to rotate.
 */

import {
  character, part, layer, line, ellipse, path, arc, through,
  type Character, type Vec2,
} from '../src/index.ts';
import { walkCycle, bodyBob, sway, applyGait } from './lib/walk.ts';

const GREEN = '#37995d';
// The mark is monochrome, but two legs in one colour read as one leg. A lighter
// tint is the cheapest way to buy depth.
const FAR = '#8fc7a8';

const RING_W = 30;
const LINE_W = 30;

const RING = { cx: 513, cy: 424, r: 361 };

// --- the bird ----------------------------------------------------------------

const HIP_NEAR: Vec2 = [500, 588];
const HIP_FAR: Vec2 = [556, 583];
const SEGMENTS: [number, number] = [175, 172];
const GROUND = 966;

/**
 * One leg, in the mark's own idiom: a straight shaft with a flat elliptical
 * foot. `limb()` would draw a toe-and-heel foot, which is right for a generic
 * character and wrong for this logo.
 */
function leg(name: string, hip: Vec2, stroke: string): void {
  const [hx, hy] = hip;
  const knee: Vec2 = [hx, hy + SEGMENTS[0]];
  const ankle: Vec2 = [hx, hy + SEGMENTS[0] + SEGMENTS[1]];

  part(name, () => {
    part('thigh', { pivot: hip }, () => {
      line({ from: hip, to: knee, stroke, width: 26 });
      part('shin', { pivot: knee }, () => {
        line({ from: knee, to: ankle, stroke, width: 26 });
        // The sole is the bottom of the ellipse, directly below the ankle.
        part('foot', { pivot: ankle, contact: [ankle[0], ankle[1] + 31] }, () => {
          ellipse({ cx: ankle[0], cy: ankle[1] + 15, rx: 62, ry: 16, fill: stroke });
        });
      });
    });
  });
}

export const tenfore: Character = character(
  'tenfore',
  { viewBox: [110, 30, 800, 970], duration: 1.25, ground: GROUND },
  () => {
    // Static frame. Declared outside `body` so the bob never moves it.
    layer('frame', () => {
      // Two arcs, not one: the mark's ring is broken where the beak crosses it
      // at the top left, and again at the bottom right.
      arc({ ...RING, from: 85, to: 234, stroke: GREEN, width: RING_W, cap: 'round' });
      arc({ ...RING, from: 252, to: 419, stroke: GREEN, width: RING_W, cap: 'round' });
    });

    part('body', { pivot: [500, 470] }, () => {
      leg('legFar', HIP_FAR, FAR);

      // Every outline below is a list of points that lie ON the curve, so each
      // one is a position readable straight off the reference art. None of them
      // is a Bezier handle that has to be guessed and then corrected by render.

      // Back and tail: one sweep from the neck root out to the tail tip.
      through([[368, 378], [462, 347], [566, 376], [652, 466], [706, 606]],
        { stroke: GREEN, width: LINE_W });
      // Breast and belly, closing under the tail.
      through([[336, 432], [338, 510], [396, 566], [507, 586], [662, 574]],
        { stroke: GREEN, width: LINE_W });
      // Folded wing.
      through([[402, 410], [470, 506], [578, 562]], { stroke: GREEN, width: LINE_W });

      part('neck', { pivot: [352, 400] }, () => {
        // The neck is a tube: two near-parallel edges bulging left on the way up.
        through([[336, 432], [302, 349], [306, 262], [326, 203], [352, 158]],
          { stroke: GREEN, width: 26 });
        through([[368, 382], [354, 304], [368, 234], [390, 206], [414, 202]],
          { stroke: GREEN, width: 26 });

        part('head', { pivot: [412, 204] }, () => {
          // The crown hooks over from the beak and back down into the throat,
          // leaving the open notch the mark has rather than a closed loop.
          //
          // Also stays a `d` string, for the opposite reason to the beak: the
          // hook is tight, and curvature is exactly what a Bezier handle buys
          // cheaply. Pinning this down with on-curve points took nine of them
          // and still read rounder. `through` is for long organic runs.
          path({ d: 'M390,130 C424,94 460,114 456,158 C452,198 428,212 410,206', stroke: GREEN, width: 26 });
          // Stays a `d` string on purpose. The beak is a sharp tip and a flat
          // base, and `through` smooths every vertex it is given, so it would
          // round the point off. Corners are what plain `path` is still for.
          path({ d: 'M247,54 C290,66 340,96 384,134 L358,172 C318,138 276,98 247,54 Z', fill: GREEN });
        });
      });

      leg('legNear', HIP_NEAR, GREEN);
    });
  },
);

// --- motion ------------------------------------------------------------------

const STANCE = 0.62;
const REACH = 13;

const gait = walkCycle({
  stance: STANCE,
  reach: REACH,
  // The mark's beak points left, so the bird walks left. Without this it keeps
  // a perfect constant-speed contact while travelling backwards.
  facing: -1,
  segments: SEGMENTS,
  clearance: 42,
  stanceKnee: 6,
  kneeBreak: 22,
  toeTuck: -20,
});

applyGait(tenfore, 'legNear', gait);
applyGait(tenfore, 'legFar', gait, 0.5);

tenfore.part('body').animate(
  bodyBob({ stance: STANCE, legLength: SEGMENTS[0] + SEGMENTS[1], reach: REACH }),
);
tenfore.part('neck').animate(sway(2, { stance: STANCE }));
tenfore.part('head').animate(sway(-1.5, { stance: STANCE }));

export default tenfore;
