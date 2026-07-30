/**
 * Two small things a scene keeps needing and keeps getting wrong by hand.
 *
 * `noise` is the difference between still and dead. A character that holds
 * perfectly steady between beats reads as a paused video rather than a living
 * thing, and the fix is a drift too small to notice and too irregular to predict.
 *
 * `aim` is the difference between a pose and a guess. Which way a joint has to
 * turn to point something at something else is a question about the artwork's
 * own geometry, and an agent that cannot see the drawing has no way to answer it
 * — the sign gets picked, it is wrong half the time, and the failure looks like
 * a stylistic choice rather than a bug. The library knows the pivot and it knows
 * where the beak is, so it can simply be asked.
 */

import { type Channel, type Character, type Vec2, sampled } from './scene.ts';
import { frameAt } from './timeline.ts';

/** Deterministic 0..1 stream from an integer seed. */
function seeded(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NoiseOptions {
  /** Wobbles per cycle in the slowest band. Whole numbers only — see below. */
  rate?: number;
  /** How many bands, each twice as fast and half as strong. */
  octaves?: number;
  /** Same seed, same wobble, every build. */
  seed?: number;
}

/**
 * A wandering value, for the parts of a character that are never quite still.
 *
 * Banded harmonics rather than true gradient noise, and the reason is the loop.
 * Every band is a whole number of cycles per cycle, so the whole sum is exactly
 * periodic and `loop-seam` is satisfied by construction — where sampled Perlin
 * noise would need its domain bent into a circle to avoid a jump at the seam.
 * Three or four bands is already past the point where a viewer can hear the
 * arithmetic in it.
 *
 * Seeded, because a build that produced different idle motion each time would
 * make every other comparison in this project meaningless.
 */
export function noise(amount: number, o: NoiseOptions = {}): Channel {
  const rate = Math.max(1, Math.round(o.rate ?? 3));
  const octaves = Math.max(1, Math.round(o.octaves ?? 3));
  const next = seeded(o.seed ?? 1);

  const bands: { f: number; phase: number; amp: number }[] = [];
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    const amp = 1 / 2 ** i;
    bands.push({ f: rate * 2 ** i, phase: next(), amp });
    total += amp;
  }

  const top = bands[bands.length - 1].f;
  return sampled((t) => {
    let v = 0;
    for (const b of bands) v += b.amp * Math.sin(2 * Math.PI * (b.f * t + b.phase));
    return (amount * v) / total;
  }, Math.max(64, top * 12));
}

export interface AimOptions {
  /** A point on the part, in rest-pose coordinates: the beak tip, the muzzle. */
  marker: Vec2;
  /** Where it should end up pointing, in world coordinates. */
  target: Vec2;
  /** When to solve, if the parts above this one are moving. */
  t?: number;
}

/**
 * The rotation, in degrees, that points `marker` at `target`.
 *
 * Solved from the part's own pivot and whatever its ancestors are doing at the
 * time, so it answers the question actually being asked — "turn to look at
 * that" — rather than leaving a number to be found by rendering, squinting, and
 * flipping the sign. The result is an ordinary angle: hand it to `keys`, to
 * `shift`, to a spring's `to`.
 *
 * The ancestors are assumed to rotate and scale uniformly, which every rig here
 * does. A parent squashed on one axis only would shear the direction, and no
 * single rotation of this part could correct it.
 */
export function aim(ch: Character, path: string, o: AimOptions): number {
  const node = ch.find(path);
  if (!node) throw new Error(`heron: no part "${path}"`);
  if (!node.pivot) throw new Error(`heron: aim() needs "${path}" to have a pivot to turn about`);

  const frame = frameAt(ch, o.t ?? 0);
  const own = frame.matrices.get(node.path)!;
  const pivot = frame.point(node, node.pivot);

  // Where the marker points now, and where it should. The part's own matrix
  // already contains its current rotation, so the answer is the difference —
  // which also means calling this against a pose that is already aiming
  // correctly returns zero rather than double-counting.
  const here = frame.point(node, o.marker);
  const has = Math.atan2(here[1] - pivot[1], here[0] - pivot[0]);
  const wants = Math.atan2(o.target[1] - pivot[1], o.target[0] - pivot[0]);
  // A mirrored ancestor reverses which way an increasing angle turns.
  const flip = own[0] * own[3] - own[1] * own[2] < 0 ? -1 : 1;

  let deg = ((wants - has) * 180) / Math.PI * flip;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}
