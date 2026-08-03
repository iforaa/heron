/**
 * Lottie export: scene graph + channels -> portable native vector animation.
 *
 * This is a compiler target, not an SVG translation. Heron's node hierarchy
 * becomes parented Lottie null layers, shapes become shape layers, and channels
 * are emitted from the same authored data the SVG compiler evaluates.
 */

import {
  type Channel, type Character, type Node, type ShapeSpec, type Track, type Vec2,
  NEUTRAL,
} from './scene.ts';
import { trackAt } from './timeline.ts';
import type { CueSheet, Score } from './score.ts';
import { endpointFrameClock } from './delivery.ts';

type Json = Record<string, unknown>;

export interface LottieOptions {
  /** Frames per second. Procedural motion is sampled on this grid. */
  fps?: number;
  /** Optional named beats/cues exported as Lottie markers. */
  timeline?: Score | CueSheet;
}

export interface LottieReport {
  layers: number;
  shapes: number;
  animatedProperties: number;
  sampledProperties: number;
  warnings: string[];
}

export interface LottieResult {
  animation: Json;
  json: string;
  report: LottieReport;
}

interface Contour {
  i: Vec2[];
  o: Vec2[];
  v: Vec2[];
  c: boolean;
}

const NUMBER = '[-+]?(?:\\d*\\.)?\\d+(?:[eE][-+]?\\d+)?';
const TOKEN = new RegExp(`[AaCcHhLlMmQqSsTtVvZz]|${NUMBER}`, 'g');
const PARAMS: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

function round(n: number, places = 4): number {
  const p = 10 ** places;
  const out = Math.round(n * p) / p;
  return Object.is(out, -0) ? 0 : out;
}

function near(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

function reflected(control: Vec2 | undefined, point: Vec2): Vec2 {
  return control ? [2 * point[0] - control[0], 2 * point[1] - control[1]] : [...point];
}

function cleanContour(c: Contour): Contour {
  return {
    i: c.i.map(([x, y]) => [round(x), round(y)]),
    o: c.o.map(([x, y]) => [round(x), round(y)]),
    v: c.v.map(([x, y]) => [round(x), round(y)]),
    c: c.c,
  };
}

/**
 * Converts one SVG endpoint arc to cubic segments.
 *
 * This follows the SVG implementation notes: transform into the ellipse's
 * local coordinates, solve its centre, then approximate spans of at most 90°.
 */
function arcCubics(
  from: Vec2,
  rxInput: number,
  ryInput: number,
  rotation: number,
  large: number,
  sweep: number,
  to: Vec2,
): Array<[Vec2, Vec2, Vec2]> {
  let rx = Math.abs(rxInput);
  let ry = Math.abs(ryInput);
  if (!rx || !ry || near(from, to)) return near(from, to) ? [] : [[from, to, to]];

  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;

  const scale = Math.sqrt((xp * xp) / (rx * rx) + (yp * yp) / (ry * ry));
  if (scale > 1) {
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = Math.max(0, rx2 * ry2 - rx2 * yp * yp - ry2 * xp * xp);
  const den = rx2 * yp * yp + ry2 * xp * xp || 1;
  const sign = large === sweep ? -1 : 1;
  const factor = sign * Math.sqrt(num / den);
  const cxp = factor * (rx * yp) / ry;
  const cyp = factor * (-ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (from[0] + to[0]) / 2;
  const cy = sin * cxp + cos * cyp + (from[1] + to[1]) / 2;

  const angle = (u: Vec2, v: Vec2): number =>
    Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
  const unitStart: Vec2 = [(xp - cxp) / rx, (yp - cyp) / ry];
  const unitEnd: Vec2 = [(-xp - cxp) / rx, (-yp - cyp) / ry];
  let theta = angle([1, 0], unitStart);
  let delta = angle(unitStart, unitEnd);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;

  const point = (a: number): Vec2 => [
    cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin,
    cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos,
  ];
  const derivative = (a: number): Vec2 => [
    -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin,
    -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos,
  ];

  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / count;
  const out: Array<[Vec2, Vec2, Vec2]> = [];
  for (let n = 0; n < count; n++) {
    const a = theta + n * step;
    const b = a + step;
    const alpha = (4 / 3) * Math.tan((b - a) / 4);
    const p0 = point(a);
    const p3 = point(b);
    const d0 = derivative(a);
    const d1 = derivative(b);
    out.push([
      [p0[0] + alpha * d0[0], p0[1] + alpha * d0[1]],
      [p3[0] - alpha * d1[0], p3[1] - alpha * d1[1]],
      p3,
    ]);
  }
  return out;
}

/** SVG path data to one or more Lottie Bezier contours. */
export function lottieContours(d: string): Contour[] {
  const raw = d.match(TOKEN) ?? [];
  const remainder = d.replace(TOKEN, '').replace(/[\s,]/g, '');
  if (!raw.length || remainder) throw new Error(`heron lottie: invalid SVG path data "${d}"`);

  const contours: Contour[] = [];
  let contour: Contour | undefined;
  let current: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let cubicControl: Vec2 | undefined;
  let quadControl: Vec2 | undefined;
  let command = '';
  let index = 0;

  const finish = () => {
    if (!contour?.v.length) return;
    if (contour.c && contour.v.length > 1 && near(contour.v[0], contour.v[contour.v.length - 1])) {
      contour.i[0] = contour.i[contour.i.length - 1];
      contour.v.pop();
      contour.i.pop();
      contour.o.pop();
    }
    contours.push(cleanContour(contour));
    contour = undefined;
  };
  const begin = (p: Vec2) => {
    finish();
    contour = { i: [[0, 0]], o: [[0, 0]], v: [[...p]], c: false };
    current = [...p];
    start = [...p];
  };
  const lineTo = (p: Vec2) => {
    if (!contour) begin(current);
    contour!.v.push([...p]);
    contour!.i.push([0, 0]);
    contour!.o.push([0, 0]);
    current = [...p];
  };
  const cubicTo = (c1: Vec2, c2: Vec2, p: Vec2) => {
    if (!contour) begin(current);
    contour!.o[contour!.o.length - 1] = sub(c1, current);
    contour!.v.push([...p]);
    contour!.i.push(sub(c2, p));
    contour!.o.push([0, 0]);
    current = [...p];
    cubicControl = [...c2];
  };
  const point = (x: number, y: number, relative: boolean): Vec2 =>
    relative ? [current[0] + x, current[1] + y] : [x, y];

  while (index < raw.length) {
    if (/^[A-Za-z]$/.test(raw[index])) command = raw[index++];
    if (!command) throw new Error(`heron lottie: path data must begin with a command`);
    const upper = command.toUpperCase();
    const count = PARAMS[upper];
    if (count === undefined) throw new Error(`heron lottie: unsupported SVG path command "${command}"`);

    if (upper === 'Z') {
      if (contour) contour.c = true;
      current = [...start];
      cubicControl = undefined;
      quadControl = undefined;
      command = '';
      continue;
    }
    if (index + count > raw.length || /^[A-Za-z]$/.test(raw[index])) {
      throw new Error(`heron lottie: SVG ${command} command is missing coordinates`);
    }
    const values = raw.slice(index, index + count).map(Number);
    if (values.some((n) => !Number.isFinite(n))) {
      throw new Error(`heron lottie: SVG ${command} command contains a non-finite coordinate`);
    }
    index += count;
    const relative = command === command.toLowerCase();
    const before = current;

    switch (upper) {
      case 'M': {
        const p = point(values[0], values[1], relative);
        begin(p);
        // Every pair after an M is an implicit L.
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L':
        lineTo(point(values[0], values[1], relative));
        break;
      case 'H':
        lineTo([relative ? current[0] + values[0] : values[0], current[1]]);
        break;
      case 'V':
        lineTo([current[0], relative ? current[1] + values[0] : values[0]]);
        break;
      case 'C': {
        const c1 = point(values[0], values[1], relative);
        const c2 = point(values[2], values[3], relative);
        const p = point(values[4], values[5], relative);
        cubicTo(c1, c2, p);
        break;
      }
      case 'S': {
        const c1 = reflected(cubicControl, current);
        const c2 = point(values[0], values[1], relative);
        const p = point(values[2], values[3], relative);
        cubicTo(c1, c2, p);
        break;
      }
      case 'Q': {
        const q = point(values[0], values[1], relative);
        const p = point(values[2], values[3], relative);
        cubicTo(
          add(current, [(2 / 3) * (q[0] - current[0]), (2 / 3) * (q[1] - current[1])]),
          add(p, [(2 / 3) * (q[0] - p[0]), (2 / 3) * (q[1] - p[1])]),
          p,
        );
        quadControl = q;
        break;
      }
      case 'T': {
        const q = reflected(quadControl, current);
        const p = point(values[0], values[1], relative);
        cubicTo(
          add(current, [(2 / 3) * (q[0] - current[0]), (2 / 3) * (q[1] - current[1])]),
          add(p, [(2 / 3) * (q[0] - p[0]), (2 / 3) * (q[1] - p[1])]),
          p,
        );
        quadControl = q;
        break;
      }
      case 'A': {
        const p = point(values[5], values[6], relative);
        const cubics = arcCubics(current, values[0], values[1], values[2], values[3], values[4], p);
        for (const [c1, c2, end] of cubics) cubicTo(c1, c2, end);
        current = p;
        break;
      }
    }

    if (upper !== 'C' && upper !== 'S') cubicControl = undefined;
    if (upper !== 'Q' && upper !== 'T') quadControl = undefined;
    // Relative multi-argument commands are relative to the endpoint reached by
    // the previous argument group, which `current` now names.
    void before;
  }
  finish();
  if (!contours.length) throw new Error('heron lottie: an SVG path produced no contours');
  return contours;
}

function ellipseContour(cx: number, cy: number, rx: number, ry: number, rotation = 0): Contour {
  const k = 0.5522847498307936;
  const points: Vec2[] = [[cx + rx, cy], [cx, cy + ry], [cx - rx, cy], [cx, cy - ry]];
  const incoming: Vec2[] = [[0, -k * ry], [k * rx, 0], [0, k * ry], [-k * rx, 0]];
  const outgoing: Vec2[] = [[0, k * ry], [-k * rx, 0], [0, -k * ry], [k * rx, 0]];
  if (!rotation) return cleanContour({ i: incoming, o: outgoing, v: points, c: true });
  const a = rotation * Math.PI / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const vector = ([x, y]: Vec2): Vec2 => [x * cos - y * sin, x * sin + y * cos];
  const around = ([x, y]: Vec2): Vec2 => add([cx, cy], vector([x - cx, y - cy]));
  return cleanContour({
    i: incoming.map(vector),
    o: outgoing.map(vector),
    v: points.map(around),
    c: true,
  });
}

function contoursOf(shape: ShapeSpec): Contour[] {
  if (shape.morph) {
    throw new Error('heron lottie: pathMorph is not supported by the first Lottie backend');
  }
  const a = shape.attrs;
  if (a.transform !== undefined
      && !(shape.tag === 'ellipse' && /^rotate\(([-+.\deE]+)\s+[-+.\deE]+\s+[-+.\deE]+\)$/.test(String(a.transform)))) {
    throw new Error(
      `heron lottie: raw SVG transform on <${shape.tag}> is not supported;`
      + ' move it to a Heron part transform or flatten the source geometry',
    );
  }
  switch (shape.tag) {
    case 'path':
      return lottieContours(String(a.d));
    case 'line':
      return [cleanContour({
        i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]],
        v: [[Number(a.x1), Number(a.y1)], [Number(a.x2), Number(a.y2)]], c: false,
      })];
    case 'circle':
      return [ellipseContour(Number(a.cx), Number(a.cy), Number(a.r), Number(a.r))];
    case 'ellipse': {
      const match = typeof a.transform === 'string'
        ? /^rotate\(([-+.\deE]+)\s+[-+.\deE]+\s+[-+.\deE]+\)$/.exec(a.transform)
        : null;
      return [ellipseContour(
        Number(a.cx), Number(a.cy), Number(a.rx), Number(a.ry), match ? Number(match[1]) : 0,
      )];
    }
    case 'rect': {
      const x = Number(a.x);
      const y = Number(a.y);
      const w = Number(a.width);
      const h = Number(a.height);
      const r = Math.min(Number(a.rx ?? 0), w / 2, h / 2);
      if (!r) return [cleanContour({
        i: [[0, 0], [0, 0], [0, 0], [0, 0]],
        o: [[0, 0], [0, 0], [0, 0], [0, 0]],
        v: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], c: true,
      })];
      const k = 0.5522847498307936;
      return [cleanContour({
        v: [
          [x + r, y], [x + w - r, y], [x + w, y + r], [x + w, y + h - r],
          [x + w - r, y + h], [x + r, y + h], [x, y + h - r], [x, y + r],
        ],
        i: [
          [-k * r, 0], [0, 0], [0, -k * r], [0, 0],
          [k * r, 0], [0, 0], [0, k * r], [0, 0],
        ],
        o: [
          [0, 0], [k * r, 0], [0, 0], [0, k * r],
          [0, 0], [-k * r, 0], [0, 0], [0, -k * r],
        ],
        c: true,
      })];
    }
    case 'polygon': {
      const values = String(a.points).trim().split(/[\s,]+/).map(Number);
      const v: Vec2[] = [];
      for (let n = 0; n < values.length; n += 2) v.push([values[n], values[n + 1]]);
      return [cleanContour({ v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]), c: true })];
    }
    default:
      throw new Error(`heron lottie: unsupported shape <${shape.tag}>`);
  }
}

function color(value: unknown): number[] {
  const text = String(value);
  const short = /^#([0-9a-f]{3})$/i.exec(text);
  const full = /^#([0-9a-f]{6})$/i.exec(text);
  const hex = short ? short[1].split('').map((c) => c + c).join('') : full?.[1];
  if (!hex) {
    if (text.startsWith('url(')) {
      throw new Error(`heron lottie: gradient paint ${text} is not supported yet`);
    }
    throw new Error(`heron lottie: paint "${text}" must be a hex colour`);
  }
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
    1,
  ].map((n) => round(n, 6));
}

function easing(ease: { key: string }): { i: Json; o: Json; hold?: boolean } {
  if (ease.key === 's:1,end') return { i: {}, o: {}, hold: true };
  const match = /^b:([-+.\deE]+),([-+.\deE]+),([-+.\deE]+),([-+.\deE]+)$/.exec(ease.key);
  if (!match) return { i: { x: [1], y: [1] }, o: { x: [0], y: [0] } };
  const [, x1, y1, x2, y2] = match.map(Number);
  return {
    o: { x: [x1], y: [y1] },
    i: { x: [x2], y: [y2] },
  };
}

function keyProperty(
  keys: Array<{ t: number; v: number; ease: { key: string } }>,
  frames: number,
  map: (value: number) => number,
  report: LottieReport,
): Json {
  // Heron holds the nearest authored value outside the keyed interval. Lottie
  // otherwise supplies its own underlying value before/after those keys, so
  // state the held endpoints in the artifact just as the CSS compiler does.
  const complete = [
    ...(keys[0].t > 0 ? [{ ...keys[0], t: 0 }] : []),
    ...keys,
    ...(keys[keys.length - 1].t < 1 ? [{ ...keys[keys.length - 1], t: 1 }] : []),
  ];
  if (complete.every((key) => key.v === complete[0].v)) return { a: 0, k: map(complete[0].v) };
  report.animatedProperties++;
  return {
    a: 1,
    k: complete.map((key, index) => {
      const out: Json = { t: round(key.t * frames), s: [map(key.v)] };
      if (index < complete.length - 1) {
        const curve = easing(key.ease);
        if (curve.hold) out.h = 1;
        else {
          out.i = curve.i;
          out.o = curve.o;
        }
      }
      return out;
    }),
  };
}

function sampledProperty(
  value: (t: number) => number,
  frames: number,
  map: (n: number) => number,
  report: LottieReport,
): Json {
  const clock = endpointFrameClock(frames);
  const values = clock.map((frame) => map(value(frame / frames)));
  if (values.every((v) => v === values[0])) return { a: 0, k: values[0] };
  report.animatedProperties++;
  report.sampledProperties++;
  return {
    a: 1,
    k: values.map((v, f) => {
      const out: Json = { t: round(clock[f]), s: [round(v)] };
      if (f < values.length - 1) {
        out.i = { x: [1], y: [1] };
        out.o = { x: [0], y: [0] };
      }
      return out;
    }),
  };
}

function scalarProperty(
  track: Track,
  name: keyof typeof NEUTRAL,
  frames: number,
  base: number,
  factor: number,
  report: LottieReport,
): Json {
  const channel = track[name] as Channel | undefined;
  if (!channel) return { a: 0, k: round(base + NEUTRAL[name] * factor) };
  const map = (v: number) => round(base + v * factor);
  if (channel.kind === 'keys' && track.phase === undefined && !channel.keys.some((k) => k.ease.key.startsWith('s:') && k.ease.key !== 's:1,end')) {
    return keyProperty(channel.keys, frames, map, report);
  }
  return sampledProperty((t) => trackAt(track, t)[name], frames, map, report);
}

/**
 * Lottie layer parenting deliberately excludes opacity. Fold the complete
 * Heron group-opacity chain onto each visible shape layer while leaving null
 * layers responsible only for geometry.
 *
 * Preserve authored keys when the chain has one varying channel. Multiplying
 * two independently eased channels does not in general produce another cubic
 * Bézier, so that case uses the same honest sampled-property path as
 * procedural motion.
 */
function cumulativeOpacityProperty(
  tracks: Track[],
  frames: number,
  report: LottieReport,
  shapeOpacity = 1,
): Json {
  let constant = shapeOpacity;
  const varying: Track[] = [];

  for (const track of tracks) {
    const channel = track.opacity;
    if (!channel) continue;
    if (channel.kind === 'keys' && channel.keys.every((key) => key.v === channel.keys[0].v)) {
      constant *= channel.keys[0].v;
    } else {
      varying.push(track);
    }
  }

  if (!varying.length) return { a: 0, k: round(constant * 100) };
  if (varying.length === 1) {
    return scalarProperty(varying[0], 'opacity', frames, 0, constant * 100, report);
  }
  return sampledProperty(
    (t) => constant * varying.reduce((opacity, track) => opacity * trackAt(track, t).opacity, 1),
    frames,
    (opacity) => round(opacity * 100),
    report,
  );
}

function aligned(a: Channel | undefined, b: Channel | undefined): boolean {
  if (!a || !b || a.kind !== 'keys' || b.kind !== 'keys' || a.keys.length !== b.keys.length) return false;
  return a.keys.every((key, i) =>
    key.t === b.keys[i].t && key.ease.key === b.keys[i].ease.key);
}

function scaleProperty(track: Track, frames: number, report: LottieReport): Json {
  const x = track.scaleX;
  const y = track.scaleY;
  if (!x && !y) return { a: 0, k: [100, 100, 100] };
  if (track.phase === undefined && ((x?.kind === 'keys' && !y) || (y?.kind === 'keys' && !x) || aligned(x, y))) {
    const source = (x ?? y) as Extract<Channel, { kind: 'keys' }>;
    if (!source.keys.some((k) => k.ease.key.startsWith('s:') && k.ease.key !== 's:1,end')) {
      const authored = source.keys.map((key, index) => ({
        t: key.t,
        v: [
          round(100 * (x?.kind === 'keys' ? x.keys[index].v : 1)),
          round(100 * (y?.kind === 'keys' ? y.keys[index].v : 1)),
          100,
        ],
        ease: key.ease,
      }));
      const vector = [
        ...(authored[0].t > 0 ? [{ ...authored[0], t: 0 }] : []),
        ...authored,
        ...(authored[authored.length - 1].t < 1
          ? [{ ...authored[authored.length - 1], t: 1 }] : []),
      ];
      if (vector.every((key) => String(key.v) === String(vector[0].v))) return { a: 0, k: vector[0].v };
      report.animatedProperties++;
      return {
        a: 1,
        k: vector.map((key, index) => {
          const out: Json = { t: round(key.t * frames), s: key.v };
          if (index < vector.length - 1) {
            const curve = easing(key.ease);
            if (curve.hold) out.h = 1;
            else {
              out.i = curve.i;
              out.o = curve.o;
            }
          }
          return out;
        }),
      };
    }
  }

  const clock = endpointFrameClock(frames);
  const values = clock.map((frame) => {
    const pose = trackAt(track, frame / frames);
    return [round(pose.scaleX * 100), round(pose.scaleY * 100), 100];
  });
  if (values.every((v) => String(v) === String(values[0]))) return { a: 0, k: values[0] };
  report.animatedProperties++;
  report.sampledProperties++;
  return {
    a: 1,
    k: values.map((value, frame) => {
      const out: Json = { t: round(clock[frame]), s: value };
      if (frame < values.length - 1) {
        out.i = { x: [1], y: [1] };
        out.o = { x: [0], y: [0] };
      }
      return out;
    }),
  };
}

function layerTransform(
  track: Track,
  pivot: Vec2,
  frames: number,
  report: LottieReport,
): Json {
  return {
    // Lottie parents do not pass opacity to their children. It is folded onto
    // visible shape layers by cumulativeOpacityProperty().
    o: { a: 0, k: 100 },
    r: scalarProperty(track, 'rotate', frames, 0, 1, report),
    p: {
      s: true,
      x: scalarProperty(track, 'x', frames, pivot[0], 1, report),
      y: scalarProperty(track, 'y', frames, pivot[1], 1, report),
    },
    a: { a: 0, k: [pivot[0], pivot[1], 0] },
    s: scaleProperty(track, frames, report),
  };
}

function staticTransform(position: Vec2 = [0, 0]): Json {
  return {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: { a: 0, k: [position[0], position[1], 0] },
    a: { a: 0, k: [0, 0, 0] },
    s: { a: 0, k: [100, 100, 100] },
  };
}

function staticPartTransform(node: Node): Json {
  const pose = { ...NEUTRAL, ...node.transform };
  const pivot = node.pivot ?? [0, 0];
  return {
    // Static opacity follows the same explicit shape-layer path as animated
    // opacity because Lottie parent transforms do not inherit it.
    o: { a: 0, k: 100 },
    r: { a: 0, k: round(pose.rotate) },
    p: { a: 0, k: [round(pivot[0] + pose.x), round(pivot[1] + pose.y), 0] },
    a: { a: 0, k: [pivot[0], pivot[1], 0] },
    s: { a: 0, k: [round(pose.scaleX * 100), round(pose.scaleY * 100), 100] },
  };
}

function shapeItems(
  shape: ShapeSpec,
  draw: { track: Track; channel: Channel } | undefined,
  frames: number,
  report: LottieReport,
): Json[] {
  const attrs = shape.attrs;
  const items: Json[] = contoursOf(shape).map((contour, index) => ({
    ty: 'sh',
    nm: `Path ${index + 1}`,
    d: 1,
    ks: { a: 0, k: contour },
  }));
  const stroke = attrs.stroke;
  if (stroke !== undefined && stroke !== 'none') {
    items.push({
      ty: 'st', nm: 'Stroke', c: { a: 0, k: color(stroke) },
      o: { a: 0, k: 100 },
      w: { a: 0, k: Number(attrs['stroke-width'] ?? 1) },
      lc: attrs['stroke-linecap'] === 'round' ? 2 : attrs['stroke-linecap'] === 'square' ? 3 : 1,
      lj: 2, ml: 4,
    });
    if (draw) {
      const property = draw.channel.kind === 'keys' && draw.track.phase === undefined
        ? keyProperty(draw.channel.keys, frames, (v) => round(v * 100), report)
        : sampledProperty((t) => trackAt(draw.track, t).draw, frames, (v) => round(v * 100), report);
      items.push({
        ty: 'tm', nm: 'Heron draw',
        s: { a: 0, k: 0 }, e: property, o: { a: 0, k: 0 }, m: 1,
      });
    }
  }
  // Lottie shape contents paint in reverse list order. Put fill after stroke so
  // the renderer paints the fill first and the stroke over it, matching SVG's
  // mandated fill-then-stroke order. The previous [path, fill, stroke] looked
  // structurally plausible but left the fill covering the inner half of every
  // stroke in Skottie—a 25% area error on small outlined circles.
  const fill = attrs.fill;
  if (fill !== undefined && fill !== 'none') {
    items.push({
      ty: 'fl', nm: 'Fill', c: { a: 0, k: color(fill) },
      o: { a: 0, k: 100 }, r: 1,
    });
  }
  if (draw && (stroke === undefined || stroke === 'none')) {
    const warning = 'draw has no effect on a fill-only shape; add a stroke or remove the draw channel';
    if (!report.warnings.includes(warning)) report.warnings.push(warning);
  }
  if (!fill && !stroke) {
    throw new Error(`heron lottie: <${shape.tag}> has neither fill nor stroke`);
  }
  return items;
}

/** Compiles a Heron character into Bodymovin/Lottie JSON. */
export function compileLottie(ch: Character, options: LottieOptions = {}): LottieResult {
  const fps = options.fps ?? 60;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) {
    throw new Error(`heron lottie: fps must be between 0 and 240, got ${fps}`);
  }
  if (ch.definitions.some((d) => d.kind === 'clip' || d.kind === 'mask')) {
    throw new Error('heron lottie: clip paths and masks are not supported by the first Lottie backend');
  }
  const skewed = ch.nodes().find((node) =>
    node.transform?.skewX !== undefined || node.transform?.skewY !== undefined
    || node.tracks.some((track) => track.skewX !== undefined || track.skewY !== undefined));
  if (skewed) {
    throw new Error(
      `heron lottie: part "${skewed.path || ch.name}" uses skew, which is not supported by the first Lottie backend`,
    );
  }
  const [vx, vy, vw, vh] = ch.viewBox;
  const frames = ch.duration * fps;
  const report: LottieReport = {
    layers: 0, shapes: 0, animatedProperties: 0, sampledProperties: 0, warnings: [],
  };
  if (ch.once) {
    report.warnings.push(
      'this scene is once-only; Lottie files do not control player looping, so configure the player with loop: false',
    );
  }
  const nullLayers: Json[] = [];
  const shapeLayers: Json[] = [];
  let nextIndex = 1;

  const viewportIndex = nextIndex++;
  nullLayers.push({
    ddd: 0, ind: viewportIndex, ty: 3, nm: 'Heron viewBox', sr: 1,
    ks: staticTransform([-vx, -vy]), ao: 0, ip: 0, op: frames, st: 0, bm: 0,
  });

  const walk = (
    node: Node,
    inheritedParent: number,
    inheritedDraw?: { track: Track; channel: Channel },
    inheritedOpacity: Track[] = [],
    inheritedStaticOpacity = 1,
  ) => {
    if (node.clip || node.mask) {
      throw new Error(`heron lottie: part "${node.path || ch.name}" uses an unsupported clip or mask`);
    }
    let parent = inheritedParent;
    let draw = inheritedDraw;
    const staticOpacity = inheritedStaticOpacity * (node.transform?.opacity ?? 1);
    const geometricRest = node.transform && Object.entries(node.transform)
      .some(([name, value]) => name !== 'opacity' && value !== NEUTRAL[name as keyof typeof NEUTRAL]);
    if (geometricRest) {
      const ind = nextIndex++;
      nullLayers.push({
        ddd: 0, ind, ty: 3, nm: `${node.path || ch.name} rest`, parent, sr: 1,
        ks: staticPartTransform(node), ao: 0, ip: 0, op: frames, st: 0, bm: 0,
      });
      parent = ind;
    }
    const opacityTracks = [
      ...inheritedOpacity,
      ...node.tracks.filter((track) => track.opacity !== undefined),
    ];
    for (let layer = 0; layer < node.tracks.length; layer++) {
      const track = node.tracks[layer];
      const ind = nextIndex++;
      const pivot = node.pivot ?? [0, 0];
      nullLayers.push({
        ddd: 0,
        ind,
        ty: 3,
        nm: `${node.path || ch.name}${layer ? ` layer ${layer}` : ''}`,
        parent,
        sr: 1,
        ks: layerTransform(track, pivot, frames, report),
        ao: 0,
        ip: 0,
        op: frames,
        st: 0,
        bm: 0,
      });
      parent = ind;
      if (track.draw) draw = { track, channel: track.draw };
    }

    for (const item of node.content) {
      if ('node' in item) {
        walk(item.node, parent, draw, opacityTracks, staticOpacity);
        continue;
      }
      const ind = nextIndex++;
      report.shapes++;
      shapeLayers.push({
        ddd: 0,
        ind,
        ty: 4,
        nm: `${node.path || ch.name} shape ${report.shapes}`,
        parent,
        sr: 1,
        ks: {
          ...staticTransform(),
          // SVG applies shape opacity after fill and stroke are composited.
          // A separate Lottie layer per shape gives us exactly that boundary.
          o: cumulativeOpacityProperty(
            opacityTracks, frames, report,
            staticOpacity * Number(item.shape.attrs.opacity ?? 1),
          ),
        },
        ao: 0,
        shapes: shapeItems(item.shape, draw, frames, report),
        ip: 0,
        op: frames,
        st: 0,
        bm: 0,
      });
    }
  };

  walk(ch.root, viewportIndex);
  const layers = [...shapeLayers.reverse(), ...nullLayers];
  report.layers = layers.length;

  const timeline = options.timeline;
  if (timeline && Math.abs(timeline.duration - ch.duration) > 1e-9) {
    throw new Error(
      `heron lottie: timeline is ${timeline.duration}s but scene is ${ch.duration}s`,
    );
  }
  const markers = timeline?.windows.map((window) => ({
    tm: round(window.from * frames),
    dr: round((window.to - window.from) * frames),
    cm: window.name,
  }));

  const animation: Json = {
    v: '5.12.2',
    fr: fps,
    ip: 0,
    op: frames,
    w: Math.round(vw),
    h: Math.round(vh),
    nm: ch.name,
    ddd: 0,
    assets: [],
    layers,
    ...(markers?.length ? { markers } : {}),
    meta: {
      g: 'Heron 0.1.0',
      heron: { duration: ch.duration, loop: !ch.once, viewBox: ch.viewBox },
    },
  };
  return { animation, json: JSON.stringify(animation), report };
}
