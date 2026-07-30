/**
 * NEXA AI — "Every idea starts as a signal"
 *
 * An original 11-second motion-graphics film built around halftone performance
 * plates, circle wipes, a voice pulse, and one dot field reorganising itself
 * into several ideas. The visual language is deliberately minimal; the motion
 * carries the commercial.
 */

import {
  character, circle, cueSheet, easeIn, easeInOut, easeOut, field, keys, layer, line,
  linear, part, polygon, rect, strokeText, swap, type Vec2,
} from '../src/index.ts';

const W = 1280;
const H = 720;
const CX = W / 2;
const CY = H / 2;
const DURATION = 11;
const BLACK = '#050505';
const WHITE = '#f7f7f4';
const BLUE = '#1688ff';

type Segment = [Vec2, Vec2];

export const FILM = cueSheet(DURATION, {
  runner: [0, 3.19],
  darkWipe: [2.695, 4.015],
  voice: [3.96, 6.16],
  thought: [5.775, 9.02],
  lightWipe: [8.635, 9.24],
  endCard: [9.185, 11],
});

function segmentDots(a: Vec2, b: Vec2, spacing = 13): Vec2[] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const count = Math.max(2, Math.round(length / spacing));
  return Array.from({ length: count + 1 }, (_, i) => {
    const u = i / count;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  });
}

function ringDots(center: Vec2, r: number, count: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return [center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r];
  });
}

/**
 * A runner as a measured dot skeleton. Eight plates give it a genuine flight
 * phase rather than sliding a still drawing across the screen.
 */
function runnerPlate(phase: number): Vec2[] {
  const a = phase * Math.PI * 2;
  const hip: Vec2 = [0, 10 + Math.sin(a * 2) * 5];
  const shoulder: Vec2 = [-27, -72 + Math.sin(a * 2) * 3];
  const head: Vec2 = [-18, -112];

  const stride = 65 * Math.sin(a);
  const strideBack = 65 * Math.sin(a + Math.PI);
  const kneeA: Vec2 = [hip[0] + stride * 0.42, hip[1] + 54 - Math.max(0, -Math.sin(a)) * 24];
  const footA: Vec2 = [hip[0] + stride, 126 - Math.max(0, -Math.sin(a)) * 34];
  const kneeB: Vec2 = [hip[0] + strideBack * 0.42, hip[1] + 54 - Math.max(0, Math.sin(a)) * 24];
  const footB: Vec2 = [hip[0] + strideBack, 126 - Math.max(0, Math.sin(a)) * 34];

  const elbowA: Vec2 = [shoulder[0] - stride * 0.34, -25];
  const handA: Vec2 = [shoulder[0] - stride * 0.72, 14];
  const elbowB: Vec2 = [shoulder[0] - strideBack * 0.34, -25];
  const handB: Vec2 = [shoulder[0] - strideBack * 0.72, 14];

  const lines: Segment[] = [
    [shoulder, hip],
    [hip, kneeA], [kneeA, footA],
    [hip, kneeB], [kneeB, footB],
    [shoulder, elbowA], [elbowA, handA],
    [shoulder, elbowB], [elbowB, handB],
  ];
  return [
    ...lines.flatMap(([from, to]) => segmentDots(from, to)),
    ...ringDots(head, 21, 11),
  ];
}

function drawDotPlate(points: Vec2[]): void {
  for (const [x, y] of points) circle({ cx: x, cy: y, r: 4.2, fill: BLACK });
}

function signalPoints(count: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => {
    const u = i / (count - 1);
    const x = 175 + u * 930;
    const envelope = Math.sin(Math.PI * u) ** 1.4;
    const y = CY + Math.sin(u * Math.PI * 12) * 104 * envelope;
    return [x, y];
  });
}

function burstPoints(count: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => {
    const ray = i % 24;
    const step = Math.floor(i / 24);
    const a = (ray / 24) * Math.PI * 2 + Math.sin(ray * 12.3) * 0.04;
    const r = 76 + step * 56 + (ray % 3) * 11;
    return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
  });
}

function logoPoints(count: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => {
    const orbit = i % 3;
    const a = ((i / count) * Math.PI * 2 * 3) + orbit * 0.74;
    const rx = [142, 88, 124][orbit];
    const ry = [68, 142, 96][orbit];
    const rot = [-0.18, 0.62, -0.72][orbit];
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    return [
      CX + x * Math.cos(rot) - y * Math.sin(rot),
      285 + x * Math.sin(rot) + y * Math.cos(rot),
    ];
  });
}

const DOT_COUNT = 120;
const SIGNAL = signalPoints(DOT_COUNT);

export const nexaAiFilm = character(
  'nexaAiFilm',
  { viewBox: [0, 0, W, H], duration: DURATION, once: true },
  () => {
    layer('paper', () => rect({ x: 0, y: 0, w: W, h: H, fill: WHITE }));

    part('runnerShot', { offstage: true }, () => {
      part('runnerTravel', { pivot: [0, 0] }, () => {
        swap('runnerFrames', Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [`f${i}`, () => drawDotPlate(runnerPlate(i / 8))]),
        ));
      });
      layer('groundDots', () => {
        for (let x = 65; x <= 1215; x += 22) circle({ cx: x, cy: 500, r: 2.5, fill: BLACK });
      });
      layer('openingLine', () => strokeText('EVERY IDEA MOVES', {
        x: CX, y: 585, size: 19, align: 'center', tracking: 0.48, stroke: BLACK, width: 2.4,
      }));
    });

    // A black disc swallows the performance plate and becomes the night stage.
    part('blackWipe', { pivot: [CX, CY], offstage: true }, () => {
      circle({ cx: CX, cy: CY, r: 92, fill: BLACK });
    });

    layer('nightShot', () => {
      part('voice', { pivot: [CX, CY] }, () => {
        for (let i = 0; i < 5; i++) {
          part(`bar${i}`, { pivot: [CX + (i - 2) * 74, CY] }, () => {
            rect({
              x: CX + (i - 2) * 74 - 18,
              y: CY - 18,
              w: 36,
              h: 36,
              radius: 18,
              fill: WHITE,
            });
          });
        }
      });

      field('thought', DOT_COUNT, (i) => {
        const [x, y] = SIGNAL[i];
        circle({ cx: x, cy: y, r: i % 11 === 0 ? 5.2 : 3, fill: WHITE });
      });

      layer('statement', () => strokeText('EVERY IDEA STARTS AS A SIGNAL', {
        x: CX, y: 602, size: 18, align: 'center', tracking: 0.42, stroke: WHITE, width: 2.2,
      }));
    });

    // The last transition is another physical wipe, so it feels related to the
    // black circle that opened the middle of the film.
    part('whiteWipe', { pivot: [CX, CY], offstage: true }, () => {
      circle({ cx: CX, cy: CY, r: 82, fill: WHITE });
    });

    layer('endCard', () => {
      layer('endMark', () => {
        polygon({
          points: [[CX, 174], [CX + 34, 208], [CX, 242], [CX - 34, 208]],
          fill: BLACK,
        });
        circle({ cx: CX, cy: 208, r: 11, fill: WHITE });
      });
      layer('endName', () => strokeText('NEXA AI', {
        x: CX, y: 300, size: 58, align: 'center', tracking: 0.3, stroke: BLACK, width: 6.5,
      }));
      layer('endLine', () => strokeText('IDEAS BECOME INTELLIGENCE', {
        x: CX, y: 408, size: 17, align: 'center', tracking: 0.46, stroke: BLACK, width: 2.1,
      }));
      line({ from: [505, 388], to: [775, 388], stroke: '#a4a4a0', width: 1.5, cap: 'butt' });
      circle({ cx: CX, cy: 520, r: 8, fill: BLUE });
    });
  },
);

// --- shot 1: the halftone runner --------------------------------------------

nexaAiFilm.swap('runnerFrames').play({ from: 0, to: 0.255, fps: 12 });
nexaAiFilm.part('runnerTravel').animate({
  x: keys([[0, -110], [0.255, 1390, easeInOut], [1, 1390]]),
  y: keys([[0, 355], [0.255, 355, easeInOut], [1, 355]]),
});
nexaAiFilm.part('groundDots').animate({
  draw: keys([[0, 0], [0.05, 1, easeOut], [0.235, 1], [0.27, 0, easeIn], [1, 0]]),
});
nexaAiFilm.part('openingLine').animate({
  draw: keys([[0, 0], [0.075, 0], [0.19, 1, easeOut], [0.235, 1], [0.27, 0], [1, 0]]),
  opacity: keys([[0, 0], [0.07, 0], [0.12, 1, easeOut], [0.235, 1], [0.27, 0], [1, 0]]),
});
nexaAiFilm.part('runnerShot').animate({
  opacity: keys([[0, 1], [0.265, 1], [0.29, 0, easeIn], [1, 0]]),
});

// --- transition: one dot becomes the whole frame ----------------------------

const blackIris = FILM.place('darkWipe', keys([[0, 0], [1 / 3, 0.15, easeIn], [1, 10.4, easeInOut]]));
nexaAiFilm.part('blackWipe').animate({ scaleX: blackIris, scaleY: blackIris });

// --- shot 2: voice pulse -----------------------------------------------------

const heights = [1.15, 2.8, 4.7, 2.8, 1.15];
for (let i = 0; i < 5; i++) {
  nexaAiFilm.part(`voice.bar${i}`).animate({
    scaleY: keys([
      [0, 1],
      [0.365, 1],
      [0.41, heights[i], easeOut],
      [0.455, 1 + (i % 2) * 0.7, easeInOut],
      [0.49, heights[4 - i] * 0.82, easeOut],
      [0.53, 1, easeInOut],
      [1, 1],
    ]),
    opacity: keys([[0, 0], [0.36, 0], [0.385, 1, easeOut], [0.535, 1], [0.56, 0, easeIn], [1, 0]]),
  });
}

// --- shot 3: one field becomes signal, expansion, then identity -------------

const thoughtWindow = FILM.at('thought');
const thoughtWidth = thoughtWindow.to - thoughtWindow.from;
const thoughtAt = (cycleTime: number) => FILM.progress('thought', cycleTime);
const thoughtDelay = (i: number) => (i % 13) * 0.0015 / thoughtWidth;

nexaAiFilm.field('thought').morphThrough([
  { at: 0, points: SIGNAL, scale: 0.25, opacity: 0, opacityEase: linear },
  { at: thoughtAt(0.565), opacity: 1, opacityEase: easeOut, delay: thoughtDelay },
  { at: thoughtAt(0.585), points: SIGNAL, scale: 1, delay: thoughtDelay },
  { at: thoughtAt(0.66), points: burstPoints(DOT_COUNT) },
  { at: thoughtAt(0.755), points: logoPoints(DOT_COUNT) },
  { at: thoughtAt(0.79), opacity: 1, opacityEase: linear },
  { at: 1, opacity: 0, opacityEase: easeIn },
], { window: thoughtWindow });

nexaAiFilm.part('statement').animate({
  draw: keys([[0, 0], [0.59, 0], [0.705, 1, easeOut], [0.755, 1], [0.79, 0, easeIn], [1, 0]]),
  opacity: keys([[0, 0], [0.585, 0], [0.63, 1, easeOut], [0.755, 1], [0.79, 0], [1, 0]]),
});

// --- final wipe and end card -------------------------------------------------

const whiteIris = FILM.place('lightWipe', keys([[0, 0], [1, 11.8, easeInOut]]));
nexaAiFilm.part('whiteWipe').animate({ scaleX: whiteIris, scaleY: whiteIris });
nexaAiFilm.part('endCard').animate({
  opacity: keys([[0, 0], [0.835, 0], [0.855, 1, easeOut], [1, 1]]),
});
const markPop = keys([[0, 0.4], [0.84, 0.4], [0.91, 1.08, easeOut], [0.94, 1, easeInOut], [1, 1]]);
nexaAiFilm.part('endMark').animate({ scaleX: markPop, scaleY: markPop });
nexaAiFilm.part('endName').animate({
  draw: keys([[0, 0], [0.87, 0], [0.95, 1, easeOut], [1, 1]]),
});
nexaAiFilm.part('endLine').animate({
  draw: keys([[0, 0], [0.91, 0], [0.98, 1, easeOut], [1, 1]]),
  opacity: keys([[0, 0], [0.9, 0], [0.95, 1, easeOut], [1, 1]]),
});

export default nexaAiFilm;
