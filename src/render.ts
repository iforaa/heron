/**
 * Static rendering: one pose, one SVG. This is what the agent looks at.
 */

import type { Character, Node, PaintDefinition, ShapeSpec, Vec2, ViewBox } from './scene.ts';
import type { CueSheet, Score } from './score.ts';
// Type-only, so no runtime cycle appears even though track.ts imports geometry
// from here. Restating these shapes structurally would let the drawing and the
// measurement drift apart with nothing to warn about it.
import type { TrackReport, TrackedSample } from './track.ts';
import { pathAt } from './path-morph.ts';
import { type Frame, type Mat, type NodePose, type Pose, REST, apply, evaluate, frameAt, netPose } from './timeline.ts';

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

/**
 * Namespaces every SVG id in one fragment, so several drawings can share a document.
 *
 * A variants sheet holds N builds of one factory, and each build emits the *same*
 * author-written ids — `id="aperture"`, `url(#skyGradient)`. Concatenated, every
 * reference in the document resolves to the first definition, so a sheet varying a
 * clip radius silently draws cell 0's artwork in all N cells. Verified: two builds
 * whose clip radii were 10 and 45 both emitted `id="aperture"`.
 *
 * Done as a pass over the serialised fragment rather than by threading a prefix
 * through the emitters, because a paint reference is baked into a shape's own
 * `fill` attribute at scene-build time (`scene.ts` writes `url(#name)` there) and
 * `shapeSvg` never sees a render context. A pass over the text reaches every id by
 * construction; threading would reach only the sites someone remembered. Nothing
 * else in Heron's output contains `id="`, `url(#` or `href="#`, and a colour like
 * `fill="#e03131"` matches none of the three.
 *
 * Class names are deliberately left alone: they carry no cross-references in a
 * static sheet, and keeping them means a cell's part is still greppable by path.
 */
export function prefixIds(svg: string, prefix: string): string {
  if (!prefix) return svg;
  // Every form inserts the prefix immediately after a fixed opener, so the id
  // itself never needs capturing.
  return svg.replace(/\bid="|\bhref="#|url\(#/g, (opener) => opener + prefix);
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
export interface NodeSvgOptions {
  /**
   * Draw the whole subtree at this fraction of its opacity, folded into each
   * shape rather than set on the groups.
   *
   * Group opacity is not a free choice of spelling. A `<g opacity>` makes a
   * renderer composite that group through an offscreen layer sized by its
   * bounds, and when a crop excludes the group those bounds are empty: resvg
   * unwraps the zero-size rect and aborts the process, which no JavaScript
   * `catch` can intercept. Folding the same factor into the shapes needs no
   * layer. It is not pixel-identical where faint shapes overlap, which is why
   * it is opt-in and used for ghosts rather than for the real drawing.
   */
  fade?: number;
  /**
   * Skip any subtree whose world bounds fall outside this view.
   *
   * Off-frame artwork cannot be seen and costs bytes, and emitting it is what
   * gives a renderer empty bounds to compute in the first place.
   */
  cull?: { view: ViewBox; corners: Map<string, Vec2[]>; matrices: Map<string, Mat> };
}

export function nodeSvg(
  node: Node,
  pose: Pose,
  indent: string,
  paint?: Paint,
  context?: RenderContext,
  time = 0,
  o: NodeSvgOptions = {},
  carried = 1,
): string {
  const layers = pose.get(node.path) ?? [];

  if (o.cull) {
    const box = boxOfCorners(o.cull.corners.get(node.path), o.cull.matrices.get(node.path));
    const [vx, vy, vw, vh] = o.cull.view;
    if (box && (box.x1 < vx || box.y1 < vy || box.x0 > vx + vw || box.y0 > vy + vh)) return '';
  }

  // Folded opacity accumulates down the tree, because that is what the nested
  // groups would otherwise have multiplied for us.
  const faded = o.fade !== undefined;
  const own = faded ? layers.reduce((n, p) => n * p.opacity, 1) : 1;
  const alpha = carried * own;
  if (faded && alpha * o.fade! < 0.02) return '';

  const depth = indent + '  '.repeat(Math.max(0, node.tracks.length - 1));
  const shapeOf = (shape: ShapeSpec): string => {
    const painted = paint ? paint(shape) : shape;
    if (!faded) {
      if (paint) return shapeSvg(painted, time);
      const use = context?.uses.get(shape);
      return use
        ? `<use href="#${use.id}" x="${round(use.x)}" y="${round(use.y)}"/>`
        : shapeSvg(shape, time, context?.morphClasses.get(shape));
    }
    const attrs = { ...painted.attrs };
    const was = typeof attrs.opacity === 'number' ? attrs.opacity : 1;
    attrs.opacity = round(was * alpha * o.fade!, 3);
    return shapeSvg({ tag: painted.tag, attrs, morph: painted.morph }, time);
  };

  const out = node.content
    .map((item) => ('shape' in item
      ? depth + '  ' + shapeOf(item.shape)
      : nodeSvg(item.node, pose, depth + '  ', paint, context, time, o, alpha)))
    .filter(Boolean)
    .join('\n');
  if (!out) return '';

  // Innermost layer first, wrapping outward, so layer 0 ends up on the outside.
  let wrapped = out;
  for (let i = Math.max(0, node.tracks.length - 1); i >= 0; i--) {
    const p = layers[i] ?? REST;
    const pad = indent + '  '.repeat(i);
    const t = transformAttr(p, node.pivot);
    const a: string[] = [];
    if (node.path) a.push(`class="${cssClass(node.path, i)}"`);
    if (i === 0 && node.clip) a.push(`clip-path="url(#${node.clip})"`);
    if (i === 0 && node.mask) a.push(`mask="url(#${node.mask})"`);
    if (t) a.push(`transform="${t}"`);
    if (!faded && p.opacity !== 1) a.push(`opacity="${round(p.opacity)}"`);
    // A dash pattern as long as the longest stroke under here, which both the
    // shapes and the compiled animation inherit. Written once, as an attribute,
    // so the snapshot and the stylesheet cannot disagree about the length.
    if (node.tracks[i]?.draw !== undefined) {
      const dash = strokeLength(node);
      a.push(`stroke-dasharray="${round(dash, 2)}"`);
      if (p.draw !== 1) a.push(`stroke-dashoffset="${dashOffset(p.draw, dash)}"`);
    }
    wrapped = `${pad}<g${a.length ? ' ' + a.join(' ') : ''}>\n${wrapped}\n${pad}</g>`;
  }
  return wrapped;
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
export interface Cell {
  label: string;
  body: string;
  /**
   * Coloured swatches appended to the label, for a cell holding several tracked
   * parts. Drawn in the label band rather than in the body: the body is a nested
   * `<svg>` scaled to the scene's viewBox, so text inside it would be sized in
   * scene units and illegible on anything but a small drawing.
   */
  legend?: Array<{ colour: string; text: string }>;
  /**
   * A plot drawn beneath the artwork in a unit box, with the aspect ratio free.
   * Emitters write 0..1 coordinates, the same convention `studio` plots channels in.
   */
  chart?: string;
}

export interface TileOptions {
  context?: RenderContext;
  /** Crop shared by every cell. Defaults to the scene's own viewBox. */
  viewBox?: ViewBox;
  /** Height in pixels of the per-cell plot band. */
  chartHeight?: number;
  /**
   * Definitions block, when the cells are not all one character's.
   *
   * A variants sheet has N characters with N sets of resources, so the sheet's
   * `<defs>` cannot be derived from any single one of them.
   */
  defs?: string;
}

/**
 * The grid every sheet is drawn on.
 *
 * There are several of them — poses over time, shapes one at a time, trajectories,
 * variants — and they are read side by side, so the chrome has to stay identical.
 * Copies of this layout would be instruments that could drift apart while
 * appearing to agree, which is the one thing a comparison tool must not do.
 */
function tile(
  ch: Character,
  cells: Cell[],
  cols: number,
  cellWidth: number,
  o: TileOptions = {},
): string {
  const [vx, vy, vw, vh] = o.viewBox ?? ch.viewBox;
  const chart = o.chartHeight ?? 0;
  const rows = Math.ceil(cells.length / cols);
  // Whole pixels. A sheet is a raster people look at, and a sub-pixel canvas
  // height buys nothing while giving the rasteriser a fractional pixmap to
  // reconcile with an integer one.
  const chh = Math.round((cellWidth * vh) / vw);
  const pad = SHEET_PAD;
  const W = sheetWidth(cols, cellWidth);
  const cellHeight = chh + chart + SHEET_LABEL;
  const H = rows * cellHeight + pad * (rows + 1);

  const drawn = cells.map((cell, i) => {
    const cx = pad + (i % cols) * (cellWidth + pad);
    const cy = pad + Math.floor(i / cols) * (cellHeight + pad);
    const legend = (cell.legend ?? [])
      .map((l) => ` <tspan fill="${l.colour}">${l.text}</tspan>`)
      .join('');
    const plot = cell.chart
      ? `\n    <svg x="${cx}" y="${cy + chh}" width="${cellWidth}" height="${chart}" viewBox="0 0 1 1" preserveAspectRatio="none">\n${cell.chart}\n    </svg>`
      : '';
    return `  <g>
    <rect x="${cx}" y="${cy}" width="${cellWidth}" height="${cellHeight}" fill="#ffffff" stroke="#dfe4e8"/>
    <text x="${cx + 6}" y="${cy + chh + chart + 14}" font-family="ui-monospace,monospace" font-size="11" fill="#68757f">${cell.label}${legend}</text>
    <svg x="${cx}" y="${cy}" width="${cellWidth}" height="${chh}" viewBox="${vx} ${vy} ${vw} ${vh}">
${cell.body}
    </svg>${plot}
  </g>`;
  });

  return block(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    // Built only when it will be used: a variants sheet supplies its own defs,
    // and scanning `ch` for reusable shapes to then discard the result costs a
    // full walk of the rig (7.4ms cold on the film's 939 shapes).
    o.defs ?? definitionsSvg(ch, '  ', o.context ?? renderContext(ch)),
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
  return tile(ch, cells, opts.cols ?? Math.min(4, times.length), opts.cellWidth ?? SHEET_CELL, { context });
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
  return tile(ch, cells, o.cols ?? Math.min(4, frames.length), o.cellWidth ?? SHEET_CELL, { context });
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
    const strength = round(0.32 * (1 - (back - 1) / Math.max(1, depth)), 3);
    // Folded into the shapes rather than set on a wrapping group, for the reason
    // `NodeSvgOptions.fade` documents: a `<g opacity>` whose bounds fall outside
    // the view is an offscreen layer of zero area, and resvg aborts on it.
    out.push(nodeSvg(ch.root, evaluate(ch, t), '      ', (s) => repaint(s, TRAIL), undefined, t, {
      fade: strength,
    }));
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

// --- motion sheets -----------------------------------------------------------

/**
 * Hues for tracked parts. Distinct in hue rather than in lightness, because
 * lightness is spent on time direction within each path.
 */
export const TRACK_HUES = ['#2f7fd0', '#c2571f', '#3ba064', '#8a52c4', '#b8a02a'];

/** A part that is only measured against, not asked about. */
const COMPARE = '#8b98a3';

/**
 * How a tracked report becomes drawable series: colour, short label, samples.
 *
 * Shared by the motion sheet and the variants overlay because the two are meant
 * to be read against each other. Left duplicated, a change like "do not spend a
 * hue on a compare part" would silently give the same part different colours in
 * the two sheets, and a legend swatch would stop naming the path it belongs to —
 * the drift `tile`'s own docstring calls the one thing a comparison tool may not
 * do.
 */
function trackSeries(parts: PartTrack[], samplesOf: (p: PartTrack, i: number) => TrackedSample[]):
Array<{ compare: boolean; colour: string; label: string; samples: TrackedSample[] }> {
  return parts.map((p, i) => ({
    compare: p.role === 'compare',
    colour: p.role === 'compare' ? COMPARE : TRACK_HUES[i % TRACK_HUES.length],
    label: p.part.split('.').pop() ?? p.part,
    samples: samplesOf(p, i),
  }));
}

/** Motion cells hold a path, not a thumbnail, so they are wider than a pose cell. */
export const MOTION_CELL = 420;

/**
 * Pale-to-saturated along one hue, so a path reads forwards without an arrow.
 *
 * The pale end stops well short of white: a first dot mixed 70% into white is
 * invisible against light artwork, which loses the one end of the path a reader
 * needs in order to know which way time runs.
 */
function tintAt(colour: string, u: number): string {
  const mix = 0.5 - 0.5 * u;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  const to = (v: number) => Math.round(v + (255 - v) * mix).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * The path, the spacing dots and the end markers for one cell.
 *
 * Shared by the motion sheet and the variants overlay rather than written twice.
 * The whole point of drawing a trajectory into a variants cell is that it can be
 * compared with the one in the motion sheet, and two emitters that agree today are
 * two that can disagree tomorrow.
 *
 * Sizes are scaled from `unit`, one crop unit in cell pixels, so marks keep a
 * constant apparent size whether the cell holds a whole stage or one bird's head.
 */
function trajectorySvg(
  series: Array<{ compare: boolean; colour: string; samples: TrackedSample[] }>,
  o: { unit: number; indent: string },
): string[] {
  const { unit, indent } = o;
  const r = 2.6 * unit;
  const out: string[] = [];
  const at = (s: TrackedSample): string => `${round(s.point[0], 2)},${round(s.point[1], 2)}`;

  for (const { compare, colour, samples } of series) {
    if (compare) {
      // Drawn, but quietly: it is the thing a clearance is measured *from*, so
      // it has to be visible without competing with the subject.
      const pts = samples.filter((s) => s.visible).map(at).join(' ');
      if (pts) {
        out.push(`${indent}<polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="${round(1 * unit, 2)}" stroke-dasharray="${round(5 * unit, 2)} ${round(4 * unit, 2)}" opacity="0.7"/>`);
      }
      continue;
    }
    // One polyline per visible run. A single line through a hide/show gap would
    // draw a chord across the frame that nobody ever saw.
    let run: TrackedSample[] = [];
    const flush = (): void => {
      if (run.length > 1) {
        out.push(`${indent}<polyline points="${run.map(at).join(' ')}" fill="none" stroke="${colour}" stroke-width="${round(1.4 * unit, 2)}" stroke-linejoin="round" opacity="0.9"/>`);
      }
      run = [];
    };
    for (const s of samples) {
      if (s.visible) run.push(s);
      else flush();
    }
    flush();

    samples.forEach((s, i) => {
      const u = samples.length > 1 ? i / (samples.length - 1) : 1;
      const size = s.boundary || s.planted ? r * 1.9 : r;
      const [x, y] = [round(s.point[0], 2), round(s.point[1], 2)];
      out.push(s.visible
        ? `${indent}<circle cx="${x}" cy="${y}" r="${round(size, 2)}" fill="${tintAt(colour, u)}"/>`
        : `${indent}<circle cx="${x}" cy="${y}" r="${round(size, 2)}" fill="none" stroke="${colour}" stroke-width="${round(0.7 * unit, 2)}" opacity="0.5"/>`);
    });

    const last = samples[samples.length - 1];
    if (last) {
      out.push(`${indent}<circle cx="${round(last.point[0], 2)}" cy="${round(last.point[1], 2)}" r="${round(r * 2.4, 2)}" fill="none" stroke="${colour}" stroke-width="${round(1.2 * unit, 2)}"/>`);
    }
  }
  return out;
}

/**
 * Where a part went, and how fast, drawn over the drawing it belongs to.
 *
 * The spacing of the dots is the reading: bunched is slow, spread is fast. That
 * is the chart animators have drawn for a century, and it says in one glance what
 * a channel plot cannot say at all — a channel knows what a joint did, not where
 * the ink travelled or whether the arc bent.
 *
 * Sizes are computed from the crop factor rather than left to
 * `vector-effect="non-scaling-stroke"`: the sheet has to rasterise identically
 * through resvg and through a browser, and arithmetic done here cannot depend on
 * a renderer implementing a feature.
 */
export function renderMotionSheet(
  ch: Character,
  report: TrackReport,
  o: {
    cols?: number;
    cellWidth?: number;
    /** Shared crop for every cell, so trajectories stay comparable. */
    viewBox?: ViewBox;
    perCue?: boolean;
  } = {},
): string {
  // No reuse context. Ghost cells fold opacity into every shape, so no two are
  // byte-identical and nothing can be shared — scanning for reuse only serialises
  // symbols that never get referenced (55 definitions and 0 `<use>` on the film,
  // 8 KB that resvg then parses for nothing). Real definitions still come from
  // `ch.definitions`, so clips, masks and gradients are unaffected.
  const context: RenderContext = { uses: new Map(), symbols: [], morphClasses: new Map() };
  const view = o.viewBox ?? ch.viewBox;
  const cellWidth = o.cellWidth ?? MOTION_CELL;
  // One unit of the crop in cell pixels, so marks keep a constant apparent size
  // whether the cell shows a whole stage or one bird's head.
  const unit = view[2] / cellWidth;
  // Culling only matters once the view is narrower than the scene, and the corners
  // depend on the rig alone, so this is per command rather than per cell.
  const corners = o.viewBox ? subtreeCorners(ch) : undefined;

  // Samples grouped once. Deriving each cue's subset with a fresh `.filter` at
  // every use is how two of them come to disagree about what a cell contains.
  const columns = report.parts.map((p) => (o.perCue
    ? p.samples.reduce((m, s) => {
        const key = s.cue ?? '';
        (m.get(key) ?? m.set(key, []).get(key)!).push(s);
        return m;
      }, new Map<string, TrackedSample[]>())
    : new Map([['', p.samples]])));
  const groups = [...columns[0].keys()];

  const cells: Cell[] = groups.map((cue) => {
    const at = columns[0].get(cue) ?? [];
    const mid = at[Math.floor(at.length / 2)]?.t ?? 0;
    const ghostTimes = [mid];

    // Faded in its own colours rather than repainted to one grey: a scene with a
    // background — a stage, a night sky, a field — flattens into an opaque block
    // under a repaint, hiding the very characters the path belongs to.
    const layers: string[] = ghostTimes
      .map((t) => {
        const frame = frameAt(ch, t);
        return nodeSvg(ch.root, frame.pose, '        ', undefined, context, t, {
          fade: 0.3,
          ...(corners ? { cull: { view, corners, matrices: frame.matrices } } : {}),
        });
      })
      .filter(Boolean);

    const series = trackSeries(report.parts, (_p, i) => columns[i].get(cue) ?? []);
    layers.push(...trajectorySvg(series, { unit, indent: '        ' }));

    return {
      label: cue ? `${cue}  ${at.length} samples` : `${at.length} samples`,
      body: layers.join('\n'),
      legend: series.map((v) => ({ colour: v.colour, text: v.label })),
      chart: speedChart(series.map((v) => ({
        samples: v.samples, colour: v.colour, skip: v.compare,
      }))),
    };
  });

  return tile(ch, cells, o.cols ?? Math.min(3, cells.length), cellWidth, {
    context,
    viewBox: view,
    chartHeight: 54,
  });
}

// --- variant sheets ----------------------------------------------------------

export interface VariantCell {
  label: string;
  /** This cell's own build. Every cell is a separate Character. */
  ch: Character;
  /** Cycle times drawn left to right inside the cell. One time is a pose. */
  times: number[];
  /** Trajectories to draw over the artwork, when a part was tracked. */
  track?: TrackReport;
}

/**
 * One cell per parameter combination, so a choice of constants can be *seen*.
 *
 * The cells share a crop and a scale, always. Letting each build frame itself
 * would draw the same motion at different sizes and destroy the only thing a
 * side-by-side sheet is for. A build that declares a different viewBox is
 * therefore reported by the caller rather than quietly rescaled into the first
 * build's box, because a rescaled cell is a lie about amplitude.
 *
 * Each build's ids are namespaced (see `prefixIds`); without that, N builds of one
 * factory collide on every author-written id and the sheet shows cell 0's clip,
 * mask and gradient in every cell.
 */
export function renderVariantSheet(
  cells: VariantCell[],
  o: { cols?: number; cellWidth?: number; viewBox?: ViewBox } = {},
): string {
  if (!cells.length) throw new Error('heron: a variant sheet needs at least one build');
  const base = cells[0].ch;
  const [vx, vy, vw, vh] = o.viewBox ?? base.viewBox;
  // A strip lays its frames out along the cell, so the cell's box is that many
  // scenes wide and `tile` derives the shorter cell height from it — and the cell
  // has to widen by the same factor, or every frame renders at a fraction of a
  // thumbnail. Both facts live here so a direct caller gets them too.
  const frames = Math.max(1, ...cells.map((c) => c.times.length));
  const cellWidth = o.cellWidth ?? (cells.some((c) => c.track) ? MOTION_CELL : SHEET_CELL) * frames;
  const view: ViewBox = [vx, vy, vw * frames, vh];
  const unit = view[2] / cellWidth;

  const defs: string[] = [];
  const drawn = cells.map((cell, i) => {
    // Per cell, not per document: this is what keeps the builds independent.
    const prefix = `v${i}-`;
    const context = renderContext(cell.ch);
    const own = definitionsSvg(cell.ch, '  ', context);
    if (own) defs.push(prefixIds(own, prefix));

    const series = cell.track ? trackSeries(cell.track.parts, (p) => p.samples) : [];
    // The trajectory goes into every strip frame — each frame is its own little
    // stage, and a path drawn in only one would read as belonging to that moment
    // rather than to the whole window — but it is the same markup every time, so
    // it is built once rather than per frame.
    const paths = series.length ? trajectorySvg(series, { unit, indent: '        ' }) : [];

    return {
      label: cell.label,
      body: cell.times.flatMap((t, k) => {
        const art = prefixIds(
          nodeSvg(cell.ch.root, evaluate(cell.ch, t), '        ', undefined, context, t),
          prefix,
        );
        const inner = [art, ...paths].filter(Boolean).join('\n');
        return inner
          ? [`      <g transform="translate(${round(vw * k, 2)} 0)">\n${inner}\n      </g>`]
          : [];
      }).join('\n'),
      legend: series.map((v) => ({ colour: v.colour, text: v.label })),
    };
  });

  return tile(base, drawn, o.cols ?? Math.min(3, cells.length), cellWidth, {
    viewBox: view,
    defs: defs.join('\n'),
  });
}

/**
 * A crop that frames everything a report tracked, at the scene's aspect ratio.
 *
 * A crop that stretched one axis would draw a circular arc as an ellipse, which
 * is exactly the judgement a motion sheet exists to support — so the shorter side
 * is grown rather than the longer one squeezed. Lives here, beside the other
 * framing helpers, so a test can reach it and so a variant overlay can share it.
 */
export function zoomBox(
  ch: Character,
  reports: TrackReport[],
  pad = 0.12,
): ViewBox | undefined {
  // A list, because a variants sheet crops N builds and the crop has to contain
  // every one of them. A box fitted to the first build would push the widest
  // build's motion off the edge of its own cell.
  const box = reports
    .flatMap((r) => r.parts)
    .reduce<Box | null>((acc, p) => mergeBoxes(acc, p.bounds), null);
  if (!box) return undefined;
  const margin = Math.max(box.x1 - box.x0, box.y1 - box.y0) * pad + 1;
  let w = box.x1 - box.x0 + margin * 2;
  let h = box.y1 - box.y0 + margin * 2;
  const aspect = ch.viewBox[2] / ch.viewBox[3];
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  w = Math.min(w, ch.viewBox[2]);
  h = Math.min(h, ch.viewBox[3]);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const x0 = Math.min(Math.max(ch.viewBox[0], cx - w / 2), ch.viewBox[0] + ch.viewBox[2] - w);
  const y0 = Math.min(Math.max(ch.viewBox[1], cy - h / 2), ch.viewBox[1] + ch.viewBox[3] - h);
  return [round(x0, 2), round(y0, 2), round(w, 2), round(h, 2)];
}

/**
 * A series in a unit box, drawn the way `studio` plots channels.
 *
 * Stroke widths are in unit-box coordinates rather than
 * `vector-effect="non-scaling-stroke"`, for the same reason the marks above are
 * sized from the crop: the sheet has to rasterise identically through resvg and
 * a browser, so nothing here may depend on a renderer implementing a feature.
 */
function unitPlot(values: number[], o: {
  colour: string; width: number; base?: number; scale?: number; dash?: string; opacity?: number;
}): string {
  if (values.length < 2) return '';
  const base = o.base ?? 1;
  const scale = o.scale ?? 0.92;
  const points = values
    .map((v, i) => `${round(i / (values.length - 1), 4)},${round(base - scale * v, 4)}`)
    .join(' ');
  const extra = (o.dash ? ` stroke-dasharray="${o.dash}"` : '')
    + (o.opacity !== undefined ? ` opacity="${o.opacity}"` : '');
  return `      <polyline points="${points}" fill="none" stroke="${o.colour}" stroke-width="${o.width}"${extra}/>`;
}

/** Speed and acceleration in a unit box, normalised per cell. */
function speedChart(series: Array<{ samples: TrackedSample[]; colour: string; skip: boolean }>): string {
  const out: string[] = [
    '      <rect width="1" height="1" fill="#fafbfc"/>',
    '      <line x1="0" y1="0.5" x2="1" y2="0.5" stroke="#e4e8eb" stroke-width="0.004"/>',
  ];
  for (const { samples, colour, skip } of series) {
    if (skip || samples.length < 3) continue;
    const speeds: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1].point;
      const b = samples[i].point;
      speeds.push(samples[i].visible && samples[i - 1].visible ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0);
    }
    const peak = Math.max(...speeds, 1e-9);
    out.push(unitPlot(speeds.map((v) => v / peak), { colour, width: 0.008 }));

    const accel = speeds.slice(1).map((v, i) => v - speeds[i]);
    const aPeak = Math.max(...accel.map(Math.abs), 1e-9);
    out.push(unitPlot(accel.map((v) => v / aPeak), {
      colour, width: 0.004, base: 0.5, scale: 0.42, dash: '0.02 0.014', opacity: 0.45,
    }));
  }
  return out.filter(Boolean).join('\n');
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

/**
 * Local corners of every part's shapes *including its descendants'*, keyed by path.
 *
 * `localCorners` deliberately reports a part's own ink, which is what picking one
 * shape out of a drawing needs. Following a part's motion needs the opposite: a
 * pure transform group — a shot, a travelling wrapper — owns no shapes at all and
 * would have no entry, so anything asking "where is this part" would get nothing
 * and fall back to the viewBox origin.
 *
 * No matrix work is involved. Shape coordinates are authored in scene space and a
 * pivot is only a rotation origin in that same space, so a subtree's local box is
 * a plain union of its descendants'.
 */
export function subtreeCorners(ch: Character): Map<string, Vec2[]> {
  const own = localCorners(ch);
  const out = new Map<string, Vec2[]>();
  const walk = (node: Node): Vec2[] => {
    const pts = [...(own.get(node.path) ?? [])];
    for (const item of node.content) if ('node' in item) pts.push(...walk(item.node));
    // Only the extremes survive, so a deep rig does not carry every leaf's corners
    // up through every ancestor.
    if (pts.length) {
      const b = hull(pts.flat());
      out.set(node.path, boxCorners(b));
      return boxCorners(b);
    }
    return pts;
  };
  walk(ch.root);
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
