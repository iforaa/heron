import type { MeasuredRun } from './runs.ts';
import type { Vec2 } from './scene.ts';

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
