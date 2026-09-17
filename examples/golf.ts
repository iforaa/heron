/**
 * One hole — an eight-and-a-half second golf short.
 *
 * A golfer, seen from the side, addresses the ball, swings, and watches it
 * fly, bounce, and roll in. Cutout rules: flat fills, no outlines, and the
 * body is a handful of hinged plates. Everything that moves is a rotation about
 * a joint, so the swing is four channels — torso, arms, wrist, and the head
 * that stays down until the ball is gone — placed against a score of beats.
 *
 * The things a golf swing has that a rotating stick does not:
 *
 *   - Lag. The wrist stays cocked through most of the downswing and releases
 *     at the ball, so the clubhead arrives late and fast.
 *   - A hold at the top. The change of direction is a pause, not a bounce.
 *   - The head. It stays on the ball until the follow-through, then comes up
 *     to watch, which is what tells the viewer where to look next.
 *   - The back heel, which comes off the ground in the finish.
 *
 * The ball is drawn behind the ground plane, so dropping into the cup is just
 * the ball going below the grass: no fade, no swap. The loop closes under a
 * short fade to black where everything is put back on the tee.
 */

import {
  character, circle, easeIn, easeInOut, easeOut, ellipse, keys, line, noise, part, path,
  polygon, rect, score, steps, type Character, type Vec2,
} from '../src/index.ts';

const W = 960;
const H = 540;
const GROUND = 430;
const DURATION = 8.6;

const SKY = '#bfe3f7';
const SUN = '#ffe27a';
const HILL_FAR = '#a9d9a0';
const HILL = '#7fc36e';
const GRASS = '#5fb050';
const GRASS_DARK = '#4f9c42';
const TREE = '#3f8a45';
const TRUNK = '#6a4a2f';
const CLOUD = '#ffffff';
const SKIN = '#f1c9a5';
const SHIRT = '#e94f37';
const SHIRT_DARK = '#c73f2a';
const PANTS = '#2c3e50';
const CAP = '#f6f6f6';
const SHOE = '#f6f6f6';
const CLUB = '#555555';
const CLUBHEAD = '#3a3a3a';
const BALL = '#ffffff';
const BALL_MARK = '#c8c8c8';
const HOLE = '#2b2b2b';
const FLAG = '#e0402a';
const POLE = '#eeeeee';
const SHADOW = '#000000';
const BLACK = '#111111';

/** A hard cut: holds the previous value, then jumps. */
const HARD = steps(1, 'end');

// --- the score ---------------------------------------------------------------

export const beats = score(DURATION, [
  ['address', 1.3],    // settle over the ball, two waggles
  ['backswing', 0.8],
  ['top', 0.3],        // the hold
  ['down', 0.2],       // lag, then release at the ball
  ['follow', 0.6],     // the club wraps round; the head comes up
  ['flight', 1.3],     // the ball is in the air
  ['land', 0.7],       // two bounces
  ['roll', 1.3],       // to the cup, and in
  ['cheer', 1.3],      // club in the air, two hops
  ['fade', 0],         // to black and back; the cast is reset while it is dark
]);

const T = (beat: string, u = 0): number => beats.time(beat, u);
/** When the frame is black and every part is put back for the next loop. */
const RESET = T('fade', 0.5);

type KeyTuple = Parameters<typeof keys>[0][number];

/**
 * Appends a hard reset so a channel that ends elsewhere still closes the loop.
 * The jump happens under the fade, where nobody can see it.
 */
function looped(list: KeyTuple[]): ReturnType<typeof keys> {
  const first = list[0][1];
  const last = list[list.length - 1][1];
  if (first === last) return keys(list);
  return keys([...list, [RESET, last, HARD], [RESET + 0.002, first]]);
}

// --- the set -----------------------------------------------------------------

const GOLFER_X = 170;
const HOLE_X = 758;
/** On the tee, at the clubhead. */
const TEE: Vec2 = [GOLFER_X + 76, GROUND - 14];

function sky(): void {
  rect({ x: 0, y: 0, w: W, h: H, fill: SKY });
  circle({ cx: 840, cy: 86, r: 40, fill: SUN });
}

function clouds(): void {
  part('clouds', () => {
    for (const [cx, cy, s] of [[140, 96, 1], [430, 62, 0.8], [660, 118, 1.15]] as const) {
      ellipse({ cx, cy, rx: 48 * s, ry: 17 * s, fill: CLOUD });
      circle({ cx: cx - 14 * s, cy: cy - 12 * s, r: 19 * s, fill: CLOUD });
      circle({ cx: cx + 14 * s, cy: cy - 9 * s, r: 14 * s, fill: CLOUD });
    }
  });
}

function hills(): void {
  // Hills end inside the frame: artwork past the viewBox is a lint finding.
  ellipse({ cx: 300, cy: GROUND, rx: 300, ry: 100, fill: HILL_FAR });
  ellipse({ cx: 700, cy: GROUND, rx: 260, ry: 80, fill: HILL });
}

function tree(x: number, s = 1): void {
  rect({ x: x - 7 * s, y: GROUND - 110 * s, w: 14 * s, h: 112 * s, fill: TRUNK });
  circle({ cx: x, cy: GROUND - 130 * s, r: 44 * s, fill: TREE });
  circle({ cx: x - 34 * s, cy: GROUND - 106 * s, r: 30 * s, fill: TREE });
  circle({ cx: x + 34 * s, cy: GROUND - 108 * s, r: 32 * s, fill: TREE });
}

function ground(): void {
  rect({ x: 0, y: GROUND, w: W, h: H - GROUND, fill: GRASS });
  // mown stripes
  for (const x of [0, 240, 480, 720]) {
    polygon({ points: [[x, GROUND], [x + 120, GROUND], [x + 200, H], [x + 40, H]], fill: GRASS_DARK });
  }
  // the tee peg
  rect({ x: TEE[0] - 2, y: TEE[1] + 4, w: 4, h: 12, fill: '#e8d8b0' });
}

function cup(): void {
  ellipse({ cx: HOLE_X, cy: GROUND + 1, rx: 15, ry: 5, fill: HOLE });
  line({ from: [HOLE_X, GROUND - 150], to: [HOLE_X, GROUND + 1], stroke: POLE, width: 4 });
  part('flag', { pivot: [HOLE_X, GROUND - 150] }, () => {
    polygon({ points: [[HOLE_X + 2, GROUND - 150], [HOLE_X + 46, GROUND - 136], [HOLE_X + 2, GROUND - 122]], fill: FLAG });
  });
}

// --- the golfer --------------------------------------------------------------

/** Standing on (x, GROUND), facing right, club soled behind the ball. */
function golfer(x: number): void {
  const hip: Vec2 = [x, GROUND - 96];
  const shoulder: Vec2 = [x + 16, GROUND - 162];
  const neck: Vec2 = [x + 20, GROUND - 172];
  const hands: Vec2 = [x + 46, GROUND - 78];

  part('golfer', { pivot: [x, GROUND] }, () => {
    // legs, back one first
    line({ from: [x - 4, hip[1]], to: [x - 22, GROUND - 6], stroke: PANTS, width: 15, cap: 'round' });
    part('backFoot', { pivot: [x - 10, GROUND] }, () => {
      ellipse({ cx: x - 22, cy: GROUND - 4, rx: 15, ry: 6, fill: SHOE });
    });
    line({ from: [x + 4, hip[1]], to: [x + 18, GROUND - 6], stroke: PANTS, width: 15, cap: 'round' });
    ellipse({ cx: x + 20, cy: GROUND - 4, rx: 15, ry: 6, fill: SHOE });

    part('torso', { pivot: hip }, () => {
      // shorts over the hips, then the shirt leaning over the ball
      ellipse({ cx: x, cy: hip[1] - 2, rx: 24, ry: 14, fill: PANTS });
      polygon({
        points: [[x - 20, hip[1] - 4], [x + 20, hip[1] - 4], [x + 34, shoulder[1] - 4], [x - 4, shoulder[1] - 10]],
        fill: SHIRT,
      });
      polygon({ points: [[x + 20, hip[1] - 4], [x + 34, shoulder[1] - 4], [x + 26, shoulder[1] + 30]], fill: SHIRT_DARK });

      part('head', { pivot: neck }, () => {
        const [hx, hy] = [neck[0] + 6, neck[1] - 20];
        line({ from: neck, to: [hx, hy + 8], stroke: SKIN, width: 12, cap: 'round' });
        circle({ cx: hx, cy: hy, r: 21, fill: SKIN });
        circle({ cx: hx + 13, cy: hy + 2, r: 2.6, fill: BLACK });
        // cap: crown and brim, brim pointing at the ball
        path({ d: `M ${hx - 22} ${hy - 4} A 22 22 0 0 1 ${hx + 22} ${hy - 4} Z`, fill: CAP });
        polygon({ points: [[hx + 12, hy - 6], [hx + 44, hy + 2], [hx + 12, hy]], fill: CAP });
        ellipse({ cx: hx - 14, cy: hy + 4, rx: 4, ry: 5, fill: SKIN });
      });

      part('arms', { pivot: shoulder }, () => {
        line({ from: [shoulder[0] - 4, shoulder[1] + 2], to: hands, stroke: SKIN, width: 12, cap: 'round' });
        line({ from: [shoulder[0] + 6, shoulder[1] - 2], to: [hands[0] + 4, hands[1] - 6], stroke: SKIN, width: 12, cap: 'round' });
        circle({ cx: shoulder[0] + 2, cy: shoulder[1] + 4, r: 13, fill: SHIRT_DARK });
        part('club', { pivot: hands }, () => {
          line({ from: hands, to: [TEE[0] - 8, GROUND - 6], stroke: CLUB, width: 4, cap: 'round' });
          polygon({
            points: [[TEE[0] - 16, GROUND - 14], [TEE[0] - 2, GROUND - 12], [TEE[0] + 2, GROUND - 2], [TEE[0] - 18, GROUND - 2]],
            fill: CLUBHEAD,
          });
          circle({ cx: hands[0] + 2, cy: hands[1] - 2, r: 9, fill: SKIN });
        });
      });
    });
  });
}

// --- the film ----------------------------------------------------------------

export const golf: Character = character(
  'golf',
  { viewBox: [0, 0, W, H], duration: DURATION, ground: GROUND },
  () => {
    sky();
    clouds();
    hills();
    tree(560, 1);
    tree(905, 0.7);
    // The ball is drawn before the ground, so below the grass line it is
    // simply gone: that is how it drops into the cup.
    part('ball', { pivot: TEE, offstage: true }, () => {
      part('arc', { pivot: TEE }, () => {
        part('spin', { pivot: TEE }, () => {
          circle({ cx: TEE[0], cy: TEE[1], r: 8, fill: BALL });
          circle({ cx: TEE[0] + 3.5, cy: TEE[1] - 1.5, r: 2.2, fill: BALL_MARK });
        });
      });
    });
    ground();
    part('shadow', { pivot: [TEE[0], GROUND], offstage: true }, () => {
      ellipse({ cx: TEE[0], cy: GROUND + 2, rx: 10, ry: 3.5, fill: SHADOW, opacity: 0.25 });
    });
    cup();
    golfer(GOLFER_X);
    part('fade', () => {
      rect({ x: 0, y: 0, w: W, h: H, fill: BLACK });
    });
  },
);

// --- the swing ---------------------------------------------------------------
// Rotations are clockwise-positive on screen. The golfer faces right, so
// "back" is negative and "through" is positive.

const arms = golf.part('golfer.torso.arms');
const club = golf.part('golfer.torso.arms.club');
const torso = golf.part('golfer.torso');
const head = golf.part('golfer.torso.head');

// The hands go back low behind the body and up over the trailing shoulder
// (clockwise), come down the same way, and go through forward and up over the
// leading shoulder (counter-clockwise).
arms.animate({
  rotate: looped([
    [0, 0],
    // waggle: the club lifts and settles twice
    [T('address', 0.2), 0, easeInOut], [T('address', 0.35), 6, easeInOut],
    [T('address', 0.5), 0, easeInOut], [T('address', 0.62), 5, easeInOut], [T('address', 0.75), 0],
    // back, hold, and the change of direction
    [T('backswing'), 0, easeInOut], [T('backswing', 1), 184],
    [T('top', 0.6), 192, easeInOut], [T('top', 1), 188, easeIn],
    // down, and through
    [T('down', 1), 0],
    [T('follow', 0.45), -140, easeOut], [T('follow', 1), -152],
    // hold the finish while the ball flies, then lower the club and watch
    [T('flight', 0.6), -152, easeInOut], [T('land', 0.4), -10, easeInOut], [T('land', 1), 0],
    // the club goes up
    [T('cheer'), 0, easeOut], [T('cheer', 0.12), -165, easeInOut],
    [T('cheer', 0.3), -140, easeInOut], [T('cheer', 0.5), -165, easeInOut],
    [T('cheer', 0.7), -142, easeInOut], [T('cheer', 1), -150],
  ]),
});

// The wrist, relative to the arms. The shaft points down at address, drags
// back low, swings up to point at the target at the top, keeps that angle while
// the arms start down (the lag), releases at the ball, and rolls over into the
// finish so the shaft wraps behind the head.
club.animate({
  rotate: looped([
    [0, 0],
    [T('address', 0.2), 0, easeInOut], [T('address', 0.35), 10, easeInOut],
    [T('address', 0.5), -3, easeInOut], [T('address', 0.62), 8, easeInOut], [T('address', 0.75), 0],
    [T('backswing'), 0, easeIn], [T('backswing', 0.45), 8, easeOut], [T('backswing', 1), 96],
    [T('top', 0.6), 106, easeInOut], [T('top', 1), 102],
    [T('down', 0.6), 96, easeIn], [T('down', 1), 0, easeOut],
    [T('follow', 0.4), -60, easeInOut], [T('follow', 1), -92],
    [T('flight', 0.6), -92, easeInOut], [T('land', 0.4), 6, easeInOut], [T('land', 1), 0],
    [T('cheer'), 0, easeOut], [T('cheer', 0.12), 8, easeInOut], [T('cheer', 0.3), -2, easeInOut],
    [T('cheer', 0.5), 8, easeInOut], [T('cheer', 0.7), -2, easeInOut], [T('cheer', 1), 4],
  ]),
});

// The torso turns away, then through, and stands up into the finish.
torso.animate({
  rotate: looped([
    [0, 0],
    [T('backswing'), 0, easeInOut], [T('backswing', 1), -12],
    [T('top', 1), -12, easeIn], [T('down', 1), 2, easeOut],
    [T('follow', 0.5), 18, easeInOut], [T('follow', 1), 16],
    [T('flight', 0.6), 16, easeInOut], [T('land', 1), 4],
    [T('cheer'), 4, easeOut], [T('cheer', 0.15), -10, easeInOut], [T('cheer', 1), -6],
  ]),
});
// Weight goes onto the front foot through the shot.
torso.animate({
  x: looped([
    [0, 0],
    [T('backswing'), 0, easeInOut], [T('backswing', 1), -8],
    [T('top', 1), -8, easeIn], [T('down', 1), 4, easeOut], [T('follow', 1), 12],
    [T('flight', 0.6), 12, easeInOut], [T('land', 1), 0],
  ]),
});

// The head stays on the ball until the follow-through, then comes up to watch,
// tracks the ball down, and lifts again for the cheer.
head.animate({
  rotate: looped([
    [0, 0],
    [T('backswing'), 0, easeInOut], [T('backswing', 1), 6],
    [T('top', 1), 6, easeIn], [T('down', 1), 0],
    [T('follow', 0.3), 0, easeOut], [T('follow', 1), -34],
    [T('flight', 0.5), -34, easeInOut], [T('land', 0.5), -14, easeInOut], [T('roll', 0.8), -8],
    [T('cheer'), -8, easeOut], [T('cheer', 0.15), -36, easeInOut], [T('cheer', 1), -30],
  ]),
});

// The back heel comes up in the finish and goes down when the club does.
golf.part('golfer.backFoot').animate({
  rotate: keys([
    [0, 0],
    [T('down', 0.5), 0, easeOut], [T('follow', 0.6), -40],
    [T('flight', 0.6), -40, easeInOut], [T('land', 1), 0],
  ]),
});

// Two hops when it drops.
golf.part('golfer').animate({
  y: keys([
    [0, 0],
    [T('cheer', 0.1), 0, easeOut], [T('cheer', 0.25), -48, easeIn], [T('cheer', 0.4), 0, easeOut],
    [T('cheer', 0.55), -48, easeIn], [T('cheer', 0.7), 0],
  ]),
});

// --- the ball ----------------------------------------------------------------

const ball = golf.part('ball');
const FLIGHT_END = 372;
const BOUNCE_1 = 442;
const BOUNCE_2 = 480;
const IN = HOLE_X - TEE[0];

ball.animate({
  x: looped([
    [0, 0],
    [T('follow'), 0], [T('flight', 1), FLIGHT_END],
    [T('land', 0.55), BOUNCE_1], [T('land', 1), BOUNCE_2, easeOut], [T('roll', 0.86), IN],
  ]),
});
golf.part('ball.arc').animate({
  y: looped([
    [0, 0],
    [T('follow'), 0, easeOut], [T('flight', 0.42), -256, easeIn], [T('flight', 1), 0],
    [T('land', 0.27), -52, easeIn], [T('land', 0.55), 0, easeOut],
    [T('land', 0.78), -16, easeIn], [T('land', 1), 0],
    // over the lip, and down
    [T('roll', 0.86), 0, easeIn], [T('roll', 1), 30],
  ]),
});
golf.part('ball.spin').animate({
  rotate: looped([
    [0, 0],
    [T('follow'), 0], [T('flight', 1), 1800],
    [T('land', 1), 2160, easeOut], [T('roll', 0.86), 2520],
  ]),
});

// The shadow rides under the ball and shrinks with height.
const shadow = golf.part('shadow');
shadow.animate({
  x: looped([
    [0, 0],
    [T('follow'), 0], [T('flight', 1), FLIGHT_END],
    [T('land', 0.55), BOUNCE_1], [T('land', 1), BOUNCE_2, easeOut], [T('roll', 0.86), IN],
  ]),
});
const SHADOW_SIZE: KeyTuple[] = [
  [0, 1],
  [T('follow'), 1, easeOut], [T('flight', 0.42), 0.35, easeIn], [T('flight', 1), 1],
  [T('land', 0.27), 0.8, easeIn], [T('land', 0.55), 1], [T('land', 0.78), 0.92], [T('land', 1), 1],
];
shadow.animate({ scaleX: keys(SHADOW_SIZE), scaleY: keys(SHADOW_SIZE) });
shadow.animate({
  opacity: keys([[0, 1], [T('roll', 0.8), 1, easeIn], [T('roll', 0.9), 0], [RESET, 0, HARD], [RESET + 0.002, 1]]),
});

// --- the rest of the world ---------------------------------------------------

golf.part('clouds').animate({
  x: keys([[0, 0, easeInOut], [0.5, 22, easeInOut], [1, 0]]),
});
golf.part('flag').animate({
  skewY: noise(7, { rate: 3, octaves: 2, seed: 3 }),
  rotate: noise(2, { rate: 2, seed: 5 }),
});

// --- the fade ----------------------------------------------------------------

golf.part('fade').animate({
  opacity: keys([
    [0, 0],
    [T('fade'), 0, easeIn], [T('fade', 0.4), 1],
    [T('fade', 0.6), 1, easeOut], [1, 0],
  ]),
});

export default golf;
