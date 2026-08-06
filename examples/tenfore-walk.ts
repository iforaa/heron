/**
 * The Tenfore mark, traced and then made to run on the spot.
 *
 * The drawing lives in `crane-rig.ts` — every coordinate in it was measured by
 * `heron trace` from icon.png, and the anatomy laid over those coordinates is
 * the part no tracer can supply. This file is only the performance: one gait,
 * one cycle, looping forever.
 *
 * See `crane-stairs.ts` for the same bird on a timeline that goes somewhere.
 */

import { keys, swing, type Character } from '../src/index.ts';
import { walkCycle, sway, pulse, applyGait } from './lib/walk.ts';
import { SEGMENTS, craneAlone, offsetFarLeg } from './crane-rig.ts';

// Cropped to the ink, measured over the whole cycle rather than the rest pose —
// the swinging leg reaches wider than a still frame shows. Without the ring the
// square canvas is mostly empty, and a portrait box is what a standing bird
// actually occupies.
export const tenforeWalk: Character = craneAlone('tenforeWalk', 0.62);

// --- motion ------------------------------------------------------------------

/**
 * A run, not a fast walk. The difference is one number.
 *
 * `stance` is the fraction of the cycle a foot spends on the ground. Above 0.5
 * the two stance phases overlap and some foot is always down — that overlap is
 * what makes a walk read as walking. Below 0.5 they no longer meet, and the gap
 * between them is a moment with both feet in the air. That flight phase is the
 * whole difference between hurrying and running, and no amount of speeding a
 * walk up will produce it.
 *
 * Everything else follows from committing to that: a longer stride to cover the
 * airborne distance, a knee that breaks much harder to fold the leg out of its
 * own way, and far more clearance, because a foot that clips the ground during
 * flight reads as a stumble.
 */
const STANCE = 0.36;
const REACH = 32;

const gait = walkCycle({
  stance: STANCE,
  reach: REACH,
  // The beak points left, so the bird runs left. Without this it keeps a
  // perfect constant-speed contact while travelling backwards.
  facing: -1,
  segments: SEGMENTS,
  clearance: 96,
  // A running leg lands bent and absorbs, where a walking leg lands locked.
  stanceKnee: 15,
  kneeBreak: 62,
  toeTuck: -46,
});

offsetFarLeg(tenforeWalk);

applyGait(tenforeWalk, 'legNear', gait);
applyGait(tenforeWalk, 'legFar', gait, 0.5);

/**
 * Where the comedy is.
 *
 * The joke is not in the legs — legs running fast just look like legs running
 * fast. It is that everything above them refuses to cooperate: a neck that
 * arrives late, a head that will not stay level, and a wing beating twice per
 * stride to no effect whatever. Each is one exaggerated channel on a part that
 * carries no weight, which is also why none of them can break the gait.
 */
/**
 * The bob has to invert for a run, and `bodyBob` cannot do it.
 *
 * A walking body is *highest* at mid-stance: the leg is straight underneath and
 * the hips vault over it, which is what `bodyBob` builds. A running body does
 * the opposite — it lands, the knee gives, and the lowest point of the whole
 * cycle is mid-stance, with the high point out in the flight phase where no
 * foot is touching anything.
 *
 * Keeping the walk's bob here was not merely wrong-looking: it lifted the body
 * at exactly the moment the far leg was trying to stand on the ground, and lint
 * caught the foot hanging 25px in the air. Swapping the two levels plants it.
 */
const BOB = 17;
tenforeWalk.part('body').animate({ y: pulse(-BOB, BOB, STANCE) });

// Ten times the walk's sway, and a beat behind it. The lag is the funny part:
// the neck is still finishing the last stride while the legs start the next.
tenforeWalk.part('neck').animate({ ...sway(20, { stance: STANCE }), phase: 0.12 });

// The head overcorrects. A real bird stabilises its head against the body; this
// one tries, misses, and swings further than the neck it is trying to cancel.
tenforeWalk.part('head').animate({ ...sway(-26, { stance: STANCE }), phase: 0.22 });

// Two flaps per stride, which is why it achieves nothing: the wing is beating
// out of phase with itself as much as with the run.
//
// Small on purpose. The wing is a 250px stroke and the pivot is at one end, so
// every degree moves the tip four pixels — at the 15 degrees this started on,
// the tip swung 65px, the stroke left the body entirely and read as a snapped
// bone rather than a flap. A long limb needs a smaller angle than it feels like
// it should.
tenforeWalk.part('wing').animate({
  rotate: keys([[0, -5], [0.25, 6], [0.5, -5], [0.75, 6], [1, -5]], swing),
});

export default tenforeWalk;
