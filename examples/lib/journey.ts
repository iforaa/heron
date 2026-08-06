/**
 * Locomotion that goes somewhere, instead of a cycle that repeats.
 *
 * A walk cycle maps one stride onto the whole cycle, so time and stride phase
 * are the same thing and neither has to be thought about. The moment a character
 * has to set off, travel, and stop, they come apart — and everything a cycle
 * scene got for free has to be re-derived, usually wrongly:
 *
 *   THE GAIT MUST BE DRIVEN BY DISTANCE, NOT BY THE CLOCK. Drive the legs from
 *   time and the stride rate stays fixed while the ground slows underneath it,
 *   and the feet skate. Drive them from distance travelled and the cadence falls
 *   off with the speed because it is derived from it, contact stays exact
 *   through the whole deceleration, and terrain features land where footfalls do
 *   because both are measured in the same units.
 *
 *   THE SCROLL SPEED IS NOT A FREE PARAMETER. A planted foot tracks backwards at
 *   a rate fixed by the gait's reach and the limb's length. The scenery has to
 *   move at exactly that rate, and the number is *measurable* — `strideLength`
 *   reads it off the rig rather than leaving it to be tuned by eye.
 *
 *   AND NO LINT CAN CATCH GETTING IT WRONG. `foot-slip` watches the foot against
 *   the character, so a character running perfectly on the spot passes every
 *   check in the library while the floor pours past it at the wrong speed. The
 *   only real defence is to make the mismatch unrepresentable, which is what
 *   this module is: the scroll and the gait phase are two readings of one
 *   number, so they cannot disagree.
 *
 * Which of the two actually moves is the scene's to choose — `world` scrolls the
 * scenery under a character that stays put, which is what keeps `ground` a
 * single number while a staircase descends past it, and `carry` moves the
 * character across a stage that does not, which is the only way two characters
 * can travel independently.
 */

import { type Channel, type Character, sampled } from '../../src/scene.ts';
import { channelAt, pointAt } from '../../src/timeline.ts';
import { density } from '../../src/score.ts';
import { type WalkTracks, applyGait, pulse } from './walk.ts';

/** The joints a gait drives, hip outward. `applyGait` owns the same order. */
const JOINTS = ['thigh', 'shin', 'foot'] as const;

/**
 * Ground height as a function of how far the character has travelled.
 *
 * `edges` are the distances at which the profile steps, for whatever draws it.
 * They hang off the terrain rather than being computed alongside it so that the
 * ground the feet stand on and the ground the eye sees are one object: two
 * functions given the same arguments only *happen* to agree, and a typo in one
 * of four repeated arguments would put a riser under a planted foot — which is
 * the one defect this module exists to make impossible.
 */
export interface Terrain {
  (travelled: number): number;
  edges: number[];
}

/**
 * One stretch of travelling: go this far, between these two moments.
 *
 * Distance and a time window, rather than distance and a cadence, because the
 * window is what a scene actually knows — the beat the walk has to happen in.
 * The cruising speed follows from the two, and the stride rate follows from
 * that, so a scene never solves `stride / period` by hand to make a walk land on
 * its beat. A `Beat` has `from` and `to` already, so it spreads straight in:
 * `{ ...beats.at('enter'), distance: 1200 }`.
 */
export interface Move {
  /** Cycle fractions this stretch runs between. */
  from: number;
  to: number;
  /** Distance covered, in user units. Always positive: a journey goes forwards. */
  distance: number;
  /** Cycle fractions spent getting up to speed, and losing it again. */
  launch?: number;
  brake?: number;
}

export interface JourneyOptions {
  /** The gait to travel with, from `walkCycle`. */
  gait: WalkTracks;
  /** Fraction of the stride a foot is planted. Must match the gait's own. */
  stance: number;
  /** The two legs, near then far. Named as `applyGait` names them. */
  legs: [string, string];
  /**
   * The stretches of travelling, in order, with standing in between.
   *
   * A list rather than one distance because arriving, waiting and leaving again
   * is one journey and not three: the gait phase, the stand blends and the
   * placement all have to be continuous across the pauses, and they only are if
   * one `advanced()` covers the whole cycle. Two journeys on one rig cannot —
   * the second would overwrite the first's legs.
   */
  moves: Move[];
  /**
   * The part the whole world hangs off. Its transform is the camera, inverted:
   * the character stays put and the scenery goes by.
   */
  world?: string;
  /**
   * The part the character hangs off, for a stage that stays where it is.
   *
   * The exact inverse of `world`, and the choice between them is the choice
   * between a camera that follows and a camera that watches. Following suits a
   * character going a long way past fixed scenery; watching suits two characters
   * who have to be somewhere in particular relative to each other, which a
   * moving world cannot express — there is only one world, and they would both
   * have to ride it.
   */
  carry?: string;
  /** Ground profile, as a function of distance travelled. Flat if omitted. */
  terrain?: Terrain;
  /** Body rise and fall, peak to peak, on the named part. */
  bob?: number;
  body?: string;
  /**
   * The stride, if it has already been measured.
   *
   * Terrain has to be sized to the stride *before* there is a journey to ask,
   * so a scene generally measures it with `strideLength` and lays the ground
   * out first. Passing the answer back in stops the same number being measured
   * twice off two rigs that have to be built identically to agree.
   */
  stride?: number;
  /**
   * Where the travel is undone, as a cycle fraction window.
   *
   * A journey ends thousands of units from where it started, which `loop-seam`
   * is right to call a jump. Naming the window a fade covers lets the world slide
   * home unseen; without it the scene has to stop somewhere it can loop from.
   */
  home?: [number, number];
}

export interface Journey {
  /** Distance covered by cycle time `t`. Everything else is a reading of this. */
  advanced: (t: number) => number;
  /** Cycle fraction one stride takes at the fastest the character ever goes. */
  period: number;
  /** Stride phase, 0 to 1 — a question about distance, not about time. */
  phase: (t: number) => number;
  /** How much of a standing pose the legs hold: 1 at both ends, 0 in between. */
  stillness: (t: number) => number;
  /** Distance per stride, measured off the rig. */
  stride: number;
  /**
   * A channel riding the stride: silent while the character is standing, and
   * sampled finely enough to resolve one.
   *
   * Anything a scene wants to hang off the gait — a wing beating twice a step, a
   * neck lagging a beat behind — goes through here, so the phase-and-stillness
   * composition and the sampling density stay the library's business rather than
   * being re-derived per scene.
   */
  riding: (amount: number, cycles: number, lag?: number) => Channel;
}

/**
 * How far the ground must move per stride, measured off the rig itself.
 *
 * `walkCycle` builds the whole of stance as one linear segment, so two samples
 * taken inside it give the rate exactly rather than approximately. Measuring
 * beats declaring: if the reach, the leg lengths or the stance fraction ever
 * change, the world still moves at whatever the new geometry demands.
 *
 * Poses the leg to take the reading and puts it back, so it can be called on a
 * finished character without disturbing it.
 */
export function strideLength(ch: Character, leg: string, gait: WalkTracks, stance: number): number {
  const kept = JOINTS.map((j) => [...ch.part(`${leg}.${j}`).node.tracks]);
  JOINTS.forEach((j) => ch.part(`${leg}.${j}`).reset());
  applyGait(ch, leg, gait);
  const a = pointAt(ch, `${leg}.foot`, stance * 0.4);
  const b = pointAt(ch, `${leg}.foot`, stance * 0.6);
  JOINTS.forEach((j, i) => {
    const joint = ch.part(`${leg}.${j}`).reset();
    for (const track of kept[i]) joint.animate(track);
  });
  return (b[0] - a[0]) / (stance * 0.2);
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

/**
 * A flight of stairs, as a function of distance travelled.
 *
 * Every drop is placed inside the window where no foot is down — stance runs
 * from 0 to `stance` of the stride and the next foot lands at 0.5, so the gap is
 * what is left of that half. Put a riser anywhere else and the ground moves
 * while a foot is standing on it. That is the whole reason terrain is declared
 * next to the gait instead of in the drawing code: the drawing can then be
 * generated from the same profile, and the two cannot drift apart.
 */
export function stairs(o: {
  /** Run of one step. One per footfall — `stride / 2` — keeps every edge clear. */
  tread: number;
  rise: number;
  steps: number;
  stance: number;
}): Terrain {
  const flight = 1 - o.stance / 0.5;
  const planted = 1 - flight;
  const ground = (d: number): number => {
    if (d <= 0) return 0;
    const k = Math.floor(d / o.tread);
    if (k >= o.steps) return o.steps * o.rise;
    const f = d / o.tread - k;
    const u = f <= planted ? 0 : (f - planted) / flight;
    return (k + smooth(u)) * o.rise;
  };
  // The middle of each flight phase: the toe leaves the tread a little before
  // the edge, and the next foot lands a little past the next one.
  return Object.assign(ground, {
    edges: Array.from({ length: o.steps }, (_, k) => (k + 1 - flight / 2) * o.tread),
  });
}

/** Ground that never changes height, for a scene that only needs to scroll. */
export function flat(): Terrain {
  return Object.assign(() => 0, { edges: [] as number[] });
}

/**
 * Drives a rig across a distance and hands back everything that follows from it.
 *
 * The legs, the body bob and the world's own transform are applied here together
 * because they are one decision — how fast the character is going — read three
 * ways. Splitting them across a scene file is what lets them disagree.
 */
/**
 * One move with everything that follows from its distance and its window.
 *
 * `blendIn` and `blendOut` are how long the legs take to leave a standing pose
 * and to find one again. Setting off wants the shorter of the two: a launch
 * blend that outlasts the first stride is a character that slides before it
 * starts walking. Stopping needs longer, because the last stride has to become a
 * stand while the body is still travelling.
 */
interface Stretch extends Move {
  launch: number;
  brake: number;
  span: number;
  cruise: number;
  blendIn: number;
  blendOut: number;
}

function plan(moves: Move[]): Stretch[] {
  if (!moves.length) throw new Error('heron: journey() needs at least one move');
  const out: Stretch[] = [];
  let after = 0;
  for (const m of moves) {
    const span = m.to - m.from;
    const launch = m.launch ?? 0;
    const brake = m.brake ?? 0;
    if (m.from < after - 1e-9 || span <= 0 || m.to > 1 + 1e-9) {
      throw new Error(
        `heron: journey() moves run in order across the cycle and cannot overlap,`
        + ` so a move from ${m.from.toFixed(3)} to ${m.to.toFixed(3)} is not one`,
      );
    }
    if (m.distance < 0) throw new Error('heron: journey() only travels forwards, so a move cannot be negative');
    // Ramping linearly at both ends covers half of what the same stretch of
    // cruising would, so this is the time the distance is actually spread over.
    const level = span - (launch + brake) / 2;
    if (level <= 1e-9) {
      throw new Error(
        `heron: a move ${span.toFixed(3)} long cannot spend ${launch.toFixed(3)} launching and`
        + ` ${brake.toFixed(3)} braking - shorten them, or give it more of the cycle`,
      );
    }
    const half = span / 2;
    out.push({
      ...m, launch, brake, span,
      cruise: m.distance / level,
      blendIn: Math.max(1e-6, Math.min(0.055, launch || 0.055, half)),
      blendOut: Math.max(1e-6, Math.min(0.09, brake || 0.09, half)),
    });
    after = m.to;
  }
  return out;
}

export function journey(ch: Character, o: JourneyOptions): Journey {
  const [near, far] = o.legs;
  const stride = o.stride ?? strideLength(ch, near, o.gait, o.stance);
  const moves = plan(o.moves);
  const place = o.world ?? o.carry;
  if (!place || (o.world && o.carry)) {
    throw new Error('heron: journey() needs exactly one of world (the camera follows) or carry (it does not)');
  }

  // Distance is cumulative across the whole cycle: moves before `t` count in
  // full, the one containing it counts in part. That continuity is the whole
  // reason a pause is a gap between moves rather than a second journey.
  const advanced = (t: number): number => {
    let d = 0;
    for (const m of moves) {
      if (t <= m.from) break;
      if (t >= m.to) { d += m.distance; continue; }
      const u = t - m.from;
      if (u <= m.launch) return d + (m.cruise * u * u) / (2 * m.launch);
      const brakeAt = m.span - m.brake;
      if (u <= brakeAt) return d + m.cruise * (u - m.launch / 2);
      const left = 1 - (u - brakeAt) / m.brake;
      return d + m.distance - ((m.cruise * m.brake) / 2) * left * left;
    }
    return d;
  };

  const phase = (t: number): number => (advanced(t) / stride) % 1;

  const stillness = (t: number): number => {
    for (const m of moves) {
      if (t <= m.from || t >= m.to) continue;
      const u = t - m.from;
      if (u < m.blendIn) return 1 - smooth(u / m.blendIn);
      if (u <= m.span - m.blendOut) return 0;
      return smooth((u - (m.span - m.blendOut)) / m.blendOut);
    }
    return 1;
  };

  const terrain = o.terrain ?? flat();
  const descent = (t: number): number => terrain(advanced(t));

  // Mid-stance: the thigh vertical, the sole flat, the foot bearing weight. The
  // only pose in a running cycle a character can be left standing in — a run
  // never has both feet down at once, so there is no instant of it to freeze on
  // and the stand has to be blended to.
  const stand = o.stance / 2;
  // Sampled fine enough to resolve the fastest stride in the journey, which is
  // the one that would alias first.
  // Facing can make stride signed; cadence is a duration and cannot be. Passing
  // a negative span to density() used to request 48 million samples and only
  // surfaced once sampled() began validating its contract.
  const period = Math.abs(stride) / Math.max(...moves.map((m) => m.cruise));
  const samples = density(period);

  const legChannel = (c: Channel, lead: number): Channel => {
    const still = channelAt(c, stand);
    return sampled((t) => {
      const run = channelAt(c, (phase(t) + lead) % 1);
      return run + (still - run) * stillness(t);
    }, samples);
  };

  for (const [leg, lead] of [[near, 0], [far, 0.5]] as const) {
    const blended = { ...o.gait };
    for (const joint of JOINTS) {
      const c = o.gait[joint].rotate;
      if (c) blended[joint] = { rotate: legChannel(c, lead) };
    }
    JOINTS.forEach((j) => ch.part(`${leg}.${j}`).reset());
    applyGait(ch, leg, blended);
  }

  // Brought home inside the window a fade is expected to cover, so the seam
  // closes without the scene having to remember to close it. Everything else
  // already returns: the legs are standing at both ends, and the bob is zero.
  const [homeFrom, homeTo] = o.home ?? [1, 1];
  const settled = (f: (t: number) => number) => (t: number): number => {
    if (t <= homeFrom) return f(t);
    if (t >= homeTo) return f(0);
    return f(homeFrom) + (f(0) - f(homeFrom)) * smooth((t - homeFrom) / (homeTo - homeFrom));
  };

  // Where the travelling actually shows. Carrying the character and scrolling
  // the world are one transform and its inverse, which is why they are one line
  // and not two code paths: a scene that changed its mind about which it wanted
  // would otherwise be a scene that re-derived the arithmetic.
  const sign = o.world ? 1 : -1;
  ch.part(place).animate({
    x: sampled(settled((t) => sign * advanced(t)), samples),
    y: sampled(settled((t) => -sign * descent(t)), samples),
  });

  /**
   * A channel riding the stride, silent once the character is standing.
   *
   * Every scene wants two or three of these — a wing beating twice a step, a
   * neck a beat behind the legs — and each one is the same composition of phase,
   * amplitude and stillness at the same sampling density. Handing it back is
   * what stops each scene re-deriving it, and re-deriving the density constant
   * along with it.
   */
  const riding = (amount: number, cycles: number, lag = 0): Channel =>
    sampled((t) => Math.sin(2 * Math.PI * (cycles * phase(t) + lag)) * amount * (1 - stillness(t)), samples);

  if (o.bob) {
    // A running body is lowest at mid-stance — it lands, the knee gives — and
    // highest through the flight phase, which is the opposite of a walk vaulting
    // over a straight leg. It settles to nothing: a standing body does not bob.
    const half = o.bob / 2;
    const wave = pulse(-half, half, o.stance);
    ch.part(o.body ?? 'body').animate({
      y: sampled((t) => channelAt(wave, phase(t)) * (1 - stillness(t)), samples),
    });
  }

  return { advanced, period, phase, stillness, stride, riding };
}
