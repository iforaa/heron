/**
 * Static rendering: one pose, one SVG. This is what the agent looks at.
 */

import type { Character, Node, ShapeSpec, Vec2 } from './scene.ts';
import { type Frame, type Mat, type NodePose, REST, apply, evaluate, frameAt } from './timeline.ts';

function attrs(a: Record<string, string | number>): string {
  return Object.entries(a)
    .map(([k, v]) => `${k}="${typeof v === 'number' ? round(v) : v}"`)
    .join(' ');
}

export function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function shapeSvg(s: ShapeSpec): string {
  return `<${s.tag} ${attrs(s.attrs)}/>`;
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

export function nodeSvg(node: Node, pose: Map<string, NodePose>, indent: string): string {
  const p = pose.get(node.path) ?? REST;
  const body = node.content
    .map((item) => ('shape' in item ? indent + '  ' + shapeSvg(item.shape) : nodeSvg(item.node, pose, indent + '  ')))
    .join('\n');

  const t = transformAttr(p, node.pivot);
  const a: string[] = [];
  if (node.path) a.push(`class="${cssClass(node.path)}"`);
  if (t) a.push(`transform="${t}"`);
  if (p.opacity !== 1) a.push(`opacity="${round(p.opacity)}"`);
  return `${indent}<g ${a.join(' ')}>\n${body}\n${indent}</g>`;
}

export function cssClass(path: string): string {
  return 'h-' + path.replace(/\./g, '-');
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
  return `${svgOpen(ch, width, height)}
${nodeSvg(ch.root, pose, '  ')}
</svg>
`;
}

/**
 * Several poses tiled into one image. Agents judge motion far better from
 * frames side by side than from a single screenshot, so this is the workhorse
 * of the feedback loop. Built as nested <svg> elements, which keeps it a pure
 * SVG operation with no image compositing.
 */
export function renderSheet(ch: Character, times: number[], opts: { cols?: number; cellWidth?: number } = {}): string {
  const [vx, vy, vw, vh] = ch.viewBox;
  const cols = opts.cols ?? Math.min(4, times.length);
  const rows = Math.ceil(times.length / cols);
  const cw = opts.cellWidth ?? SHEET_CELL;
  const chh = round((cw * vh) / vw);
  const pad = SHEET_PAD;
  const W = sheetWidth(cols, cw);
  const H = rows * (chh + SHEET_LABEL) + pad * (rows + 1);

  const cells = times.map((t, i) => {
    const cx = pad + (i % cols) * (cw + pad);
    const cy = pad + Math.floor(i / cols) * (chh + SHEET_LABEL + pad);
    const pose = evaluate(ch, t);
    return `  <g>
    <rect x="${cx}" y="${cy}" width="${cw}" height="${chh + SHEET_LABEL}" fill="#ffffff" stroke="#dfe4e8"/>
    <text x="${cx + 6}" y="${cy + chh + 14}" font-family="ui-monospace,monospace" font-size="11" fill="#68757f">t=${t.toFixed(2)}</text>
    <svg x="${cx}" y="${cy}" width="${cw}" height="${chh}" viewBox="${vx} ${vy} ${vw} ${vh}">
${nodeSvg(ch.root, pose, '      ')}
    </svg>
  </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#eef1f3"/>
${cells.join('\n')}
</svg>
`;
}

// --- bounding boxes ----------------------------------------------------------

export interface Box { x0: number; y0: number; x1: number; y1: number }

function num(v: string | number | undefined, d = 0): number {
  return typeof v === 'number' ? v : v === undefined ? d : parseFloat(v) || d;
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
    case 'polygon': {
      const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
      return grow(hull(pts));
    }
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
export function pathPoints(d: string): Vec2[] {
  const PARAMS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  const out: Vec2[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let cmd = '';
  let i = 0;

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const key = cmd.toLowerCase();
    const rel = cmd === key;
    const n = PARAMS[key];
    if (n === undefined) { i++; continue; }
    if (key === 'z') { cx = sx; cy = sy; continue; }
    if (i + n > tokens.length) break;

    const p = tokens.slice(i, i + n).map(Number);
    i += n;

    if (key === 'h') { cx = rel ? cx + p[0] : p[0]; out.push([cx, cy]); }
    else if (key === 'v') { cy = rel ? cy + p[0] : p[0]; out.push([cx, cy]); }
    else if (key === 'a') {
      const ex = rel ? cx + p[5] : p[5];
      const ey = rel ? cy + p[6] : p[6];
      out.push(...arcPoints(cx, cy, p[0], p[1], p[2], p[3] !== 0, p[4] !== 0, ex, ey));
      cx = ex; cy = ey;
    } else {
      for (let k = 0; k + 1 < n; k += 2) {
        const x = rel ? cx + p[k] : p[k];
        const y = rel ? cy + p[k + 1] : p[k + 1];
        out.push([x, y]);
      }
      cx = rel ? cx + p[n - 2] : p[n - 2];
      cy = rel ? cy + p[n - 1] : p[n - 1];
      if (key === 'm') { sx = cx; sy = cy; cmd = rel ? 'l' : 'L'; }
    }
  }
  return out;
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
  rxIn: number, ryIn: number, phiDeg: number,
  large: boolean, sweepFlag: boolean,
  x2: number, y2: number,
): Vec2[] {
  const out: Vec2[] = [[x1, y1], [x2, y2]];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  // A zero radius means the arc degenerates to a line, which the endpoints bound.
  if (!rx || !ry) return out;

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

  const at = (t: number): Vec2 => [
    cx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP,
    cy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP,
  ];

  // Angles where the arc is momentarily vertical (dx/dt = 0) or horizontal.
  for (const base of [Math.atan2(-ry * sinP, rx * cosP), Math.atan2(ry * cosP, rx * sinP)]) {
    for (const t of [base, base + Math.PI]) {
      let d = (t - start) % (2 * Math.PI);
      if (d < 0) d += 2 * Math.PI;
      if (Math.abs(sweep >= 0 ? d : d - 2 * Math.PI) <= Math.abs(sweep)) out.push(at(t));
    }
  }
  return out;
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
