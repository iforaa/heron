/**
 * Several versions of one scene, so a choice can be looked at instead of guessed.
 *
 * Numbers like a hop height, a ride amplitude or a follow-through delay have no
 * right answer derivable from anything — they are chosen because the result reads
 * well. An agent that cannot see the result picks one, renders it, decides it is
 * "fine", and ships it; the loop that would have improved it costs a full
 * build-look-rebuild round per candidate, so it is run once if at all.
 *
 * `examples/crane-family.ts` was tuned exactly that way, by hand, one constant at
 * a time. A grid renders all the candidates in one image, which turns "invent a
 * plausible number" into "pick the one that reads best" — a judgement an agent can
 * actually make, and one it can support with the sidecar's numbers.
 *
 * Everything here is data. The scene is a function of its parameters, the axes are
 * declared beside it, and the combinations are derived — so the parameters cannot
 * drift out of sync with the cells that claim to show them.
 */

import type { Character } from './scene.ts';

/** Named axes of variation, each a list of values to try. */
export type Axes = Record<string, readonly unknown[]>;

/** One value drawn from each axis. */
export type AxisValues<S extends Axes> = { -readonly [K in keyof S]: S[K][number] };

export interface VariantMeta {
  /** Position in declaration order, first axis slowest. Stable across runs. */
  index: number;
  /** `ride=14 delay=0.08` — the cell's caption and its identity in the sidecar. */
  label: string;
  /**
   * A stable integer derived from `index`, for scenes with any randomness in them.
   *
   * Without this a `noise` or `shuffle` seeded from a constant would give every
   * cell the same wobble — hiding the interaction between the parameter and the
   * randomness — while seeding from a clock would reshuffle the grid on every
   * render and make two sheets incomparable. Derived from the index, so cell 4 is
   * the same cell 4 tomorrow.
   */
  seed: number;
}

export type Variant<S extends Axes> = AxisValues<S> & VariantMeta;

/**
 * How many builds a sheet may hold.
 *
 * Not an arbitrary limit: a 5x5x5 grid is 125 compiles and 125 cells, which is
 * neither quick nor readable, and a comparison nobody can read is worse than no
 * comparison. Exceeding it is an error naming the axes rather than a silent
 * subsample — a biased selection is the one output a comparison instrument must
 * never produce.
 */
export const MAX_BUILDS = 25;

function show(v: unknown): string {
  if (typeof v === 'number') return String(Number(v.toFixed(4)));
  if (typeof v === 'string') return v;
  return JSON.stringify(v) ?? String(v);
}

/** `ride=14 delay=0.08` — the cell's caption. */
function labelOf(names: string[], values: Record<string, unknown>): string {
  return names.map((k) => `${k}=${show(values[k])}`).join(' ');
}

/**
 * A scene factory bound to the axes it varies.
 *
 * A class rather than a plain object so `pick(mod, VariantSet)` finds it with the
 * same one line every other export kind uses, instead of a naming convention that
 * fails silently when someone calls their export `make` instead of `build`.
 */
export class VariantSet<S extends Axes = Axes> {
  readonly axes: S;
  readonly names: string[];
  readonly combinations: Array<Variant<S>>;
  readonly build: (params: Variant<S>) => Character;

  constructor(build: (params: Variant<S>) => Character, axes: S) {
    const names = Object.keys(axes);
    for (const k of names) {
      if (!Array.isArray(axes[k]) || axes[k].length === 0) {
        throw new Error(`heron: variant axis "${k}" needs at least one value`);
      }
    }
    this.axes = axes;
    this.names = names;
    this.build = build;

    // Declaration order, first axis slowest, so the sheet reads as the matrix it
    // is: rows walk the earlier axes, columns the last one.
    let rows: Array<Record<string, unknown>> = [{}];
    for (const k of names) {
      rows = rows.flatMap((row) => axes[k].map((v) => ({ ...row, [k]: v })));
    }
    this.combinations = rows.map((values, index) => ({
      ...values,
      index,
      label: labelOf(names, values),
      seed: index + 1,
    }) as Variant<S>);
  }

  /** The first value of every axis: the canonical scene, and what other commands get. */
  get base(): Variant<S> {
    return this.combinations[0];
  }

  /** How many cells the last axis wants, so a sheet defaults to the matrix shape. */
  get columns(): number {
    const last = this.names[this.names.length - 1];
    return last ? this.axes[last].length : 1;
  }

  /**
   * The combinations matching every `axis=value` filter, compared as text so a
   * filter can come straight off a command line.
   */
  select(filters: string[]): Array<Variant<S>> {
    const pairs = filters.map((pair): [string, string] => {
      const eq = pair.indexOf('=');
      if (eq < 1) throw new Error(`heron: a variant filter is axis=value, not "${pair}"`);
      const k = pair.slice(0, eq);
      if (!this.names.includes(k)) {
        throw new Error(`heron: no variant axis "${k}". This scene varies: ${this.names.join(', ')}`);
      }
      return [k, pair.slice(eq + 1)];
    });
    return this.combinations.filter((c) =>
      pairs.every(([k, v]) => show((c as Record<string, unknown>)[k]) === v));
  }

  /**
   * The combinations to actually build: selected, then held to the cap.
   *
   * The refusals live here rather than in the CLI because they are facts about
   * the grid — the cap, the axis names and how to slice are all things the set
   * knows and a command would have to be handed.
   */
  plan(filters: string[] = []): Array<Variant<S>> {
    const combos = filters.length ? this.select(filters) : this.combinations;
    if (!combos.length) {
      throw new Error(`heron: no combination matches that filter. This grid is ${this.describe()}`);
    }
    // Refused rather than sampled. A silently biased subsample is the one output
    // a comparison instrument may not produce.
    if (combos.length > MAX_BUILDS) {
      throw new Error(
        `heron: ${combos.length} builds is more than ${MAX_BUILDS}. This grid is `
        + `${this.describe()} — trim an axis, or slice it with --only axis=value.`,
      );
    }
    return combos;
  }

  /** What to trim, when there are too many builds to draw. */
  describe(): string {
    return this.names.map((k) => `${k} (${this.axes[k].length})`).join(' x ');
  }
}

/**
 * Binds a scene factory to the axes it varies.
 *
 * Written with the axes inline so TypeScript infers the parameter type of the
 * factory from them — renaming an axis then fails to compile instead of producing
 * a grid of identical cells:
 *
 * ```ts
 * export const shots = grid(
 *   (p) => buildScene({ ride: p.ride, delay: p.delay }),
 *   { ride: [8, 14, 20], delay: [0.04, 0.08, 0.12] },
 * );
 * ```
 *
 * Each cell builds a **fresh** Character. Reusing one and re-animating it would
 * accumulate layers, because `PartHandle.animate` pushes a new layer per call.
 */
export function grid<S extends Axes>(
  build: (params: Variant<S>) => Character,
  axes: S,
): VariantSet<S> {
  return new VariantSet(build, axes);
}
