/**
 * A one-shot cartoon stop, authored from Heron's ordinary parts and channels.
 *
 * There is deliberately no skid behavior here. The performance is a handful of
 * poses: a distance-driven run, three increasingly desperate leg reversals, a
 * sheared braking silhouette, and spring follow-through after the feet stop.
 */

import {
  character, circle, field, keys, line, part, rect, score, spring,
  settleTime, easeInOut, easeOut, type Character,
} from '../src/index.ts';
import { walkCycle } from './lib/walk.ts';
import { journey } from './lib/journey.ts';
import {
  FAR, GROUND, INK, SEGMENTS, craneRig, offsetFarLeg,
} from './lib/crane-rig.ts';

const SKY = '#f6faf7';
const TRACK = '#d9ece1';
const DUST = '#a9d3bb';

const RUN_SECONDS = 2.15;
const SKID_SECONDS = 0.58;
const RECOIL = { swing: 26, stiffness: 390, damping: 23 };
const RECOIL_SECONDS = settleTime(RECOIL);
const HOLD_SECONDS = 1.35;
const DURATION = RUN_SECONDS + SKID_SECONDS + RECOIL_SECONDS + HOLD_SECONDS;

const VIEW: [number, number, number, number] = [-120, -90, 1820, 1120];
const START = 860;
const TRAVEL = 860;

export const craneSkid: Character = character(
  'craneSkid',
  { viewBox: VIEW, duration: DURATION, ground: GROUND, once: true },
  () => {
    rect({ x: VIEW[0], y: VIEW[1], w: VIEW[2], h: VIEW[3], fill: SKY });
    line({ from: [VIEW[0] + 5, GROUND], to: [VIEW[0] + VIEW[2] - 5, GROUND], stroke: TRACK, width: 10 });

    // Dust is stage-space artwork: the bird arrives here, while the cloud is
    // already waiting invisibly at the stopping point.
    field('dust', 9, (i) => {
      const row = i % 3;
      circle({
        cx: 0,
        cy: 0,
        r: 10 + row * 5,
        fill: DUST,
      });
    });

    // A placement layer puts the entrance in the right wing. `runner` owns the
    // travel, so its translation is not entangled with this constant offset.
    part('entrance', { offstage: true }, () => {
      part('runner', () => {
        craneRig({ ink: INK, far: FAR });
        // Three little impact ticks. They follow travel but stay independent of
        // the anatomy and can therefore cut on for one beat.
        part('surprise', () => {
          line({ from: [250, 32], to: [217, -14], stroke: INK, width: 13 });
          line({ from: [300, 15], to: [293, -42], stroke: INK, width: 13 });
          line({ from: [347, 29], to: [367, -22], stroke: INK, width: 13 });
        });
      });
    });
  },
);

export const beats = score(craneSkid, [
  ['run', RUN_SECONDS],
  ['skid', SKID_SECONDS],
  ['recoil', RECOIL_SECONDS],
  ['hold', HOLD_SECONDS],
]);

// Constant placement is a track because parts carry no static transform.
craneSkid.part('entrance').animate({ x: keys([[0, START], [1, START]]) });
offsetFarLeg(craneSkid, 'runner');

const STANCE = 0.34;
const gait = walkCycle({
  stance: STANCE,
  reach: 35,
  facing: -1,
  segments: SEGMENTS,
  clearance: 105,
  stanceKnee: 18,
  kneeBreak: 68,
  toeTuck: -50,
});

/**
 * The ordinary locomotion reaches zero velocity at the end of `skid`. Cadence
 * follows distance, so the base run remains grounded even while the authored
 * leg reversals below make the stop look increasingly desperate.
 */
export const run = journey(craneSkid, {
  gait,
  stance: STANCE,
  legs: ['runner.legNear', 'runner.legFar'],
  carry: 'runner',
  moves: [{
    from: beats.at('run').from,
    to: beats.at('skid').to,
    distance: TRAVEL,
    launch: 0.08 / DURATION,
    brake: SKID_SECONDS / DURATION,
  }],
  bob: 38,
  body: 'runner.body',
});

const body = craneSkid.part('runner.body');
const neck = craneSkid.part('runner.neck');
const head = craneSkid.part('runner.head');
const wing = craneSkid.part('runner.wing');

// Running posture gives way to the opposite silhouette as the feet catch. The
// X shear moves the upper half left and the feet right around the body pivot —
// the graphic shorthand for momentum continuing after contact.
body.animate({
  rotate: keys([
    [0, -7],
    [beats.at('run').to, -7, easeOut],
    [beats.at('skid').to, 4, easeOut],
    [beats.at('recoil').to, 0],
    [1, 0],
  ]),
  skewX: keys([
    [0, 0],
    [beats.at('run').to, 0, easeOut],
    [beats.time('skid', 0.42), 25, easeInOut],
    [beats.at('skid').to, 17, easeOut],
    [beats.at('recoil').to, 0],
    [1, 0],
  ]),
  scaleX: keys([
    [0, 1],
    [beats.at('run').to, 1],
    [beats.time('skid', 0.42), 1.08, easeInOut],
    [beats.at('skid').to, 0.98, easeOut],
    [beats.at('recoil').to, 1],
    [1, 1],
  ]),
  scaleY: keys([
    [0, 1],
    [beats.at('run').to, 1],
    [beats.time('skid', 0.42), 0.92, easeInOut],
    [beats.at('skid').to, 1.03, easeOut],
    [beats.at('recoil').to, 1],
    [1, 1],
  ]),
});

// Base secondary action rides the stride and goes silent when the journey does.
neck.animate({ rotate: run.riding(16, 1, 0.12) });
head.animate({ rotate: run.riding(-21, 1, 0.22) });
wing.animate({ rotate: run.riding(6, 2) });

// The skid is hand-authored. Near and far legs hit the same poses half a beat
// apart, making a readable three-drawing scramble rather than a faster walk.
const near = [0, 46, -24, 52, -15, 38, 0];
const far = [0, -24, 49, -18, 45, -10, 0];
const times = [0, 0.16, 0.34, 0.52, 0.69, 0.84, 1];
const placed = (values: number[]) => beats.place(
  'skid',
  keys(times.map((t, i) => [t, values[i]]), easeInOut),
);

craneSkid.part('runner.legNear.thigh').animate({ rotate: placed(near) });
craneSkid.part('runner.legNear.shin').animate({ rotate: placed(near.map((v) => -v * 1.35)) });
craneSkid.part('runner.legNear.foot').animate({ rotate: placed(near.map((v) => v * 0.38)) });
craneSkid.part('runner.legFar.thigh').animate({ rotate: placed(far) });
craneSkid.part('runner.legFar.shin').animate({ rotate: placed(far.map((v) => -v * 1.35)) });
craneSkid.part('runner.legFar.foot').animate({ rotate: placed(far.map((v) => v * 0.38)) });

// When the legs stop, the light parts keep moving. These layers begin and end
// at zero, so the final held pose is clean.
neck.animate({ rotate: beats.during('recoil', spring(RECOIL)) });
head.animate({ rotate: beats.during('recoil', spring({ ...RECOIL, swing: -38 })) });
wing.animate({ rotate: beats.during('recoil', spring({ ...RECOIL, swing: 16, damping: 27 })) });
body.animate({ skewY: beats.during('recoil', spring({ ...RECOIL, swing: -4, damping: 28 })) });

// Dust fans backward (screen-right) while rising. Stagger is expressed only in
// the local keys, keeping every particle an ordinary independently tracked part.
craneSkid.field('dust').each((particle, i, n) => {
  // Never zero: a delay of 0 would repeat the t=0 key, which keys() refuses.
  const delay = 0.02 + (i / Math.max(1, n - 1)) * 0.26;
  const row = i % 3;
  const x = 530 + i * 19;
  const y = GROUND - 12 - row * 8;
  particle.animate({
    x: beats.place('skid', keys([[0, x], [delay, x], [1, x + 85 + i * 12]], easeOut)),
    y: beats.place('skid', keys([[0, y], [delay, y], [1, y - 55 - row * 24]], easeOut)),
    scaleX: beats.place('skid', keys([[0, 0.25], [delay, 0.25], [1, 1.7]], easeOut)),
    scaleY: beats.place('skid', keys([[0, 0.25], [delay, 0.25], [1, 1.25]], easeOut)),
    opacity: beats.place('skid', keys([[0, 0], [delay, 0], [Math.min(0.9, delay + 0.2), 0.8], [1, 0]], easeOut)),
  });
});

craneSkid.part('runner.surprise').animate({
  opacity: keys([
    [0, 0],
    [beats.at('run').to, 0],
    [beats.time('skid', 0.12), 1],
    [beats.at('skid').to, 1],
    [beats.time('recoil', 0.35), 0],
    [1, 0],
  ]),
});

export default craneSkid;
