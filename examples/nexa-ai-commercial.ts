/**
 * NEXA AI — a fictional eight-second brand commercial.
 *
 * The scene is intentionally made from Heron primitives only. Data motes pull
 * into a neural core, the core resolves into a mark, and a monoline wordmark
 * writes itself on. `once` makes this a short film rather than a cycle.
 */

import {
  arc, character, circle, easeIn, easeInOut, easeOut, field, keys, layer,
  line, part, polygon, rect, strokeText, type Vec2,
} from '../src/index.ts';

const W = 1200;
const H = 675;
const CX = W / 2;
const CY = 315;
const DURATION = 8;

const INK = '#f5fbff';
const CYAN = '#59e7ff';
const BLUE = '#6f8cff';
const VIOLET = '#aa72ff';
const NIGHT = '#050816';

/** Integer-arithmetic hash: bit-identical on every JS engine, unlike Math.sin. */
function hash(i: number, salt: number): number {
  let s = (Math.imul(i, 0x9e3779b9) + Math.imul(salt, 0x85ebca6b)) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x21f0aaad) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 0x735a2d97) >>> 0;
  return ((s ^ (s >>> 15)) >>> 0) / 4294967296;
}

/** Where a mote rests before assembly — the artwork and its journey share it. */
function motePoint(i: number): Vec2 {
  return [45 + hash(i, 4) * 1110, 45 + hash(i, 5) * 520];
}

export const nexaAiCommercial = character(
  'nexaAiCommercial',
  { viewBox: [0, 0, W, H], duration: DURATION, once: true },
  () => {
    layer('backdrop', () => {
      rect({ x: 0, y: 0, w: W, h: H, fill: NIGHT });
      circle({ cx: CX, cy: CY, r: 300, fill: '#0b1232', opacity: 0.62 });
      circle({ cx: CX, cy: CY, r: 205, fill: '#101946', opacity: 0.48 });
      // Fine horizon strokes give the frame the polish of a motion-graphics
      // plate without relying on gradients or filters.
      for (let i = 0; i < 9; i++) {
        const y = 92 + i * 62;
        line({ from: [90, y], to: [1110, y], stroke: '#182044', width: 1, cap: 'butt' });
      }
    });

    field('stars', 36, (i) => {
      const x = 35 + hash(i, 1) * 1130;
      const y = 28 + hash(i, 2) * 590;
      circle({ cx: x, cy: y, r: 0.8 + hash(i, 3) * 1.8, fill: i % 5 === 0 ? CYAN : INK });
    });

    // These motes start across the whole frame and arrive on an elliptical
    // lattice around the core, making the assembly read spatially.
    field('motes', 28, (i) => {
      const [x, y] = motePoint(i);
      circle({ cx: x, cy: y, r: 2.2 + hash(i, 6) * 2.6, fill: i % 3 === 0 ? VIOLET : CYAN });
    });

    part('coreLift', { pivot: [CX, CY] }, () => {
      part('core', { pivot: [CX, CY] }, () => {
        layer('halo', () => {
          circle({ cx: CX, cy: CY, r: 118, fill: '#172255', opacity: 0.72 });
          circle({ cx: CX, cy: CY, r: 84, fill: '#202a68', opacity: 0.72 });
        });
        part('orbitWide', { pivot: [CX, CY] }, () => {
          arc({ cx: CX, cy: CY, rx: 156, ry: 88, rotate: -12, stroke: BLUE, width: 3.5 });
          circle({ cx: CX + 151, cy: CY - 19, r: 7, fill: CYAN });
        });
        part('orbitTall', { pivot: [CX, CY] }, () => {
          arc({ cx: CX, cy: CY, rx: 92, ry: 150, rotate: 32, stroke: VIOLET, width: 3.5 });
          circle({ cx: CX - 69, cy: CY - 102, r: 6, fill: VIOLET });
        });
        part('orbitInner', { pivot: [CX, CY] }, () => {
          arc({ cx: CX, cy: CY, rx: 108, ry: 62, rotate: 38, stroke: INK, width: 2.4, opacity: 0.86 });
        });
        layer('signal', () => {
          line({ from: [CX - 57, CY], to: [CX - 24, CY], stroke: CYAN, width: 5 });
          line({ from: [CX + 24, CY], to: [CX + 57, CY], stroke: CYAN, width: 5 });
          line({ from: [CX, CY - 57], to: [CX, CY - 24], stroke: VIOLET, width: 5 });
          line({ from: [CX, CY + 24], to: [CX, CY + 57], stroke: VIOLET, width: 5 });
          polygon({
            points: [[CX, CY - 34], [CX + 34, CY], [CX, CY + 34], [CX - 34, CY]],
            fill: INK,
          });
          circle({ cx: CX, cy: CY, r: 11, fill: '#0b1130' });
        });
      });
    });

    layer('brand', () => {
      layer('wordmark', () => strokeText('NEXA AI', {
        x: CX, y: 464, size: 58, align: 'center', tracking: 0.28, stroke: INK, width: 6.5,
      }));
      layer('tagline', () => strokeText('INTELLIGENCE AMPLIFIED', {
        x: CX, y: 552, size: 17, align: 'center', tracking: 0.42, stroke: '#8fa7c8', width: 2.2,
      }));
      layer('rule', () => line({ from: [438, 532], to: [762, 532], stroke: '#385079', width: 1.5, cap: 'butt' }));
    });
  },
);

// Quiet star breathing keeps the backdrop alive while remaining subordinate.
nexaAiCommercial.field('stars').each((star, i) => {
  const low = 0.16 + (i % 4) * 0.06;
  star.animate({ opacity: keys([[0, low], [0.35 + (i % 5) * 0.05, 0.8, easeInOut], [1, 0.34]]) });
});

// Each field instance is an ordinary Heron part, so it can receive its own
// arrival point and timing while sharing one compact declaration.
nexaAiCommercial.field('motes').each((mote, i, n) => {
  const [x, y] = motePoint(i);
  const a = (i / n) * Math.PI * 2 + hash(i, 7) * 0.18;
  const tx = CX + Math.cos(a) * (118 + (i % 3) * 24);
  const ty = CY + Math.sin(a) * (70 + (i % 4) * 13);
  const arrive = 0.22 + (i / n) * 0.105;
  const swellIn = keys([[0, 0.35, easeInOut], [0.08, 0.35, easeInOut], [arrive, 1, easeOut], [1, 1]]);
  mote.animate({
    x: keys([[0, 0, easeInOut], [0.08, 0, easeInOut], [arrive, tx - x, easeOut], [1, tx - x]]),
    y: keys([[0, 0, easeInOut], [0.08, 0, easeInOut], [arrive, ty - y, easeOut], [1, ty - y]]),
    scaleX: swellIn,
    scaleY: swellIn,
  });
  mote.animate({
    opacity: keys([[0, 0], [0.08 + (i / n) * 0.08, 0], [arrive, 0.92, easeOut], [0.64, 0.92], [0.72, 0.18, easeInOut], [1, 0.18]]),
  });
});

const coreArrival = keys([[0, 0.25], [0.29, 0.25, easeOut], [0.44, 1.08, easeOut], [0.52, 1, easeInOut], [1, 1]]);
nexaAiCommercial.part('core').animate({
  scaleX: coreArrival,
  scaleY: coreArrival,
  rotate: keys([[0, -18], [0.29, -18, easeOut], [0.44, -4, easeOut], [0.52, 0, easeInOut], [1, 0]]),
  opacity: keys([[0, 0], [0.27, 0], [0.42, 1, easeOut], [1, 1]]),
});

const coreRecede = keys([[0, 1], [0.57, 1, easeInOut], [0.72, 0.72, easeInOut], [1, 0.72]]);
nexaAiCommercial.part('coreLift').animate({
  y: keys([[0, 0], [0.57, 0, easeInOut], [0.72, -72, easeInOut], [1, -72]]),
  scaleX: coreRecede,
  scaleY: coreRecede,
});

nexaAiCommercial.part('orbitWide').animate({
  rotate: keys([[0, -60], [0.34, -60, easeOut], [0.62, 0, easeInOut], [1, 18]]),
  draw: keys([[0, 0], [0.33, 0], [0.5, 1, easeOut], [1, 1]]),
});
nexaAiCommercial.part('orbitTall').animate({
  rotate: keys([[0, 52], [0.35, 52, easeOut], [0.62, 0, easeInOut], [1, -14]]),
  draw: keys([[0, 0], [0.35, 0], [0.52, 1, easeOut], [1, 1]]),
});
nexaAiCommercial.part('orbitInner').animate({
  rotate: keys([[0, -28], [0.38, -28, easeOut], [0.6, 0, easeInOut], [1, 9]]),
  draw: keys([[0, 0], [0.39, 0], [0.54, 1, easeOut], [1, 1]]),
});
const signalRise = keys([[0, 0.1], [0.4, 0.1, easeOut], [0.52, 1, easeOut], [1, 1]]);
nexaAiCommercial.part('signal').animate({
  scaleX: signalRise,
  scaleY: signalRise,
  opacity: keys([[0, 0], [0.4, 0], [0.48, 1, easeOut], [1, 1]]),
});

nexaAiCommercial.part('wordmark').animate({
  draw: keys([[0, 0], [0.66, 0], [0.83, 1, easeOut], [1, 1]]),
  opacity: keys([[0, 0], [0.64, 0], [0.7, 1, easeOut], [1, 1]]),
});
nexaAiCommercial.part('tagline').animate({
  draw: keys([[0, 0], [0.77, 0], [0.94, 1, easeOut], [1, 1]]),
  opacity: keys([[0, 0], [0.76, 0], [0.83, 1, easeOut], [1, 1]]),
});
nexaAiCommercial.part('rule').animate({
  scaleX: keys([[0, 0], [0.73, 0, easeOut], [0.86, 1, easeOut], [1, 1]]),
  opacity: keys([[0, 0], [0.72, 0], [0.8, 1, easeOut], [1, 1]]),
});
