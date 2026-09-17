/**
 * A chick hops on an empty field until its mother arrives and walks it home.
 *
 * The whole scene is one idea borrowed from the shorts this is trying to be: a
 * small character does something pointless and delighted, a larger one arrives,
 * and the arrival changes what the small one is doing. Nothing is said. The
 * acting is entirely in *when* — the hop that never becomes a fourth hop, the
 * head that comes up before the feet have finished, the pause before the neck
 * comes down. So the file is mostly a score, and the score is mostly silence.
 *
 * Two characters in one cycle is what this scene is really testing, and it turns
 * out to be one decision the library had been quietly assuming away. Every scene
 * before this scrolled the *world* past a character standing still, which is the
 * right camera for a journey and the only camera when there is one traveller.
 * Two travellers cannot both ride the world — there is only one of it, and where
 * they are relative to each other is the entire subject. So they are carried
 * instead, across a stage that stays put, and the mother's arriving, waiting and
 * leaving again are one `journey` with a gap in it rather than two that would
 * overwrite each other's legs.
 *
 * The other thing it needed was a hop that is a hop. See `jump`: the honest
 * input is where the hip goes, and the legs are solved from it.
 */

import {
  character, keys, layer, line, part, rect, through,
  aim, during, noise, score, shift, spring, settleTime,
  swell, easeOut, type Character, type Vec2,
} from '../src/index.ts';
import { walkCycle } from './lib/walk.ts';
import { hops, jump } from './lib/jump.ts';
import { journey, strideLength } from './lib/journey.ts';
import { ANKLE, GROUND, SEGMENTS, craneRig, offsetFarLeg } from './lib/crane-rig.ts';

// --- the two birds -----------------------------------------------------------

/**
 * The chick is the adult, smaller. That is a claim about the drawing and not a
 * shortcut: this is a monoline mark, so the chick has to stay recognisably the
 * same bird and proportion is the only thing allowed to differ. Scaled about the
 * point where its own foot meets the floor, so both birds stand on one line.
 */
const CHICK = 0.46;
const STAND: Vec2 = [ANKLE[0], GROUND];

/**
 * Where each of them stands, as a distance from the rig's own feet.
 *
 * The chick is off centre rather than at the origin, and the offset is exactly
 * the room the pair needs to walk into: they leave to the left, so the frame has
 * to hold both of them at the moment the fade starts, and the only way to buy
 * that is to start further right. Which is also where a small thing waiting for
 * someone belongs — with the empty half of the field in front of it.
 */
const CHICK_AT = 200;
const APART = 400;

/**
 * The mother's gait is unhurried and the chick's is not.
 *
 * Their cadences are never chosen. Both cover the same ground in the same beat
 * and the chick's legs are half the length, so it takes very nearly twice the
 * steps — which is the whole joke of a small thing keeping up with a large one,
 * and it falls out of the geometry rather than being animated.
 */
const MOTHER = { stance: 0.58, reach: 26, clearance: 78, stanceKnee: 9, kneeBreak: 38, toeTuck: -32 };
const CHILD = { stance: 0.52, reach: 24, clearance: 74, stanceKnee: 11, kneeBreak: 46, toeTuck: -34 };

// The beak points left, so both birds walk left.
const gaitOf = (o: typeof MOTHER) => walkCycle({ ...o, facing: -1, segments: SEGMENTS });
const momGait = gaitOf(MOTHER);
const kidGait = gaitOf(CHILD);

// --- the timeline ------------------------------------------------------------
// Named beats in the order they happen, in seconds. Nothing below adds anything
// up; every moment in the scene is one of these, read back by name.

const DURATION = 11;

/**
 * The chick's head snaps up and then rings, so `notice` is exactly as long as
 * the ring takes and not a moment longer. `settleTime` says how long that is,
 * which is the only reason this number is not a guess like every other startle.
 */
const START = { swing: -30, stiffness: 900, damping: 26 };

const beats = score(DURATION, [
  ['alone', 2.4],
  ['approach', 1.3],
  ['notice', settleTime(START)],
  ['arrive', 1.1],
  ['nuzzle', 1.0],
  ['together', 0],
  ['straighten', 0.55],
  ['leave', 2.4],
  ['fade', 0.5],
  ['reset', 0.35],
  ['open', 0.4],
]);

// --- the stage ---------------------------------------------------------------

const SKY = '#f2f7f4';
const FIELD = '#dceee4';
const EDGE = '#b4d8c4';
const REED = '#c3e0d0';

/**
 * Wide, low, and mostly empty.
 *
 * The room on the right is the mother's entrance and has to be there in the
 * first frame, because an entrance is only an entrance if there is somewhere to
 * come from. The room on the left is where they go. What is left in the middle
 * is one small bird a long way from anything, which is the shot.
 */
const VIEW: [number, number, number, number] = [-560, -200, 2210, 1444];

/** A tuft of grass. Three strokes, drawn the way the birds are. */
function tuft(x: number, h: number): void {
  const w = h * 0.34;
  for (const lean of [-1, -0.1, 0.9]) {
    through([[x, GROUND + 10], [x + lean * w * 0.5, GROUND - h * 0.6], [x + lean * w, GROUND - h]], {
      stroke: REED, width: 13,
    });
  }
}

/** Sky, field and a few reeds. Declared offstage: a backdrop bleeds by design. */
function field(): void {
  layer('field', { offstage: true }, () => {
    rect({ x: VIEW[0], y: VIEW[1], w: VIEW[2], h: VIEW[3], fill: SKY });
    rect({ x: VIEW[0], y: GROUND, w: VIEW[2], h: VIEW[1] + VIEW[3] - GROUND, fill: FIELD });
    line({ from: [VIEW[0], GROUND], to: [VIEW[0] + VIEW[2], GROUND], stroke: EDGE, width: 14 });
    for (const [x, h] of [[-470, 150], [-180, 96], [140, 118], [1090, 120], [1420, 168], [1610, 104]] as const) {
      tuft(x, h);
    }
  });
}

// --- the scene ---------------------------------------------------------------

/**
 * One bird, wrapped twice on purpose.
 *
 * The outer part is what travels and the inner one is what is scaled, and they
 * cannot be the same part. Layers compose as nested groups, so a scale wrapped
 * around a translate measures that translate in the *bird's* units, and a chick
 * asked to walk four hundred would walk a hundred and eighty. Keeping the
 * journey outside the scale keeps every distance in this file in one unit.
 *
 * Offstage, because both of them are meant to be out of frame at some point:
 * she has not arrived yet and they have both left.
 */
function bird(name: string): void {
  part(name, { offstage: true }, () => {
    part(`${name}Size`, { pivot: STAND }, craneRig);
  });
}

export const craneFamily: Character = character(
  'craneFamily',
  { viewBox: VIEW, duration: DURATION, ground: GROUND },
  () => {
    field();
    // The mother is declared first, so she reads as being behind — which is
    // where a parent shepherding a chick actually stands, and which leaves the
    // chick, who is the subject, unoccluded where they overlap.
    layer('cast', () => {
      bird('mom');
      bird('kid');
    });
  },
);

offsetFarLeg(craneFamily, 'mom');
offsetFarLeg(craneFamily, 'kid');
craneFamily.part('kidSize').animate({
  scaleX: keys([[0, CHICK], [1, CHICK]]),
  scaleY: keys([[0, CHICK], [1, CHICK]]),
});

// --- the travelling ----------------------------------------------------------

/**
 * Both strides are measured off the rigs as they now stand, scale included, so
 * every distance below is in screen units and the two birds are comparable.
 */
const MOM_STRIDE = strideLength(craneFamily, 'mom.legNear', momGait, MOTHER.stance);
const KID_STRIDE = strideLength(craneFamily, 'kid.legNear', kidGait, CHILD.stance);

/** Rounded to whole strides, so she arrives on a footfall rather than mid-air. */
const strides = (want: number, of: number) => Math.max(1, Math.round(want / of)) * of;

/** Far enough out to be off the frame in the first frame, and she leaves as far as she came. */
const ENTER = strides(1200, MOM_STRIDE);
const LEAVE = ENTER;

/**
 * The chick covers slightly less ground than its mother, so she closes on it as
 * they go. A parent walking a small thing home is behind it and gaining rather
 * than level with it — and it keeps the chick in frame while she catches up.
 */
const CLOSES = 150;

/**
 * Where each of them starts. She begins her entrance offstage and finishes it
 * `APART` from the chick, so her mark is the whole journey behind where she ends
 * up standing.
 */
const MOM_AT = CHICK_AT + APART;
craneFamily.part('kid').animate({ x: keys([[0, CHICK_AT], [1, CHICK_AT]]) });
craneFamily.part('mom').animate({ x: keys([[0, MOM_AT + ENTER], [1, MOM_AT + ENTER]]) });

const walk = journey(craneFamily, {
  gait: momGait,
  stance: MOTHER.stance,
  legs: ['mom.legNear', 'mom.legFar'],
  carry: 'mom',
  stride: MOM_STRIDE,
  bob: 16,
  body: 'mom.body',
  // Arriving and leaving are one journey with a stop in the middle. The brake is
  // long and the launch is not: she slows for a long time before she gets there,
  // which is the difference between arriving and stopping.
  moves: [
    { from: beats.at('approach').from, to: beats.at('arrive').to, distance: ENTER, launch: 0.05, brake: 0.15 },
    { ...beats.at('leave'), distance: LEAVE, launch: 0.04, brake: 0.05 },
  ],
  home: [beats.at('reset').from, beats.at('reset').to],
});

const trot = journey(craneFamily, {
  gait: kidGait,
  stance: CHILD.stance,
  legs: ['kid.legNear', 'kid.legFar'],
  carry: 'kid',
  stride: KID_STRIDE,
  // In the chick's own units, which are the ones inside its scale.
  bob: 24,
  body: 'kid.body',
  moves: [{ ...beats.at('leave'), distance: LEAVE - CLOSES, launch: 0.05, brake: 0.05 }],
  home: [beats.at('reset').from, beats.at('reset').to],
});

// --- the hopping -------------------------------------------------------------

/**
 * Three hops, going nowhere, which is the point.
 *
 * `jump` takes only the hip's height and solves the legs from it, so the feet
 * neither sink nor slide however deep the gather goes — and because a lift of
 * zero leaves the legs exactly as it found them, this stacks straight on top of
 * the standing pose the journey is already holding them in. Its numbers are the
 * chick's own, so they are inside the scale like the rig they drive.
 */
const HOP = { height: 210, crouch: 44 };
const alone = beats.at('alone');

jump(craneFamily, {
  legs: ['kid.legNear', 'kid.legFar'],
  body: 'kid.body',
  segments: SEGMENTS,
  facing: -1,
  tuck: 22,
  lift: during(alone, hops(3, HOP)),
});

// --- the acting --------------------------------------------------------------
// One layer per idea, stacked. None of them knows about the others.

const momWing = craneFamily.part('mom.wing');
const momNeck = craneFamily.part('mom.neck');
const momHead = craneFamily.part('mom.head');
const kidWing = craneFamily.part('kid.wing');
const kidNeck = craneFamily.part('kid.neck');
const kidHead = craneFamily.part('kid.head');

/** The mother's walk, carried up through her. Small: she is not in a hurry. */
momWing.animate({ rotate: walk.riding(3.5, 2) });
momNeck.animate({ rotate: walk.riding(6, 1, 0.14) });
momHead.animate({ rotate: walk.riding(-8, 1, 0.26) });

/**
 * The chick's is the same three lines, a little larger, at nearly twice the
 * rate — the rate is not set here either, it is what its own short legs do.
 * Larger than this and the neck and head swing against each other hard enough
 * to fold the beak down over its own back twice a step.
 */
kidWing.animate({ rotate: trot.riding(8, 2) });
kidNeck.animate({ rotate: trot.riding(9, 1, 0.12) });
kidHead.animate({ rotate: trot.riding(-11, 1, 0.24) });

/**
 * Wings out on every hop, achieving nothing.
 *
 * Literally the same curve as the body's, scaled — so the wing opens on the way
 * *down*, before the feet have left, and is at full stretch at the apex. Driving
 * it off a timer instead would need retiming every time the hop did.
 */
const FLAP = -26 / HOP.height;
kidWing.animate({
  rotate: during(alone, hops(3, { height: HOP.height * FLAP, crouch: HOP.crouch * FLAP })),
});

// --- the arrival -------------------------------------------------------------

const notice = beats.at('notice');
const nuzzle = beats.at('nuzzle');

/**
 * Where the chick looks, and where the mother looks, both solved off the rig.
 *
 * The two of them are a hundred and eighty degrees of ambiguity apart: the beak
 * sits up and to the left of every pivot it hangs from, so the rotation that
 * turns a head *toward* something below and to the right is not the one that
 * reads like "toward". `aim` answers from the geometry, which is the only thing
 * here that knows where the beak actually is.
 */
const BEAK: Vec2 = [260.6, 63.8];
const MOTHERS_EYE: Vec2 = [MOM_AT + 360, 150];

/**
 * A point in the air between them, and the reason it is in the air.
 *
 * The obvious target for a mother greeting a chick is the top of the chick's
 * head, and it is wrong. This neck is one rigid segment pivoting at its base, so
 * a beak that has to arrive at a point below and well past the pivot swings
 * something like a hundred and forty degrees — and what a real crane does with
 * that reach is *curl*, which one segment cannot. Rendered, it does not read as
 * bending down. It reads as a broken neck.
 *
 * So they meet halfway, above the chick, which is both what the rig can say and
 * a better beat: the small one stretching up to be met is the whole relationship
 * in one pose, where the large one bending all the way down is only condescension.
 */
const MEETING: Vec2 = [MOM_AT + 100, 330];

/**
 * The head goes first and the neck follows it, which is the order a startle
 * happens in. Each is solved after the one before it is applied, so the second
 * answers for what is left rather than for the whole turn a second time.
 */
const kidLook = aim(craneFamily, 'kid.head', { marker: BEAK, target: MOTHERS_EYE, t: notice.from });
kidHead.animate({ rotate: during(notice, shift(kidLook * 0.55)) });
const kidCarry = aim(craneFamily, 'kid.neck', { marker: BEAK, target: MOTHERS_EYE, t: notice.to });
kidNeck.animate({ rotate: during(notice, shift(kidCarry * 0.45)) });

/** And it rings, because a head that stops dead where it was aimed is a machine. */
kidHead.animate({ rotate: during(notice, spring(START)) });
kidWing.animate({ rotate: during(notice, spring({ ...START, swing: 16, damping: 34 })) });

/**
 * Then she bows to it, and it stretches up.
 *
 * Most of each reach is the neck, because a crane's neck is what reaches; the
 * head only finishes the aim. Both stop a little short of the solved angle on
 * purpose — beak meeting beak would be a peck, and coming to rest just before
 * contact is the difference between a greeting and a collision.
 */
const momBend = aim(craneFamily, 'mom.neck', { marker: BEAK, target: MEETING, t: nuzzle.from });
momNeck.animate({ rotate: during(nuzzle, shift(momBend * 0.88)) });
const momTip = aim(craneFamily, 'mom.head', { marker: BEAK, target: MEETING, t: nuzzle.to });
momHead.animate({ rotate: during(nuzzle, shift(momTip * 0.7)) });

const kidReach = aim(craneFamily, 'kid.neck', { marker: BEAK, target: MEETING, t: nuzzle.from });
kidNeck.animate({ rotate: during(nuzzle, shift(kidReach * 0.95)) });

/** The wing comes round as she reaches. Negative lifts it away from the flank. */
momWing.animate({ rotate: during(nuzzle, swell(-26)) });

/**
 * Nothing alive is ever completely still, and the chick least of all. Banded
 * harmonics at whole numbers of cycles per cycle, so each closes its own seam.
 */
momNeck.animate({ rotate: noise(1.1, { rate: 2, seed: 3 }) });
kidNeck.animate({ rotate: noise(2.2, { rate: 3, seed: 17 }) });
kidHead.animate({ rotate: noise(3.1, { rate: 4, seed: 8 }) });

// --- setting off -------------------------------------------------------------

/**
 * Everyone comes up out of the greeting before anyone walks anywhere.
 *
 * Its own beat, and not part of `leave`, because a mother who sets off with her
 * neck still folded over the chick is a bird diving at the floor — which is
 * exactly what the first cut of this was. It also means every held turn in the
 * scene is released here rather than under the fade, so the cycle closes half a
 * second before anything is hidden and the seam owes the fade nothing.
 */
const up = beats.at('straighten');
momNeck.animate({ rotate: during(up, shift(-momBend * 0.88)) });
momHead.animate({ rotate: during(up, shift(-momTip * 0.7)) });
kidNeck.animate({ rotate: during(up, shift(-kidReach * 0.95 - kidCarry * 0.45)) });
/** The chick looks where it is going, which is away from her and ahead. */
kidHead.animate({ rotate: during(up, shift(-kidLook * 0.55)) });

// --- closing the loop --------------------------------------------------------

/**
 * The cast dissolves into the sky rather than into a hole, so the fade sits
 * inside the field rather than around it. The journeys bring themselves home
 * behind it; everything else has already returned on its own.
 */
craneFamily.part('cast').animate({
  opacity: keys([
    [0, 1],
    [beats.at('fade').from, 1],
    [beats.at('reset').from, 0],
    [beats.at('open').from, 0],
    [1, 1],
  ], easeOut),
});

export { beats, walk, trot };
export default craneFamily;
