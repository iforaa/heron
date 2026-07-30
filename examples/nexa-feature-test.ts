/**
 * NEXA AI — four-second feature test.
 *
 * A compact commercial ident exercising Heron's gradient resources, feathered
 * masks, clip paths, path morphing, field formation morphing, cue timing and
 * deterministic vector type.
 */

import {
  character, circle, clipPath, cueSheet, easeIn, easeInOut, easeOut, field,
  keys, layer, line, linearGradient, mask, part, path, pathMorph, radialGradient,
  rect, strokeText, type Vec2,
} from '../src/index.ts';

const W = 1280;
const H = 720;
const CX = W / 2;
const CY = H / 2;
const DURATION = 4;
const INK = '#06101e';
const CYAN = '#54e8ff';
const BLUE = '#4169ff';
const WHITE = '#f8fbff';
const DOTS = 54;

export const FILM = cueSheet(DURATION, {
  ignition: [0, 1.25],
  transform: [0.65, 3.15],
  endCard: [2.75, 4],
});

function ring(count: number, radius: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return [CX + Math.cos(a) * radius, CY + Math.sin(a) * radius];
  });
}

function signal(count: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => {
    const u = i / (count - 1);
    return [
      275 + u * 730,
      CY + Math.sin(u * Math.PI * 8) * Math.sin(u * Math.PI) * 105,
    ];
  });
}

function intelligence(count: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => {
    const orbit = i % 3;
    const a = (i / count) * Math.PI * 6 + orbit * 0.9;
    const rx = [155, 92, 126][orbit];
    const ry = [72, 145, 105][orbit];
    const turn = [-0.2, 0.62, -0.72][orbit];
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    return [
      CX + x * Math.cos(turn) - y * Math.sin(turn),
      315 + x * Math.sin(turn) + y * Math.cos(turn),
    ];
  });
}

const START = ring(DOTS, 52);

export const nexaFeatureTest = character(
  'NEXA AI — feature test',
  { viewBox: [0, 0, W, H], duration: DURATION, once: true },
  () => {
    const background = linearGradient('night', {
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      stops: [
        { at: 0, color: '#030711' },
        { at: 0.55, color: '#07172b' },
        { at: 1, color: '#100a2e' },
      ],
    });
    const corePaint = linearGradient('core-paint', {
      x1: 0.1,
      y1: 0,
      x2: 0.9,
      y2: 1,
      stops: [
        { at: 0, color: CYAN },
        { at: 0.5, color: '#a8b5ff' },
        { at: 1, color: BLUE },
      ],
    });
    const featherPaint = radialGradient('feather-paint', {
      stops: [
        { at: 0, color: '#fff', opacity: 1 },
        { at: 0.55, color: '#fff', opacity: 0.65 },
        { at: 1, color: '#fff', opacity: 0 },
      ],
    });
    const aperture = clipPath('aperture', () => {
      circle({ cx: CX, cy: CY, r: 245, fill: '#fff' });
    });
    const feather = mask('feather', () => {
      circle({ cx: CX, cy: CY, r: 310, fill: featherPaint });
    }, {
      mode: 'alpha',
      region: { x: 260, y: -20, width: 760, height: 760 },
    });

    layer('background', () => rect({ x: 0, y: 0, w: W, h: H, fill: background }));

    layer('stars', () => {
      for (let i = 0; i < 72; i++) {
        const x = (i * 173 + 41) % W;
        const y = (i * 97 + 29) % H;
        circle({ cx: x, cy: y, r: i % 7 === 0 ? 1.8 : 0.85, fill: '#afc9ff', opacity: 0.28 });
      }
    });

    part('halo', { pivot: [CX, CY], mask: feather }, () => {
      circle({ cx: CX, cy: CY, r: 310, fill: '#287cff', opacity: 0.55 });
    });

    part('apertureContent', { pivot: [CX, CY], clip: aperture }, () => {
      for (let i = -3; i <= 3; i++) {
        line({
          from: [310, CY + i * 44],
          to: [970, CY + i * 44],
          stroke: i === 0 ? CYAN : '#5680bd',
          width: i === 0 ? 2.5 : 1,
          opacity: i === 0 ? 0.55 : 0.2,
        });
      }
      path({
        d: pathMorph([
          [
            0,
            'M490 360 C490 265 555 215 640 215 C725 215 790 265 790 360 C790 455 725 505 640 505 C555 505 490 455 490 360 Z',
            easeInOut,
          ],
          [
            0.42,
            'M470 335 C480 260 555 205 640 215 C735 220 820 275 820 360 C825 435 760 505 670 510 C565 510 475 435 470 335 Z',
            easeInOut,
          ],
          [
            0.72,
            'M485 285 C540 210 635 190 720 225 C805 255 845 340 815 415 C780 505 685 535 600 500 C505 470 435 375 485 285 Z',
            easeInOut,
          ],
          [
            1,
            'M500 360 C500 270 565 225 640 225 C715 225 780 270 780 360 C780 450 715 495 640 495 C565 495 500 450 500 360 Z',
          ],
        ]),
        fill: corePaint,
        opacity: 0.94,
      });
    });

    field('thought', DOTS, (i) => {
      circle({ cx: START[i][0], cy: START[i][1], r: i % 9 === 0 ? 4.8 : 3.1, fill: WHITE });
    });

    part('endCard', { pivot: [CX, 390] }, () => {
      layer('name', () => strokeText('NEXA AI', {
        x: CX,
        y: 300,
        size: 58,
        align: 'center',
        tracking: 0.34,
        stroke: WHITE,
        width: 5.2,
      }));
      layer('line', () => strokeText('INTELLIGENCE IN MOTION', {
        x: CX,
        y: 410,
        size: 17,
        align: 'center',
        tracking: 0.48,
        stroke: '#a9c7ff',
        width: 2,
      }));
    });
  },
);

const haloIgnite = FILM.place('ignition', keys([[0, 0.08, easeOut], [0.68, 1.08, easeOut], [1, 1]]));
nexaFeatureTest.part('halo').animate({
  scaleX: haloIgnite,
  scaleY: haloIgnite,
  opacity: FILM.place('endCard', keys([[0, 1], [0.48, 0.2, easeIn], [1, 0]])),
});

const coreIgnite = FILM.place('ignition', keys([[0, 0.15, easeOut], [0.7, 1.04, easeOut], [1, 1]]));
nexaFeatureTest.part('apertureContent').animate({
  scaleX: coreIgnite,
  scaleY: coreIgnite,
  rotate: FILM.place('transform', keys([[0, -8, easeInOut], [0.55, 7, easeInOut], [1, 0]])),
  opacity: FILM.place('endCard', keys([[0, 1], [0.52, 0, easeIn], [1, 0]])),
});

nexaFeatureTest.field('thought').morphThrough([
  { at: 0, points: START, scale: 0.25, opacity: 0 },
  { at: 0.14, points: START, scale: 1, opacity: 0.95, stagger: 0.08, ease: easeOut },
  { at: 0.48, points: signal(DOTS), scale: 0.85, opacity: 0.82, stagger: 0.06, ease: easeInOut },
  { at: 0.76, points: intelligence(DOTS), scale: 1.05, opacity: 0.88, stagger: 0.06, ease: easeInOut },
  { at: 1, points: intelligence(DOTS), scale: 0.65, opacity: 0.24, ease: easeOut },
], { window: FILM.at('transform') });

const cardSettle = FILM.place('endCard', keys([[0, 0.92, easeOut], [0.45, 1.02, easeOut], [0.7, 1]]));
nexaFeatureTest.part('endCard').animate({
  scaleX: cardSettle,
  scaleY: cardSettle,
  opacity: FILM.place('endCard', keys([[0, 0, easeOut], [0.3, 1], [1, 1]])),
});
nexaFeatureTest.part('endCard.name').animate({
  draw: FILM.place('endCard', keys([[0, 0], [0.55, 1, easeOut], [1, 1]])),
});
nexaFeatureTest.part('endCard.line').animate({
  draw: FILM.place('endCard', keys([[0, 0], [0.25, 0], [0.82, 1, easeOut], [1, 1]])),
});

export default nexaFeatureTest;
