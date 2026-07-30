/**
 * Two-bone IK under motion.
 *
 * Two robot arms with different proportions and opposite bend directions track
 * the same target. The target follows a closed asymmetric path, so this tests
 * more than a convenient circle: every quadrant, changing distance, and both
 * branches of the analytic solution are exercised continuously.
 */

import {
  arc, character, circle, field, keys, layer, line, part, polygon, rect,
  reach, sampled, through, type Character, type Vec2,
} from '../src/index.ts';

const W = 1000;
const H = 600;
const DURATION = 5;
const SAMPLES = 160;

const NIGHT = '#07101d';
const GRID = '#15253a';
const INK = '#dceafa';
const CYAN = '#49dcff';
const VIOLET = '#a77cff';
const TARGET = '#ffdf68';

export const LEFT_ROOT: Vec2 = [210, 365];
export const RIGHT_ROOT: Vec2 = [790, 365];
export const LEFT_LENGTHS: [number, number] = [215, 190];
export const RIGHT_LENGTHS: [number, number] = [195, 210];
export const LEFT_END: Vec2 = [LEFT_ROOT[0], LEFT_ROOT[1] + LEFT_LENGTHS[0] + LEFT_LENGTHS[1]];
export const RIGHT_END: Vec2 = [RIGHT_ROOT[0], RIGHT_ROOT[1] + RIGHT_LENGTHS[0] + RIGHT_LENGTHS[1]];

/** Closed, deliberately non-circular target motion. */
export function ikTargetAt(t: number): Vec2 {
  const a = t * Math.PI * 2;
  return [
    500 + Math.cos(a) * 64 + Math.cos(a * 3) * 19,
    255 + Math.sin(a * 2) * 72 + Math.sin(a) * 18,
  ];
}

function arm(name: string, root: Vec2, lengths: [number, number], colour: string): void {
  const [upperLength, lowerLength] = lengths;
  const joint: Vec2 = [root[0], root[1] + upperLength];
  const end: Vec2 = [root[0], joint[1] + lowerLength];

  layer(`${name}Envelope`, { offstage: true }, () => {
    arc({
      cx: root[0], cy: root[1], r: upperLength + lowerLength,
      from: 205, to: 335, stroke: colour, width: 1.2, opacity: 0.18,
    });
    arc({
      cx: root[0], cy: root[1], r: Math.abs(upperLength - lowerLength),
      stroke: colour, width: 1.2, opacity: 0.24,
    });
  });

  part(`${name}Upper`, { pivot: root }, () => {
    // Dark under-strokes give the links a mechanical outline without filters.
    line({ from: root, to: joint, stroke: NIGHT, width: 25 });
    line({ from: root, to: joint, stroke: colour, width: 13 });
    line({ from: root, to: joint, stroke: INK, width: 3, opacity: 0.7 });

    part(`${name}Lower`, { pivot: joint }, () => {
      line({ from: joint, to: end, stroke: NIGHT, width: 23 });
      line({ from: joint, to: end, stroke: colour, width: 11 });
      line({ from: joint, to: end, stroke: INK, width: 2.5, opacity: 0.7 });

      part(`${name}Tool`, { pivot: end }, () => {
        circle({ cx: end[0], cy: end[1], r: 17, fill: NIGHT, stroke: colour, width: 5 });
        line({
          from: [end[0] - 22, end[1] - 10],
          to: [end[0] - 7, end[1]],
          stroke: INK,
          width: 5,
        });
        line({
          from: [end[0] + 22, end[1] - 10],
          to: [end[0] + 7, end[1]],
          stroke: INK,
          width: 5,
        });
      });
    });
  });

  layer(`${name}Base`, () => {
    polygon({
      points: [
        [root[0] - 32, root[1] + 24],
        [root[0] - 23, root[1] - 26],
        [root[0] + 23, root[1] - 26],
        [root[0] + 32, root[1] + 24],
      ],
      fill: '#101e31',
      stroke: colour,
      width: 4,
    });
    circle({ cx: root[0], cy: root[1], r: 15, fill: NIGHT, stroke: INK, width: 4 });
    circle({ cx: root[0], cy: root[1], r: 5, fill: colour });
  });
}

const targetPath = Array.from({ length: 65 }, (_, i) => ikTargetAt(i / 64));

export const twoBoneIk: Character = character(
  'twoBoneIk',
  { viewBox: [0, 0, W, H], duration: DURATION },
  () => {
    layer('background', { offstage: true }, () => {
      rect({ x: 0, y: 0, w: W, h: H, fill: NIGHT });
      for (let x = 50; x < W; x += 50) {
        line({ from: [x, 0], to: [x, H], stroke: GRID, width: x % 100 === 0 ? 1.2 : 0.6, cap: 'butt' });
      }
      for (let y = 50; y < H; y += 50) {
        line({ from: [0, y], to: [W, y], stroke: GRID, width: y % 100 === 0 ? 1.2 : 0.6, cap: 'butt' });
      }
      rect({ x: 42, y: 35, w: 916, h: 520, radius: 18, fill: 'none', stroke: '#263a55', width: 2 });
    });

    layer('trajectory', () => {
      through(targetPath, { closed: true, stroke: TARGET, width: 2, opacity: 0.25 });
      field('trajectoryDots', 16, (i, n) => {
        const [x, y] = ikTargetAt(i / n);
        circle({ cx: x, cy: y, r: 2.5, fill: TARGET, opacity: 0.42 });
      });
    });

    arm('left', LEFT_ROOT, LEFT_LENGTHS, CYAN);
    arm('right', RIGHT_ROOT, RIGHT_LENGTHS, VIOLET);

    part('target', { pivot: ikTargetAt(0) }, () => {
      const [x, y] = ikTargetAt(0);
      circle({ cx: x, cy: y, r: 34, fill: TARGET, opacity: 0.1 });
      circle({ cx: x, cy: y, r: 20, fill: NIGHT, stroke: TARGET, width: 4 });
      circle({ cx: x, cy: y, r: 7, fill: TARGET });
      line({ from: [x - 29, y], to: [x - 22, y], stroke: TARGET, width: 3 });
      line({ from: [x + 22, y], to: [x + 29, y], stroke: TARGET, width: 3 });
      line({ from: [x, y - 29], to: [x, y - 22], stroke: TARGET, width: 3 });
      line({ from: [x, y + 22], to: [x, y + 29], stroke: TARGET, width: 3 });
    });

    layer('legend', () => {
      // A compact diagrammatic label: two links, one target, and a solved tick.
      line({ from: [74, 79], to: [112, 79], stroke: CYAN, width: 7 });
      circle({ cx: 119, cy: 79, r: 7, fill: INK });
      line({ from: [126, 79], to: [164, 79], stroke: VIOLET, width: 7 });
      circle({ cx: 182, cy: 79, r: 10, fill: 'none', stroke: TARGET, width: 3 });
      line({ from: [177, 79], to: [181, 84], stroke: TARGET, width: 3 });
      line({ from: [181, 84], to: [189, 72], stroke: TARGET, width: 3 });
    });
  },
);

reach(twoBoneIk, {
  chain: ['leftUpper', 'leftLower'],
  lengths: LEFT_LENGTHS,
  target: ikTargetAt,
  bend: 1,
  samples: SAMPLES,
});
reach(twoBoneIk, {
  chain: ['rightUpper', 'rightLower'],
  lengths: RIGHT_LENGTHS,
  target: ikTargetAt,
  bend: -1,
  samples: SAMPLES,
});

const targetHome = ikTargetAt(0);
twoBoneIk.part('target').animate({
  x: sampled((t) => ikTargetAt(t)[0] - targetHome[0], SAMPLES),
  y: sampled((t) => ikTargetAt(t)[1] - targetHome[1], SAMPLES),
});
const targetPulse = keys([[0, 1], [0.25, 1.12], [0.5, 1], [0.75, 1.12], [1, 1]]);
twoBoneIk.part('target').animate({ scaleX: targetPulse, scaleY: targetPulse });

export default twoBoneIk;
