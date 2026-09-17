/**
 * A heron fishes at dusk, and misses.
 *
 * The scene is one gesture with a long wait on either side of it. Everything
 * else in the frame — reeds, clouds, a dragonfly, the bird's own breathing — is
 * there so the wait reads as patience rather than as a paused file. Nothing in
 * the first two seconds is the subject, and that is the point: the strike lands
 * because the frame had been still.
 *
 * Which parts of the library carry which idea:
 *
 *   - `reach()` drives the neck. The honest input is where the beak should go,
 *     not two joint angles, so the strike is a target on the water surface and
 *     the neck is solved from it, over the head-tilt that was already authored.
 *   - `spring()` is the recoil. A neck that snaps back up does not stop dead; it
 *     rings, and the ring is an additive layer over the exact keyed lift.
 *   - `noise()` is why the bird and the dragonfly are alive between beats, and
 *     it is periodic by construction so the loop closes.
 *   - `field()` + `stagger()` make the ripples a set of rings arriving one after
 *     another rather than one ring fading, which is what a splash actually is.
 *   - Nested parts keep the fish exact: carry, lift, spin and squash are four
 *     groups with their own keyframe lists, not one baked curve.
 */

import {
  channelAt, character, circle, ellipse, field, keys, layer, line, noise, part, path, polygon,
  reach, rect, score, spring, stagger, within,
  cubicBezier, easeIn, easeInOut, easeOut, type Character, type Vec2,
} from '../src/index.ts';

const W = 800;
const H = 500;
const DURATION = 6;

// --- palette: an evening pond ------------------------------------------------

const SKY = '#f5d9ad';
const SKY_HIGH = '#f2c98f';
const SUN = '#f7b26b';
const HILL_FAR = '#7fa38f';
const HILL = '#456f60';
const WATER = '#1c5561';
const WATER_LIGHT = '#2f7482';
const REED = '#22362f';
const CLOUD = '#fbead2';
const HERON = '#dfe4e9';
const HERON_SHADE = '#b6c1ca';
const BEAK = '#2b2f33';
const EYE = '#f2c230';
const PUPIL = '#1a1a1a';
const FISH = '#d9762b';
const FISH_DARK = '#a8531a';
const RIPPLE = '#a7d5dc';
const DRAGONFLY = '#3b6f8f';

const WATERLINE = 320;

// --- the timeline ------------------------------------------------------------
// Sequential beats. The wait is most of the cycle on purpose.

const RECOIL = { swing: -7, stiffness: 520, damping: 14 };

const beats = score(DURATION, [
  ['wait', 1.7],
  ['cock', 0.45],
  ['poise', 0.45],
  ['strike', 0.2],
  ['plunge', 0.3],
  ['recoil', 0.5],
  ['settle', 0],
]);

/** The fish is in the air from the moment the beak hits the water until the neck is back up. */
const LEAP = beats.span('plunge', 'recoil');
/** Rings spread from the plunge into the settle. */
const RIPPLES = beats.span('plunge', 'settle');

// --- the bird's measurements -------------------------------------------------
// The neck is a two-bone chain: shoulder -> crook -> head. Rest lengths are
// measured from these points, and `reach()` measures the rest direction itself.

const SHOULDER: Vec2 = [262, 228];
const CROOK: Vec2 = [238, 152];
const NECK: [number, number] = [Math.hypot(CROOK[0] - SHOULDER[0], CROOK[1] - SHOULDER[1]), 72];
// The rest chain is straight: two-bone IK measures the upper bone's direction
// and assumes the lower one continues it, so a crooked rest pose would be
// "corrected" into a straight neck before anything else moved.
const HEAD: Vec2 = [
  CROOK[0] + ((CROOK[0] - SHOULDER[0]) / NECK[0]) * NECK[1],
  CROOK[1] + ((CROOK[1] - SHOULDER[1]) / NECK[0]) * NECK[1],
];

/** Where the head goes: just above the surface, so the beak plunges under it. */
const STRIKE_AT: Vec2 = [172, WATERLINE - 14];
/** Where each droplet of the splash flies, relative to the strike point. */
const DROPS: Array<[dx: number, dy: number]> = [[-34, -60], [-14, -78], [10, -70], [28, -52], [-50, -40]];

// --- the stage ---------------------------------------------------------------

function sky(): void {
  layer('sky', { offstage: true }, () => {
    rect({ x: 0, y: 0, w: W, h: H, fill: SKY });
    rect({ x: 0, y: 0, w: W, h: 120, fill: SKY_HIGH });
    circle({ cx: 610, cy: 214, r: 46, fill: SUN });
  });
}

/** A row of clouds at one depth. */
function cloudStrip(name: string, y: number, size: number, puffs: Vec2[]): void {
  layer(name, { offstage: true }, () => {
    for (const [x, dy] of puffs) {
      ellipse({ cx: x, cy: y + dy, rx: size * 2.4, ry: size * 0.55, fill: CLOUD });
      ellipse({ cx: x + size * 0.9, cy: y + dy - size * 0.35, rx: size * 1.2, ry: size * 0.7, fill: CLOUD });
    }
  });
}

function hills(): void {
  layer('hills', { offstage: true }, () => {
    path({
      d: 'M 0 300 C 90 262 170 258 250 276 C 340 296 420 250 520 262 C 600 270 700 236 800 250 L 800 320 L 0 320 Z',
      fill: HILL_FAR,
    });
    path({
      d: 'M 0 320 C 120 298 220 302 330 314 C 450 328 560 290 660 298 C 730 304 770 296 800 288 L 800 330 L 0 330 Z',
      fill: HILL,
    });
  });
}

function water(): void {
  layer('water', { offstage: true }, () => {
    rect({ x: 0, y: WATERLINE, w: W, h: H - WATERLINE, fill: WATER });
    for (const [x, y, w] of [[60, 372, 90], [300, 412, 140], [520, 386, 70], [640, 448, 120], [120, 470, 60]] as const) {
      rect({ x, y, w, h: 4, radius: 2, fill: WATER_LIGHT });
    }
  });
}

/** Reeds in the right foreground, each rooted where it meets the water. */
function reeds(): void {
  const stalks: Array<[x: number, h: number, lean: number]> = [
    [575, 150, -0.05], [612, 205, 0.04], [640, 172, -0.02], [672, 228, 0.06],
    [703, 188, -0.04], [736, 240, 0.03], [768, 200, -0.05],
  ];
  field('reeds', stalks.length, (i) => {
    const [x, h, lean] = stalks[i];
    const root: Vec2 = [x, WATERLINE + 8];
    part('stalk', { pivot: root }, () => {
      const top: Vec2 = [x + lean * h, WATERLINE - h];
      line({ from: root, to: top, stroke: REED, width: 5 });
      // The seed head.
      ellipse({ cx: top[0], cy: top[1] - 14, rx: 5, ry: 18, fill: REED });
    });
  });
}

// --- the bird ----------------------------------------------------------------

function heron(): void {
  part('heron', { pivot: SHOULDER }, () => {
    // Legs first, so the body sits over them.
    line({ from: [290, 262], to: [284, 352], stroke: HERON_SHADE, width: 5 });
    line({ from: [318, 262], to: [326, 352], stroke: HERON_SHADE, width: 5 });

    part('body', { pivot: SHOULDER }, () => {
      polygon({ points: [[350, 232], [392, 214], [396, 244], [356, 258]], fill: HERON_SHADE });
      ellipse({ cx: 305, cy: 240, rx: 58, ry: 32, fill: HERON });
      ellipse({ cx: 318, cy: 236, rx: 38, ry: 18, rotate: -8, fill: HERON_SHADE });

      part('neckUpper', { pivot: SHOULDER }, () => {
        line({ from: SHOULDER, to: CROOK, stroke: HERON, width: 20 });
        part('neckLower', { pivot: CROOK }, () => {
          line({ from: CROOK, to: HEAD, stroke: HERON, width: 16 });
          part('head', { pivot: HEAD }, () => {
            const [hx, hy] = HEAD;
            const eye: Vec2 = [hx - 8, hy - 3];
            polygon({ points: [[hx - 14, hy - 8], [hx - 78, hy + 4], [hx - 14, hy + 12]], fill: BEAK });
            ellipse({ cx: hx, cy: hy, rx: 20, ry: 14, fill: HERON });
            // Crest feathers.
            polygon({ points: [[hx + 10, hy - 10], [hx + 34, hy - 22], [hx + 14, hy - 2]], fill: HERON_SHADE });
            circle({ cx: eye[0], cy: eye[1], r: 5.5, fill: EYE });
            part('pupil', { pivot: eye }, () => {
              circle({ cx: eye[0] - 1, cy: eye[1], r: 2.6, fill: PUPIL });
            });
            part('lid', { pivot: [eye[0], eye[1] - 5] }, () => {
              ellipse({ cx: eye[0], cy: eye[1], rx: 6.5, ry: 6, fill: HERON });
            });
          });
        });
      });
    });
  });
}

// --- the fish and the water it disturbs --------------------------------------

function fish(): void {
  // Below the surface at rest, and drawn before the water so the water hides it.
  const home: Vec2 = [176, WATERLINE + 22];
  part('fish', { pivot: home }, () => {
    part('lift', { pivot: home }, () => {
      part('spin', { pivot: home }, () => {
        part('squash', { pivot: home }, () => {
          const [x, y] = home;
          polygon({ points: [[x - 24, y], [x - 3, y - 10], [x + 17, y - 3], [x + 17, y + 3], [x - 3, y + 10]], fill: FISH });
          polygon({ points: [[x + 14, y], [x + 32, y - 12], [x + 32, y + 12]], fill: FISH_DARK });
          circle({ cx: x - 13, cy: y - 3, r: 2.4, fill: PUPIL });
        });
      });
    });
  });
}

function splash(): void {
  const at: Vec2 = [STRIKE_AT[0], WATERLINE];
  field('ripples', 3, () => {
    part('ring', { pivot: at }, () => {
      ellipse({ cx: at[0], cy: at[1], rx: 30, ry: 9, fill: 'none', stroke: RIPPLE, width: 3 });
    });
  });
  field('drops', DROPS.length, () => {
    part('drop', { pivot: at }, () => circle({ cx: at[0], cy: at[1] - 4, r: 3.5, fill: RIPPLE }));
  });
}

function dragonfly(): void {
  const at: Vec2 = [480, 196];
  part('dragonfly', { pivot: at }, () => {
    line({ from: [at[0] - 20, at[1]], to: [at[0] + 24, at[1]], stroke: DRAGONFLY, width: 4 });
    circle({ cx: at[0] - 22, cy: at[1], r: 4.5, fill: DRAGONFLY });
    part('wings', { pivot: at }, () => {
      ellipse({ cx: at[0] - 2, cy: at[1] - 9, rx: 17, ry: 5, fill: CLOUD, opacity: 0.9 });
      ellipse({ cx: at[0] + 6, cy: at[1] + 9, rx: 17, ry: 5, fill: CLOUD, opacity: 0.9 });
    });
  });
}

export const heronFishing: Character = character(
  'heronFishing',
  { viewBox: [0, 0, W, H], duration: DURATION, ground: WATERLINE },
  () => {
    sky();
    cloudStrip('cloudsFar', 96, 12, [[40, 0], [150, 10], [250, -6], [330, 12], [440, 4], [560, -8], [700, 10]]);
    cloudStrip('cloudsNear', 150, 20, [[80, 0], [360, 14], [560, -10]]);
    hills();
    dragonfly();
    fish();
    water();
    splash();
    heron();
    reeds();
  },
);

// --- the sky moves -----------------------------------------------------------
// Six seconds is too short for clouds to cross anything, so they drift and
// drift back, the near layer twice as far as the far one. Slow enough that the
// turn is never seen; far enough that a still frame is not what is playing.

heronFishing.part('cloudsFar').animate({ x: keys([[0, 0, easeInOut], [0.5, -9, easeInOut], [1, 0]]) });
heronFishing.part('cloudsNear').animate({ x: keys([[0, 0, easeInOut], [0.5, -20, easeInOut], [1, 0]]) });

// --- idle life ---------------------------------------------------------------

heronFishing.part('heron').animate({ y: noise(2.5, { rate: 2, seed: 4 }) });
heronFishing.part('body').animate({ rotate: noise(1.2, { rate: 1, seed: 9 }) });

for (let i = 0; i < 7; i++) {
  heronFishing.part(`reeds.${i}.stalk`).animate({
    rotate: keys([[0, -2.5, easeInOut], [0.5, 2.5, easeInOut], [1, -2.5]]),
    phase: (i * 0.37) % 1,
  });
}

heronFishing.part('dragonfly').animate({
  x: noise(70, { rate: 1, octaves: 3, seed: 2 }),
  y: noise(36, { rate: 2, octaves: 2, seed: 7 }),
});
// Wings beat too fast to read as motion; they read as a blur that changes shape.
heronFishing.part('dragonfly.wings').animate({
  scaleY: keys(Array.from({ length: 49 }, (_, i) => [i / 48, i % 2 ? 0.2 : 1])),
});

// --- the bird acts -----------------------------------------------------------

// Two blinks in the wait, and a slow one after the miss.
heronFishing.part('lid').animate({
  scaleY: keys([
    [0, 0], [0.11, 0], [0.125, 1], [0.15, 1], [0.165, 0],
    [0.235, 0], [0.25, 1], [0.27, 1], [0.285, 0],
    [0.86, 0], [0.885, 1], [0.93, 1], [0.955, 0], [1, 0],
  ]),
});
// The eye finds the fish before the head does.
heronFishing.part('pupil').animate({
  x: within(beats.span('wait', 'cock'), keys([[0, 0], [0.7, 0, easeOut], [0.8, -2.2], [1, -2.2]])),
  y: within(beats.span('wait', 'cock'), keys([[0, 0], [0.7, 0, easeOut], [0.8, 2], [1, 2]])),
});
heronFishing.part('pupil').animate({
  x: within(beats.at('settle'), keys([[0, 0], [0.55, 0, easeInOut], [0.7, 2.2], [1, 2.2]])),
  y: within(beats.at('settle'), keys([[0, 0], [0.55, 0, easeInOut], [0.7, -2], [1, -2]])),
});

// The head tilts to look, holds through the strike, and rights itself with the recoil.
const LOOK = beats.span('cock', 'recoil');
const u = (name: string, end = false) => {
  const b = beats.at(name);
  return ((end ? b.to : b.from) - LOOK.from) / (LOOK.to - LOOK.from);
};
heronFishing.part('head').animate({
  rotate: keys([
    [0, 0, easeOut], [u('cock', true), -22], [u('plunge', true), -22, easeIn], [1, 0],
  ]),
});

// The strike: where the head is, as a fraction between rest and the water.
const dip = within(beats.span('strike', 'recoil'), keys([
  [0, 0, cubicBezier(0.7, 0, 1, 1)],
  [(beats.at('strike').to - beats.at('strike').from) / (beats.at('recoil').to - beats.at('strike').from), 1],
  [(beats.at('plunge').to - beats.at('strike').from) / (beats.at('recoil').to - beats.at('strike').from), 1, easeOut],
  [1, 0],
]));
// A little anticipation: the head draws back through the poise and releases
// into the strike, so the pull-back is gone by the time the beak lands.
const POISE = beats.span('poise', 'strike');
const poiseEnd = (beats.at('poise').to - POISE.from) / (POISE.to - POISE.from);
const anticipate = within(POISE, keys([
  [0, 0, easeInOut], [poiseEnd * 0.6, 1], [poiseEnd, 1, easeIn], [1, 0],
]));

reach(heronFishing, {
  chain: ['heron.body.neckUpper', 'heron.body.neckUpper.neckLower'],
  lengths: NECK,
  target: (t, frame) => {
    const rest = frame.point(heronFishing.find('neckLower')!, HEAD);
    const k = channelAt(dip, t);
    const back = channelAt(anticipate, t);
    return [
      rest[0] + (STRIKE_AT[0] - rest[0]) * k + back * 14,
      rest[1] + (STRIKE_AT[1] - rest[1]) * k - back * 6,
    ];
  },
  bend: 1,
  samples: 240,
});
// The recoil rings after the neck is back up.
heronFishing.part('neckUpper').animate({
  rotate: beats.duringAdditive('settle', spring(RECOIL)),
});

// --- the fish gets away ------------------------------------------------------

// The flight is authored over the leap; the swim back to the start happens
// under the water, where nothing can see it, so the loop closes honestly.
const AFTER = beats.span('plunge', 'settle');
const leapEnd = (LEAP.to - LEAP.from) / (AFTER.to - AFTER.from);
const back = leapEnd + 0.08;
heronFishing.part('fish').animate({
  x: within(AFTER, keys([[0, 0], [leapEnd, -96], [back, -96, easeInOut], [1, 0]])),
});
heronFishing.part('lift').animate({
  y: within(LEAP, keys([[0, 0, easeOut], [0.5, -108, easeIn], [1, 0]])),
});
heronFishing.part('spin').animate({
  rotate: within(AFTER, keys([[0, 40, easeOut], [leapEnd / 2, 0, easeIn], [leapEnd, -50], [back, -50], [back + 0.02, 40], [1, 40]])),
});
heronFishing.part('squash').animate({
  scaleX: within(AFTER, keys([
    [0, 1.35, easeOut], [leapEnd * 0.18, 1, easeIn], [leapEnd * 0.5, 1, easeOut], [leapEnd * 0.85, 1],
    [leapEnd, 0.7], [back, 0.7], [back + 0.02, 1.35], [1, 1.35],
  ])),
  scaleY: within(AFTER, keys([
    [0, 0.72, easeOut], [leapEnd * 0.18, 1, easeIn], [leapEnd * 0.5, 1, easeOut], [leapEnd * 0.85, 1],
    [leapEnd, 1.4], [back, 1.4], [back + 0.02, 0.72], [1, 0.72],
  ])),
});

// --- the water answers -------------------------------------------------------

for (let i = 0; i < 3; i++) {
  const b = stagger(RIPPLES, i, 3, { spread: 0.35 });
  // The ring shrinks back to its seed only once it is fully transparent.
  heronFishing.part(`ripples.${i}.ring`).animate({
    scaleX: within(b, keys([[0, 0.2, easeOut], [0.9, 2.8], [0.94, 0.2], [1, 0.2]])),
    scaleY: within(b, keys([[0, 0.2, easeOut], [0.9, 2.8], [0.94, 0.2], [1, 0.2]])),
  });
  heronFishing.part(`ripples.${i}.ring`).animate({
    opacity: within(b, keys([[0, 0], [0.05, 0.9, easeIn], [0.9, 0], [1, 0]])),
  });
}

DROPS.forEach(([dx, dy], i) => {
  const b = stagger(beats.span('plunge', 'recoil'), i, DROPS.length, { spread: 0.25 });
  // Each drop flies, fades, and only then snaps home for the next cycle.
  heronFishing.part(`drops.${i}.drop`).animate({
    x: within(b, keys([[0, 0], [0.85, dx], [0.9, 0], [1, 0]])),
  });
  heronFishing.part(`drops.${i}.drop`).animate({
    y: within(b, keys([[0, 0, easeOut], [0.45, dy, easeIn], [0.85, 10], [0.9, 0], [1, 0]])),
  });
  heronFishing.part(`drops.${i}.drop`).animate({
    opacity: within(b, keys([[0, 0], [0.03, 1], [0.7, 1], [0.85, 0], [1, 0]])),
  });
});

export default heronFishing;
