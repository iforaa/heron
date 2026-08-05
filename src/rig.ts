import type { MeasuredRun } from './runs.ts';
import { type Character, type CharacterOptions, type Vec2, character, part, ribbon, through } from './scene.ts';

export interface RigCutSuggestion {
  joint: number;
  at: number;
  point: Vec2;
  distance: number;
}

export interface RigRunReport {
  name: string;
  points: number;
  length: number;
  width: { min: number; max: number };
  from: Vec2;
  to: Vec2;
  cuts: RigCutSuggestion[];
}

export interface RigReport {
  runs: RigRunReport[];
  joints: Vec2[];
}

/** Relates measured trace runs to candidate skeleton joints without naming anatomy. */
export function analyzeRig(runs: Record<string, MeasuredRun>, joints: Vec2[] = []): RigReport {
  const reports = Object.entries(runs).map(([name, run]): RigRunReport => {
    if (run.points.length < 2 || run.points.length !== run.widths.length) {
      throw new Error(`heron: rig run "${name}" has mismatched points and widths`);
    }
    const segments = run.points.slice(1).map((point, i) =>
      Math.hypot(point[0] - run.points[i][0], point[1] - run.points[i][1]));
    const length = segments.reduce((sum, value) => sum + value, 0);
    let before = 0;
    const cuts = joints.flatMap((joint, jointIndex): RigCutSuggestion[] => {
      let best = { distance: Infinity, at: 0, point: run.points[0] as Vec2 };
      before = 0;
      for (let i = 0; i < segments.length; i++) {
        const a = run.points[i];
        const b = run.points[i + 1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const u = Math.max(0, Math.min(1, ((joint[0] - a[0]) * dx + (joint[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        const point: Vec2 = [a[0] + dx * u, a[1] + dy * u];
        const distance = Math.hypot(point[0] - joint[0], point[1] - joint[1]);
        if (distance < best.distance) best = { distance, at: (before + segments[i] * u) / (length || 1), point };
        before += segments[i];
      }
      const tolerance = Math.max(2, Math.max(...run.widths) * 2);
      return best.distance <= tolerance && best.at > 0.02 && best.at < 0.98
        ? [{ joint: jointIndex, at: best.at, point: best.point, distance: best.distance }]
        : [];
    });
    return {
      name, points: run.points.length, length,
      width: { min: Math.min(...run.widths) * 2, max: Math.max(...run.widths) * 2 },
      from: run.points[0], to: run.points.at(-1)!, cuts,
    };
  });
  return { runs: reports, joints };
}

export interface RigPart {
  runs: MeasuredRun[];
  parent?: string;
  /** Required when parent is set: a child rotates about a joint, not nowhere. */
  pivot?: Vec2;
  contact?: Vec2;
  fill?: string;
  stroke?: string;
  opacity?: number;
}

/**
 * Builds a character directly from an assignment over measured runs.
 *
 * `trace` recovers geometry and `heron rig` suggests where to cut it, but the
 * judgement — which run is the thigh, which joint it hangs from — is the
 * author's. This is where that judgement is stated, as data rather than as a
 * hand-written module: re-tracing regenerates RUNS, the assignment survives,
 * and there is nothing to merge.
 */
export function rig(
  name: string, opts: CharacterOptions, assignment: Record<string, RigPart>,
): Character {
  const entries = Object.entries(assignment);
  if (!entries.length) throw new Error('heron: rig() needs at least one part');
  for (const [partName, spec] of entries) {
    if (!Array.isArray(spec.runs) || !spec.runs.length) {
      throw new Error(`heron: rig part "${partName}" needs at least one run`);
    }
    if (spec.parent !== undefined && !(spec.parent in assignment)) {
      throw new Error(`heron: rig part "${partName}" names unknown parent "${spec.parent}"`);
    }
    if (spec.parent !== undefined && spec.pivot === undefined) {
      throw new Error(
        `heron: rig part "${partName}" has a parent and therefore needs a pivot`
        + ' — heron rig <traced>.ts suggests cut points to use',
      );
    }
  }

  const children = new Map<string | undefined, string[]>();
  for (const [partName, spec] of entries) {
    const siblings = children.get(spec.parent) ?? [];
    siblings.push(partName);
    children.set(spec.parent, siblings);
  }

  const emitted = new Set<string>();
  const emit = (partName: string): void => {
    const spec = assignment[partName];
    emitted.add(partName);
    part(partName, { pivot: spec.pivot, contact: spec.contact }, () => {
      for (const run of spec.runs) {
        const shared = {
          ...(run.cap === 'butt' ? { cap: 'butt' as const } : {}),
          ...(run.closed ? { closed: true } : {}),
          ...(spec.opacity !== undefined ? { opacity: spec.opacity } : {}),
        };
        // The same rule trace applies when it emits source: a width profile that
        // actually varies is a ribbon, a flat one is the stroke it really is.
        if (run.widths.every((w) => w === run.widths[0])) {
          through(run.points, { stroke: spec.stroke ?? spec.fill ?? '#000', width: run.widths[0] * 2, ...shared });
        } else {
          ribbon(run.points, run.widths, { fill: spec.fill ?? '#000', ...shared });
        }
      }
      for (const child of children.get(partName) ?? []) emit(child);
    });
  };

  const built = character(name, opts, () => {
    for (const root of children.get(undefined) ?? []) emit(root);
  });

  // An entry whose parent chain never reaches the root is unreachable, which
  // happens with validated parent names either because it sits on a cycle or
  // because it is a descendant of one — both are reported together, since
  // this pass cannot tell which parts of `missed` are the cycle itself.
  const missed = entries.map(([n]) => n).filter((n) => !emitted.has(n));
  if (missed.length) {
    throw new Error(`heron: rig parts ${missed.join(', ')} never reach the root — a parent cycle, or a child of one`);
  }
  return built;
}
