/**
 * The crane that started the project: an icon-style bird, drawn in code so that
 * every part has a name and a joint, then walked.
 */

import {
  character, part, limb, ellipse, circle, path,
  type Character, type Vec2,
} from '../src/index.ts';
import { walkCycle, bodyBob, sway, pulse, applyGait } from './lib/walk.ts';

const PALE = '#eef3f6';
const TAIL = '#dde5ea';
const WING = '#ccd8e0';
const DARK = '#46555f';
const MID = '#5d6d78';
const NEAR_LEG = '#3d4a54';
const FAR_LEG = '#8f9ca6';

const HIP_Y = 112;
const SEGMENTS: [number, number] = [36, 32];
const FOOT = { toe: [13, 3] as Vec2, heel: [-7, 3] as Vec2 };

export const crane: Character = character(
  'crane',
  { viewBox: [18, 8, 180, 186], duration: 1.1, ground: 183 },
  () => {
    part('shadow', { pivot: [100, 184] }, () => {
      ellipse({ cx: 100, cy: 184, rx: 42, ry: 4.5, fill: '#b9c6d0', opacity: 0.45 });
    });

    part('body', { pivot: [100, 95] }, () => {
      // Far leg first: it reads as depth because it sits behind the torso.
      limb('legFar', { hip: [92, HIP_Y], segments: SEGMENTS, stroke: FAR_LEG, foot: FOOT });

      // Tail bustle, the drooping plume cranes carry over the tail.
      path({ d: 'M66,84 C50,77 34,83 25,97 C40,101 58,97 68,91 Z', fill: TAIL });

      ellipse({ cx: 100, cy: 95, rx: 42, ry: 21, rotate: -5, fill: PALE });

      // Folded wing, with dark primaries sweeping back over the bustle.
      path({ d: 'M70,84 C88,76 116,79 128,89 C116,101 86,103 66,96 Z', fill: WING });
      path({ d: 'M78,94 C64,99 48,102 33,101 C45,95 62,90 76,90 Z', fill: DARK });
      path({ d: 'M74,90 C62,94 50,97 39,98 C50,93 62,89 73,88 Z', fill: MID });

      part('neck', { pivot: [130, 86] }, () => {
        path({ d: 'M130,86 C137,66 142,48 147,34', stroke: PALE, width: 7 });

        part('head', { pivot: [148, 32] }, () => {
          circle({ cx: 148, cy: 30, r: 8, fill: PALE });
          path({ d: 'M141.5,25.2 A8,8 0 0 1 154.8,25.6 C151,23.4 145.2,23.3 141.5,25.2 Z', fill: '#d94f4f' });
          circle({ cx: 151.5, cy: 29, r: 1.5, fill: '#2b343b' });
          path({ d: 'M155,28.4 L188,30.5 L155,32.8 Z', fill: '#e0a63f' });
        });
      });

      limb('legNear', { hip: [105, HIP_Y], segments: SEGMENTS, stroke: NEAR_LEG, foot: FOOT });
    });
  },
);

// --- motion ------------------------------------------------------------------

const STANCE = 0.62;
const REACH = 18;
// Clearance is solved from the leg geometry rather than being a magic angle,
// so the gait survives a change of proportions.
const gait = walkCycle({ stance: STANCE, reach: REACH, segments: SEGMENTS, stanceKnee: 8, kneeBreak: 28, toeTuck: -32 });

applyGait(crane, 'legNear', gait);
applyGait(crane, 'legFar', gait, 0.5);

crane.part('body').animate(bodyBob({ stance: STANCE, legLength: SEGMENTS[0] + SEGMENTS[1], reach: REACH }));
crane.part('neck').animate(sway(2.4, { stance: STANCE }));
// The head counter-rotates so it stays level while the body works underneath.
crane.part('head').animate(sway(-2, { stance: STANCE }));

// The contact shadow tightens and darkens as the body drops onto a leg.
crane.part('shadow').animate({
  scaleX: pulse(1.06, 0.94, STANCE),
  opacity: pulse(0.5, 0.38, STANCE),
});

export default crane;
