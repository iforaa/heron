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
  character, part, layer, line, ellipse, path,
  walkCycle, bodyBob, sway, applyGait,
  type Character, type Vec2,
} from '../src/index.ts';

const GREEN = '#37995d';
// The mark is monochrome, but two legs in one colour read as one leg. A lighter
// tint is the cheapest way to buy depth.
const FAR = '#8fc7a8';

const RING_W = 30;
const LINE_W = 30;

// --- the ring ----------------------------------------------------------------

const CX = 513;
const CY = 424;
const R = 361;

/** Arc of the ring between two clockwise-from-3-o'clock angles. */
function ring(a0: number, a1: number): string {
  const at = (a: number): Vec2 => [
    CX + R * Math.cos((a * Math.PI) / 180),
    CY + R * Math.sin((a * Math.PI) / 180),
  ];
  const [x0, y0] = at(a0);
  const [x1, y1] = at(a1);
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

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
      path({ d: ring(85, 234), stroke: GREEN, width: RING_W, cap: 'round' });
      path({ d: ring(252, 419), stroke: GREEN, width: RING_W, cap: 'round' });
    });

    part('body', { pivot: [500, 470] }, () => {
      leg('legFar', HIP_FAR, FAR);

      // Back and tail: one sweep from the neck root out to the tail tip.
      path({ d: 'M368,378 C420,338 500,336 566,376 C632,416 682,500 706,606', stroke: GREEN, width: LINE_W });
      // Breast and belly, closing under the tail.
      path({ d: 'M336,432 C318,486 340,540 396,566 C452,590 546,592 662,574', stroke: GREEN, width: LINE_W });
      // Folded wing.
      path({ d: 'M402,410 C432,486 494,540 578,562', stroke: GREEN, width: LINE_W });

      part('neck', { pivot: [352, 400] }, () => {
        // The neck is a tube: two near-parallel edges bulging left on the way up.
        path({ d: 'M336,432 C300,380 292,320 306,262 C316,220 334,182 352,158', stroke: GREEN, width: 26 });
        path({ d: 'M368,382 C350,328 348,276 368,234 C380,208 398,196 414,202', stroke: GREEN, width: 26 });

        part('head', { pivot: [412, 204] }, () => {
          // The crown hooks over from the beak and back down into the throat,
          // leaving the open notch the mark has rather than a closed loop.
          path({ d: 'M390,130 C424,94 460,114 456,158 C452,198 428,212 410,206', stroke: GREEN, width: 26 });
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
