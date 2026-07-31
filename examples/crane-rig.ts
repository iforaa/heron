/**
 * The Tenfore crane, traced and rigged — the drawing without the performance.
 *
 * Every number here was measured by `heron trace` from icon.png and moved across
 * unchanged. What this file adds is the anatomy, which no tracer can see: which
 * run is a thigh, where the hip is, which end of the wing is the shoulder. That
 * is the whole split the library exists for — the pixels say where the ink is,
 * and a person says which ink is a leg.
 *
 * It lives apart from any one scene because the anatomy is not a performance.
 * A walk, a run, a run down a flight of stairs are three timelines over the same
 * bird, and the measurements have no business being retyped for each of them.
 *
 * Three decisions the trace could not make, and why they went this way:
 *
 *   - THE RING IS GONE. It reads as a frame around a still mark, and a frame is
 *     exactly what a walk does not want: the bird strides while the ring holds
 *     it in place, so the eye reads a bird trapped in a hoop rather than one
 *     going somewhere. Dropped for animation; the icon keeps it.
 *
 *   - THE TUCK IS A POSE, NOT ANATOMY. The mark shows a heron standing on one
 *     leg with the other drawn up. A one-legged bird cannot walk, so the second
 *     leg is the measured leg again, shifted across the body and tinted back.
 *
 *   - AND THE TUCKED LEG GOES WITH IT. Every run that drew it is dropped — the
 *     shin (s8) and the folded pod below it (s7, s10, s11, s15, s17, s18), which
 *     is the thigh doubled back with the toes inside. It looks like a leaf, and
 *     leaving it in gave the bird a third leg standing frozen while the other
 *     two walked. A pose has to be removed whole; half of one is scenery that
 *     never agrees with the motion.
 *
 * Joints are measured, not guessed. The hip and knee sit on forks that `trace`
 * reported at (509, 579) and (504, 738), and the floor is the lowest ink in the
 * reference, at y=975.
 */

import { character, part, ribbon, path, keys, type Character, type Vec2 } from '../src/index.ts';

export const INK = '#3ba064';
// Two legs in one colour read as one leg. A lighter tint is the cheapest depth
// cue the mark can afford without introducing a second hue.
export const FAR = '#8fc7a8';

export const HIP: Vec2 = [508.9, 578.4];
export const KNEE: Vec2 = [505.1, 737.2];
export const ANKLE: Vec2 = [507.5, 943];
export const GROUND = 975;

/** How far the far leg sits across and behind the near one. */
export const ACROSS = 52;
export const BEHIND = -5;

export const SEGMENTS: [number, number] = [KNEE[1] - HIP[1], ANKLE[1] - KNEE[1]];

/** Bounds of the bird's own ink over a full stride, from `heron inspect`. */
export const BIRD: { x0: number; y0: number; x1: number; y1: number } =
  { x0: 123, y0: -36, x1: 951, y1: 1014 };

// --- runs, measured ----------------------------------------------------------

const THIGH_P: Vec2[] = [[508.9,578.4],[508.8,580.6],[508.7,582.4],[508.5,586.3],[508.3,592.2],[508.2,593.1],[508.2,594.3],[508,678.6],[508.1,679.8],[509.9,690.4],[511.1,695.8],[505.1,737.2]];
const THIGH_W = [20.9,20.4,19.9,19.1,18,17.8,17.6,17.3,17.5,19.1,20.1,21.8];
const SHIN_P: Vec2[] = [[505.1,737.2],[506.5,742.7],[508.1,752.3],[508.2,753.2],[509,760.7],[509,761.7],[507.5,932.3],[507.5,943],[509.9,949.2]];
const SHIN_W = [21.8,20.4,18.9,18.8,18.1,18.1,19.3,21.4,22.3];
const FOOT_P: Vec2[] = [[507.5,943],[509.9,949.2],[511.1,950.5],[512.1,951.3],[515.1,953],[516.4,953.5],[521.2,954.6],[525.7,955],[527.6,955],[534.6,954.9],[545.5,954.2],[557.4,953.7],[569.3,954.6]];
const FOOT_W = [21.4,22.3,22.4,22.5,22.4,22.4,22,21.5,21.2,20.3,18.7,16.5,13.3];
const FOOT_PAD = 'M 471 935 c -23 5 -32 8 -37 14 -8 7 0 15 19 20 8 3 28 6 33 6 2 0 6 -3 13 -10 l 10 -10 -10 -11 -10 -10 -7 0 c -4 0 -9 1 -11 1 z';

/**
 * One leg, drawn from the measured run.
 *
 * Both legs are built from the same coordinates and the far one is *moved* by
 * its own transform, rather than by rewriting every number in it. The wrapper
 * part is free to carry that offset because a gait only ever animates the
 * thigh, shin and foot inside it.
 *
 * The alternative — adding dx, dy to each point — also meant translating a
 * potrace `d` string by hand, which is a regex that happens to work only because
 * potrace writes one absolute moveto and then relative curves. Letting the
 * matrix do it removes that assumption, and it carries the pivots and the
 * contact point along for free.
 */
function leg(name: string, tint: string): void {
  part(name, () => {
    part('thigh', { pivot: HIP }, () => {
      ribbon(THIGH_P, THIGH_W, { fill: tint });
      part('shin', { pivot: KNEE }, () => {
        ribbon(SHIN_P, SHIN_W, { fill: tint });
        part('foot', { pivot: ANKLE, contact: [ANKLE[0], GROUND] }, () => {
          ribbon(FOOT_P, FOOT_W, { fill: tint });
          path({ d: FOOT_PAD, fill: tint });
        });
      });
    });
  });
}

/**
 * Declares the whole bird into the surrounding `character()`: a `body` holding
 * both legs, the torso, a hinged wing, and a neck carrying the head.
 */
export function craneRig(palette: { ink?: string; far?: string } = {}): void {
  const ink = palette.ink ?? INK;
  const far = palette.far ?? FAR;
  part('body', { pivot: [500, 470] }, () => {
    // Behind the torso, so it reads as the far side.
    leg('legFar', far);

    ribbon([
      [363.4, 378.1], [364.9, 378.2], [367, 378.1], [371.6, 377.7], [374.6, 377.2], [378.9, 376.2],
      [381.6, 375.3], [385.7, 373.7], [387.7, 372.9], [390.6, 371.5], [406, 363], [424.2, 354.2],
      [440.8, 349.7], [442.8, 349.3], [448.6, 348.5], [450.2, 348.3], [456.1, 347.8], [461.8, 347.6],
      [463.2, 347.6], [465.3, 347.6], [471, 347.8], [476.9, 348.2], [477.8, 348.3], [479.3, 348.5],
      [484.1, 349.1], [486.1, 349.5], [499.9, 352.4], [504.7, 353.7], [511, 355.7], [517.8, 358.2],
      [527.7, 362.5], [536.6, 366.8], [540.9, 369.1], [554.8, 377.3], [582.8, 398.2], [610.9, 425.1],
      [630.9, 448], [646.9, 469.1], [672.1, 508.9], [689.2, 542.3], [707.1, 584.5], [712.1, 598.5],
      [716, 611.6],
    ], [
      22.9, 22.1, 21.1, 19.4, 18.7, 18,
      17.7, 17.7, 17.7, 17.8, 18.1, 18,
      17.9, 17.9, 17.9, 17.9, 17.9, 18,
      18, 18, 18, 18, 18, 18,
      18.1, 18.1, 18.1, 18.1, 18.2, 18.2,
      18.2, 18.2, 18.2, 18.2, 18.2, 18.2,
      18.1, 18.1, 18.2, 17.9, 18.1, 18.1,
      18.3,
    ], { fill: ink });

    ribbon([
      [302.3, 410.9], [302.6, 414.2], [305.9, 433], [312.5, 452.8], [324.5, 475.6], [337.7, 493.2],
      [354.6, 510.5], [365.6, 519.5], [375.5, 526.7], [395.9, 539.2], [422.9, 552.2], [425.8, 553.5],
      [435.5, 557.3], [442.7, 559.9], [463.1, 566.3], [482.8, 571.7], [487.5, 573], [492.5, 574.3],
      [495.3, 575], [496.1, 575.2], [497.4, 575.5], [499.1, 575.9], [501.2, 576.3], [502.3, 576.6],
      [505.2, 577.1], [507.2, 577.5], [511.2, 578.1], [518.6, 578.6], [519.7, 578.7], [525.3, 578.4],
      [534.3, 576.6], [542.6, 573.7], [542.8, 573.6], [543.1, 573.6], [540.7, 575],
    ], [
      18.1, 18.1, 18.2, 18.2, 18.2, 18.2,
      18.2, 18.2, 18.2, 18.1, 18.1, 18.1,
      18.2, 18.3, 18.5, 17.9, 17.6, 17.4,
      17.3, 17.3, 17.3, 17.3, 17.3, 17.3,
      17.4, 17.6, 17.9, 19.1, 19.3, 20.7,
      23.7, 26.8, 26.8, 26.6, 24.2,
    ], { fill: ink });

    // The folded wing, given a pivot at its root so it can flap. In the mark
    // it is one static stroke down the flank; the joint is the only thing
    // added here, and it is where the wing actually leaves the shoulder.
    part('wing', { pivot: [406, 428] }, () => {
      ribbon([
        [400.5, 421.9], [408, 443.3], [414.7, 456.1], [427.3, 474.4], [437.5, 486], [454.4, 501.6],
        [472.4, 515], [494, 526.3], [528.1, 546.8], [533.8, 552], [534.8, 552.9], [539.2, 557.2],
        [541, 558.9], [544.5, 562.1], [547.8, 564.9], [549.4, 566.2], [551.1, 567.4], [554.8, 569.7],
        [555.8, 570.3], [559.1, 571.8], [560.2, 572.2], [565.7, 573.9], [569.6, 574.8], [573.6, 575.5],
        [578.5, 576.2], [579.9, 576.3], [584, 576.8], [588.9, 577.4], [590.3, 577.5], [595.1, 578.2],
        [596.4, 578.4], [599.3, 578.8], [603.1, 579.4], [604.4, 579.6], [610.9, 580.5], [612.2, 580.7],
        [613.4, 580.9], [617.9, 581.4], [619.2, 581.6], [629.7, 582.5], [630.8, 582.6], [632.8, 582.7],
        [639, 583.2], [652.8, 584.2],
      ], [
        18, 18.1, 18.3, 18.3, 18.2, 18.2,
        18.3, 17.5, 20, 21.9, 22.3, 24.1,
        24.9, 26.5, 27.9, 28.5, 29, 29.9,
        30.1, 30.5, 30.6, 30.5, 30.2, 29.7,
        28.9, 28.7, 28, 27.2, 27, 26.3,
        26.1, 25.7, 25.2, 25, 24.3, 24.1,
        24, 23.4, 23.3, 22, 21.8, 21.5,
        20.7, 18.6,
      ], { fill: ink });
    });

    part('neck', { pivot: [340, 396] }, () => {
      ribbon([
        [428.4, 221.3], [414.8, 249.2], [376.7, 310.8], [369.8, 323.9], [368.9, 325.6], [365.4, 333.5],
        [362, 342.3], [360.8, 345.9], [360.1, 348.7], [359.3, 351.4], [358.9, 353.1], [358.5, 355.1],
        [357.8, 359.5], [357.6, 361.1], [357.5, 368.2], [357.7, 369.5], [358, 371.2], [359, 374.5],
        [360, 376.7], [360.5, 377.7], [361.3, 378.9], [362.5, 380.6],
      ], [
        17.8, 17.8, 18, 17.9, 17.8, 17.6,
        17.5, 17.5, 17.5, 17.5, 17.6, 17.6,
        17.9, 18, 19.2, 19.5, 20, 21.2,
        22.3, 22.8, 23.6, 24.7,
      ], { fill: ink });

      ribbon([
        [377.1, 225.1], [342.8, 276.7], [330.7, 297.4], [317.9, 324.4], [308, 353.3], [302.8, 380.9],
        [302.4, 384.1], [301.8, 398], [302.3, 410.9], [302.6, 414.2], [305.9, 433],
      ], [
        18, 17.9, 17.8, 17.9, 17.8, 17.9,
        17.9, 18, 18.1, 18.1, 18.2,
      ], { fill: ink });

      part('head', { pivot: [402, 223] }, () => {
        ribbon([
          [260.6, 63.8], [264.7, 66.1], [267, 67.3], [268.8, 68.3], [271, 69.5], [272.1, 70.1],
          [273.4, 70.8], [274.5, 71.4], [276.7, 72.6], [277.8, 73.3], [279.1, 74], [280.1, 74.7],
          [282.3, 76.1], [283.4, 76.8], [297, 87], [334.6, 110.6], [335.7, 110.9], [337.9, 111.4],
          [341, 111.9], [341.9, 112], [343.1, 112.2], [355.8, 112.6], [362.8, 112.4], [376.7, 112.4],
          [378.8, 112.5], [380.3, 112.6], [385.3, 113.1], [387.3, 113.4], [394.4, 115], [397.3, 116],
          [401, 117.4], [408.8, 121.6], [422.8, 134.2], [430.5, 146.3], [433.1, 152.2], [433.8, 154.1],
          [434.4, 156], [435, 157.7], [435.7, 160.6], [436.2, 162.8], [436.9, 166.6], [437.2, 168.2],
          [437.7, 174.5], [437.8, 176.1], [437.8, 179], [437.7, 180.5], [437.2, 187.9], [437, 189.5],
          [436.5, 193.2], [436.1, 195.1], [435.9, 196.6], [435.3, 199.4], [434.8, 201.4], [434, 204.6],
          [433.3, 207.2], [428.9, 220.1], [428.4, 221.3], [414.8, 249.2], [376.7, 310.8],
        ], [
          18.8, 19.7, 20.3, 20.7, 21.2, 21.4,
          21.7, 21.9, 22.4, 22.7, 23, 23.2,
          23.7, 24, 27.2, 28.3, 28.1, 27.5,
          26.7, 26.5, 26.1, 22.3, 20.5, 18.3,
          18.2, 18.1, 17.9, 17.9, 17.9, 17.9,
          18, 18.2, 18.5, 18.3, 18.2, 18.2,
          18.1, 18.1, 18, 18, 17.9, 17.9,
          17.9, 17.9, 17.8, 17.8, 17.8, 17.8,
          17.8, 17.8, 17.8, 17.8, 17.8, 17.8,
          17.8, 17.8, 17.8, 17.8, 18,
        ], { fill: ink });

        ribbon([
          [338, 112.4], [338.5, 115.6], [338.7, 117.1], [339, 119.2], [340.4, 126.9], [341.1, 129.8],
          [342.3, 134.1], [344.4, 139.7], [345.8, 142.5], [347.3, 145.2], [352.5, 152.5], [368.2, 167.3],
          [380.1, 178.1], [382.9, 181.9], [383.9, 183.5], [385.1, 186.1], [386.4, 190.7], [386.8, 193.3],
          [386.8, 194.6], [386.7, 199.1], [386.6, 200.4], [386.3, 202.1], [386.1, 203.4], [385.7, 205.1],
          [384.6, 209.2], [382.3, 215], [377.1, 225.1], [342.8, 276.7], [330.7, 297.4],
        ], [
          29.7, 26.9, 25.7, 24.3, 20.5, 19.6,
          18.7, 18.2, 18.2, 18.1, 18.3, 18.8,
          18.5, 18.4, 18.3, 18.2, 18.1, 18,
          18, 17.9, 17.9, 17.9, 17.9, 17.8,
          17.8, 17.9, 18, 17.9, 17.8,
        ], { fill: ink });
      });
    });

    leg('legNear', ink);
  });
}

/**
 * Moves the far leg across and behind the near one.
 *
 * It has to be a (constant) track rather than a static offset because a part
 * carries no transform of its own — the only way to move one is to animate it.
 *
 * `of` names which bird, for a scene holding more than one.
 */
export function offsetFarLeg(ch: Character, of = ''): void {
  ch.part(of ? `${of}.legFar` : 'legFar').animate({
    x: keys([[0, ACROSS], [1, ACROSS]]),
    y: keys([[0, BEHIND], [1, BEHIND]]),
  });
}

/** The bird alone, in its measured coordinates. Used by the single-cycle scenes. */
export function craneAlone(name: string, duration: number): Character {
  return character(
    name,
    { viewBox: [BIRD.x0, BIRD.y0, BIRD.x1 - BIRD.x0, BIRD.y1 - BIRD.y0], duration, ground: GROUND },
    craneRig,
  );
}
