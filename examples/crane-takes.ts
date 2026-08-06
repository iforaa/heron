/**
 * One walk, nine amounts of ride, so the amount can be chosen instead of guessed.
 *
 * `crane-family.ts` carries this comment above three hand-tuned constants:
 *
 *   "Larger than this and the neck and head swing against each other hard enough
 *    to fold the beak down over its own back twice a step."
 *
 * That is a real finding and a real threshold, and it was found the expensive way
 * — animate, render, look, adjust, render again — with the answer left behind as a
 * bare `9` and `-11` that no later reader can check or move safely. The numbers are
 * not derivable: how much neck a walking bird should carry is a question about how
 * it reads, not about physics.
 *
 * This grid asks that *kind* of question, not that exact one: the chick's ride is
 * carried by `trot.riding` with a per-part lag, where this uses a plain `sway` on a
 * single bird. So the numbers below are not drop-in replacements for the family
 * scene's — they demonstrate the method on the same rig.
 *
 * A grid asks the question properly. Nine builds, one image, and the fold is
 * visible as a loop in the beak's trajectory rather than as a thing you have to
 * already know to look for:
 *
 *   heron variants examples/crane-takes.ts --motion body.neck.head@260,64 --strip 3
 *   heron variants examples/crane-takes.ts --motion body.neck.head@260,64 --only neck=9
 *
 * The rig is `crane-rig.ts`'s, reached through the `craneAlone` factory that
 * `crane-stairs.ts` already uses to measure a stride — a scene being a function of
 * its numbers is an idiom this project had before it had a grid to exercise it.
 */

import { grid, type Character, type Variant } from '../src/index.ts';
import { applyGait, sway, walkCycle } from './lib/walk.ts';
import { SEGMENTS, craneAlone, offsetFarLeg } from './crane-rig.ts';

// The same run `crane-stairs.ts` uses. Copied rather than imported: importing a
// scene module would build its whole 7-second film as a side effect just to read
// two constants. If that run is ever retuned, retune this with it.
const STANCE = 0.36;

const gait = walkCycle({
  stance: STANCE,
  reach: 32,
  // The beak points left, so the bird walks left.
  facing: -1,
  segments: SEGMENTS,
  clearance: 96,
  stanceKnee: 15,
  kneeBreak: 62,
  toeTuck: -46,
});

/**
 * The two numbers under the finding, and nothing else.
 *
 * `neck` is how far the neck swings with the body; `head` counter-rotates against
 * it to keep the skull level. Their *ratio* is what folds the beak, which is why
 * both belong in the grid — varying one alone would find a threshold that moves
 * the moment the other changes.
 */
const AXES = {
  neck: [6, 9, 13],
  head: [-8, -11, -15],
};

function take(p: Variant<typeof AXES>): Character {
  const ch = craneAlone(`crane-${p.index}`, 1.1);
  offsetFarLeg(ch);
  applyGait(ch, 'legNear', gait);
  applyGait(ch, 'legFar', gait, 0.5);
  // `sway` is a whole track, not a channel, so it is passed straight to `animate`.
  ch.part('body.neck').animate(sway(p.neck, { stance: STANCE }));
  ch.part('body.neck.head').animate(sway(p.head, { stance: STANCE }));
  return ch;
}

export const takes = grid(take, AXES);
