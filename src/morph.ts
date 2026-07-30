/**
 * Turning one set of points into another.
 *
 * The animation is trivial — every dot travels from somewhere to somewhere else,
 * and `ramp` inside a staggered beat says that in one line. The whole problem is
 * the *assignment*: which dot goes to which place. Get it wrong and a few
 * hundred dots swap sides on their way across, the field turns to static in the
 * middle of the move, and the two shapes stop looking like one thing changing
 * into another. Get it right and nobody notices there was a decision.
 *
 * Nearest-available, farthest-first. Each dot takes the closest target nobody
 * has claimed, and the dots furthest from where the crowd is going choose
 * first — because those are the ones with a real preference, while a dot already
 * near the middle can be sent almost anywhere at almost no cost. Choosing in
 * that order keeps total travel low *and* keeps the long journeys from crossing,
 * which greedy in index order does not.
 *
 * This minimises distance, not crossings; it is not optimal transport and does
 * not try to be. It also does not need to be: it is one operator used for one
 * kind of shot, and the difference between it and an exact assignment is a
 * handful of dots taking the second-nearest seat.
 */

import type { Vec2 } from './scene.ts';
import { seeded } from './random.ts';

export interface Move {
  /** Where this instance has to travel, relative to where it was drawn. */
  dx: number;
  dy: number;
  /**
   * True when there was no target left for it.
   *
   * Which is not an error: a gather from eight hundred dots into a hundred is
   * seven hundred dots with nowhere to go, and what they should do is leave.
   * Fade the spares out over the same beat and the crowd condenses.
   */
  spare: boolean;
}

/**
 * Assigns each point in `from` a point in `to`.
 *
 * `from` is the field as it stands, in the order its instances were declared, so
 * the result indexes straight into `field.each`. Surplus targets are simply not
 * used — a field can only move the instances it has, and inventing more of them
 * silently is how a scene ends up with dots that were never declared.
 */
export function morph(from: Vec2[], to: Vec2[]): Move[] {
  const centre = to.length
    ? to.reduce((a, p) => [a[0] + p[0] / to.length, a[1] + p[1] / to.length] as Vec2, [0, 0] as Vec2)
    : ([0, 0] as Vec2);

  // Furthest from where everything is heading picks first.
  const order = from
    .map((p, i) => ({ i, d: (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2 }))
    .sort((a, b) => b.d - a.d)
    .map((e) => e.i);

  const taken = new Uint8Array(to.length);
  const out: Move[] = from.map(() => ({ dx: 0, dy: 0, spare: true }));

  for (const i of order) {
    const [px, py] = from[i];
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < to.length; k++) {
      if (taken[k]) continue;
      const d = (to[k][0] - px) ** 2 + (to[k][1] - py) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best < 0) break; // every target claimed; the rest are spares
    taken[best] = 1;
    out[i] = { dx: to[best][0] - px, dy: to[best][1] - py, spare: false };
  }
  return out;
}

/**
 * A shuffle that is the same every run.
 *
 * A dissolve wants its instances to leave in no discernible order, and `order`
 * on a stagger wants exactly that list. Seeded, because a build whose dots
 * scattered differently each time would make every snapshot comparison in this
 * project meaningless.
 */
export function shuffle(n: number, seed = 1): number[] {
  const next = seeded(seed);
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
