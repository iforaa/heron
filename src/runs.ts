import type { Vec2 } from './scene.ts';

export interface MeasuredRun {
  points: Vec2[];
  /** Half-width at each point, matching ribbon(). */
  widths: number[];
  cap?: 'round' | 'butt';
  closed?: boolean;
}

function validate(run: MeasuredRun, label: string): void {
  if (run.points.length < 2 || run.points.length !== run.widths.length) {
    throw new Error(`heron: ${label} needs at least two points and one matching width per point`);
  }
  if (run.points.some((point) => point.length !== 2 || !point.every(Number.isFinite))
      || run.widths.some((width) => !Number.isFinite(width) || width < 0)) {
    throw new Error(`heron: ${label} coordinates and widths must be finite, with non-negative widths`);
  }
}

export function measuredRun(
  points: Vec2[], widths: number[], o: Pick<MeasuredRun, 'cap' | 'closed'> = {},
): MeasuredRun {
  const run: MeasuredRun = {
    points: points.map((point) => [...point]), widths: [...widths], ...o,
  };
  validate(run, 'measuredRun()');
  return run;
}

/** Splits a run at normalized arc length while interpolating its width there. */
export function cutRun(run: MeasuredRun, at: number): [MeasuredRun, MeasuredRun] {
  validate(run, 'cutRun()');
  if (!Number.isFinite(at) || at <= 0 || at >= 1) {
    throw new Error(`heron: cutRun() position must be strictly inside 0..1, got ${at}`);
  }
  const lengths = run.points.slice(1).map((point, i) =>
    Math.hypot(point[0] - run.points[i][0], point[1] - run.points[i][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) throw new Error('heron: cutRun() cannot split a zero-length run');
  const target = total * at;
  let traversed = 0;
  let segment = 0;
  while (segment < lengths.length - 1 && traversed + lengths[segment] < target) {
    traversed += lengths[segment++];
  }
  const u = (target - traversed) / lengths[segment];
  const a = run.points[segment];
  const b = run.points[segment + 1];
  const point: Vec2 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  const width = run.widths[segment] + (run.widths[segment + 1] - run.widths[segment]) * u;
  const left = measuredRun(
    [...run.points.slice(0, segment + 1), point],
    [...run.widths.slice(0, segment + 1), width],
    { cap: run.cap },
  );
  const right = measuredRun(
    [point, ...run.points.slice(segment + 1)],
    [width, ...run.widths.slice(segment + 1)],
    { cap: run.cap },
  );
  return [left, right];
}

function reversed(run: MeasuredRun): MeasuredRun {
  return { ...run, points: [...run.points].reverse(), widths: [...run.widths].reverse() };
}

/** Joins runs at their nearest endpoints, reversing data and widths together. */
export function joinRuns(...input: MeasuredRun[]): MeasuredRun {
  if (!input.length) throw new Error('heron: joinRuns() needs at least one run');
  input.forEach((run) => validate(run, 'joinRuns()'));
  let out = measuredRun(input[0].points, input[0].widths, { cap: input[0].cap });
  for (const original of input.slice(1)) {
    const choices: Array<[number, boolean, boolean]> = [];
    for (const reverseOut of [false, true]) for (const reverseNext of [false, true]) {
      const a = (reverseOut ? out.points[0] : out.points.at(-1))!;
      const b = (reverseNext ? original.points.at(-1) : original.points[0])!;
      choices.push([Math.hypot(a[0] - b[0], a[1] - b[1]), reverseOut, reverseNext]);
    }
    choices.sort((a, b) => a[0] - b[0]);
    if (choices[0][1]) out = reversed(out);
    const next = choices[0][2] ? reversed(original) : original;
    const same = Math.hypot(
      out.points.at(-1)![0] - next.points[0][0], out.points.at(-1)![1] - next.points[0][1],
    ) < 1e-9;
    out = measuredRun(
      [...out.points, ...next.points.slice(same ? 1 : 0)],
      [...out.widths, ...next.widths.slice(same ? 1 : 0)],
      { cap: out.cap },
    );
  }
  return out;
}
