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

import { type Stroke, inkColour, inkMask, junctions, loadImage, skeletonise, strokes } from './raster.ts';
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
}

/** Above this, a run is tapering rather than holding one width. */
const TAPER = 1.35;

function ident(s: string): string {
  // An input that is already a usable identifier is left exactly as given.
  // Case-folding it would quietly rename what the caller explicitly asked for.
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(s)) return s;
  const cleaned = s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1)))
    .join('');
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `art${cleaned}`;
}

function pointList(pts: Vec2[], scale: number): string {
  const p = pts.map(([x, y]) => `[${Math.round(x / scale)}, ${Math.round(y / scale)}]`);
  // One long line is unreadable and one point per line is unreviewable; six is
  // about the width of a sensible editor.
  const rows: string[] = [];
  for (let i = 0; i < p.length; i += 6) rows.push(`      ${p.slice(i, i + 6).join(', ')}`);
  return rows.join(',\n');
}

export function trace(file: string, o: TraceOptions = {}): TraceResult {
  const bm = loadImage(file);
  const mask = inkMask(bm, o.threshold);
  const colour = inkColour(bm, mask);
  const found = strokes(mask, o.epsilon ?? 1.2, o.minBranch ?? 6);
  const joints = junctions(skeletonise(mask));

  const s = bm.scale;
  const W = Math.round(bm.width / s);
  const H = Math.round(bm.height / s);
  const name = ident(o.name ?? basename(file, extname(file)));
  const varying = found.filter((k) => k.widthVariation > TAPER).length;
  const self = o.out ?? 'scene.ts';

  const body = found.map((k, i) => {
    const xs = k.points.map((p) => p[0] / s);
    const ys = k.points.map((p) => p[1] / s);
    const box = `[${Math.round(Math.min(...xs))} ${Math.round(Math.min(...ys))} ${Math.round(Math.max(...xs))} ${Math.round(Math.max(...ys))}]`;
    const taper = k.widthVariation > TAPER
      ? `\n    // ! width varies ${k.widthVariation}x along this run: probably a filled shape,`
        + `\n    //   not a stroke. Redraw it as path({ d }) or polygon() if it should taper.`
      : '';
    const bends = k.corners.length
      ? `\n    // ! turns sharply at ${k.corners.map((c) => `(${Math.round(c[0] / s)}, ${Math.round(c[1] / s)})`).join(' ')}`
        + `\n    //   A drawn stroke curves; a hard corner usually means two things were`
        + `\n    //   traced as one run because they touch. Consider splitting it there.`
      : '';
    const opts = [`stroke: INK`, `width: ${Math.round((k.width / s) * 10) / 10}`, k.closed ? 'closed: true' : '']
      .filter(Boolean).join(', ');
    return `    // s${i}  box ${box}  length ${Math.round(k.length / s)}px  width ${Math.round((k.width / s) * 10) / 10}${taper}${bends}\n`
      + `    through([\n${pointList(k.points, s)},\n    ], { ${opts} });`;
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
 *   2. Group the strokes into named parts, nesting them the way the body is
 *      jointed: a shin lives inside a thigh, so it follows when the thigh turns.
 *      Keep the numbers below exactly as they are while you do this. They were
 *      measured; anything you retype by eye is a guess re-entering the file.
 *
 *   3. Give every moving part a \`pivot\`, at the joint's coordinate in this same
 *      space. A pivot is a position, not an offset.
 *
 *   4. Set \`ground\` on the character to the y of the floor, or the contact
 *      lints cannot run at all.
 *
 *   5. Only then animate, and re-run \`heron match\` afterwards to confirm the
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

import { character, layer, through, type Character } from '${o.importFrom ?? '@heron/core'}';

const INK = '${colour}';

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
  };
}
