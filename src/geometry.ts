/**
 * Computational geometry shared by rendering, tracking, linting and matching.
 *
 * This module has no serialization responsibilities. Keeping measurement here
 * prevents non-rendering tools from depending on the SVG renderer and gives the
 * geometry seam a focused test surface.
 */
import type { Character, Node, ShapeSpec, Vec2 } from './scene.ts';
import { type Frame, type Mat, apply, frameAt } from './timeline.ts';

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

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
    case 'polyline':
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
    case 'polygon':
    case 'polyline': {
      const nums = polygonPoints(a);
      const pts: Vec2[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      if (!pts.length) return 0;
      return chords(s.tag === 'polygon' ? [...pts, pts[0]] : pts);
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

function svgTransformMatrix(text: string): Mat {
  const multiply = (a: Mat, b: Mat): Mat => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  let matrix: Mat = [1, 0, 0, 1, 0, 0];
  let consumed = '';
  for (const match of text.matchAll(/(matrix|translate|rotate|skewX|skewY|scale)\s*\(([^)]*)\)/g)) {
    consumed += match[0];
    const values = match[2].trim().split(/[ ,]+/).filter(Boolean).map(Number);
    if (!values.length || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`heron: invalid SVG transform "${text}"`);
    }
    const angle = values[0] * Math.PI / 180;
    let operation: Mat;
    if (match[1] === 'matrix' && values.length === 6) operation = values as Mat;
    else if (match[1] === 'translate') operation = [1, 0, 0, 1, values[0], values[1] ?? 0];
    else if (match[1] === 'scale') operation = [values[0], 0, 0, values[1] ?? values[0], 0, 0];
    else if (match[1] === 'skewX') operation = [1, 0, Math.tan(angle), 1, 0, 0];
    else if (match[1] === 'skewY') operation = [1, Math.tan(angle), 0, 1, 0, 0];
    else if (match[1] === 'rotate') {
      const rotation: Mat = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
      const x = values[1] ?? 0;
      const y = values[2] ?? 0;
      operation = multiply(multiply([1, 0, 0, 1, x, y], rotation), [1, 0, 0, 1, -x, -y]);
    } else throw new Error(`heron: invalid SVG transform "${text}"`);
    matrix = multiply(matrix, operation);
  }
  if (consumed.replace(/[\s,]/g, '') !== text.replace(/[\s,]/g, '')) {
    throw new Error(`heron: unsupported SVG transform "${text}"`);
  }
  return matrix;
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
      if (!b) continue;
      // The corners of a circle's axis-aligned box are not on the circle. Once
      // rotated they can leave the viewBox while every pixel of the circle stays
      // inside it, producing a false clipping warning. Sample the actual smooth
      // boundary; boxes remain exact for rectilinear geometry.
      const shapePoints: Vec2[] = [];
      if (item.shape.tag === 'circle' || item.shape.tag === 'ellipse') {
        const a = item.shape.attrs;
        const cx = num(a.cx);
        const cy = num(a.cy);
        const stroke = num(a['stroke-width'], 0) / 2;
        const rx = num(item.shape.tag === 'circle' ? a.r : a.rx) + stroke;
        const ry = num(item.shape.tag === 'circle' ? a.r : a.ry) + stroke;
        for (let i = 0; i < 64; i++) {
          const angle = i / 64 * Math.PI * 2;
          shapePoints.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
        }
      } else {
        shapePoints.push(...boxCorners(b));
      }
      const ownTransform = item.shape.attrs.transform;
      pts.push(...(typeof ownTransform === 'string'
        ? shapePoints.map((point) => apply(svgTransformMatrix(ownTransform), point))
        : shapePoints));
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
