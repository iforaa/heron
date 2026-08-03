/**
 * The Tenfore crane plays golf.
 *
 * The geometry is `heron trace`d from the app icon (94.7% coverage, ink 1.000x).
 * The retained crane paths keep those measured coordinates; the enclosing ring
 * is removed, an eye/ball/tee are added, and the standing leg is completed
 * behind the crossed stroke so it remains whole when that stroke becomes a
 * moving club. The joke was already in the mark: the tucked leg crosses the
 * standing leg and ends in a leaf, which is to say the bird has been holding a
 * golf club all along. The club's pivot is (598, 635), the measured joint where
 * that leg leaves the body.
 *
 * The bird keeps its head perfectly still through the swing, which is not
 * laziness about rigging the neck: the neck strokes share ink with the chest
 * contour, so bending them would tear the mark — and a motionless head happens
 * to be textbook golf form. All the acting is in the club and one small lean
 * as the crane admires the shot.
 *
 * Impact is a beat boundary, not a guess: the downswing beat ends with the club
 * at its local address angle, while the parent body's small recoil keeps the
 * face crossing the ball. The ball's flight starts on that same boundary.
 * Accelerating easeIn into it is the physics; everything after is follow-through.
 */

import { readFileSync } from 'node:fs';

import {
  arc, character, circle, keys, layer, line, part, path, ribbon,
  score, within,
  easeIn, easeInOut, easeOut, type Character,
} from '../src/index.ts';

const INK = '#3ba064';
const PRODUCTION_INK = '#2C7C4D';

/**
 * The final frame is the asset the mobile app actually ships, not another
 * approximation of it. Reading it at authoring time keeps that file the source
 * of truth; Heron's compiled SVG still embeds the resulting paths and has no
 * runtime dependency on the app repository.
 */
const productionSvg = readFileSync(
  new URL('../../tenfore_crane_rn_template/assets/images/crane-logo.svg', import.meta.url),
  'utf8',
);
const productionPaths = [...productionSvg.matchAll(/<path\s+d="([^"]+)"/g)].map((m) => m[1]);
if (productionPaths.length !== 3) {
  throw new Error(`crane-golf: expected 3 paths in the production logo, found ${productionPaths.length}`);
}

const DURATION = 6.7;

export const beats = score(DURATION, [
  ['address', 1.3],
  ['backswing', 0.8],
  ['top', 0.35],
  ['down', 0.2],
  ['thru', 0.5],
  ['watch', 1.5],
  ['recover', 0.7],
  ['hold', 1.35],
]);

// The ball is struck at the down/thru boundary and stays gone.
const FLIGHT = {
  name: 'flight',
  from: beats.at('thru').from,
  to: beats.at('watch').to,
  seconds: beats.at('thru').seconds + beats.at('watch').seconds,
};

// Ball at the club face's rest position, teed just off the leaf.
const BALL: [number, number] = [383, 872];

export const craneGolf: Character = character(
  'craneGolf',
  // Match the mobile asset's framing so the final dissolve has no camera jump.
  { viewBox: [0, 0, 1024, 1024], duration: DURATION, ground: 960, once: true },
  () => {
    /**
     * s0/s1 and the three small crossing remnants from the measured icon.
     * The ring begins invisible and writes itself back on only after the golfer
     * has recovered, resolving the character performance into the original mark.
     */
    part('ring', () => {
      arc({ cx: 513.1, cy: 427.7, r: 359.2, from: -102.2, to: 83.1, stroke: INK, width: 35.2 });
      arc({ cx: 512.9, cy: 427.9, r: 359, from: -129.9, to: -248.6, stroke: INK, width: 35.2 });
      path({ d: 'M 436 58 c -2 1 -8 2 -14 4 -7 1 -13 3 -14 3 -1 0 -7 2 -13 4 -5 2 -10 4 -10 4 0 1 3 3 9 3 9 2 22 6 28 10 2 1 2 1 9 -6 7 -6 7 -6 5 -8 -2 -2 -2 -2 2 -7 4 -4 4 -4 2 -6 -1 -1 -2 -2 -4 -1 z', fill: INK });
      path({ d: 'M 384 746 c -1 2 -2 3 -1 3 0 1 0 2 -1 3 -1 1 -1 1 1 3 1 2 2 3 1 4 -1 0 1 3 5 7 l 7 6 8 -9 9 -9 -3 -1 c -7 -3 -17 -6 -19 -7 -1 0 -2 -1 -3 -1 0 -2 -1 -1 -4 1 z', fill: INK });
      path({ d: 'M 289 149 c -4 5 -5 6 -4 7 2 1 2 1 1 3 -2 1 -2 2 2 5 l 4 4 6 -5 c 4 -3 7 -6 7 -7 1 0 -1 -3 -4 -6 -3 -3 -6 -6 -6 -6 0 0 -3 2 -6 5 z', fill: INK });
    });

    // Tee and ball live behind the bird, so the club sweeps in front of them.
    // The tee pivots at its base, because it is about to be flipped.
    part('tee', { pivot: [BALL[0], 918] }, () => {
      line({ from: [BALL[0], 886], to: [BALL[0], 916], stroke: INK, width: 10 });
      line({ from: [BALL[0] - 11, 918], to: [BALL[0] + 11, 918], stroke: INK, width: 8 });
    });
    part('ball', { pivot: BALL }, () => {
      circle({ cx: BALL[0], cy: BALL[1], r: 14, fill: 'none', stroke: INK, width: 7 });
    });

    /**
     * Everything that is bird leans together about the standing foot's contact
     * point, so no stroke ever moves relative to another and the mark cannot
     * tear. The club is nested inside, so it rides the lean too.
     */
    part('bird', { pivot: [509, 950] }, () => {
      // The traced standing leg begins at the visible edge of the body. Extend
      // its root underneath the body artwork so leaning never opens a white
      // seam between the torso and the weight-bearing leg.
      line({ from: [509, 552], to: [509, 596], stroke: INK, width: 35.2 });

      // s2: front of the neck, running down into the chest.
      ribbon([
        [338.1, 112.6], [340.9, 126.8], [344.6, 139.6], [345.8, 142.4], [347.2, 145.2], [352.2, 152.7],
        [367.8, 167.8], [383, 182.2], [386.5, 190.9], [386.9, 194.6], [386.6, 200.4], [386.3, 202.1],
        [384.6, 209], [382.3, 215], [376.8, 225.3], [330.8, 297.6], [318, 324.4], [308, 353.3],
        [302.4, 384.1], [301.7, 398], [302.3, 410.9], [306, 433], [312.5, 452.8], [324.5, 475.6],
        [337.6, 493.3], [365.6, 519.5], [395.9, 539.3], [442.5, 560.2], [482.6, 571.8], [497.2, 575.4],
        [499, 575.8], [502.1, 576.4], [505.1, 576.9], [511.3, 577.9], [534.9, 576.9], [542.6, 574.6],
        [539.6, 576.4],
      ], [
        28.9, 20.2, 18.4, 18.4, 18.4, 18.6,
        18.8, 18.3, 18.1, 18, 17.9, 17.9,
        17.9, 17.9, 18.1, 17.9, 17.9, 17.8,
        18, 18.1, 18.1, 18.1, 18.3, 18.2,
        18.3, 18.3, 18.1, 18.2, 17.8, 17.3,
        17.3, 17.3, 17.4, 17.8, 23.1, 25.9,
        23.1,
      ], { fill: INK });

      // s3: the back, neck base to tail tip.
      ribbon([
        [363.5, 378.4], [371.7, 377.9], [378.9, 376.3], [385.7, 373.9], [387.7, 373], [390.6, 371.6],
        [405.9, 362.9], [424, 353.9], [443, 349.1], [449, 348.4], [463, 347.6], [479, 348.5],
        [484, 349.1], [499.9, 352.3], [504.8, 353.7], [527.7, 362.5], [554.8, 377.4], [582.9, 398.1],
        [610.9, 425.1], [646.8, 469.2], [672.1, 508.9], [689.3, 542.2], [707.2, 584.4], [715.9, 611.3],
      ], [
        22.8, 19.6, 18.2, 17.9, 17.9, 18,
        18.2, 17.9, 17.9, 17.9, 18, 18.1,
        18.1, 18.2, 18.2, 18.2, 18.2, 18.2,
        18.3, 18.2, 18.2, 17.9, 18.1, 18.3,
      ], { fill: INK });

      // s4: beak, crest and the back of the neck.
      ribbon([
        [260.2, 63.7], [267, 67.5], [269, 68.6], [271.4, 69.9], [274.3, 71.4], [276.7, 72.8],
        [279.6, 74.3], [282, 75.8], [283.2, 76.4], [297.6, 86.7], [334.8, 110.5], [335.9, 110.8],
        [341, 111.8], [355.7, 112.5], [380.1, 112.6], [385.1, 113.1], [397.3, 116], [401, 117.4],
        [408.7, 121.5], [422.8, 134], [433.3, 152.5], [434.6, 156.2], [435.1, 157.9], [436.3, 162.8],
        [437.7, 174.4], [437.8, 176.1], [437.2, 187.9], [437, 189.5], [436.4, 193.4], [433.3, 207.2],
        [428.3, 221.5], [414.8, 249.3], [376.7, 310.8], [365.5, 333.6], [362.1, 342.3], [359.4, 351.3],
        [359, 353], [357.7, 359.6], [357.5, 361.3], [357.5, 369.5], [357.8, 371.2], [358.9, 374.7],
        [362.4, 380.7],
      ], [
        18.9, 20.5, 20.9, 21.4, 22, 22.5,
        23, 23.5, 23.7, 27, 29.5, 29.2,
        27.9, 23.3, 18.4, 18.1, 18, 18.1,
        18.3, 18.5, 18.2, 18.2, 18.1, 18.1,
        17.9, 17.9, 17.9, 17.9, 17.9, 17.9,
        17.9, 17.8, 18, 17.8, 17.7, 17.6,
        17.7, 17.9, 18.1, 19.4, 19.9, 21.1,
        24.4,
      ], { fill: INK });

      // s5: the belly, chest to tail underside.
      ribbon([
        [400.4, 422.1], [414.6, 456.4], [427.4, 474.5], [437.6, 486], [454.4, 501.6], [472.4, 515],
        [493.6, 526.7], [529.1, 545.6], [534.4, 551.5], [539.1, 557.1], [547.5, 565.6], [549.2, 566.9],
        [578.6, 576.4], [590, 578], [596, 578.8], [611, 580.5], [619.1, 581.3], [630.8, 582.5],
        [652.5, 584.2],
      ], [
        18, 18.3, 18.3, 18.3, 18.3, 18.2,
        17.7, 19.5, 22, 24.6, 28.4, 28.8,
        28.7, 27.2, 26.2, 24.1, 23.1, 21.9,
        18.7,
      ], { fill: INK });

      // s13, s16 and s14 from the trace are gone: they were the slivers where
      // the ring crossed the crest and the beak, and they float once it leaves.

      /**
       * The one addition the icon never had: an eye, in the white pocket the
       * head loop encloses. A dot that blinks is the entire difference between
       * a logo and a character. It squashes about its own centre to blink.
       */
      part('eye', { pivot: [392, 152] }, () => {
        circle({ cx: 392, cy: 152, r: 11, fill: INK });
      });

      // s9, s6: the standing leg, body to foot. The source trace separates
      // these where the crossed stroke covers them. Complete that hidden span
      // before drawing the club so the supporting leg does not break when the
      // club swings away.
      line({ from: [508.9, 578.9], to: [510.3, 695.4], stroke: INK, width: 35.2 });
      ribbon([
        [510.3, 695.4], [508.6, 716.2], [505.3, 737.1],
      ], [
        17.6, 18.2, 22.2,
      ], { fill: INK });
      ribbon([
        [505.3, 737.1], [506.9, 742.9], [509.1, 760.9], [509.2, 761.8], [508.6, 931.5], [508, 942.6],
        [509.9, 949.2], [510.9, 950.6], [511.8, 951.6], [514.5, 953.5], [515.7, 954.1], [524.7, 955.8],
        [545.2, 954.3], [569.4, 954.4],
      ], [
        22.2, 19.9, 17.9, 17.9, 19, 21.5,
        22.7, 22.9, 23, 23, 23, 22,
        18.7, 13.1,
      ], { fill: INK });


      /**
       * The club: the crossed leg, shaft in two measured runs, the leaf as its
       * head, and the leaf's three hatch marks. Pivot at the measured joint
       * where the leg leaves the body.
       */
      part('club', { pivot: [598, 635] }, () => {
        // s8: upper shaft, hip to the crossing.
        ribbon([
          [598.3, 634.7], [541.8, 687.7], [539.5, 688.4], [531.4, 691.1], [523.9, 694.7], [518.8, 698.3],
          [516.9, 700.1], [511.4, 707.8], [508, 716.9], [506.2, 727.8], [505.8, 739.1],
        ], [
          17.7, 18.1, 18.6, 20.3, 21.6, 22.1,
          22.1, 21.9, 21.3, 21, 21.4,
        ], { fill: INK });

        // s10: lower shaft, crossing to the leaf.
        ribbon([
          [503.9, 737.5], [501.6, 738.1], [490.6, 741.6], [484, 744.4], [481.2, 745.8], [479.2, 746.8],
          [476.3, 748.3], [464.8, 755.9], [441.3, 782.2], [440.2, 784.1], [438.7, 786.8], [435, 795.3],
          [433.9, 798.3], [432.8, 802], [432.2, 804.2],
        ], [
          22.5, 22, 19.7, 18.6, 18.2, 17.9,
          17.6, 16.6, 18, 18.3, 18.6, 20.1,
          20.6, 21.4, 21.8,
        ], { fill: INK });

        // s7, s11: the leaf, the club's head.
        ribbon([
          [432.6, 803.3], [422.1, 806.9], [417.5, 810.4], [410.4, 821.5], [399, 866.1], [397.7, 874.4],
          [400.1, 897.9], [401.8, 900.7], [405.8, 904.8], [416.9, 907.3], [425.7, 904], [426.8, 903.3],
          [436, 895.4], [441.2, 889.5],
        ], [
          21.6, 19.8, 19, 17.6, 18, 18.5,
          19.8, 19.9, 19.8, 19.3, 18.6, 18.6,
          17.8, 17.3,
        ], { fill: INK });
        ribbon([
          [433.9, 802.8], [439.8, 809.1], [444.9, 815.8], [445.6, 817], [457.3, 849.2], [456.2, 866],
          [455, 869.9], [451.5, 877.5], [449.9, 880.1],
        ], [
          21.6, 19.8, 18.6, 18.4, 17.3, 17.6,
          17.6, 17.6, 17.5,
        ], { fill: INK });

        // s15, s17, s18: the hatching inside the leaf.
        path({ d: 'M 425 870 c -1 1 -2 4 -2 7 -1 8 -7 13 -7 6 0 -2 0 -2 -1 -1 -3 2 -2 4 0 7 2 1 4 1 12 1 8 0 9 0 12 -2 3 -3 3 -3 2 -7 -1 -2 -3 -4 -6 -6 -4 -2 -4 -2 -5 0 -1 2 -2 -1 -2 -4 0 -3 -1 -4 -3 -1 z', fill: INK });
        path({ d: 'M 439 857 c 1 2 1 4 1 5 -1 3 -4 2 -5 -1 -1 -4 -2 -1 -2 6 l -1 7 4 2 c 3 1 3 1 5 -1 4 -3 6 -12 4 -16 -1 -1 -2 -3 -4 -4 l -3 -2 1 4 z', fill: INK });
        path({ d: 'M 424 862 c -1 1 -1 4 -1 6 0 3 0 3 2 2 1 -2 2 -3 1 -5 -1 -4 -2 -5 -2 -3 z', fill: INK });
      });
    });

    // s12: the ground pad. It is the tee box, not a foot; it stays put.
    layer('pad', () => {
      path({ d: 'M 471 935 c -23 5 -32 8 -37 14 -8 7 0 15 19 20 8 3 28 6 33 6 2 0 6 -3 13 -10 l 10 -10 -10 -11 -10 -10 -7 0 c -4 0 -9 1 -11 1 z', fill: INK });
    });

    /**
     * Exact three-path production artwork, declared last so it can dissolve
     * over the reconstructed animation. Its source coordinates are 0..10240;
     * the constant transform below is the app SVG's own
     * `translate(0,1024) scale(0.1,-0.1)`.
     */
    part('productionLogo', { pivot: [0, 0] }, () => {
      for (const d of productionPaths) path({ d, fill: PRODUCTION_INK });
    });
  },
);

// --- the swing ---------------------------------------------------------------

const club = craneGolf.part('bird.club');

const address = beats.at('address');
const backswing = beats.at('backswing');
const top = beats.at('top');
const down = beats.at('down');
const thru = beats.at('thru');
const watch = beats.at('watch');
const recover = beats.at('recover');
const hold = beats.at('hold');

/** A moment inside a beat, as a cycle fraction. */
const at = (b: { from: number; to: number }, u: number) => b.from + (b.to - b.from) * u;

// The final logo resolution occupies the first two-thirds of the hold, leaving
// a clean still of the restored mark at the end.
const LOGO_RETURN = {
  name: 'logoReturn',
  from: hold.from,
  to: at(hold, 2 / 3),
  seconds: hold.seconds * 2 / 3,
};

const PRODUCTION_LOCKUP = {
  name: 'productionLockup',
  from: LOGO_RETURN.to,
  // A decimal score can accumulate a few ulps past 1; the cycle boundary is
  // exact and `within()` deliberately refuses anything outside it.
  to: 1,
  seconds: hold.seconds / 3,
};

craneGolf.part('ring').animate({
  draw: within(LOGO_RETURN, keys([[0, 0, easeOut], [1, 1]])),
  opacity: within(LOGO_RETURN, keys([[0, 0], [0.15, 1], [1, 1]])),
});

// A literal path morph is not valid here: the performed crane is many traced
// strokes while the app mark is three compound filled paths with unrelated
// command topology. A matched dissolve preserves both drawings and, crucially,
// leaves the exact production vectors in the final frame.
const dissolveOut = within(PRODUCTION_LOCKUP, keys([[0, 1, easeInOut], [1, 0]]));
craneGolf.part('ring').animate({ opacity: dissolveOut });
craneGolf.part('bird').animate({ opacity: dissolveOut });
craneGolf.part('pad').animate({ opacity: dissolveOut });

craneGolf.part('productionLogo').animate({
  x: keys([[0, 0], [1, 0]]),
  y: keys([[0, 1024], [1, 1024]]),
  scaleX: keys([[0, 0.1], [1, 0.1]]),
  scaleY: keys([[0, -0.1], [1, -0.1]]),
  opacity: within(PRODUCTION_LOCKUP, keys([[0, 0, easeInOut], [1, 1]])),
});

/**
 * The whole swing is one channel. Sequential poses layered as separate
 * channels would each hold their end values outside their own windows and the
 * rest pose would sum to nonsense — one gesture, one track.
 *
 * Waggle at address, backswing up, a held top, then easeIn accelerating into
 * impact: the downswing ends at exactly 0 in the club's local track, so the
 * strike is the beat boundary. The follow-through is still moving at ball
 * speed as the face passes the tee, brakes past it, holds while the crane
 * watches, and eases home.
 */
club.animate({
  rotate: keys([
    [0, 0, easeInOut],
    [at(address, 0.28), -3, easeInOut],
    [at(address, 0.5), 2, easeInOut],
    [address.to, 0, easeInOut],
    // Negative is the backswing side: the shaft slides along the crossing the
    // mark already has, and the leaf cocks behind the standing leg.
    [backswing.to, -125, easeInOut],
    // The tremble at the top: holding a heavy club with one leg's worth of
    // conviction. Three tiny oscillations before commitment.
    [at(top, 0.25), -122.5, easeInOut],
    [at(top, 0.5), -126.5, easeInOut],
    [at(top, 0.75), -123, easeInOut],
    [top.to, -125, easeIn],
    [down.to, 0],
    // Overswung through impact, then a wobble as the follow-through arrives
    // somewhere the golfer did not entirely plan.
    [at(thru, 0.3), 44, easeOut],
    [thru.to, 68],
    [at(watch, 0.1), 59, easeInOut],
    [at(watch, 0.24), 66, easeInOut],
    [at(watch, 0.38), 62, easeInOut],
    [watch.to, 62, easeInOut],
    [recover.to, 0],
    [1, 0],
  ]),
});

// --- the ball ----------------------------------------------------------------

/**
 * Off the tee at impact, rising left, shrinking as it goes: distance played as
 * scale, so the ball never has to leave the viewBox to read as gone.
 */
craneGolf.part('ball').animate({
  x: within(FLIGHT, keys([[0, 0, easeOut], [1, -300]])),
  y: within(FLIGHT, keys([[0, 0, easeOut], [0.75, -395, easeInOut], [1, -370]])),
  scaleX: within(FLIGHT, keys([[0, 1], [1, 0.3]])),
  scaleY: within(FLIGHT, keys([[0, 1], [1, 0.3]])),
  opacity: within(FLIGHT, keys([[0, 1], [0.88, 1, easeIn], [1, 0]])),
});

// --- the admiring lean -------------------------------------------------------

/**
 * The body is where the comedy lives: a settle-in shimmy at address, a coil
 * into the backswing, an uncoiling overshoot through impact, then a lean
 * toward the departed ball.
 */
craneGolf.part('bird').animate({
  rotate: keys([
    [0, 0, easeInOut],
    [at(address, 0.55), 0, easeInOut],
    [at(address, 0.68), 1.8, easeInOut],
    [at(address, 0.81), -1.8, easeInOut],
    [at(address, 0.93), 1.2, easeInOut],
    [address.to, 0, easeInOut],
    [backswing.to, 4, easeInOut],
    [top.to, 4, easeIn],
    [down.to, -1.5],
    [at(thru, 0.4), -2.5, easeInOut],
    [watch.from, -2.5, easeInOut],
    [at(watch, 0.35), -5],
    [recover.from, -5, easeInOut],
    [recover.to, 0],
    [1, 0],
  ]),
});

/**
 * Impact recoil, then two happy bounces while the ball flies. A one-legged
 * bird that just hit a golf ball is allowed to be pleased about it.
 */
craneGolf.part('bird').animate({
  y: keys([
    [0, 0],
    [thru.from, 0, easeOut],
    [at(thru, 0.25), -16, easeIn],
    [at(thru, 0.6), 0, easeOut],
    [at(watch, 0.2), 0, easeOut],
    [at(watch, 0.34), -24, easeIn],
    [at(watch, 0.48), 0, easeOut],
    [at(watch, 0.6), -11, easeIn],
    [at(watch, 0.72), 0],
    [1, 0],
  ]),
});

/** Blinks: one of concentration at address, one of satisfaction after. */
craneGolf.part('bird.eye').animate({
  scaleY: keys([
    [0, 1],
    [at(address, 0.38), 1], [at(address, 0.44), 0.12], [at(address, 0.52), 1],
    [at(watch, 0.75), 1], [at(watch, 0.81), 0.12], [at(watch, 0.89), 1],
    [1, 1],
  ]),
});
craneGolf.part('bird.eye').animate({
  opacity: within(LOGO_RETURN, keys([[0, 1, easeIn], [0.3, 0], [1, 0]])),
});

/**
 * The tee does not survive the strike: it flips away end over end and lands
 * lying flat. -630 is two spins minus a quarter, which is what lying down is.
 */
const TOSS = {
  name: 'toss',
  from: thru.from,
  to: at(watch, 0.45),
  seconds: thru.seconds + watch.seconds * 0.45,
};
craneGolf.part('tee').animate({
  rotate: within(TOSS, keys([[0, 0, easeOut], [1, -630]])),
  x: within(TOSS, keys([[0, 0, easeOut], [1, -95]])),
  y: within(TOSS, keys([[0, 0, easeOut], [0.55, -70, easeIn], [1, 34]])),
});
craneGolf.part('tee').animate({
  opacity: within(LOGO_RETURN, keys([[0, 1, easeIn], [0.3, 0], [1, 0]])),
});

export default craneGolf;
