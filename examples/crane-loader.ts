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
