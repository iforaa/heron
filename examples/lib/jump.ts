/**
 * Leaving the ground, with the legs solved rather than drawn.
 *
 * A jump looks like a vertical curve and is really two problems, and only one of
 * them is the curve. While the feet are down, the body can only go lower by
 * folding the legs, and the fold has to fold *about the foot*: the ankle is
 * pinned to the floor, so every degree of knee flexion moves the hip both down
 * and sideways, by an amount that depends on the segment lengths and on how bent
 * the leg already was. Author that by hand and it is wrong in one of exactly two
 * ways — the crouch is drawn as a body translation and the feet sink through the
 * floor, or it is drawn as joint angles and the feet slide. `ground-penetration`
 * catches the first. Nothing catches the second except looking, because a foot
 * skating a few units a frame is a defect the eye reads as "cheap" without ever
 * locating.
 *
 * So this takes only the honest input — where the hip goes — and derives the
 * rest. One curve, positive up:
 *
 *   below zero  the feet are down, so the legs fold by exactly the angle that
 *               lowers the hip that far, and the body slides sideways by exactly
 *               the amount that leaves the ankle where it was.
 *   above zero  the feet are off the ground, so nothing is pinned: the body
 *               simply rises and the legs tuck.
 *
 * The two meet at zero with the legs as they were and no offset, which is what
 * lets one continuous curve describe a gather, a launch, a flight and a landing
 * without saying where any of them start — and what makes a jump stackable on a
 * walk, since a lift of zero leaves the walk exactly alone.
 *
 * The fold is one family of poses — thigh back by `m`, shin forward by `2m`,
 * foot back by `m` — so the sole stays flat throughout and the whole leg is
 * described by a single angle. It flexes the same way round as `walkCycle`'s
 * `stanceKnee`, so a crouch deepens the stance the gait is already holding
 * instead of unbending it.
 *
 * WHERE THE LEG ALREADY IS, IS MEASURED. The drop a fold produces depends on the
 * pose it starts from, and a rig standing in a gait's mid-stance is not standing
 * straight. Solving against a straight leg instead would put the foot several
 * units under the floor at the bottom of every crouch — small, systematic, and
 * exactly the sort of thing nobody finds. So the existing layers are read at
 * every instant and the fold is solved against them. That means this must be
 * applied *after* whatever poses the legs.
 */

import { type Channel, type Character, type Track, sampled } from '../../src/scene.ts';
import { type Shape } from '../../src/score.ts';
import { channelAt, trackAt } from '../../src/timeline.ts';

const DEG = 180 / Math.PI;

export interface JumpOptions {
  /** Every leg that leaves the ground together. A two-footed hop names both. */
  legs: string[];
  /** The part the legs hang off — the thing that actually rises. */
  body?: string;
  /** Segment lengths, hip outward. The same array `walkCycle` takes. */
  segments: [number, number];
  /**
   * Where the hip is, over the cycle, in user units and positive up. Below zero
   * is a crouch and is solved into the legs; above zero is flight.
   */
  lift: Channel;
  /**
   * Which way the character faces: `1` for right, `-1` for left. Decides which
   * way the knee breaks, and so which way the body slides to hold the foot.
   */
  facing?: 1 | -1;
  /** How far the shin folds at the top of the arc. Legs tuck in the air. */
  tuck?: number;
  samples?: number;
}

/** Where the ankle sits relative to the hip: how far down, and how far aside. */
interface Hang {
  down: number;
  side: number;
}

/** Total rotation over a set of layers. Rotations about one pivot simply add. */
function rotationOf(layers: Track[], t: number): number {
  let deg = 0;
  for (const track of layers) deg += trackAt(track, t).rotate;
  return deg;
}

export function jump(ch: Character, o: JumpOptions): void {
  const [thighLen, shinLen] = o.segments;
  const facing = o.facing ?? 1;
  const tuck = (o.tuck ?? 0) / DEG;
  const samples = o.samples ?? 128;

  // The highest the hip gets, measured off the curve rather than declared, so
  // the tuck is full at the apex whatever the curve turns out to peak at.
  let peak = 0;
  for (let i = 0; i <= samples; i++) peak = Math.max(peak, channelAt(o.lift, i / samples));

  /**
   * The leg the body's compensation is solved against.
   *
   * One body cannot follow two legs, and in a two-footed hop it does not have
   * to: both are at the same pose whenever the lift is anything but zero, which
   * is the only time this is consulted. The first leg named is the one asked.
   */
  // Snapshotted, because the layers this adds must not feed back into the pose
  // it is solving against.
  const [heldThigh, heldShin] = (['thigh', 'shin'] as const)
    .map((joint) => [...ch.part(`${o.legs[0]}.${joint}`).node.tracks]);

  /**
   * How far below the hip the ankle hangs, and how far to one side, with the
   * legs folded through `m` radians on top of whatever they are already doing.
   *
   * `f` is the fold's contribution: it takes `m` off the thigh's world angle and
   * puts `m` onto the shin's, which is the whole of the pose family written out.
   */
  const hang = (t: number, m: number): Hang => {
    const one = rotationOf(heldThigh, t) / DEG - facing * m;
    const two = one + rotationOf(heldShin, t) / DEG + 2 * facing * m;
    return {
      down: thighLen * Math.cos(one) + shinLen * Math.cos(two),
      side: -thighLen * Math.sin(one) - shinLen * Math.sin(two),
    };
  };

  /**
   * The fold that lowers the hip by `drop`, found by bisection.
   *
   * Inverted numerically rather than in closed form because the closed form only
   * exists for a straight leg, and a leg standing in a gait is not straight. A
   * deeper fold always brings the ankle nearer the hip, so the answer is bracketed
   * by a straight leg and a fully folded one and thirty halvings land well inside
   * a hundredth of a degree.
   */
  const foldFor = (t: number, rest: Hang, drop: number): number => {
    let lo = 0;
    let hi = Math.PI / 2;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (rest.down - hang(t, mid).down < drop) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };

  // Every channel below asks the same two questions of the same instants, and
  // the compiler samples each of them on one shared grid. Solving once per
  // instant turns thirty bisection steps per channel into thirty per frame.
  const cache = new Map<number, { fold: number; x: number; y: number }>();
  const at = (t: number) => {
    let got = cache.get(t);
    if (got) return got;
    const h = channelAt(o.lift, t);
    if (h >= 0) {
      got = { fold: peak > 0 ? tuck * (h / peak) : 0, x: 0, y: -h };
    } else {
      const rest = hang(t, 0);
      const fold = foldFor(t, rest, -h);
      const bent = hang(t, fold);
      // The hip goes down by however much the fold shortened the leg, and aside
      // by however much it swung the ankle — which is what leaves the ankle put.
      got = { fold, x: rest.side - bent.side, y: rest.down - bent.down };
    }
    cache.set(t, got);
    return got;
  };

  for (const leg of o.legs) {
    ch.part(`${leg}.thigh`).animate({ rotate: sampled((t) => -facing * at(t).fold * DEG, samples) });
    ch.part(`${leg}.shin`).animate({ rotate: sampled((t) => 2 * facing * at(t).fold * DEG, samples) });
    // Whatever the leg above is doing, the sole stays flat — so the contact
    // point rides directly under the ankle at every depth of the crouch.
    ch.part(`${leg}.foot`).animate({ rotate: sampled((t) => -facing * at(t).fold * DEG, samples) });
  }

  ch.part(o.body ?? 'body').animate({
    y: sampled((t) => at(t).y, samples),
    x: sampled((t) => at(t).x, samples),
  });
}

export interface HopOptions {
  /** How high the hip rises, in user units. */
  height: number;
  /** How deep it gathers before each launch. Defaults to a third of the height. */
  crouch?: number;
  /** Fraction of one hop spent off the ground. */
  flight?: number;
}

/**
 * Repeated hops, as a lift curve for `jump`.
 *
 * Three pieces, each returning to zero at its own ends, so the whole thing is
 * continuous and the last hop finishes standing:
 *
 *   GATHER is a half sine with its time skewed late, so the sink is unhurried
 *   and the extension out of it is not. That asymmetry is most of the read of a
 *   jump — a gather that springs back as slowly as it sank is a bob.
 *
 *   FLIGHT is a parabola, because that is what an unsupported body does. Nothing
 *   is gained by shaping it: gravity has no taste.
 *
 *   ABSORB is the gather skewed the other way, taken quickly and given back
 *   slowly, which is the difference between weight and a bounce.
 */
export function hops(count: number, o: HopOptions): Shape {
  const crouch = o.crouch ?? o.height / 3;
  const flight = o.flight ?? 0.52;
  const off = (1 - flight) * 0.62;
  const down = off + flight;

  const one = (u: number): number => {
    if (u < off) return -crouch * Math.sin(Math.PI * (u / off) ** 1.6);
    if (u < down) {
      const v = (u - off) / flight;
      return o.height * 4 * v * (1 - v);
    }
    return -crouch * 0.8 * Math.sin(Math.PI * ((u - down) / (1 - down)) ** 0.8);
  };

  const f: Shape = (_, u) => one((u * count) % 1);
  // One hop is a whole gesture inside what is already a fraction of the cycle,
  // so the sampling has to be per hop and not per beat. At the usual density
  // three hops in a quarter of a cycle would be sixteen points each, and the
  // compiler would faithfully bake a jump nobody wrote.
  f.samples = (b) => Math.ceil(48 / Math.max(1e-6, (b.to - b.from) / count));
  return f;
}
