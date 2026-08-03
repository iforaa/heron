/**
 * CHESSRUN — a knight becomes the brand
 *
 * Both ends are authored in Heron. A proper outlined chess glyph supplies the
 * horse anatomy; the destination is rebuilt from filled type outlines and
 * simple logo geometry. The knight's base literally morphs into the lockup
 * base, while a field sampled from the filled horse turns into four fast
 * horizontal bands and then occupies the filled destination mark.
 */

import {
  arcPath, character, circle, easeIn, easeInOut, easeOut, field, fontPath,
  keys, layer, line, loadOutlineFont, lottieContours, part, path, pathMorph,
  rect, score, within, type Vec2,
} from '../src/index.ts';
import { createRequire } from 'node:module';

const W = 960;
const H = 540;
const DURATION = 5.6;
const PAPER = '#f4f1e8';
const INK = '#17191a';
const ORANGE = '#f4a54d';
const GRID = '#d9d5ca';
const COUNT = 260;

// Reproducible, redistributable outline inputs. Both packages declare OFL-1.1;
// resolving through Node keeps the example independent of the current working
// directory and of fonts installed on the host machine.
const require = createRequire(import.meta.url);
const symbolFont = loadOutlineFont(require.resolve(
  '@fontsource/noto-sans-symbols-2/files/noto-sans-symbols-2-symbols-400-normal.woff',
));
const displayFont = loadOutlineFont(require.resolve(
  '@fontsource/noto-sans/files/noto-sans-latin-900-normal.woff',
));

// Noto Sans Symbols 2 supplies the chess glyph; rotating its outlined path
// produces a strong right-facing knight.
const knightOutline = fontPath('♞', {
  font: symbolFont, x: 365, y: 126, size: 300, precision: 2,
}).d;
const KNIGHT_PIVOT: Vec2 = [480.5, 263.5];

const chessOutline = fontPath('CHESS', {
  font: displayFont, x: 480, y: 184, size: 66, align: 'center', tracking: -0.035, precision: 2,
}).d;
const runOutline = fontPath('RUN', {
  font: displayFont, x: 480, y: 266, size: 82, align: 'center', tracking: -0.025, precision: 2,
}).d;

const LOGO_PIVOT: Vec2 = [480, 268];
const LOGO_ANGLE = -7;
const PLATE = 'M342 258 L606 258 L606 346 L342 346 Z';
const ROOK = [
  'M426 118 L452 118 L452 145 L469 145 L469 118',
  'L492 118 L492 145 L509 145 L509 118 L535 118',
  'L535 167 L518 184 L443 184 L426 167 Z',
].join(' ');
const KNIGHT_BASE = 'M382 390 L578 390 L598 410 L586 434 L374 434 L362 410 Z';
const LOGO_BASE = 'M310 414 L630 414 L654 438 L654 462 L286 462 L286 438 Z';
const BALL = arcPath({ cx: 505, cy: 388, r: 18 });

export const beats = score(DURATION, [
  ['holdKnight', 0.8],
  ['anticipate', 0.75],
  ['fracture', 0.45],
  ['transform', 1.35],
  ['resolve', 1],
  ['holdLogo', 1.25],
]);

type Contour = ReturnType<typeof lottieContours>[number];
type PointTransform = (point: Vec2) => Vec2;

function rotateAround([x, y]: Vec2, pivot: Vec2, degrees: number): Vec2 {
  const angle = degrees * Math.PI / 180;
  const dx = x - pivot[0];
  const dy = y - pivot[1];
  return [
    pivot[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
    pivot[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
  ];
}

function cubic(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
  t: number,
): Vec2 {
  const u = 1 - t;
  return [
    u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * d[0],
    u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * d[1],
  ];
}

function flatten(contour: Contour, transform: PointTransform): Vec2[] {
  const points: Vec2[] = [];
  const edges = contour.c ? contour.v.length : contour.v.length - 1;
  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % contour.v.length;
    const a = contour.v[i];
    const d = contour.v[j];
    const b: Vec2 = [a[0] + contour.o[i][0], a[1] + contour.o[i][1]];
    const c: Vec2 = [d[0] + contour.i[j][0], d[1] + contour.i[j][1]];
    for (let step = 0; step < 7; step++) {
      points.push(transform(cubic(a, b, c, d, step / 7)));
    }
  }
  if (!contour.c) points.push(transform(contour.v[contour.v.length - 1]));
  return points;
}

function insidePolygon([x, y]: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

interface FilledShape {
  d: string;
  transform?: PointTransform;
}

function filledSamples(
  shapes: FilledShape[],
  bounds: [number, number, number, number],
  count: number,
  spacing = 5,
): Vec2[] {
  const polygons = shapes.map((shape) =>
    lottieContours(shape.d).map((contour) => flatten(contour, shape.transform ?? ((p) => p))));
  const [x0, y0, x1, y1] = bounds;
  const candidates: Vec2[] = [];
  let row = 0;
  for (let y = y0; y <= y1; y += spacing, row++) {
    for (let x = x0; x <= x1; x += spacing) {
      const point: Vec2 = [x + (row % 2) * spacing * 0.5, y];
      const painted = polygons.some((shape) =>
        shape.reduce((inside, polygon) => inside !== insidePolygon(point, polygon), false));
      if (painted) candidates.push(point);
    }
  }
  if (candidates.length < count) {
    throw new Error(`chessrun-logo: only ${candidates.length} fill samples for ${count} particles`);
  }
  return Array.from({ length: count }, (_, i) =>
    candidates[Math.floor((i + 0.35) * candidates.length / count)]);
}

const knightTransform: PointTransform = (point) => rotateAround(point, KNIGHT_PIVOT, 180);
const logoTransform: PointTransform = (point) => rotateAround(point, LOGO_PIVOT, LOGO_ANGLE);

const KNIGHT_POINTS = filledSamples(
  [{ d: knightOutline, transform: knightTransform }],
  [350, 120, 615, 390],
  COUNT,
);
const LOGO_POINTS = filledSamples([
  { d: ROOK },
  { d: chessOutline, transform: logoTransform },
  { d: PLATE, transform: logoTransform },
  { d: BALL },
], [280, 100, 660, 410], COUNT);

const BANDS: Vec2[] = Array.from({ length: COUNT }, (_, i) => {
  const lane = i % 4;
  const rank = Math.floor(i / 4);
  const u = rank / Math.max(1, Math.ceil(COUNT / 4) - 1);
  return [
    285 + u * 370 + Math.sin(i * 1.91) * 4,
    132 + lane * 88 + Math.sin(u * Math.PI * 5 + lane) * 6,
  ];
});

export const chessrunLogo = character(
  'chessrunLogo',
  { viewBox: [0, 0, W, H], duration: DURATION, once: true },
  () => {
    layer('paper', () => rect({ x: 0, y: 0, w: W, h: H, fill: PAPER }));

    part('board', () => {
      for (let x = 334; x <= 626; x += 48) {
        line({ from: [x, 443], to: [x, 477], stroke: GRID, width: 1.4 });
      }
      line({ from: [334, 443], to: [626, 443], stroke: GRID, width: 1.4 });
      line({ from: [334, 477], to: [626, 477], stroke: GRID, width: 1.4 });
      rect({ x: 478, y: 443, w: 48, h: 34, fill: ORANGE, opacity: 0.13 });
    });

    part('knight', { pivot: KNIGHT_PIVOT }, () => {
      part('glyph', { pivot: KNIGHT_PIVOT }, () => {
        path({ d: knightOutline, fill: INK });
      });
      circle({ cx: 510, cy: 225, r: 3.7, fill: ORANGE });
    });

    // This is the one literal path morph: a six-corner chess-piece plinth
    // becomes the six-corner brand base without changing topology.
    part('base', () => path({
      d: pathMorph([
        [0, KNIGHT_BASE],
        [beats.at('transform').from, KNIGHT_BASE, easeInOut],
        [beats.at('transform').to, LOGO_BASE, easeOut],
        [1, LOGO_BASE],
      ]),
      fill: INK,
    }));

    field('matter', COUNT, (i) => {
      circle({
        cx: KNIGHT_POINTS[i][0],
        cy: KNIGHT_POINTS[i][1],
        r: i % 17 === 0 ? 3.3 : 2.35,
        fill: i % 5 === 0 ? ORANGE : INK,
      });
    });

    part('logo', () => {
      part('plate', { pivot: LOGO_PIVOT }, () => path({ d: PLATE, fill: ORANGE }));
      part('run', { pivot: LOGO_PIVOT }, () => path({ d: runOutline, fill: '#ffffff' }));
      part('chess', { pivot: LOGO_PIVOT }, () => path({ d: chessOutline, fill: INK }));
      part('rook', { pivot: [480, 184] }, () => path({ d: ROOK, fill: INK }));
      part('ball', { pivot: [505, 388] }, () => circle({ cx: 505, cy: 388, r: 18, fill: INK }));
    });
  },
);

const anticipate = beats.at('anticipate');
const fracture = beats.at('fracture');
const transform = beats.at('transform');
const resolve = beats.at('resolve');

chessrunLogo.part('board').animate({
  opacity: keys([
    [0, 0], [0.08, 0, easeOut], [anticipate.from, 1],
    [fracture.from, 1, easeIn], [fracture.to, 0], [1, 0],
  ]),
});

chessrunLogo.part('knight.glyph').animate({ rotate: keys([[0, 180], [1, 180]]) });
chessrunLogo.part('knight').animate({
  rotate: within(anticipate, keys([[0, 0, easeInOut], [0.34, -4, easeOut], [0.7, 2.2, easeInOut], [1, 0]])),
  y: within(anticipate, keys([[0, 0, easeIn], [0.4, 12, easeOut], [0.72, -7, easeInOut], [1, 0]])),
  scaleX: within(anticipate, keys([[0, 1, easeIn], [0.4, 1.035, easeOut], [0.72, 0.985, easeInOut], [1, 1]])),
  scaleY: within(anticipate, keys([[0, 1, easeIn], [0.4, 0.94, easeOut], [0.72, 1.035, easeInOut], [1, 1]])),
  opacity: within(fracture, keys([[0, 1, easeIn], [0.7, 0], [1, 0]])),
});

chessrunLogo.field('matter').morphThrough([
  { at: 0, points: KNIGHT_POINTS, opacity: 0, scale: 0.35 },
  { at: 0.13, points: KNIGHT_POINTS, opacity: 1, scale: 1, ease: easeOut },
  { at: 0.52, points: BANDS, opacity: 1, scale: 0.88, stagger: 0.08, ease: easeIn },
  { at: 0.92, points: LOGO_POINTS, opacity: 0.9, scale: 0.72, stagger: 0.06, ease: easeOut },
  { at: 1, points: LOGO_POINTS, opacity: 0.9, scale: 0.72 },
], { window: { from: fracture.from, to: transform.to } });
chessrunLogo.part('matter').animate({
  opacity: within(resolve, keys([[0, 1, easeIn], [0.72, 0], [1, 0]])),
});

const reveal = (delay: number) => within(resolve, keys(delay === 0
  ? [[0, 0, easeOut], [0.2, 1], [1, 1]]
  : [[0, 0], [delay, 0, easeOut], [Math.min(delay + 0.2, 1), 1], [1, 1]]));
const settle = (delay: number) => within(resolve, keys(delay === 0
  ? [[0, 0.88, easeOut], [0.28, 1.045, easeInOut], [1, 1]]
  : [[0, 0.88], [delay, 0.88, easeOut], [Math.min(delay + 0.28, 0.88), 1.045, easeInOut], [1, 1]]));

for (const name of ['plate', 'run', 'chess'] as const) {
  chessrunLogo.part(`logo.${name}`).animate({
    rotate: keys([[0, LOGO_ANGLE], [1, LOGO_ANGLE]]),
    opacity: reveal(name === 'plate' ? 0 : name === 'run' ? 0.1 : 0.2),
    scaleX: settle(name === 'plate' ? 0 : name === 'run' ? 0.1 : 0.2),
    scaleY: settle(name === 'plate' ? 0 : name === 'run' ? 0.1 : 0.2),
  });
}

chessrunLogo.part('logo.rook').animate({
  y: within(resolve, keys([[0, -24], [0.28, -24, easeOut], [0.58, 5, easeInOut], [0.82, 0], [1, 0]])),
  opacity: reveal(0.28),
});
chessrunLogo.part('logo.ball').animate({
  y: within(resolve, keys([[0, -62], [0.36, -62, easeIn], [0.62, 7, easeOut], [0.82, -3, easeInOut], [1, 0]])),
  scaleX: settle(0.32),
  scaleY: settle(0.32),
  opacity: reveal(0.32),
});
