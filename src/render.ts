/**
 * Static rendering: one pose, one SVG. This is what the agent looks at.
 */

import type { Character, Node, PaintDefinition, ShapeSpec, Vec2 } from './scene.ts';
import type { CueSheet, Score } from './score.ts';
import { pathAt } from './path-morph.ts';
import { type Frame, type Mat, type NodePose, type Pose, REST, apply, evaluate, frameAt } from './timeline.ts';

function attrs(a: Record<string, string | number>): string {
  return Object.entries(a)
    .map(([k, v]) => `${k}="${typeof v === 'number' ? round(v) : v}"`)
    .join(' ');
}

export function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function shapeSvg(s: ShapeSpec, t = 0, className?: string): string {
  const rendered = { ...s.attrs };
  if (s.morph) rendered.d = pathAt(s.morph, t);
  if (className) rendered.class = rendered.class ? `${rendered.class} ${className}` : className;
  return `<${s.tag} ${attrs(rendered)}/>`;
}

interface ShapeUse {
  id: string;
  x: number;
  y: number;
}

export interface RenderContext {
  uses: Map<ShapeSpec, ShapeUse>;
  symbols: Array<{ id: string; shape: ShapeSpec }>;
  morphClasses: Map<ShapeSpec, string>;
}

function stableAttrs(a: Record<string, string | number>): string {
  return JSON.stringify(Object.keys(a).sort().map((key) => [key, a[key]]));
}

/** Which attributes carry a shape's position. Lines also shift their far end. */
const ORIGIN: Record<string, [string, string]> = {
  circle: ['cx', 'cy'], ellipse: ['cx', 'cy'], rect: ['x', 'y'], line: ['x1', 'y1'],
};

function reusableShape(shape: ShapeSpec): {
  key: string;
  x: number;
  y: number;
  template: ShapeSpec;
} | null {
  const a = shape.attrs;
  // A transform commonly embeds the original centre, so translating the
  // primitive independently would change its transform origin.
  if (a.transform !== undefined) return null;
  const rest = { ...a };
  const origin = ORIGIN[shape.tag];
  if (!origin) return null;
  const x = Number(rest[origin[0]]);
  const y = Number(rest[origin[1]]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  rest[origin[0]] = 0;
  rest[origin[1]] = 0;
  if (shape.tag === 'line') {
    const x2 = Number(rest.x2);
    const y2 = Number(rest.y2);
    if (!Number.isFinite(x2) || !Number.isFinite(y2)) return null;
    rest.x2 = x2 - x;
    rest.y2 = y2 - y;
  }
  const template = { tag: shape.tag, attrs: rest };
  return { key: `${shape.tag}:${stableAttrs(rest)}`, x, y, template };
}

/**
 * Finds repeated translated primitives once per character.
 *
 * Fields and vector type are mostly the same small circles and line segments at
 * different coordinates. SVG already has exactly that representation:
 * definition plus `<use x y>`. The scene remains expanded for addressing and
 * lints; only its serialized form is compacted.
 */
export function renderContext(ch: Character): RenderContext {
  const groups = new Map<string, Array<{ shape: ShapeSpec; x: number; y: number; template: ShapeSpec }>>();
  for (const { shape } of listShapes(ch)) {
    const candidate = reusableShape(shape);
    if (!candidate) continue;
    const group = groups.get(candidate.key) ?? [];
    group.push({ shape, x: candidate.x, y: candidate.y, template: candidate.template });
    groups.set(candidate.key, group);
  }

  const uses = new Map<ShapeSpec, ShapeUse>();
  const symbols: RenderContext['symbols'] = [];
  const occupied = new Set(ch.definitions.map((d) => d.name));
  let index = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let id = `h-auto-${index++}`;
    while (occupied.has(id)) id = `h-auto-${index++}`;
    occupied.add(id);
    symbols.push({ id, shape: group[0].template });
    for (const item of group) uses.set(item.shape, { id, x: item.x, y: item.y });
  }
  return { uses, symbols, morphClasses: new Map() };
}

function gradientAttrs(def: PaintDefinition): Record<string, string | number> {
  const shared: Record<string, string | number> = {
    id: def.name,
    gradientUnits: def.units,
    spreadMethod: def.spread,
  };
  if (def.transform) shared.gradientTransform = def.transform;
  if (def.kind === 'linear') {
    return { ...shared, x1: def.x1, y1: def.y1, x2: def.x2, y2: def.y2 };
  }
  const radial: Record<string, string | number> = {
    ...shared, cx: def.cx, cy: def.cy, r: def.r,
  };
  if (def.fx !== undefined) radial.fx = def.fx;
  if (def.fy !== undefined) radial.fy = def.fy;
  return radial;
}

/** Serialises the resources a character's shapes refer to. */
export function definitionsSvg(ch: Character, indent = '  ', context = renderContext(ch)): string {
  if (!ch.definitions.length && !context.symbols.length) return '';
  const body = ch.definitions.map((def) => {
    if (def.kind === 'clip') {
      const shapes = definitionShapes(def.root, indent + '    ');
      return `${indent}  <clipPath id="${def.name}" clipPathUnits="${def.units}">\n${shapes}\n${indent}  </clipPath>`;
    }
    if (def.kind === 'mask') {
      const region = def.region
        ? ` ${attrs({ x: def.region.x, y: def.region.y, width: def.region.width, height: def.region.height })}`
        : '';
      const shapes = definitionShapes(def.root, indent + '    ');
      return `${indent}  <mask id="${def.name}" maskUnits="${def.units}" maskContentUnits="${def.contentUnits}" mask-type="${def.mode}"${region}>\n${shapes}\n${indent}  </mask>`;
    }
    const tag = def.kind === 'linear' ? 'linearGradient' : 'radialGradient';
    const stops = def.stops.map((stop) => {
      const a: Record<string, string | number> = {
        offset: stop.at,
        'stop-color': stop.color,
      };
      if (stop.opacity !== undefined) a['stop-opacity'] = stop.opacity;
      return `${indent}    <stop ${attrs(a)}/>`;
    }).join('\n');
    return `${indent}  <${tag} ${attrs(gradientAttrs(def))}>\n${stops}\n${indent}  </${tag}>`;
  });
  body.push(...context.symbols.map(({ id, shape }) => {
    const withId: ShapeSpec = { tag: shape.tag, attrs: { id, ...shape.attrs } };
    return `${indent}  ${shapeSvg(withId)}`;
  }));
  return `${indent}<defs>\n${body.join('\n')}\n${indent}</defs>`;
}

/** Clip geometry has no rig or animation semantics, so emit only its ink. */
function definitionShapes(node: Node, indent: string): string {
  return node.content.map((item) =>
    'shape' in item
      ? indent + shapeSvg(item.shape)
      : definitionShapes(item.node, indent),
  ).join('\n');
}

/**
 * Repaints a shape without caring what kind it is.
 *
 * `fill="none"` and `stroke="none"` are load-bearing — an arc is a stroked path
 * with no fill, and painting that fill turns a thin ring into a solid disc. So
 * `none` is left exactly where it is, and only real colours are replaced.
 */
function repaint(s: ShapeSpec, colour: string): ShapeSpec {
  const attrs: Record<string, string | number> = { ...s.attrs };
  for (const k of ['fill', 'stroke']) {
    if (attrs[k] !== undefined && attrs[k] !== 'none') attrs[k] = colour;
  }
  return { tag: s.tag, attrs };
}

/**
 * The SVG transform attribute equivalent of the CSS the compiler emits.
 * Kept deliberately in the same order as `localMatrix`.
 */
export function transformAttr(p: NodePose, pivot?: Vec2): string {
  const parts: string[] = [];
  const [px, py] = pivot ?? [0, 0];
  if (p.x || p.y) parts.push(`translate(${round(p.x)} ${round(p.y)})`);
  if (p.rotate) parts.push(`rotate(${round(p.rotate)} ${round(px)} ${round(py)})`);
  if (p.scaleX !== 1 || p.scaleY !== 1) {
    parts.push(`translate(${round(px)} ${round(py)}) scale(${round(p.scaleX)} ${round(p.scaleY)}) translate(${round(-px)} ${round(-py)})`);
  }
  return parts.join(' ');
}

/**
 * Rewrites a shape on its way out. Used to pick one shape out of the drawing —
 * shapes are compared by identity, so this needs no agreement with any separate
 * enumeration of them.
 */
export type Paint = (shape: ShapeSpec) => ShapeSpec;

/**
 * One group per part, plus one more for every layer of motion past the first.
 *
 * The nesting is not a rendering detail — it is how layers compose, here and in
 * the compiled stylesheet alike. Writing them as separate groups is what lets
 * CSS animate each one independently, and drawing the static pose the same way
 * keeps a snapshot structurally identical to the thing it is a snapshot of.
 */
export function nodeSvg(
  node: Node,
  pose: Pose,
  indent: string,
  paint?: Paint,
  context?: RenderContext,
  time = 0,
): string {
  const layers = pose.get(node.path) ?? [];
  const depth = indent + '  '.repeat(Math.max(0, node.tracks.length - 1));
  let out = node.content
    .map((item) => ('shape' in item
      ? depth + '  ' + (() => {
          if (paint) return shapeSvg(paint(item.shape), time);
          const use = context?.uses.get(item.shape);
          return use
            ? `<use href="#${use.id}" x="${round(use.x)}" y="${round(use.y)}"/>`
            : shapeSvg(item.shape, time, context?.morphClasses.get(item.shape));
        })()
      : nodeSvg(item.node, pose, depth + '  ', paint, context, time)))
    .join('\n');

  // Innermost layer first, wrapping outward, so layer 0 ends up on the outside.
  for (let i = Math.max(0, node.tracks.length - 1); i >= 0; i--) {
    const p = layers[i] ?? REST;
    const pad = indent + '  '.repeat(i);
    const t = transformAttr(p, node.pivot);
    const a: string[] = [];
    if (node.path) a.push(`class="${cssClass(node.path, i)}"`);
    if (i === 0 && node.clip) a.push(`clip-path="url(#${node.clip})"`);
    if (i === 0 && node.mask) a.push(`mask="url(#${node.mask})"`);
    if (t) a.push(`transform="${t}"`);
    if (p.opacity !== 1) a.push(`opacity="${round(p.opacity)}"`);
    // A dash pattern as long as the longest stroke under here, which both the
    // shapes and the compiled animation inherit. Written once, as an attribute,
    // so the snapshot and the stylesheet cannot disagree about the length.
    if (node.tracks[i]?.draw !== undefined) {
      const dash = strokeLength(node);
      a.push(`stroke-dasharray="${round(dash, 2)}"`);
      if (p.draw !== 1) a.push(`stroke-dashoffset="${dashOffset(p.draw, dash)}"`);
    }
    out = `${pad}<g${a.length ? ' ' + a.join(' ') : ''}>\n${out}\n${pad}</g>`;
  }
  return out;
}

/** Layer 0 keeps the bare name, so a part with one layer looks like it always did. */
export function cssClass(path: string, layer = 0): string {
  return 'h-' + path.replace(/\./g, '-') + (layer ? `-l${layer}` : '');
}

/** Root element shared by the snapshot and the build, so the two cannot drift. */
export function svgOpen(ch: Character, width: number, height: number): string {
  const [vx, vy, vw, vh] = ch.viewBox;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${width}" height="${height}" role="img" aria-label="${ch.name}">`;
}

/** Output pixel size, defaulting to twice the viewBox. */
export function outputSize(ch: Character, width?: number): { width: number; height: number } {
  const w = width ?? ch.viewBox[2] * 2;
  return { width: w, height: round((w * ch.viewBox[3]) / ch.viewBox[2]) };
}

export interface RenderOptions {
  /** Pixel width of the output; height follows the viewBox aspect. */
  width?: number;
  /** A prepared shape-reuse context, so per-frame callers can build it once. */
  context?: RenderContext;
}

/** Joins document pieces with newlines, dropping the empty ones. */
export function block(...parts: string[]): string {
  return parts.filter(Boolean).join('\n');
}

/** Sheet cell geometry, shared so callers can size a raster to match. */
export const SHEET_CELL = 260;
export const SHEET_PAD = 8;
export const SHEET_LABEL = 20;

/** Width in pixels of a sheet with this many columns. */
export function sheetWidth(cols: number, cellWidth = SHEET_CELL): number {
  return cols * cellWidth + SHEET_PAD * (cols + 1);
}

/** The default frame times for a sheet: evenly spaced across one cycle. */
export function sheetTimes(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i / count);
}

/** Serialises the pose at cycle time `t` (0..1) as a standalone static SVG. */
export function renderStatic(ch: Character, t: number, opts: RenderOptions = {}): string {
  const { width, height } = outputSize(ch, opts.width);
  const pose = evaluate(ch, t);
  const context = opts.context ?? renderContext(ch);
  return block(
    svgOpen(ch, width, height),
    definitionsSvg(ch, '  ', context),
    nodeSvg(ch.root, pose, '  ', undefined, context, t),
    '</svg>',
  ) + '\n';
}

/**
 * The grid both sheets are drawn on.
 *
 * There are two of them — poses over time, and shapes one at a time — and they
 * are read side by side, so the chrome has to stay identical. Two copies of this
 * layout would be two instruments that could drift apart while appearing to
 * agree, which is the one thing a comparison tool must not do.
 */
function tile(
  ch: Character,
  cells: { label: string; body: string }[],
  cols: number,
  cellWidth: number,
  context = renderContext(ch),
): string {
  const [vx, vy, vw, vh] = ch.viewBox;
  const rows = Math.ceil(cells.length / cols);
  const chh = round((cellWidth * vh) / vw);
  const pad = SHEET_PAD;
  const W = sheetWidth(cols, cellWidth);
  const H = rows * (chh + SHEET_LABEL) + pad * (rows + 1);

  const drawn = cells.map((cell, i) => {
    const cx = pad + (i % cols) * (cellWidth + pad);
    const cy = pad + Math.floor(i / cols) * (chh + SHEET_LABEL + pad);
    return `  <g>
    <rect x="${cx}" y="${cy}" width="${cellWidth}" height="${chh + SHEET_LABEL}" fill="#ffffff" stroke="#dfe4e8"/>
    <text x="${cx + 6}" y="${cy + chh + 14}" font-family="ui-monospace,monospace" font-size="11" fill="#68757f">${cell.label}</text>
    <svg x="${cx}" y="${cy}" width="${cellWidth}" height="${chh}" viewBox="${vx} ${vy} ${vw} ${vh}">
${cell.body}
    </svg>
  </g>`;
  });

  return block(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    definitionsSvg(ch, '  ', context),
    `  <rect width="${W}" height="${H}" fill="#eef1f3"/>`,
    drawn.join('\n'),
    '</svg>',
  ) + '\n';
}

/**
 * Several poses tiled into one image. Agents judge motion far better from
 * frames side by side than from a single screenshot, so this is the workhorse
 * of the feedback loop. Built as nested <svg> elements, which keeps it a pure
 * SVG operation with no image compositing.
 */
export function renderSheet(
  ch: Character, times: number[], opts: { cols?: number; cellWidth?: number; onion?: number } = {},
): string {
  const context = renderContext(ch);
  const cells = times.map((t, i) => ({
    label: `t=${t.toFixed(2)}`,
    body: opts.onion
      ? onionSvg(ch, times, i, opts.onion, context)
      : nodeSvg(ch.root, evaluate(ch, t), '      ', undefined, context, t),
  }));
  return tile(ch, cells, opts.cols ?? Math.min(4, times.length), opts.cellWidth ?? SHEET_CELL, context);
}

export interface CueFrame {
  cue: string;
  /** Normalized cycle time. */
  time: number;
  /** Local progress through the cue. */
  progress: number;
  /** Wall-clock time from the start of the animation. */
  seconds: number;
}

export interface CueSheetRenderOptions {
  cols?: number;
  cellWidth?: number;
  /** Frames per cue, or exact local progress values. Defaults to start/middle/end. */
  samples?: number | number[];
  /** Render only these named cues, in this order. */
  cues?: string[];
}

/** `n` local progress values evenly spaced over a cue; a single sample sits mid-cue. */
function evenly(n: number): number[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`heron: cue sheet samples must be a positive integer, got ${n}`);
  }
  return n === 1 ? [0.5] : Array.from({ length: n }, (_, i) => i / (n - 1));
}

/** Resolves review frames from a score or overlapping cue sheet. */
export function cueFrames(
  timeline: Score | CueSheet,
  o: Pick<CueSheetRenderOptions, 'samples' | 'cues'> = {},
): CueFrame[] {
  const beats = timeline.windows;
  const byName = new Map(beats.map((b) => [b.name, b]));
  const selected = o.cues ?? beats.map((b) => b.name);
  const local = typeof o.samples === 'number' ? evenly(o.samples) : o.samples ?? [0, 0.5, 1];
  if (!local.length || local.some((u) => !Number.isFinite(u) || u < 0 || u > 1)) {
    throw new Error('heron: cue sheet sample positions must be from 0 to 1');
  }

  return selected.flatMap((name) => {
    const beat = byName.get(name);
    if (!beat) {
      throw new Error(`heron: no cue "${name}". Available: ${[...byName.keys()].join(', ')}`);
    }
    return local.map((progress): CueFrame => {
      // Resolve in the authored unit first. This avoids turning a clean 4.5s
      // midpoint into 4.499999999999999s through normalized-time subtraction.
      const seconds = beat.from * timeline.duration + beat.seconds * progress;
      return { cue: name, time: seconds / timeline.duration, progress, seconds };
    });
  });
}

/**
 * A film review sheet selected and labelled by authored timing structure.
 *
 * Cue boundaries are intentionally not deduplicated: the same instant can be
 * the end of one thought and the start of another, and both labels matter.
 */
export function renderCueSheet(
  ch: Character,
  timeline: Score | CueSheet,
  o: CueSheetRenderOptions = {},
): string {
  if (Math.abs(ch.duration - timeline.duration) > 1e-9) {
    throw new Error(
      `heron: cue sheet duration ${timeline.duration}s does not match "${ch.name}" (${ch.duration}s)`,
    );
  }
  const frames = cueFrames(timeline, o);
  const context = renderContext(ch);
  const cells = frames.map((frame) => ({
    label: `${frame.cue} ${Math.round(frame.progress * 100)}% · ${frame.seconds.toFixed(2)}s`,
    body: nodeSvg(ch.root, evaluate(ch, frame.time), '      ', undefined, context, frame.time),
  }));
  return tile(ch, cells, o.cols ?? Math.min(4, frames.length), o.cellWidth ?? SHEET_CELL, context);
}

const TRAIL = '#3ba064';

/**
 * The frames before this one, ghosted behind it.
 *
 * A sheet answers "is this pose right"; it cannot answer "is this *motion*
 * right", because the thing that goes wrong in motion — an arc that flattens, a
 * limb that changes direction a beat early, a rotation that turns the wrong way
 * — is a relationship between frames and is invisible in any one of them. Both
 * defects that survived to the final render of the stairs scene were of exactly
 * that kind, and both would have been obvious here.
 *
 * Animators have drawn this for a century and call it onion skinning. The
 * ghosts fade with age so the direction of travel reads without a legend.
 */
function onionSvg(
  ch: Character, times: number[], index: number, depth: number, context?: RenderContext,
): string {
  const out: string[] = [];
  for (let back = Math.min(depth, index); back > 0; back--) {
    const t = times[index - back];
    const fade = round(0.32 * (1 - (back - 1) / Math.max(1, depth)), 3);
    out.push(`      <g opacity="${fade}">`);
    out.push(nodeSvg(ch.root, evaluate(ch, t), '        ', (s) => repaint(s, TRAIL), undefined, t));
    out.push('      </g>');
  }
  out.push(nodeSvg(ch.root, evaluate(ch, times[index]), '      ', undefined, context, times[index]));
  return out.join('\n');
}

// --- shape identification ----------------------------------------------------

/** One drawn shape, and which part owns it. Array position is its `s0`, `s1` … */
export interface ShapeRef {
  /** Dotted path of the owning part, or `''` at the root. */
  path: string;
  shape: ShapeSpec;
}

/** Every shape in the drawing, in declaration order. */
export function listShapes(ch: Character): ShapeRef[] {
  const out: ShapeRef[] = [];
  const walk = (node: Node): void => {
    for (const item of node.content) {
      if ('shape' in item) out.push({ path: node.path, shape: item.shape });
      else walk(item.node);
    }
  };
  walk(ch.root);
  return out;
}

const GHOST = '#dee3e7';
const PICK = '#e03131';

/**
 * One cell per shape, each showing the whole drawing with that shape picked out.
 *
 * This exists because deciding *which ink is which part* is the one step of the
 * pipeline with no instrument on it, and it is where the mistakes happen. A
 * traced file names its runs `s0`, `s1`, `s2`; nothing about those names says
 * which is a leg, and a bounding box does not say either — a box around a folded
 * limb and a box around a leaf are the same rectangle. Seeing each run lit up
 * inside the whole drawing answers it immediately, and answers it before the
 * grouping is written rather than after the animation looks wrong.
 *
 * Rendered at rest, deliberately. This is a question about anatomy, not motion.
 */
export function renderShapeSheet(ch: Character, opts: { cols?: number; cellWidth?: number } = {}): string {
  const shapes = listShapes(ch);
  const pose = evaluate(ch, 0);
  const cells = shapes.map((ref, i) => ({
    label: ref.path ? `s${i}  ${ref.path}` : `s${i}`,
    // Matched on the shape itself rather than on a position counted twice: the
    // same object `listShapes` handed back is the one the renderer reaches.
    body: nodeSvg(ch.root, pose, '      ', (s) => repaint(s, s === ref.shape ? PICK : GHOST), undefined, 0),
  }));
  return tile(ch, cells, opts.cols ?? Math.min(5, Math.max(1, shapes.length)), opts.cellWidth ?? SHEET_CELL);
}

// --- bounding boxes ----------------------------------------------------------

export interface Box { x0: number; y0: number; x1: number; y1: number }

function num(v: string | number | undefined, d = 0): number {
  return typeof v === 'number' ? v : v === undefined ? d : parseFloat(v) || d;
}

/** The `points` attribute, flattened. Defined once so both readers agree on it. */
function polygonPoints(a: Record<string, string | number>): number[] {
  return String(a.points).trim().split(/[\s,]+/).map(Number);
}

/** Local-space bounds of one shape. Paths use the control-point hull, which is
 *  conservative (never too small) and needs no path parser. */
export function shapeBox(s: ShapeSpec): Box | null {
  const a = s.attrs;
  const sw = num(a['stroke-width'], 0) / 2;
  const grow = (b: Box): Box => ({ x0: b.x0 - sw, y0: b.y0 - sw, x1: b.x1 + sw, y1: b.y1 + sw });
  switch (s.tag) {
    case 'circle': {
      const r = num(a.r);
      return grow({ x0: num(a.cx) - r, y0: num(a.cy) - r, x1: num(a.cx) + r, y1: num(a.cy) + r });
    }
    case 'ellipse':
      return grow({
        x0: num(a.cx) - num(a.rx), y0: num(a.cy) - num(a.ry),
        x1: num(a.cx) + num(a.rx), y1: num(a.cy) + num(a.ry),
      });
    case 'rect':
      return grow({ x0: num(a.x), y0: num(a.y), x1: num(a.x) + num(a.width), y1: num(a.y) + num(a.height) });
    case 'line':
      return grow({
        x0: Math.min(num(a.x1), num(a.x2)), y0: Math.min(num(a.y1), num(a.y2)),
        x1: Math.max(num(a.x1), num(a.x2)), y1: Math.max(num(a.y1), num(a.y2)),
      });
    case 'polygon':
      return grow(hull(polygonPoints(a)));
    case 'path': {
      const pts = pathPoints(String(a.d));
      return pts.length ? grow(hull(pts.flat())) : null;
    }
    default:
      return null;
  }
}

/**
 * Points that bound a path: on-curve endpoints plus off-curve control points.
 * The control hull always contains the true curve, so this over-estimates
 * rather than under-estimates, which is the safe direction for clipping checks
 * and needs no curve subdivision. Arcs are the exception: their radii and flags
 * are not coordinates and must never be read as any, so they get bounded
 * exactly by `arcPoints`.
 */
/** One command of a path, with every coordinate resolved to absolute. */
interface Seg {
  /** The command, lower-cased. */
  key: string;
  /** Where it starts. */
  from: Vec2;
  /**
   * Its parameters, absolute. Coordinate pairs are converted; an arc's radii,
   * rotation and flags are left exactly as written.
   */
  abs: number[];
  /** Where it ends. */
  to: Vec2;
  /** The previous curve's last control point, mirrored — what `s` and `t` imply. */
  reflect: Vec2;
}

/**
 * Walks a path's commands, resolving relative coordinates and implicit repeats.
 *
 * Two things need this — the bounding hull that decides `out-of-view`, and the
 * arc length that decides how far a `draw` reveal has to travel — and they must
 * agree about what a `d` string says. Written twice they would agree only until
 * the first fix to one of them: a packed arc flag, an exponent, an implicit
 * command after `Z`. Written once they cannot disagree at all.
 */
function pathSegments(d: string, visit: (s: Seg) => void): void {
  const PARAMS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let rx = 0, ry = 0;
  let cmd = '';
  let i = 0;

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const key = cmd.toLowerCase();
    const rel = cmd === key;
    const n = PARAMS[key];
    if (n === undefined) { i++; continue; }

    const from: Vec2 = [cx, cy];
    if (key === 'z') {
      visit({ key, from, abs: [], to: [sx, sy], reflect: [cx, cy] });
      cx = sx; cy = sy; rx = cx; ry = cy;
      continue;
    }
    if (i + n > tokens.length) break;
    const p = tokens.slice(i, i + n).map(Number);
    i += n;

    let abs: number[];
    let to: Vec2;
    if (key === 'h') {
      to = [rel ? cx + p[0] : p[0], cy];
      abs = to;
    } else if (key === 'v') {
      to = [cx, rel ? cy + p[0] : p[0]];
      abs = to;
    } else if (key === 'a') {
      to = [rel ? cx + p[5] : p[5], rel ? cy + p[6] : p[6]];
      abs = [p[0], p[1], p[2], p[3], p[4], to[0], to[1]];
    } else {
      abs = p.map((v, k) => (rel ? v + (k % 2 ? cy : cx) : v));
      to = [abs[n - 2], abs[n - 1]];
    }

    visit({ key, from, abs, to, reflect: [2 * cx - rx, 2 * cy - ry] });

    // A curve's last control point is what the next smooth command mirrors;
    // anything else reflects about the current point, i.e. no curvature carried.
    if (key === 'c' || key === 's' || key === 'q') { rx = abs[n - 4]; ry = abs[n - 3]; }
    else if (key === 't') { rx = 2 * cx - rx; ry = 2 * cy - ry; }
    else { rx = to[0]; ry = to[1]; }

    [cx, cy] = to;
    // A moveto starts a subpath, and further coordinate pairs after it are lines.
    if (key === 'm') { sx = cx; sy = cy; cmd = rel ? 'l' : 'L'; }
  }
}

export function pathPoints(d: string): Vec2[] {
  const out: Vec2[] = [];
  pathSegments(d, (s) => {
    if (s.key === 'z') return;
    if (s.key === 'a') {
      out.push(...arcPoints(s.from[0], s.from[1], s.abs[0], s.abs[1], s.abs[2], s.abs[3] !== 0, s.abs[4] !== 0, s.to[0], s.to[1]));
      return;
    }
    for (let k = 0; k + 1 < s.abs.length; k += 2) out.push([s.abs[k], s.abs[k + 1]]);
  });
  return out;
}

/** An SVG arc in the centre parameterisation everything useful needs. */
interface Arc {
  cx: number; cy: number; rx: number; ry: number;
  phi: number; start: number; sweep: number;
}

function arcAt(a: Arc, t: number): Vec2 {
  const cosP = Math.cos(a.phi);
  const sinP = Math.sin(a.phi);
  return [
    a.cx + a.rx * Math.cos(t) * cosP - a.ry * Math.sin(t) * sinP,
    a.cy + a.rx * Math.cos(t) * sinP + a.ry * Math.sin(t) * cosP,
  ];
}

/**
 * Endpoint form to centre form, as the SVG spec defines it.
 *
 * Shared by everything that needs to know where an arc actually goes: its exact
 * bounds, and its length. Returns null when the arc degenerates to a line.
 */
function arcCentre(
  x1: number, y1: number,
  rxIn: number, ryIn: number, phiDeg: number,
  large: boolean, sweepFlag: boolean,
  x2: number, y2: number,
): Arc | null {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!rx || !ry) return null;

  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const px = cosP * dx + sinP * dy;
  const py = -sinP * dx + cosP * dy;

  // Radii too small to span the endpoints are scaled up, per the SVG spec.
  const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const den = rx * rx * py * py + ry * ry * px * px;
  const num = rx * rx * ry * ry - den;
  const co = den > 0 ? Math.sqrt(Math.max(0, num / den)) * (large === sweepFlag ? -1 : 1) : 0;
  const cxp = (co * rx * py) / ry;
  const cyp = (-co * ry * px) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const start = Math.atan2((py - cyp) / ry, (px - cxp) / rx);
  const end = Math.atan2((-py - cyp) / ry, (-px - cxp) / rx);
  let sweep = end - start;
  if (!sweepFlag && sweep > 0) sweep -= 2 * Math.PI;
  if (sweepFlag && sweep < 0) sweep += 2 * Math.PI;

  return { cx, cy, rx, ry, phi, start, sweep };
}

/**
 * Exact bounds of an SVG elliptical arc: both endpoints, plus whichever of the
 * four axis extremes the sweep actually passes through.
 *
 * The cheap approximation — pad the endpoints by the radii — is wrong by two
 * whole radii, so a ring drawn as one big arc reports a box several times its
 * real size and trips `out-of-view` on artwork that never leaves the frame.
 * Converting to centre parameterisation costs twenty lines and is exact.
 */
function arcPoints(
  x1: number, y1: number,
  rx: number, ry: number, phiDeg: number,
  large: boolean, sweepFlag: boolean,
  x2: number, y2: number,
): Vec2[] {
  const out: Vec2[] = [[x1, y1], [x2, y2]];
  const a = arcCentre(x1, y1, rx, ry, phiDeg, large, sweepFlag, x2, y2);
  if (!a) return out;
  const cosP = Math.cos(a.phi);
  const sinP = Math.sin(a.phi);

  // Angles where the arc is momentarily vertical (dx/dt = 0) or horizontal.
  for (const base of [Math.atan2(-a.ry * sinP, a.rx * cosP), Math.atan2(a.ry * cosP, a.rx * sinP)]) {
    for (const t of [base, base + Math.PI]) {
      let d = (t - a.start) % (2 * Math.PI);
      if (d < 0) d += 2 * Math.PI;
      if (Math.abs(a.sweep >= 0 ? d : d - 2 * Math.PI) <= Math.abs(a.sweep)) out.push(arcAt(a, t));
    }
  }
  return out;
}

// --- stroke length -----------------------------------------------------------

/** Samples per curved segment. Chord sums converge fast; sixteen is past the knee. */
const FLATTEN = 16;

function chords(pts: Vec2[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return n;
}

function bezierAt(p: Vec2[], t: number): Vec2 {
  // de Casteljau, so the same routine serves cubics and quadratics.
  let cur = p;
  while (cur.length > 1) {
    const next: Vec2[] = [];
    for (let i = 0; i + 1 < cur.length; i++) {
      next.push([cur[i][0] + (cur[i + 1][0] - cur[i][0]) * t, cur[i][1] + (cur[i + 1][1] - cur[i][1]) * t]);
    }
    cur = next;
  }
  return cur[0];
}

function sampleBezier(p: Vec2[]): Vec2[] {
  return Array.from({ length: FLATTEN + 1 }, (_, i) => bezierAt(p, i / FLATTEN));
}

/**
 * Arc length of a path's outline, by flattening it.
 *
 * `stroke-dasharray` needs this in user units, because the one thing that would
 * have made it unnecessary — `pathLength`, which renormalises a path to whatever
 * length you claim — is honoured by browsers and ignored by resvg. Relying on it
 * would have made a drawn-on stroke correct in the deliverable and wrong in
 * every snapshot the agent looks at, which is the one failure this project
 * cannot afford.
 *
 * Sampled rather than solved: elliptical arcs have no closed form at all, and a
 * chord sum is a slight under-estimate that `strokeLength` pads for.
 */
export function pathLength(d: string): number {
  let total = 0;
  pathSegments(d, (s) => {
    const chord = () => Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]);
    switch (s.key) {
      case 'm':
        return;
      case 'l': case 'h': case 'v': case 'z':
        total += chord();
        return;
      case 'a': {
        const arc = arcCentre(s.from[0], s.from[1], s.abs[0], s.abs[1], s.abs[2], s.abs[3] !== 0, s.abs[4] !== 0, s.to[0], s.to[1]);
        total += arc
          ? chords(Array.from({ length: FLATTEN + 1 }, (_, k) => arcAt(arc, arc.start + (arc.sweep * k) / FLATTEN)))
          : chord();
        return;
      }
      default: {
        // Cubic, quadratic, and their smooth forms, which supply the first
        // control point by reflection rather than writing it out.
        const pts: Vec2[] = [s.from];
        if (s.key === 's' || s.key === 't') pts.push(s.reflect);
        for (let k = 0; k + 1 < s.abs.length; k += 2) pts.push([s.abs[k], s.abs[k + 1]]);
        total += chords(sampleBezier(pts));
      }
    }
  });
  return total;
}

/** Outline length of one shape, whatever kind it is. */
export function shapeLength(s: ShapeSpec): number {
  const a = s.attrs;
  switch (s.tag) {
    case 'line':
      return Math.hypot(num(a.x2) - num(a.x1), num(a.y2) - num(a.y1));
    case 'circle':
      return 2 * Math.PI * num(a.r);
    case 'ellipse': {
      // Ramanujan's approximation, good to a part in ten thousand.
      const p = num(a.rx);
      const q = num(a.ry);
      const h = ((p - q) * (p - q)) / ((p + q) * (p + q));
      return Math.PI * (p + q) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    }
    case 'rect':
      return 2 * (num(a.width) + num(a.height));
    case 'polygon': {
      const nums = polygonPoints(a);
      const pts: Vec2[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      return pts.length ? chords([...pts, pts[0]]) : 0;
    }
    case 'path':
      return pathLength(String(a.d));
    default:
      return 0;
  }
}

/**
 * How much of the pattern is still hidden, in user units.
 *
 * The conversion between a 0..1 channel and `stroke-dashoffset` is exactly the
 * thing parity rests on, so the static renderer, the compiler and the test that
 * guards them all ask here rather than each writing it out.
 */
export function dashOffset(draw: number, dash: number): number {
  return round((1 - draw) * dash, 2);
}

/**
 * The dash length a part's `draw` channel is measured in.
 *
 * Every shape under the part shares the longest one, on purpose. A dash pattern
 * as long as the path it sits on is what makes `stroke-dashoffset` a reveal
 * rather than a repeating dotted line, and a *shared* one makes the strokes
 * reveal at a common speed: they all set off together and each finishes when its
 * own ink runs out, which is what a pen does. Giving each stroke its own length
 * would need its own animation, and the point of a part is that it has one.
 */
export function strokeLength(node: Node): number {
  let most = 0;
  const walk = (n: Node): void => {
    for (const item of n.content) {
      if ('shape' in item) most = Math.max(most, shapeLength(item.shape));
      else walk(item.node);
    }
  };
  walk(node);
  // A chord sum runs slightly short. Rounding up costs a sliver of the reveal at
  // one end and guarantees the stroke is never left with a gap at the other.
  return most * 1.02;
}

function hull(nums: number[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    x0 = Math.min(x0, nums[i]); x1 = Math.max(x1, nums[i]);
    y0 = Math.min(y0, nums[i + 1]); y1 = Math.max(y1, nums[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

function boxCorners(b: Box): Vec2[] {
  return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
}

/**
 * Local corners of every part's own shapes, keyed by path.
 *
 * Shape geometry is authored in the rest pose and never changes — only the
 * matrix above it does. Computing this once and transforming the corners avoids
 * re-parsing every path's `d` string at every sampled instant, which is the
 * bulk of the work in a bounds scan.
 */
export function localCorners(ch: Character): Map<string, Vec2[]> {
  const out = new Map<string, Vec2[]>();
  for (const node of ch.nodes()) {
    const pts: Vec2[] = [];
    for (const item of node.content) {
      if (!('shape' in item)) continue;
      const b = shapeBox(item.shape);
      if (b) pts.push(...boxCorners(b));
    }
    if (pts.length) out.set(node.path, pts);
  }
  return out;
}

export function boxOfCorners(corners: Vec2[] | undefined, m: Mat | undefined): Box | null {
  if (!corners || !m) return null;
  let out: Box | null = null;
  for (const c of corners) {
    const [x, y] = apply(m, c);
    out = out
      ? { x0: Math.min(out.x0, x), y0: Math.min(out.y0, y), x1: Math.max(out.x1, x), y1: Math.max(out.y1, y) }
      : { x0: x, y0: y, x1: x, y1: y };
  }
  return out;
}

export function mergeBoxes(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** World bounds of every part at one instant, given precomputed local corners. */
export function frameBox(frame: Frame, corners: Map<string, Vec2[]>): Box | null {
  let out: Box | null = null;
  for (const [path, pts] of corners) out = mergeBoxes(out, boxOfCorners(pts, frame.matrices.get(path)));
  return out;
}

/** World-space bounds of a part (its own shapes only) at time t. */
export function partBox(ch: Character, path: string, t: number): Box | null {
  const node = ch.find(path);
  if (!node) return null;
  return boxOfCorners(localCorners(ch).get(node.path), frameAt(ch, t).matrices.get(node.path));
}

/** World bounds of the whole character at time t. */
export function sceneBox(ch: Character, t: number): Box | null {
  return frameBox(frameAt(ch, t), localCorners(ch));
}
