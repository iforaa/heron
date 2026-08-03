/**
 * Tiny crews assemble the extracted Chessrun mark.
 *
 * The six logo objects come from `chessrun-objects.ts`; this scene only gives
 * them blocking and acting.  Workers share the same travel curve as the load
 * they carry, while analytic two-bone IK keeps each hand on a measured grip
 * point.  This is deliberately an animation made from the reconstructed Heron
 * objects, not an embedded copy of the source SVG.
 */

import {
  character, channelAt, circle, ellipse, easeInOut, easeOut, keys, limb,
  line, part, path as drawPath, reach, rect, sampled, walkCycle,
  type Channel, type Character, type Vec2,
} from '../src/index.ts';
import {
  chessrunObjects, type ChessrunObject,
} from './chessrun-objects.ts';

const W = 960;
const H = 540;
const DURATION = 8.2;
const FLOOR = 399;

const PAPER = '#f7f3ea';
const INK = '#17191a';
const ORANGE = '#f4a54d';
const FAR = '#8d8b84';
const SHADOW = '#d9d2c4';

interface Move {
  from: number;
  to: number;
  dx: number;
  lift: number;
  overshoot?: number;
}

interface WorkerSpec {
  name: string;
  hip: Vec2;
  facing: 1 | -1;
  move: Move;
  exit: { from: number; to: number; dx: number };
  grip: { part: string; point: Vec2 };
  bend: 1 | -1;
  carried?: boolean;
}

const moves: Record<string, Move> = {
  base: { from: 0.03, to: 0.30, dx: -650, lift: -38, overshoot: 7 },
  chessText: { from: 0.20, to: 0.49, dx: -600, lift: 48, overshoot: 8 },
  runPlate: { from: 0.27, to: 0.56, dx: 590, lift: 42, overshoot: -7 },
  rook: { from: 0.47, to: 0.72, dx: -560, lift: 68, overshoot: 6 },
  ball: { from: 0.68, to: 0.85, dx: 510, lift: 0, overshoot: -10 },
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const local = (t: number, move: Move): number => clamp01((t - move.from) / (move.to - move.from));

/** A carried object approaches, settles past its mark, then seats exactly. */
function travelX(move: Move): Channel {
  return sampled((t) => {
    const u = local(t, move);
    if (u <= 0) return move.dx;
    if (u >= 1) return 0;
    const settleAt = 0.82;
    if (u < settleAt) {
      const p = easeOut.fn(u / settleAt);
      return move.dx * (1 - p) + (move.overshoot ?? 0) * p;
    }
    return (move.overshoot ?? 0) * (1 - easeInOut.fn((u - settleAt) / (1 - settleAt)));
  }, 96);
}

/** Loads arrive slightly above or below their slot and are visibly lowered in. */
function travelY(move: Move): Channel {
  return sampled((t) => {
    const u = local(t, move);
    if (u <= 0) return move.lift;
    if (u >= 1) return 0;
    if (u < 0.68) return move.lift;
    const p = easeInOut.fn((u - 0.68) / 0.32);
    return move.lift * (1 - p) + Math.sin(p * Math.PI) * 3;
  }, 72);
}

function exitX(worker: WorkerSpec, t: number): number {
  const { exit } = worker;
  if (t <= exit.from) return 0;
  if (t >= exit.to) return exit.dx;
  return exit.dx * easeInOut.fn((t - exit.from) / (exit.to - exit.from));
}

function workerX(worker: WorkerSpec, t: number): number {
  return channelAt(travelX(worker.move), t) + exitX(worker, t);
}

function walkBob(worker: WorkerSpec, t: number): number {
  // Screen-space cadence: one full left/right cycle per worker-height travelled.
  // The workers enter quickly, so the literal planted-foot stride would produce
  // a frantic thirty-cycle run rather than a readable construction-site walk.
  const STRIDE = 72;
  const inWindow = (from: number, to: number, travelled: number): number => {
    if (t <= from || t >= to) return 0;
    return -Math.abs(Math.sin((travelled / STRIDE) * Math.PI * 2)) * 1.7;
  };
  const entered = Math.abs(channelAt(travelX(worker.move), t) - worker.move.dx);
  const exited = Math.abs(exitX(worker, t));
  return inWindow(worker.move.from, worker.move.to, entered)
    + inWindow(worker.exit.from, worker.exit.to, exited);
}

function fixed(value: number): Channel {
  return keys([[0, value], [1, value]]);
}

function drawObject(object: ChessrunObject): void {
  part(object.name, { pivot: [0, 0] }, () => {
    for (const shape of object.shapes) {
      if (shape.kind === 'circle') {
        circle({ cx: shape.cx, cy: shape.cy, r: shape.r, fill: shape.fill });
      } else {
        drawPath({ d: shape.d, fill: shape.fill });
      }
    }
  });
}

/**
 * A compact construction worker.  The body is intentionally icon-like so it
 * supports the logo rather than competing with it; the hard hat and safety
 * vest do most of the character recognition.
 */
function drawWorker(spec: WorkerSpec): void {
  const [hx, hy] = spec.hip;
  const shoulderY = hy - 52;
  const headY = hy - 70;
  const toe = 7 * spec.facing;

  part(spec.name, { pivot: spec.hip }, () => {
    // Far limbs first, then the torso, then the working arm.
    limb('legFar', {
      hip: [hx - 5, hy - 30], segments: [15, 15], stroke: FAR,
      widths: [6, 5, 3.4], foot: { toe: [toe, 1], heel: [-toe * 0.55, 1] },
    });
    limb('armFar', {
      hip: [hx - 5 * spec.facing, shoulderY], segments: [24, 22],
      stroke: FAR, widths: [6, 5, 3],
    });

    // Trousers, shirt, high-visibility vest.
    rect({ x: hx - 11, y: hy - 35, w: 22, h: 30, radius: 6, fill: '#34404b' });
    rect({ x: hx - 13, y: hy - 58, w: 26, h: 28, radius: 7, fill: ORANGE });
    line({ from: [hx, hy - 56], to: [hx, hy - 32], stroke: PAPER, width: 2.2, opacity: 0.8 });
    line({ from: [hx - 10, hy - 43], to: [hx + 10, hy - 43], stroke: PAPER, width: 2.2, opacity: 0.8 });

    circle({ cx: hx, cy: headY, r: 11, fill: '#d79b6f' });
    // Nose indicates facing even at cue-sheet scale.
    circle({ cx: hx + 10 * spec.facing, cy: headY + 1, r: 2.8, fill: '#c68459' });
    circle({ cx: hx + 4.5 * spec.facing, cy: headY - 2, r: 1.5, fill: INK });
    drawPath({
      d: `M${hx - 13},${headY - 7} Q${hx},${headY - 18} ${hx + 13},${headY - 7} L${hx + 14},${headY - 3} L${hx - 14},${headY - 3} Z`,
      fill: ORANGE,
    });

    limb('armNear', {
      hip: [hx + 5 * spec.facing, shoulderY], segments: [24, 22],
      stroke: '#d79b6f', widths: [7, 5.5, 3],
    });
    limb('legNear', {
      hip: [hx + 5, hy - 30], segments: [15, 15], stroke: INK,
      widths: [6, 5, 3.4], foot: { toe: [toe, 1], heel: [-toe * 0.55, 1] },
    });
  });
}

const workers: WorkerSpec[] = [
  {
    name: 'baseLeft', hip: [386, FLOOR], facing: 1, move: moves.base,
    exit: { from: 0.34, to: 0.49, dx: 650 },
    grip: { part: 'base', point: [-34, -3] }, bend: -1,
  },
  {
    name: 'baseRight', hip: [574, FLOOR], facing: 1, move: moves.base,
    exit: { from: 0.34, to: 0.49, dx: 650 },
    grip: { part: 'base', point: [34, -3] }, bend: 1,
  },
  {
    name: 'chessLeft', hip: [366, 369], facing: 1, move: moves.chessText,
    exit: { from: 0.53, to: 0.68, dx: 650 },
    grip: { part: 'chessText', point: [-143, -123] }, bend: -1,
  },
  {
    name: 'chessRight', hip: [565, 369], facing: 1, move: moves.chessText,
    exit: { from: 0.53, to: 0.68, dx: 650 },
    grip: { part: 'chessText', point: [-79, -136] }, bend: 1,
  },
  {
    name: 'runLeft', hip: [391, 390], facing: -1, move: moves.runPlate,
    exit: { from: 0.60, to: 0.75, dx: -650 },
    grip: { part: 'runPlate', point: [-135, -104] }, bend: -1,
  },
  {
    name: 'runRight', hip: [560, 390], facing: -1, move: moves.runPlate,
    exit: { from: 0.60, to: 0.75, dx: -650 },
    grip: { part: 'runPlate', point: [-83, -118] }, bend: 1,
  },
  {
    name: 'towerBottom', hip: [515, FLOOR], facing: 1, move: moves.rook,
    exit: { from: 0.76, to: 0.94, dx: 650 },
    grip: { part: 'rookRigger', point: [0, 6] }, bend: -1,
  },
  {
    name: 'rookRigger', hip: [515, 295], facing: 1, move: moves.rook,
    exit: { from: 0.76, to: 0.94, dx: 650 },
    grip: { part: 'rook', point: [14, 7] }, bend: 1, carried: true,
  },
];

export const chessrunWorkers: Character = character(
  'chessrunWorkers',
  { viewBox: [0, 0, W, H], duration: DURATION, ground: FLOOR, once: true },
  () => {
    part('background', () => {
      rect({ x: 0, y: 0, w: W, h: H, fill: PAPER });
      line({ from: [84, FLOOR + 1], to: [876, FLOOR + 1], stroke: SHADOW, width: 2 });
      ellipse({ cx: 480, cy: FLOOR + 5, rx: 155, ry: 11, fill: SHADOW, opacity: 0.42 });
    });

    for (const object of chessrunObjects) drawObject(object);
    for (const worker of workers) drawWorker(worker);

    // The foreman jogs in behind the ball and gives the assembled mark a nod.
    drawWorker({
      name: 'foreman', hip: [584, FLOOR], facing: -1, move: moves.ball,
      exit: { from: 0.88, to: 1, dx: -650 },
      grip: { part: 'ball', point: [0, 0] }, bend: 1,
    });
  },
);

// Logo objects: exact final transforms plus one authored assembly layer.
for (const object of chessrunObjects) {
  const move = object.name === 'runText' ? moves.runPlate : moves[object.name];
  chessrunWorkers.part(object.name).animate({
    // Keep placement and travel in one transform layer. A second translation
    // after the 2.5x logo scale would itself be scaled and leave the workers
    // chasing a load moving 2.5 times farther than they do.
    x: move
      ? sampled((t) => object.transform.x + channelAt(travelX(move), t), 96)
      : fixed(object.transform.x),
    y: move
      ? sampled((t) => object.transform.y + channelAt(travelY(move), t), 72)
      : fixed(object.transform.y),
    scaleX: fixed(object.transform.scaleX),
    scaleY: fixed(object.transform.scaleY),
  });
}

// The ball rolls along the floor before climbing the tiny final ramp into place.
chessrunWorkers.part('ball').animate({
  rotate: sampled((t) => -travelValue(travelX(moves.ball), t) * 3.35, 96),
});

// A gait is driven by distance, not by timeline duration. One complete
// left/right cycle per worker-height travelled keeps entry and exit cadence
// synchronized with translation instead of moonwalking or skating.
function gaitChannel(channel: Channel, worker: WorkerSpec, phase: number): Channel {
  const STRIDE = 72;
  const windowValue = (
    t: number, from: number, to: number, travelled: number,
  ): number => {
    if (t <= from || t >= to) return 0;
    const u = (t - from) / (to - from);
    const rampIn = clamp01(u / 0.04);
    const rampOut = clamp01((1 - u) / 0.08);
    return channelAt(channel, (travelled / STRIDE + phase) % 1) * Math.min(rampIn, rampOut);
  };
  return sampled((t) => {
    const entered = Math.abs(channelAt(travelX(worker.move), t) - worker.move.dx);
    const exited = Math.abs(exitX(worker, t));
    return windowValue(t, worker.move.from, worker.move.to, entered)
      + windowValue(t, worker.exit.from, worker.exit.to, exited);
  }, 120);
}

function travelValue(channel: Channel, t: number): number {
  return channelAt(channel, t);
}

for (const worker of workers) {
  const gait = walkCycle({
    stance: 0.62, reach: 20, segments: [15, 15], clearance: 4,
    kneeBreak: 38, toeTuck: -52, facing: worker.facing,
  });
  chessrunWorkers.part(worker.name).animate({
    x: sampled((t) => workerX(worker, t), 120),
    y: sampled((t) => walkBob(worker, t), 120),
    opacity: keys([[0, 0], [worker.move.from - 0.012, 0], [worker.move.from + 0.012, 1], [1, 1]]),
  });
  if (worker.carried) {
    chessrunWorkers.part(`${worker.name}.legNear.thigh`).animate({
      rotate: keys([[0, -8], [worker.move.from, -8], [worker.move.to, 7], [worker.exit.to, -8], [1, -8]]),
    });
    chessrunWorkers.part(`${worker.name}.legFar.thigh`).animate({
      rotate: keys([[0, 7], [worker.move.from, 7], [worker.move.to, -8], [worker.exit.to, 7], [1, 7]]),
    });
    continue;
  }
  for (const [leg, phase] of [['legNear', 0], ['legFar', 0.5]] as const) {
    chessrunWorkers.part(`${worker.name}.${leg}.thigh`).animate({
      rotate: gaitChannel(gait.thigh.rotate!, worker, phase),
    });
    chessrunWorkers.part(`${worker.name}.${leg}.shin`).animate({
      rotate: gaitChannel(gait.shin.rotate!, worker, phase),
    });
    chessrunWorkers.part(`${worker.name}.${leg}.foot`).animate({
      rotate: gaitChannel(gait.foot.rotate!, worker, phase),
    });
  }
}

// Analytic IK is appended last so it captures all worker and load motion.
function gripAt(worker: WorkerSpec, t: number): Vec2 {
  const release = worker.exit.from;
  const blendEnd = release + 0.025;
  const objectTarget = (() => {
    const object = chessrunObjects.find((candidate) => candidate.name === worker.grip.part);
    if (object) {
      const move = object.name === 'runText' ? moves.runPlate : moves[object.name];
      return [
        object.transform.x + channelAt(travelX(move), t) + worker.grip.point[0] * object.transform.scaleX,
        object.transform.y + channelAt(travelY(move), t) + worker.grip.point[1] * object.transform.scaleY,
      ] as Vec2;
    }
    const supported = workers.find((candidate) => candidate.name === worker.grip.part);
    if (!supported) throw new Error(`chessrun-workers: unknown grip target ${worker.grip.part}`);
    return [
      supported.hip[0] + workerX(supported, t) + worker.grip.point[0],
      supported.hip[1] + walkBob(supported, t) + worker.grip.point[1],
    ] as Vec2;
  })();
  if (t <= release) return objectTarget;

  // After release, the hand comes back to the worker's own chest and travels
  // with the body during the walk-off.
  const rest: Vec2 = [
    worker.hip[0] + workerX(worker, t) + worker.facing * 15,
    worker.hip[1] + walkBob(worker, t) - 34,
  ];
  if (t >= blendEnd) return rest;
  const u = easeInOut.fn((t - release) / (blendEnd - release));
  return [
    objectTarget[0] + (rest[0] - objectTarget[0]) * u,
    objectTarget[1] + (rest[1] - objectTarget[1]) * u,
  ];
}

for (const worker of workers) {
  reach(chessrunWorkers, {
    chain: [`${worker.name}.armNear.thigh`, `${worker.name}.armNear.thigh.shin`],
    lengths: [24, 22], target: (t) => gripAt(worker, t), bend: worker.bend, samples: 144,
  });
  reach(chessrunWorkers, {
    chain: [`${worker.name}.armFar.thigh`, `${worker.name}.armFar.thigh.shin`],
    lengths: [24, 22], target: (t) => gripAt(worker, t),
    bend: worker.bend === 1 ? -1 : 1, samples: 144,
  });
}

// Foreman uses a compact walk, then disappears after the final inspection.
const foremanMove = moves.ball;
const foreman: WorkerSpec = {
  name: 'foreman', hip: [584, FLOOR], facing: -1, move: foremanMove,
  exit: { from: 0.88, to: 1, dx: -650 },
  grip: { part: 'ball', point: [0, 0] }, bend: 1,
};
const foremanGait = walkCycle({ reach: 20, segments: [15, 15], clearance: 4, facing: -1 });
chessrunWorkers.part('foreman').animate({
  x: sampled((t) => workerX(foreman, t), 120),
  y: sampled((t) => walkBob(foreman, t), 120),
  opacity: keys([[0, 0], [0.668, 0], [0.692, 1], [1, 1]]),
});
for (const [leg, phase] of [['legNear', 0], ['legFar', 0.5]] as const) {
  chessrunWorkers.part(`foreman.${leg}.thigh`).animate({
    rotate: gaitChannel(foremanGait.thigh.rotate!, foreman, phase),
  });
  chessrunWorkers.part(`foreman.${leg}.shin`).animate({
    rotate: gaitChannel(foremanGait.shin.rotate!, foreman, phase),
  });
  chessrunWorkers.part(`foreman.${leg}.foot`).animate({
    rotate: gaitChannel(foremanGait.foot.rotate!, foreman, phase),
  });
}
reach(chessrunWorkers, {
  chain: ['foreman.armNear.thigh', 'foreman.armNear.thigh.shin'],
  lengths: [24, 22], target: (t) => gripAt(foreman, t), bend: 1, samples: 144,
});
reach(chessrunWorkers, {
  chain: ['foreman.armFar.thigh', 'foreman.armFar.thigh.shin'],
  lengths: [24, 22], target: (t) => gripAt(foreman, t), bend: -1, samples: 144,
});

export default chessrunWorkers;
