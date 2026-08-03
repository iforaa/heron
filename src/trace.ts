/**
 * Turning a reference image into Heron source.
 *
 * This does exactly one job: it recovers *geometry* — centrelines and measured
 * widths — so that no coordinate in a scene is ever a number somebody squinted
 * at a PNG to guess. It does not recover *anatomy*, and it does not pretend to.
 * Naming a run of ink "the thigh" and deciding the hip sits at one end of it is
 * a judgement about what the drawing depicts, and nothing in the pixels carries
 * it.
 *
 * That split is the honest one. Skeleton branches line up with limbs far better
 * than outline segments ever could — a medial axis forks where a leg meets a
 * body, whereas an outline runs straight past the joint — but "far better" is
 * not "correctly", so the output is a scaffold to be assigned, not a rig.
 */

import { basename, extname } from 'node:path';

import {
  type Stroke, inkColour, inkMask, junctions, labelRegions, loadImage,
  maskOfRegions, skeletonise, strokes,
} from './raster.ts';
import { hasPotrace, outlinePaths } from './outline.ts';
import { fitCircle, fitLine } from './fit.ts';
import { type RefineReport, refine } from './refine.ts';
import { coverage } from './raster.ts';
import { arcPath } from './scene.ts';
import type { Vec2 } from './scene.ts';

export interface TraceOptions {
  /** Simplification tolerance in source pixels. Larger means fewer points. */
  epsilon?: number;
  /** Ink/background separation, 0..1. */
  threshold?: number;
  /** Drop centreline branches shorter than this, in pixels. Removes thinning spurs. */
  minBranch?: number;
  /** Identifier for the exported character. Defaults to the file name. */
  name?: string;
  /** Name of the file being written, used in the generated instructions. */
  out?: string;
  /** Module specifier to import from. Local examples need a relative path. */
  importFrom?: string;
  /** Use potrace for tapering regions when available. On by default. */
  outlines?: boolean;
  /**
   * How close a circle or line must come, in pixels, to be used in place of a
   * point list. Set to 0 to always emit point lists.
   */
  fit?: number;
  /**
   * When to emit a measured width profile rather than a single width.
   * `taper` only where the width genuinely varies, `all` everywhere a run has a
   * centreline, `none` never.
   */
  ribbons?: 'taper' | 'all' | 'none';
  /**
   * Passes of reference-driven correction after tracing. 0 turns it off.
   * Each pass costs one render of the scene.
   */
  refine?: number;
}

export interface TraceResult {
  source: string;
  strokes: Stroke[];
  colour: string;
  width: number;
  height: number;
  /** Strokes whose width is not constant, so probably filled shapes. */
  varying: number;
  /** Skeleton forks, in source coordinates. The best available guess at joints. */
  joints: Vec2[];
  /** Tapering regions reproduced as exact outlines rather than as strokes. */
  outlined: number;
  /** Runs that turned out to be a circle or a straight line. */
  fitted: number;
  /** Runs emitted with a measured width profile rather than a single width. */
  profiled: number;
  /** What the correction pass changed, if it ran. */
  tuned: RefineReport | null;
}

/** Above this, a run is tapering rather than holding one width. */
const TAPER = 1.35;
/** Widths within this of each other came off the same pen. */
const PEN = 0.05;
/** A fit must describe at least this much of a run to be a description of it. */
const MOSTLY = 0.85;
/** Below this sweep an arc is better said as a line. */
const MIN_SWEEP = 20;
/** An arc whose radius dwarfs its own extent is a straight line in disguise. */
const MAX_RADIUS = 5;
/** Smallest arc radius worth naming, as a multiple of the run's own width. */
const TIGHT = 2;
/**
 * How much slack a fit gets once the correction pass has run.
 *
 * Correction moves points to where the ink actually is, and the ink is not
 * exactly on any circle, so points judged afterwards no longer sit on one to
 * within the tolerance they started at. Holding them to it rejects the ring
 * outright; allowing the wobble lets the fit average it away, which is the whole
 * reason to fit rather than to keep the points.
 */
const RELAXED = 2;

/**
 * Snaps measured widths onto the few pen weights the drawing was made with.
 *
 * A mark is drawn with one or two nib sizes, so the widths coming back are that
 * intent plus measurement noise — 37.6, 38.1, 37.9 are one pen, not three. The
 * spread is small, but it is spread in the wrong direction: each is a median
 * over one run, while the group median pools hundreds of samples across every
 * run that shares the weight. Snapping is therefore *more* accurate as well as
 * truer to how the thing was made, and it gives an agent grouping the strokes
 * into parts one number to reason about instead of ten.
 *
 * Only widths already within a few percent of each other are pooled. Two genuine
 * weights stay two.
 */
function quantiseWidths(runs: Stroke[], tapering: boolean[]): number[] {
  const eligible = runs
    .map((s, i) => ({ i, w: s.width, len: s.length }))
    .filter((r) => r.w > 0 && !tapering[r.i])
    .sort((a, b) => a.w - b.w);

  const groups: (typeof eligible)[] = [];
  for (const r of eligible) {
    const last = groups[groups.length - 1];
    // Compared against the group's smallest member, so a long chain of small
    // steps cannot drift a group across two genuinely different weights.
    if (last && r.w <= last[0].w * (1 + PEN)) last.push(r);
    else groups.push([r]);
  }

  // Every stroke ends up here with its final width, rather than only the ones
  // that moved. An emission site that had to remember to consult a map of
  // exceptions would eventually forget, and quietly print the un-pooled
  // measurement — which is exactly the kind of uniform, invisible error the
  // pooling exists to remove.
  const out = runs.map((s) => s.width);
  for (const g of groups) {
    // Weighted by length: a 400px run measured the pen far better than a 30px
    // one. `g` is already ascending in width, so this walk is the weighted median.
    const total = g.reduce((n, m) => n + m.len, 0);
    let seen = 0;
    let pick = 0;
    for (const m of g) {
      seen += m.len;
      pick = m.w;
      if (seen >= total / 2) break;
    }
    for (const m of g) out[m.i] = Math.round(pick * 10) / 10;
  }
  return out;
}

function ident(s: string): string {
  // An input that is already a usable identifier is left exactly as given.
  // Case-folding it would quietly rename what the caller explicitly asked for.
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(s)) return s;
  const cleaned = s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1)))
    .join('');
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `art${cleaned}`;
}

/**
 * Coordinates keep a decimal, because the centreline is fitted between pixels.
 *
 * Rounding to whole numbers would throw away the sub-pixel fit and put back the
 * lattice error it exists to remove — up to half a pixel on every point, which
 * is worth several points of overlap on a fine-lined mark.
 */
function n1(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/**
 * One long line is unreadable and one item per line is unreviewable; six is
 * about the width of a sensible editor.
 */
function wrap(items: string[], perRow = 6): string {
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(`      ${items.slice(i, i + perRow).join(', ')}`);
  return rows.join(',\n');
}

function pointList(pts: Vec2[], scale: number): string {
  return wrap(pts.map(([x, y]) => `[${n1(x / scale)}, ${n1(y / scale)}]`));
}

/** The extent of a point list, by one pass rather than four spreads. */
function bounds(pts: Vec2[], scale: number): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [px, py] of pts) {
    const x = px / scale;
    const y = py / scale;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function trace(file: string, o: TraceOptions = {}): TraceResult {
  const bm = loadImage(file);
  const mask = inkMask(bm, o.threshold);
  const colour = inkColour(bm, mask);
  // Thinning costs more than everything else here put together, so the skeleton
  // is taken once and shared with the two things that need it.
  const skeleton = skeletonise(mask);
  const found = strokes(mask, o.epsilon ?? 1.2, o.minBranch ?? 6, skeleton);
  const joints = junctions(skeleton);

  const s = bm.scale;
  const W = Math.round(bm.width / s);
  const H = Math.round(bm.height / s);
  const name = ident(o.name ?? basename(file, extname(file)));
  // Decided once. Read four different ways it becomes four chances for the
  // splitter's idea of a taper and the emitter's to disagree.
  const tapering = found.map((k) => k.widthVariation > TAPER);
  const varying = tapering.filter(Boolean).length;
  // Shapes the correction pass renders but never moves, in reference pixels.
  const fixed: string[] = [];
  const self = o.out ?? 'scene.ts';

  /**
   * What is left for an outline tracer, now that width can vary.
   *
   * Very little. A tapering run used to have to be handed to potrace, because a
   * constant width could not describe it — and what came back was a boundary
   * with the centreline thrown away, so the shape could be moved but never
   * posed. A ribbon describes the same taper from the measurement itself and
   * keeps the centreline, so that trade is no longer necessary.
   *
   * An outline is still right for a blob: a mark with no meaningful centreline
   * at all, where the medial axis is a dot or a star rather than a path. Those
   * have nothing for a ribbon to be a ribbon along.
   */
  const useOutlines = (o.outlines ?? true) && hasPotrace();
  const blob = (k: Stroke) => k.points.length < 4 || k.length < k.width * 2;
  const label = useOutlines && found.some(blob) ? labelRegions(mask, found) : null;
  const outline = new Map<number, string>();
  if (label) {
    found.forEach((k, i) => {
      if (!blob(k)) return;
      const paths = outlinePaths(maskOfRegions(mask, label, new Set([i])));
      // A region can come back as several contours — separate blobs, or a shape
      // with a hole. They are still one part, and potrace winds them so nonzero
      // fill does the right thing, so they concatenate into one path rather
      // than being discarded.
      if (paths?.length && paths.join('').length > 8) {
        outline.set(i, paths.join(' '));
        fixed.push(`<path d="${paths.join(' ')}" fill="${colour}"/>`);
      }
    });
  }

  // Resolved once, for every stroke, before anything is emitted. No emission
  // site can then reach an un-pooled measurement by forgetting to ask.
  const pen = quantiseWidths(found, tapering);

  // Which primitives the generated file actually uses, recorded where each one
  // is written rather than recovered afterwards by searching the output for it.
  const used = new Set(['character', 'layer']);
  let profiled = 0;

  /**
   * Correction runs before the shapes are named, not after, and the order is the
   * whole point.
   *
   * Fitting first freezes a circle from the raw trace and puts it beyond reach:
   * measured with fits held fixed the scene reaches 94.6%, and with no fits at
   * all — so that every run is free to move — it reaches 94.8%. Neither is the
   * answer, because the first gives up accuracy and the second gives up saying
   * "this is a ring".
   *
   * Correcting first and fitting afterwards gives up neither. Every run is a
   * ribbon while the reference is pulling on it, and only once it has settled is
   * it asked what shape it turned out to be — so the circle is solved from
   * corrected samples rather than from the first guess.
   */
  const movable: number[] = [];
  found.forEach((_, i) => { if (!outline.has(i)) movable.push(i); });

  let tuned: RefineReport | null = null;
  const passes = o.refine ?? 12;
  if (passes > 0 && movable.length) {
    const res = refine(
      fixed,
      movable.map((i) => ({
        points: found[i].points.map((p): Vec2 => [p[0], p[1]]),
        widths: [...found[i].widths],
        closed: found[i].closed,
        cap: found[i].cap,
      })),
      coverage(bm), colour, { rounds: passes },
    );
    res.ribbons.forEach((r, n) => {
      found[movable[n]].points = r.points;
      found[movable[n]].widths = r.widths;
    });
    tuned = res.report;
  }

  /**
   * A run that is really a circle or a line is emitted as one.
   *
   * The straight fit is tried first. A short, gently curved run will also admit
   * some enormous circle that passes through it, and describing a leg as a
   * 4000-pixel arc is true, useless, and impossible to animate.
   *
   * A primitive carries one width, so it is only offered where the corrected
   * profile is near enough to flat to lose nothing by saying so.
   */
  const tol = (o.fit ?? 1.5) * (tuned ? RELAXED : 1);
  const shape = new Map<number, string>();
  if (tol > 0) {
    found.forEach((k, i) => {
      if (outline.has(i) || tapering[i] || k.points.length < 5) return;
      // The same bar as everywhere else for "holds one width", rather than a
      // second opinion about the same question.
      const flat = Math.max(...k.widths) / Math.max(0.5, Math.min(...k.widths));
      if (flat > TAPER) return;
      const tail = `stroke: INK, width: ${n1(pen[i] / s)}${k.cap === 'butt' ? `, cap: 'butt'` : ''}`;

      const straight = fitLine(k.points);
      if (straight && straight.error <= tol && straight.inliers >= MOSTLY) {
        used.add('line');
        shape.set(i, `    //   a straight line, within ${n1(straight.error / s)}px over its whole length\n`
          + `    line({ from: [${n1(straight.from[0] / s)}, ${n1(straight.from[1] / s)}], `
          + `to: [${n1(straight.to[0] / s)}, ${n1(straight.to[1] / s)}], ${tail} });`);
        return;
      }

      const round = fitCircle(k.points);
      if (!round || round.error > tol || round.inliers < MOSTLY) return;
      const sweep = Math.abs(round.to - round.from);
      const [x0, y0, x1, y1] = bounds(k.points, 1);
      if (sweep < MIN_SWEEP || round.r > Math.hypot(x1 - x0, y1 - y0) * MAX_RADIUS) return;
      // A turn tighter than its own stroke is a blob, not an arc: at r = width
      // the inner edge has almost closed on itself, and a constant-width arc
      // through it throws away the taper that is the only thing making it read
      // as a curl. Centreline error alone cannot see this — the fit is a good
      // fit, of the wrong kind of thing.
      if (round.r < pen[i] * TIGHT) return;
      const arcArgs = `cx: ${n1(round.cx / s)}, cy: ${n1(round.cy / s)}, r: ${n1(round.r / s)}`;
      const whole = k.closed || sweep >= 359;
      const angles = whole ? '' : `, from: ${n1(round.from)}, to: ${n1(round.to)}`;
      used.add('arc');
      shape.set(i, `    //   a circle, within ${n1(round.error / s)}px over ${Math.round(sweep)} degrees, fitted\n`
        + `    //   from ${k.points.length} corrected samples.\n`
        + `    arc({ ${arcArgs}${angles}, ${tail} });`);
    });
  }
  const mode = o.ribbons ?? 'all';
  if (found.length) used.add('measuredRun');

  const runData = found.map((run, i) => {
    const options = [
      run.cap === 'butt' ? `cap: 'butt' as const` : '',
      run.closed ? 'closed: true' : '',
    ].filter(Boolean).join(', ');
    return `  s${i}: measuredRun([\n${pointList(run.points, s)},\n  ], [\n`
      + `${wrap(run.widths.map((width) => n1(width / s)))},\n  ]${options ? `, { ${options} }` : ''}),`;
  }).join('\n');

  const body = found.map((k, i) => {
    const box = `[${bounds(k.points, s).map(Math.round).join(' ')}]`;

    const traced = outline.get(i);
    if (traced) {
      used.add('path');
      return `    // s${i}  box ${box}  length ${Math.round(k.length / s)}px\n`
        + `    //   a filled blob with no centreline to measure, so this is its traced outline.\n`
        + `    path({ d: '${traced}', fill: INK });`;
    }

    const bends = k.corners.length
      ? `\n    // ! turns sharply at ${k.corners.map((c) => `(${Math.round(c[0] / s)}, ${Math.round(c[1] / s)})`).join(' ')}`
        + `\n    //   A drawn stroke curves; a hard corner usually means two things were`
        + `\n    //   traced as one run because they touch. Consider splitting it there.`
      : '';
    const width = n1(pen[i] / s);
    const snapped = pen[i] !== k.width
      ? `\n    //   width snapped from ${n1(k.width / s)} to the shared pen weight ${width}`
      : '';
    // A cut end rendered with a round cap bulges past the tip and leaves the
    // corners bare, so the measured cap travels with the geometry.
    const head = `    // s${i}  box ${box}  length ${Math.round(k.length / s)}px  width ${width}`
      + `${k.cap === 'butt' ? '  cut ends' : ''}${snapped}${bends}\n`;

    const fitted = shape.get(i);
    if (fitted) return head + fitted;

    /**
     * A run whose width changes along it is emitted as what it is: a centreline
     * with a width at every point, offset into its own outline. That is exact
     * where one number cannot be, and unlike a traced outline it keeps the
     * centreline, so the shape can still be posed.
     */
    if (mode === 'all' || (mode === 'taper' && tapering[i])) {
      used.add('ribbon');
      profiled++;
      return `${head}    //   width runs ${n1(Math.min(...k.widths) * 2 / s)} to ${n1(Math.max(...k.widths) * 2 / s)}, `
        + `so this is a measured profile rather than one number.\n`
        + `    ribbon(RUNS.s${i}.points, RUNS.s${i}.widths, { fill: INK`
        + `${k.cap === 'butt' ? `, cap: 'butt'` : ''}${k.closed ? ', closed: true' : ''} });`;
    }

    used.add('through');
    const opts = [
      `stroke: INK`, `width: ${width}`,
      k.cap === 'butt' ? `cap: 'butt'` : '', k.closed ? 'closed: true' : '',
    ].filter(Boolean).join(', ');
    return `${head}    through(RUNS.s${i}.points, { ${opts} });`;
  }).join('\n\n');

  const jointList = joints.length
    ? joints.map((j) => `(${Math.round(j[0] / s)}, ${Math.round(j[1] / s)})`).join('  ')
    : '(none found)';

  const source = `/**
 * Traced from ${basename(file)} by \`heron trace\`.
 *
 * GEOMETRY IS MEASURED. ANATOMY IS NOT. This file renders, but it cannot move:
 * every run of ink is a sibling in one flat layer, so there is no leg to rotate.
 * Finish it in this order — the order matters, and skipping ahead is how scenes
 * end up quietly wrong.
 *
 *   1. Check the trace before touching it:
 *        heron match ${self} ${basename(file)}
 *      Overlap should already be high. If it is not, re-run \`heron trace\` with a
 *      different --epsilon or --threshold rather than hand-editing points.
 *
 *   2. See which run is which before grouping anything:
 *        heron shapes ${self}
 *      One cell per run, lit up inside the whole drawing. Do not skip this and
 *      work from the boxes below instead — a box around a folded limb and a box
 *      around a leaf are the same rectangle, and guessing here is how a bird
 *      ends up with a third leg that never moves.
 *
 *   3. Group the strokes into named parts, nesting them the way the body is
 *      jointed: a shin lives inside a thigh, so it follows when the thigh turns.
 *      Keep the numbers below exactly as they are while you do this. They were
 *      measured; anything you retype by eye is a guess re-entering the file.
 *
 *   4. Give every moving part a \`pivot\`, at the joint's coordinate in this same
 *      space. A pivot is a position, not an offset.
 *
 *   5. Set \`ground\` on the character to the y of the floor, or the contact
 *      lints cannot run at all.
 *
 *   6. Only then animate, and re-run \`heron match\` afterwards to confirm the
 *      rest pose still matches the reference.
 *
 * Two things this trace could not know, and you must decide:
 *   - Strokes that overlap in the drawing are separate runs here. Some belong to
 *     one part; some are the seam between two.
 *   - A pose is not anatomy. If the reference shows a limb tucked or hidden, it
 *     still needs to exist as a part before it can move.
 *
 * CANDIDATE JOINTS. These are where the skeleton forks, which is where one run
 * of ink leaves another — so they are the best guess the pixels can offer at
 * where the joints are, and they are measured rather than eyeballed. Treat them
 * as suggestions: the drawing decides what is actually a joint.
 *
 *   ${jointList}
 *
 * Lines below marked \`// !\` are things the trace noticed but could not resolve.
 * Read every one before animating.
 */

import { ${[...used].join(', ')}, type Character } from '${o.importFrom ?? '@heron/core'}';

const INK = '${colour}';

// Named geometry data: group, cut or join these runs without ever transcribing
// a point separately from its measured width profile.
export const RUNS = {
${runData}
};

export const JOINTS = [${joints.map((joint) => `[${n1(joint[0] / s)}, ${n1(joint[1] / s)}]`).join(', ')}];

export const ${name}: Character = character(
  '${name}',
  {
    viewBox: [0, 0, ${W}, ${H}],
    duration: 1,
    // ground: ${H - 1},   // <- the floor's y, once you know where the feet are
  },
  () => {
    // Declaration order is z-order. Longest run first; reorder as needed.
    layer('art', () => {
${body.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}
    });
  },
);

export default ${name};
`;

  return {
    source, strokes: found, colour, width: W, height: H, varying,
    joints: joints.map((j): Vec2 => [Math.round(j[0] / s), Math.round(j[1] / s)]),
    outlined: outline.size,
    fitted: shape.size,
    profiled,
    tuned,
  };
}
