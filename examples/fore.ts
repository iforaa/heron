/**
 * FORE! — a fourteen-second cutout short.
 *
 * Construction-paper cartoon rules, deliberately: flat fills and no outlines,
 * characters that slide rather than walk, bodies that bob when they talk, a
 * mouth that is two shapes cut on the beat, and hard cuts between a wide shot
 * and one close-up. Nothing here needs the rig to be anatomically right; it
 * needs the timing to be. So the file is mostly a score, and every gesture is
 * placed against a named beat rather than a number.
 *
 * The story: a crane tees off, the ball bonks a gopher, the crane celebrates
 * and slides over to collect — and the gopher pops out of a different hole
 * with the ball. Chase. Iris out. FIN.
 *
 * It loops rather than plays once so a README reader who scrolls past after
 * the page loaded still sees the film. The end card holds, then fades to the
 * opening frame; every part that moved is reset while the card is opaque, so
 * the first and last visible poses are the same picture.
 */

import {
  character, circle, easeIn, easeInOut, easeOut, ellipse, keys, line, part, path,
  polygon, rect, score, steps, strokeText, swap, type Character, type Vec2,
} from '../src/index.ts';

const W = 960;
const H = 540;
const GROUND = 430;
const DURATION = 14;

const SKY = '#9ad0f5';
const HILL = '#7cc26a';
const HILL_FAR = '#a6d98f';
const GRASS = '#5aa84a';
const HOLE = '#4a3520';
const CRANE = '#dfe3e6';
const CRANE_LIGHT = '#f3f5f7';
const CRANE_DARK = '#b9c2c9';
const LEG = '#f0a030';
const BEAK = '#222222';
const EYE = '#f5c542';
const FUR = '#9c6b3c';
const FUR_LIGHT = '#d9b98a';
const FUR_DARK = '#3a2415';
const WHITE = '#ffffff';
const RED = '#e0402a';
const PINK = '#e8788a';
const STAR = '#ffd23f';
const BLACK = '#111111';

/** A hard cut: holds the previous value, then jumps. */
const HARD = steps(1, 'end');

// --- the score ---------------------------------------------------------------

export const beats = score(DURATION, [
  ['setup', 1.6],      // crane waggles; gopher pops up and blinks
  ['backswing', 0.7],
  ['top', 0.4],        // the hold before the whoosh
  ['down', 0.18],
  ['flight', 0.7],     // ball in the air, club follows through
  ['bonk', 1.2],       // X eyes, stars, gopher drops
  ['cheer', 1.2],      // flap and hop
  ['slide', 1.2],      // crane slides to the hole, talking
  ['insert', 1.3],     // close-up: gopher with the ball, tongue out
  ['skid', 0.5],       // back to wide: crane skids to a stop
  ['tilt', 1.0],       // pause, head tilt, ?!
  ['chase', 1.4],      // both off screen right
  ['iris', 0.6],
  ['fin', 0],          // end card, then fade back to the top
]);

const T = (beat: string, u = 0): number => beats.time(beat, u);
/** When the card is black and the cast is quietly put back for the next loop. */
const RESET = T('fin', 0.5);

/**
 * Appends a hard reset so a channel that ends elsewhere still closes the loop.
 * The jump happens under the end card, where nobody can see it.
 */
type KeyTuple = Parameters<typeof keys>[0][number];

function looped(list: KeyTuple[]): ReturnType<typeof keys> {
  const first = list[0][1];
  const last = list[list.length - 1][1];
  if (first === last) return keys(list);
  return keys([...list, [RESET, last, HARD], [RESET + 0.002, first]]);
}

/** Mouth flaps at a fixed rate across a window: open, shut, open, shut. */
function flaps(from: number, to: number, perSecond = 8): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  const step = 1 / perSecond / DURATION;
  let open = true;
  for (let t = from; t < to; t += step) {
    out.push([t, open ? 'open' : 'shut']);
    open = !open;
  }
  out.push([to, 'shut']);
  return out;
}

// --- the cast ----------------------------------------------------------------

/** Crane standing on (x, GROUND), facing right. Club hangs from its wing. */
function crane(x: number): void {
  part('crane', { pivot: [x, GROUND], offstage: true }, () => {
    // legs
    line({ from: [x - 10, GROUND - 62], to: [x - 12, GROUND], stroke: LEG, width: 5, cap: 'round' });
    line({ from: [x + 12, GROUND - 62], to: [x + 16, GROUND], stroke: LEG, width: 5, cap: 'round' });
    polygon({ points: [[x - 24, GROUND], [x - 2, GROUND], [x - 8, GROUND - 5]], fill: LEG });
    polygon({ points: [[x + 6, GROUND], [x + 28, GROUND], [x + 20, GROUND - 5]], fill: LEG });
    // body
    ellipse({ cx: x, cy: GROUND - 90, rx: 46, ry: 34, fill: CRANE });
    ellipse({ cx: x + 6, cy: GROUND - 80, rx: 28, ry: 18, fill: CRANE_LIGHT });
    // tail
    polygon({ points: [[x - 40, GROUND - 100], [x - 70, GROUND - 120], [x - 62, GROUND - 92]], fill: CRANE_DARK });
    // neck and head
    line({ from: [x + 30, GROUND - 108], to: [x + 52, GROUND - 180], stroke: CRANE, width: 16, cap: 'round' });
    part('head', { pivot: [x + 52, GROUND - 180] }, () => {
      circle({ cx: x + 56, cy: GROUND - 192, r: 24, fill: CRANE_LIGHT });
      polygon({ points: [[x + 44, GROUND - 212], [x + 40, GROUND - 234], [x + 54, GROUND - 216]], fill: CRANE_DARK });
      polygon({ points: [[x + 54, GROUND - 214], [x + 58, GROUND - 236], [x + 64, GROUND - 216]], fill: CRANE_DARK });
      circle({ cx: x + 66, cy: GROUND - 198, r: 7, fill: EYE });
      circle({ cx: x + 68, cy: GROUND - 198, r: 3, fill: BEAK });
      swap('mouth', {
        shut: () => {
          polygon({ points: [[x + 78, GROUND - 194], [x + 122, GROUND - 186], [x + 78, GROUND - 180]], fill: BEAK });
        },
        open: () => {
          polygon({ points: [[x + 78, GROUND - 196], [x + 122, GROUND - 194], [x + 78, GROUND - 186]], fill: BEAK });
          polygon({ points: [[x + 78, GROUND - 184], [x + 118, GROUND - 176], [x + 78, GROUND - 174]], fill: BEAK });
        },
      });
    });
    // the ?! that pops over its head
    part('what', { pivot: [x + 96, GROUND - 236] }, () => {
      strokeText('?!', { x: x + 96, y: GROUND - 262, size: 44, align: 'center', stroke: BEAK, width: 7 });
    });
    // wing and club
    part('wing', { pivot: [x - 15, GROUND - 108] }, () => {
      polygon({
        points: [[x - 15, GROUND - 108], [x - 60, GROUND - 85], [x - 45, GROUND - 58], [x + 10, GROUND - 70]],
        fill: CRANE_DARK,
      });
    });
    // A long shaft from a high pivot: a short club from a low one barely left
    // the ground at the top of the backswing, and the swing did not read.
    part('club', { pivot: [x - 40, GROUND - 95] }, () => {
      line({ from: [x - 40, GROUND - 95], to: [x - 24, GROUND - 4], stroke: '#444444', width: 7, cap: 'round' });
      polygon({ points: [[x - 32, GROUND - 12], [x + 2, GROUND - 3], [x - 1, GROUND + 6], [x - 36, GROUND - 2]], fill: '#333333' });
    });
  });
}

interface GopherOptions {
  /** Which faces this gopher needs; the first one is showing at t=0. */
  faces: Array<'open' | 'blink' | 'x' | 'smug'>;
  /** Holding the ball in its paws. */
  ball?: boolean;
  name?: string;
}

/** Gopher in a hole at (x, GROUND), facing left. Its pivot is the hole. */
function gopher(x: number, o: GopherOptions): void {
  part(o.name ?? 'gopher', { pivot: [x, GROUND], offstage: true }, () => {
    rect({ x: x - 30, y: GROUND - 70, w: 60, h: 90, radius: 28, fill: FUR });
    ellipse({ cx: x, cy: GROUND - 15, rx: 16, ry: 22, fill: FUR_LIGHT });
    circle({ cx: x - 22, cy: GROUND - 82, r: 8, fill: FUR });
    circle({ cx: x + 22, cy: GROUND - 82, r: 8, fill: FUR });
    circle({ cx: x, cy: GROUND - 60, r: 30, fill: FUR });
    ellipse({ cx: x - 4, cy: GROUND - 46, rx: 13, ry: 9, fill: FUR_LIGHT });
    circle({ cx: x - 8, cy: GROUND - 52, r: 4, fill: FUR_DARK });
    rect({ x: x - 9, y: GROUND - 42, w: 12, h: 8, fill: WHITE });
    if (o.ball) {
      ellipse({ cx: x - 30, cy: GROUND - 22, rx: 7, ry: 5, fill: FUR });
      circle({ cx: x - 34, cy: GROUND - 28, r: 8, fill: WHITE });
      ellipse({ cx: x - 30, cy: GROUND - 30, rx: 7, ry: 5, fill: FUR });
    }
    const faces: Record<string, () => void> = {
      open: () => {
        circle({ cx: x - 12, cy: GROUND - 66, r: 7, fill: WHITE });
        circle({ cx: x + 10, cy: GROUND - 66, r: 7, fill: WHITE });
        circle({ cx: x - 14, cy: GROUND - 66, r: 3, fill: FUR_DARK });
        circle({ cx: x + 8, cy: GROUND - 66, r: 3, fill: FUR_DARK });
      },
      blink: () => {
        line({ from: [x - 18, GROUND - 66], to: [x - 6, GROUND - 66], stroke: FUR_DARK, width: 3, cap: 'round' });
        line({ from: [x + 4, GROUND - 66], to: [x + 16, GROUND - 66], stroke: FUR_DARK, width: 3, cap: 'round' });
      },
      x: () => {
        for (const cx of [x - 12, x + 10]) {
          line({ from: [cx - 6, GROUND - 72], to: [cx + 6, GROUND - 60], stroke: FUR_DARK, width: 3, cap: 'round' });
          line({ from: [cx + 6, GROUND - 72], to: [cx - 6, GROUND - 60], stroke: FUR_DARK, width: 3, cap: 'round' });
        }
      },
      smug: () => {
        circle({ cx: x - 12, cy: GROUND - 66, r: 7, fill: WHITE });
        circle({ cx: x + 10, cy: GROUND - 66, r: 7, fill: WHITE });
        rect({ x: x - 20, y: GROUND - 74, w: 38, h: 6, fill: FUR });
        circle({ cx: x - 14, cy: GROUND - 65, r: 3, fill: FUR_DARK });
        circle({ cx: x + 8, cy: GROUND - 65, r: 3, fill: FUR_DARK });
        ellipse({ cx: x - 6, cy: GROUND - 34, rx: 5, ry: 8, fill: PINK });
      },
    };
    swap('face', Object.fromEntries(o.faces.map((f) => [f, faces[f]])));
    // stars orbit the head after the bonk; they ride the gopher, so they drop with it
    part('stars', { pivot: [x, GROUND - 60] }, () => {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const sx = x + Math.cos(a) * 48;
        const sy = GROUND - 60 + Math.sin(a) * 48;
        polygon({ points: star(sx, sy, 11), fill: STAR });
      }
    });
  });
}

function star(cx: number, cy: number, r: number): Vec2[] {
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
}

// --- the set -----------------------------------------------------------------

const TEE_X = 180;
const BALL: Vec2 = [TEE_X - 10, GROUND - 7];
const HOLE_1 = 650;
const HOLE_2 = 820;
const FLAG_X = 700;

function sky(): void {
  rect({ x: 0, y: 0, w: W, h: H, fill: SKY });
  circle({ cx: 860, cy: 80, r: 38, fill: '#ffe45c' });
}

function hills(): void {
  // Hills end inside the frame: artwork past the viewBox is a lint finding.
  ellipse({ cx: 260, cy: GROUND, rx: 260, ry: 100, fill: HILL_FAR });
  ellipse({ cx: 700, cy: GROUND, rx: 260, ry: 80, fill: HILL });
}

function ground(): void {
  rect({ x: 0, y: GROUND, w: W, h: H - GROUND, fill: GRASS });
}

function hole(x: number): void {
  ellipse({ cx: x, cy: GROUND + 2, rx: 34, ry: 9, fill: HOLE });
}

function flag(): void {
  line({ from: [FLAG_X, GROUND - 130], to: [FLAG_X, GROUND + 2], stroke: '#eeeeee', width: 4 });
  polygon({ points: [[FLAG_X + 2, GROUND - 130], [FLAG_X + 42, GROUND - 118], [FLAG_X + 2, GROUND - 106]], fill: RED });
}

// --- the film ----------------------------------------------------------------

export const fore: Character = character(
  'fore',
  { viewBox: [0, 0, W, H], duration: DURATION, ground: GROUND },
  () => {
    swap('shots', {
      wide: () => {
        sky();
        part('clouds', () => {
          for (const [cx, cy] of [[150, 90], [420, 60], [640, 120]] as Vec2[]) {
            part(`c${cx}`, () => {
              ellipse({ cx, cy, rx: 46, ry: 18, fill: WHITE });
              circle({ cx: cx - 14, cy: cy - 12, r: 18, fill: WHITE });
              circle({ cx: cx + 12, cy: cy - 10, r: 14, fill: WHITE });
            });
          }
        });
        hills();
        gopher(HOLE_1, { faces: ['open', 'blink', 'x'], name: 'gopher' });
        gopher(HOLE_2, { faces: ['open', 'smug'], ball: true, name: 'gopher2' });
        ground();
        hole(HOLE_1);
        hole(HOLE_2);
        flag();
        rect({ x: BALL[0] - 3, y: BALL[1] + 5, w: 6, h: 4, fill: '#cccccc' });
        part('ball', { pivot: BALL, offstage: true }, () => {
          part('arc', { pivot: BALL }, () => {
            circle({ cx: BALL[0], cy: BALL[1], r: 9, fill: WHITE });
          });
        });
        crane(TEE_X);
      },
      insert: () => {
        rect({ x: 0, y: 0, w: W, h: H, fill: SKY });
        part('closeup', { pivot: [480, 540], transform: { scaleX: 2.4, scaleY: 2.4 } }, () => {
          gopher(480, { faces: ['open', 'smug'], ball: true, name: 'star' });
          rect({ x: 280, y: GROUND, w: 400, h: 110, fill: GRASS });
          ellipse({ cx: 480, cy: GROUND + 2, rx: 34, ry: 9, fill: HOLE });
        });
      },
    });
    // iris: two black plates with holes, shrinking about the centre of the
    // frame. A plate covers the frame while its hole shrinks only as long as
    // its ink reaches four times further than its hole, and a plate much bigger
    // than the frame panics resvg, so the iris is two of them: the first takes
    // the hole from 600 to 150 while still covering everything, the second sits
    // inside that and takes it from 150 to 37, and the card fades in under the
    // last of it.
    for (const [name, hole] of [['iris', 600], ['iris2', 150]] as const) {
      part(name, { pivot: [W / 2, H / 2], offstage: true }, () => {
        const cx = W / 2;
        const cy = H / 2;
        const half = hole * 4;
        path({
          d: `M ${cx - half} ${cy - half} h ${2 * half} v ${2 * half} h ${-2 * half} Z `
            + `M ${cx + hole} ${cy} A ${hole} ${hole} 0 1 0 ${cx - hole} ${cy} A ${hole} ${hole} 0 1 0 ${cx + hole} ${cy} Z`,
          fill: BLACK,
        });
      });
    }
    part('card', () => {
      rect({ x: 0, y: 0, w: W, h: H, fill: BLACK });
      strokeText('FIN', { x: W / 2, y: H / 2 - 40, size: 84, align: 'center', stroke: '#f7f7f4', width: 9 });
    });
  },
);

// --- shots -------------------------------------------------------------------

fore.swap('shots').cut([[0, 'wide'], [T('insert'), 'insert'], [T('skid'), 'wide']]);

// --- the crane ---------------------------------------------------------------

const craneBody = fore.part('shots.wide.crane');

craneBody.animate({
  x: looped([
    [0, 0],
    [T('slide'), 0, easeInOut], [T('slide', 1), 380],
    [T('skid'), 380, easeOut], [T('skid', 1), 430],
    [T('chase', 0.1), 430, easeIn], [T('chase', 0.9), 1000],
  ]),
});
// hop twice during the cheer
craneBody.animate({
  y: keys([
    [0, 0],
    [T('cheer'), 0, easeOut], [T('cheer', 0.15), -44, easeIn], [T('cheer', 0.3), 0, easeOut],
    [T('cheer', 0.45), -44, easeIn], [T('cheer', 0.6), 0],
  ]),
});
// talk-bob while sliding
craneBody.animate({
  y: beats.duringAdditive('slide', (_s, u) => -7 * Math.abs(Math.sin(u * Math.PI * 5))),
});
// lean back through the skid
craneBody.animate({
  rotate: keys([
    [0, 0],
    [T('skid'), 0, easeOut], [T('skid', 0.6), -16, easeInOut], [T('skid', 1), 0],
  ]),
});

fore.part('shots.wide.crane.head').animate({
  rotate: keys([
    [0, 0],
    [T('tilt', 0.25), 0, easeInOut], [T('tilt', 0.45), 24],
    [T('chase'), 24, easeInOut], [T('chase', 0.25), 0],
  ]),
});

fore.swap('shots.wide.crane.head.mouth').cut([
  [0, 'shut'],
  ...flaps(T('cheer', 0.55), T('slide', 0.95)),
  [T('tilt', 0.6), 'open'],
  [T('chase', 0.3), 'shut'],
]);

// the ?! springs in, overshoots, and is gone with the chase. It hides by
// scaling to almost nothing rather than to zero: a zero-area group is a
// degenerate bounds computation the rasteriser cannot survive.
const POP: KeyTuple[] = [
  [0, 0.001],
  [T('tilt', 0.5), 0.001, easeOut], [T('tilt', 0.62), 1.3, easeInOut], [T('tilt', 0.75), 1],
  [T('chase', 0.2), 1, HARD], [T('chase', 0.25), 0.001],
];
fore.part('shots.wide.crane.what').animate({
  scaleX: keys(POP),
  scaleY: keys(POP),
});

// the swing: waggle, back, hold, whoosh, follow through, recover
fore.part('shots.wide.crane.club').animate({
  rotate: keys([
    [0, 0],
    [T('setup', 0.2), 0, easeInOut], [T('setup', 0.4), 9, easeInOut],
    [T('setup', 0.6), -5, easeInOut], [T('setup', 0.8), 0],
    [T('backswing'), 0, easeOut], [T('backswing', 1), 150],
    [T('top', 1), 150, easeIn], [T('down', 1), 0, easeOut],
    [T('flight', 0.5), -165],
    [T('cheer', 0.7), -165, easeInOut], [T('slide', 0.2), 0],
  ]),
});
// the wing goes with the club, and flaps in the cheer
fore.part('shots.wide.crane.wing').animate({
  rotate: keys([
    [0, 0],
    [T('backswing'), 0, easeOut], [T('backswing', 1), 40],
    [T('top', 1), 40, easeIn], [T('down', 1), -10, easeOut],
    [T('flight', 0.5), -30],
    [T('cheer', 0.7), -30, easeInOut], [T('slide', 0.2), 0],
  ]),
});
fore.part('shots.wide.crane.wing').animate({
  rotate: beats.duringAdditive('cheer', (_s, u) => Math.sin(u * Math.PI * 8) * 40 * Math.sin(Math.PI * u)),
});

// --- the ball ----------------------------------------------------------------

fore.part('shots.wide.ball').animate({
  x: looped([
    [0, 0],
    [T('flight'), 0], [T('flight', 1), HOLE_1 - 4 - BALL[0]],
  ]),
});
fore.part('shots.wide.ball.arc').animate({
  y: looped([
    [0, 0],
    [T('flight'), 0, easeOut], [T('flight', 0.5), -240, easeIn], [T('flight', 1), -85],
    [T('bonk', 0.12), 0, easeOut], [T('bonk', 0.24), -20, easeIn], [T('bonk', 0.36), 0],
  ]),
});
fore.part('shots.wide.ball').animate({
  opacity: keys([
    [0, 1],
    [T('bonk', 0.85), 1, HARD], [T('bonk', 0.9), 0],
    [RESET, 0, HARD], [RESET + 0.002, 1],
  ]),
});

// --- the gophers -------------------------------------------------------------

fore.part('shots.wide.gopher').animate({
  y: keys([
    [0, 90],
    [T('setup', 0.35), 90, easeOut], [T('setup', 0.55), -8, easeInOut], [T('setup', 0.7), 0],
    [T('bonk'), 0, easeIn], [T('bonk', 0.08), 16, easeOut], [T('bonk', 0.22), 0],
    [T('bonk', 0.8), 0, easeIn], [T('bonk', 1), 90],
  ]),
});
fore.swap('shots.wide.gopher.face').cut([
  [0, 'open'],
  [T('setup', 0.8), 'blink'], [T('setup', 0.88), 'open'],
  [T('bonk'), 'x'],
  [RESET, 'open'],
]);
fore.part('shots.wide.gopher.stars').animate({
  rotate: keys([[0, 0], [T('bonk'), 0], [T('bonk', 1), 540], [RESET, 540, HARD], [RESET + 0.002, 0]]),
  opacity: keys([
    [0, 0],
    [T('bonk'), 0, HARD], [T('bonk', 0.02), 1],
    [T('bonk', 0.75), 1, easeIn], [T('bonk', 0.85), 0],
  ]),
});

const gopher2 = fore.part('shots.wide.gopher2');
gopher2.animate({
  y: keys([
    [0, 90],
    [T('skid'), 90, easeOut], [T('skid', 0.4), -8, easeInOut], [T('skid', 0.7), 0],
    [T('chase'), 0, easeOut], [T('chase', 0.15), -50],
    [RESET, -50, HARD], [RESET + 0.002, 90],
  ]),
});
gopher2.animate({
  x: looped([
    [0, 0],
    [T('chase', 0.05), 0, easeIn], [T('chase', 0.75), 420],
  ]),
});
// a little bounce as it runs
gopher2.animate({
  y: beats.duringAdditive('chase', (_s, u) => -10 * Math.abs(Math.sin(u * Math.PI * 7)), { attack: 0.15 }),
});
fore.swap('shots.wide.gopher2.face').cut([[0, 'open'], [T('skid', 0.9), 'smug'], [RESET, 'open']]);

// the close-up
const star2 = fore.part('shots.insert.closeup.star');
star2.animate({
  y: keys([
    [0, 90],
    [T('insert'), 90, easeOut], [T('insert', 0.2), -12, easeInOut], [T('insert', 0.32), 0],
    [T('skid'), 0, HARD], [T('skid', 0.01), 90],
  ]),
});
star2.animate({
  y: beats.duringAdditive(
    'insert', (_s, u) => (u > 0.45 ? -6 * Math.abs(Math.sin(u * Math.PI * 9)) : 0),
  ),
});
fore.swap('shots.insert.closeup.star.face').cut([[0, 'open'], [T('insert', 0.5), 'smug'], [T('skid'), 'open']]);
// the ball is in its paws: no stars in the close-up
fore.part('shots.insert.closeup.star.stars').animate({ opacity: keys([[0, 0], [1, 0]]) });
fore.part('shots.wide.gopher2.stars').animate({ opacity: keys([[0, 0], [1, 0]]) });

// --- clouds ------------------------------------------------------------------

fore.part('shots.wide.clouds').animate({
  x: keys([[0, 0, easeInOut], [0.5, 28, easeInOut], [1, 0]]),
});

// --- iris and card -----------------------------------------------------------

const IRIS_A: KeyTuple[] = [
  [0, 1], [T('iris'), 1, easeIn], [T('iris', 0.55), 0.25],
  [T('fin', 0.6), 0.25, HARD], [T('fin', 0.62), 1],
];
const IRIS_B: KeyTuple[] = [
  [0, 1], [T('iris', 0.55), 1, easeOut], [T('iris', 1), 0.25],
  [T('fin', 0.6), 0.25, HARD], [T('fin', 0.62), 1],
];
fore.part('iris').animate({ scaleX: keys(IRIS_A), scaleY: keys(IRIS_A) });
// The inner plate's hole is smaller than the frame from the start, so it is
// invisible until the outer plate's hole has shrunk to meet it.
fore.part('iris2').animate({
  scaleX: keys(IRIS_B),
  scaleY: keys(IRIS_B),
  opacity: keys([[0, 0], [T('iris', 0.55), 0, HARD], [T('iris', 0.56), 1], [RESET, 1, HARD], [RESET + 0.002, 0]]),
});
fore.part('card').animate({
  opacity: keys([
    [0, 0],
    [T('iris', 0.8), 0, easeIn], [T('iris', 1), 1],
    [T('fin', 0.75), 1, easeInOut], [1, 0],
  ]),
});

export default fore;
