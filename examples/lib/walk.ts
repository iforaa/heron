/**
 * A walk cycle, written entirely in Heron's public DSL.
 *
 * This is a worked example to copy and adapt, not a universal preset. A gait
 * tuned for a long-legged bird will not transfer unchanged to a crab or a
 * toddler; the value here is the *structure* — which joint does what, and when —
 * and the two rules encoded below, which hold for any legged character:
 *
 *   1. Ground contact is one uninterrupted segment with no intermediate
 *      keyframe. Any change of angular rate while the foot is planted shows up
 *      as the foot changing speed, which the eye reads as skating.
 *   2. The sole stays flat against the ground through stance, which means the
 *      foot's own rotation is always the negation of everything above it
 *      (`foot = -(thigh + shin)`). That relation is computed here rather than
 *      hand-tuned, so it survives any change to the other parameters.
 */

import { type Channel, type Character, type Track, keys } from '../../src/scene.ts';
import { glide, linear, push, swing } from '../../src/easing.ts';

export interface WalkOptions {
  /** Fraction of the cycle the foot spends on the ground. Above 0.5 gives the
   *  double-support overlap that makes a walk read as walking rather than
   *  marching. */
  stance?: number;
  /** Peak thigh swing, degrees either side of vertical. Larger is a longer stride. */
  reach?: number;
  /** Knee flexion held through stance. Near zero keeps the leg locked. */
  stanceKnee?: number;
  /** Knee flexion at push-off, when the joint breaks to lift the foot clear. */
  kneeBreak?: number;
  /**
   * Peak knee flexion mid-swing, in degrees. This is what gives the foot ground
   * clearance — and it does NOT transfer between characters, because clearance
   * is `shinLength * (1 - cos(lift))`. The same 48 degrees that lifts a crane's
   * foot 10 units lifts a stubby rodent's barely 4. Prefer passing `segments`
   * and letting the clearance be solved for.
   */
  lift?: number;
  /**
   * Limb segment lengths, hip outward — the same array given to `limb()`. When
   * present, `lift` is derived from `clearance` instead of guessed, which is the
   * single most common way a gait tuned for one character breaks on another.
   */
  segments?: [number, number];
  /**
   * How far the foot should clear the ground mid-swing, in user units. Defaults
   * to 15% of total leg length. Requires `segments`.
   */
  clearance?: number;
  /** Toe rotation while the foot is off the ground. Negative points the toes down. */
  toeTuck?: number;
  /**
   * When the leg starts extending for touchdown. Late is important: the foot
   * travels forward fastest at the end of swing, so a leg that straightens
   * early puts the foot on the ground while it is still moving forward, and it
   * visibly skates into position. Keeping the knee flexed until here holds the
   * foot clear until it is nearly over its landing spot.
   */
  settle?: number;
  /**
   * How early the knee starts breaking, as a fraction of the cycle before
   * stance ends. Zero — the default — keeps the foot rigid until push-off. A
   * real foot lifts its heel early and rolls over the toe, but a single-pivot
   * foot rotates about the ankle, so any lead drags the planted toe faster than
   * ground speed. Raise it only for a character whose foot is short enough that
   * the drag does not read.
   */
  pushLead?: number;
  /** When the knee reaches peak flexion. Defaults to just after push-off. */
  peak?: number;
  /**
   * Which way the character faces: `1` for right, `-1` for left. Default `1`.
   *
   * A gait is a set of angles, and angles do not survive a change of facing.
   * Drive a left-facing character with the default and every joint is mirrored:
   * the planted foot tracks toward the head instead of away from it, so the
   * character moonwalks. It reads as *wrong* immediately and as *why* almost
   * never, and no lint can catch it — the foot is still moving at a perfectly
   * constant speed, just in the direction of travel instead of against it.
   *
   * This mirrors the motion, not the drawing. The artwork must already face the
   * way you claim, and an asymmetric foot has to be drawn mirrored too.
   */
  facing?: 1 | -1;
  /**
   * When knee extension finishes, if it should not finish at `settle`. Separate
   * because a character with a long foot relative to its stride needs the leg
   * straight *before* the thigh reaches its forward extreme, or unwinding the
   * toe tuck drives the toe into the floor.
   */
  extendAt?: number;
}

export interface WalkTracks {
  thigh: Track;
  shin: Track;
  foot: Track;
}

/**
 * Knee flexion needed to lift the ankle by `clearance`.
 *
 * Bending the knee by `a` raises the ankle by `shin * (1 - cos a)`, so the angle
 * that clears the ground depends entirely on how long the shin is. Short legs
 * need a *larger* knee break than long ones for the same clearance, which is the
 * opposite of what proportional intuition suggests.
 */
function solveLift(segments?: [number, number], clearance?: number): number | undefined {
  if (!segments) return undefined;
  const [thigh, shin] = segments;
  const want = clearance ?? (thigh + shin) * 0.15;
  const ratio = 1 - want / shin;
  const deg = ratio <= -1 ? 180 : (Math.acos(Math.max(-1, Math.min(1, ratio))) * 180) / Math.PI;
  return Math.max(20, Math.min(75, deg));
}

/** Mirrors a rotation channel, which is all it takes to turn a gait around. */
function mirror(c: Channel): Channel {
  return c.kind === 'keys'
    ? { kind: 'keys', keys: c.keys.map((k) => ({ ...k, v: -k.v })) }
    : { kind: 'fn', fn: (t) => -c.fn(t), samples: c.samples };
}

/**
 * Returns one track per limb segment. Apply them to a `limb()`'s parts, then
 * give the opposite leg the same tracks at `phase: 0.5`.
 */
export function walkCycle(o: WalkOptions = {}): WalkTracks {
  const stance = o.stance ?? 0.62;
  const reach = o.reach ?? 18;
  const stanceKnee = o.stanceKnee ?? 8;
  const contactKnee = stanceKnee / 2;
  const kneeBreak = o.kneeBreak ?? 28;
  const toeTuck = o.toeTuck ?? -32;
  const settle = o.settle ?? 0.94;

  // Solve knee flexion for a target ground clearance rather than accepting a
  // number tuned against some other character's proportions.
  const lift = o.lift ?? solveLift(o.segments, o.clearance) ?? 48;

  const pushStart = stance - (o.pushLead ?? 0);
  const pushEnd = stance + 0.04;
  const peak = o.peak ?? stance + 0.18;
  // Extension has to land between peak flexion and the end of the cycle.
  const extendAt = Math.max(peak + 0.01, Math.min(0.99, o.extendAt ?? settle));

  /**
   * Rule 3: retraction. The leg swings past its contact angle and is already
   * sweeping backward when the foot lands, so touchdown happens at ground
   * speed instead of the foot arriving forward and skidding to a stop. The
   * overshoot is sized to match the stance angular rate exactly, which also
   * makes velocity continuous across the loop seam — the cycle repeats with no
   * detectable hitch.
   */
  const stanceRate = (2 * reach) / stance;
  const retract = stanceRate * (1 - settle);

  // Thigh angle at any point of stance, which stance interpolates linearly.
  const thighAt = (t: number) => -reach + 2 * reach * (t / stance);
  // Rule 2: whatever the leg above is doing, the sole stays flat.
  const flatSole = (thigh: number, knee: number) => -(thigh + knee);

  const tracks: WalkTracks = {
    // One linear segment across the whole of stance (rule 1), an eased swing,
    // then the retraction into touchdown (rule 3).
    thigh: {
      rotate: keys([
        [0, -reach, linear],
        [stance, reach, glide],
        [settle, -reach - retract, linear],
        [1, -reach],
      ]),
    },

    // The knee stays nearly locked while planted, then breaks hard at push-off
    // to clear the ground, and extends again to reach for the next contact.
    shin: {
      rotate: keys([
        [0, contactKnee, linear],
        [pushStart, stanceKnee, push],
        [pushEnd, kneeBreak, swing],
        [peak, lift, swing],
        // Extension completes by `extendAt`, so the leg is rigid through the
        // retraction and the foot travels backward instead of being thrown
        // forward by a straightening knee.
        [extendAt, contactKnee, linear],
        [1, contactKnee],
      ]),
    },

    foot: {
      rotate: keys([
        [0, flatSole(thighAt(0), contactKnee), linear],
        [pushStart, flatSole(thighAt(pushStart), stanceKnee), push],
        [pushEnd, toeTuck, swing],
        [peak, toeTuck + 2, swing],
        [extendAt, flatSole(-reach - retract, contactKnee), linear],
        [1, flatSole(thighAt(0), contactKnee)],
      ]),
    },
  };

  if ((o.facing ?? 1) === 1) return tracks;
  return {
    thigh: { rotate: mirror(tracks.thigh.rotate!) },
    shin: { rotate: mirror(tracks.shin.rotate!) },
    foot: { rotate: mirror(tracks.foot.rotate!) },
  };
}

/**
 * The twice-per-stride envelope: high over each mid-stance, low through each
 * double-support. Body bob, neck sway and a contact shadow are all this same
 * shape driving different channels, so it lives here once rather than being
 * respelled — `stance + (1 - stance) / 2` is not something a caller should have
 * to rederive.
 */
export function pulse(atContact: number, atMidStance: number, stance = 0.62): Channel {
  const mid = stance / 2;
  const swingMid = stance + (1 - stance) / 2;
  return keys([
    [0, atContact],
    [mid, atMidStance],
    [stance, atContact],
    [swingMid, atMidStance],
    [1, atContact],
  ]);
}

export interface BobOptions {
  /** Cycle fraction where stance ends; the body must be low here and at 0. */
  stance?: number;
  /**
   * Vertical travel. Defaults to a value derived from the leg geometry: a
   * straight support leg is at its tallest when vertical, so the body must fall
   * by exactly `length * (1 - cos(reach))` at the extremes for the planted foot
   * to stay at a constant height. Getting this right removes the need for an IK
   * solver in the common case, so prefer passing the geometry over a number.
   */
  amount?: number;
  /** Total leg length, used to derive `amount`. */
  legLength?: number;
  /** Thigh swing, used to derive `amount`. Should match the gait's `reach`. */
  reach?: number;
}

/** Body rise and fall, twice per stride. Pair with `walkCycle`. */
export function bodyBob(o: BobOptions = {}): Track {
  const stance = o.stance ?? 0.62;
  const amount =
    o.amount ?? (o.legLength ? (o.legLength * (1 - Math.cos(((o.reach ?? 18) * Math.PI) / 180))) / 2 : 1.65);
  return { y: pulse(amount, -amount, stance) };
}

/** Gentle sway, for necks, tails and anything that trails the body. */
export function sway(degrees: number, o: { stance?: number; phase?: number } = {}): Track {
  return { rotate: pulse(degrees, -degrees * 0.7, o.stance ?? 0.62), phase: o.phase };
}

/**
 * Applies a gait to a limb declared by `limb()`, optionally offset in time.
 *
 * Mirroring a walk onto the opposite leg is the single most common thing a
 * scene does after building one, and doing it by hand means naming the same
 * three joints in the same order in every scene file.
 */
export function applyGait(ch: Character, limbName: string, gait: WalkTracks, phase = 0): void {
  const shift = (t: Track): Track => (phase ? { ...t, phase } : t);
  ch.part(`${limbName}.thigh`).animate(shift(gait.thigh));
  ch.part(`${limbName}.shin`).animate(shift(gait.shin));
  ch.part(`${limbName}.foot`).animate(shift(gait.foot));
}
