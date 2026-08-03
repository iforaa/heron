/**
 * Traced from crane-golf-icon.png by `heron trace`.
 *
 * GEOMETRY IS MEASURED. ANATOMY IS NOT. This file renders, but it cannot move:
 * every run of ink is a sibling in one flat layer, so there is no leg to rotate.
 * Finish it in this order — the order matters, and skipping ahead is how scenes
 * end up quietly wrong.
 *
 *   1. Check the trace before touching it:
 *        heron match crane-golf-traced.ts crane-golf-icon.png
 *      Overlap should already be high. If it is not, re-run `heron trace` with a
 *      different --epsilon or --threshold rather than hand-editing points.
 *
 *   2. See which run is which before grouping anything:
 *        heron shapes crane-golf-traced.ts
 *      One cell per run, lit up inside the whole drawing. Do not skip this and
 *      work from the boxes below instead — a box around a folded limb and a box
 *      around a leaf are the same rectangle, and guessing here is how a bird
 *      ends up with a third leg that never moves.
 *
 *   3. Group the strokes into named parts, nesting them the way the body is
 *      jointed: a shin lives inside a thigh, so it follows when the thigh turns.
 *      Keep the numbers below exactly as they are while you do this. They were
 *      measured; anything you retype by eye is a guess re-entering the file.
 *
 *   4. Give every moving part a `pivot`, at the joint's coordinate in this same
 *      space. A pivot is a position, not an offset.
 *
 *   5. Set `ground` on the character to the y of the floor, or the contact
 *      lints cannot run at all.
 *
 *   6. Only then animate, and re-run `heron match` afterwards to confirm the
 *      rest pose still matches the reference.
 *
 * Two things this trace could not know, and you must decide:
 *   - Strokes that overlap in the drawing are separate runs here. Some belong to
 *     one part; some are the seam between two.
 *   - A pose is not anatomy. If the reference shows a limb tucked or hidden, it
 *     still needs to exist as a part before it can move.
 *
 * CANDIDATE JOINTS. These are where the skeleton forks, which is where one run
 * of ink leaves another — so they are the best guess the pixels can offer at
 * where the joints are, and they are measured rather than eyeballed. Treat them
 * as suggestions: the drawing decides what is actually a joint.
 *
 *   (338, 113)  (364, 379)  (545, 570)  (509, 579)  (512, 695)  (504, 738)  (433, 804)  (447, 878)  (437, 890)  (508, 954)
 *
 * Lines below marked `// !` are things the trace noticed but could not resolve.
 * Read every one before animating.
 */

import { character, layer, arc, line, ribbon, path, type Character } from '../src/index.ts';

const INK = '#3ba064';

export const craneGolfIcon: Character = character(
  'craneGolfIcon',
  {
    viewBox: [0, 0, 1024, 1024],
    duration: 1,
    // ground: 1023,   // <- the floor's y, once you know where the feet are
  },
  () => {
    // Declaration order is z-order. Longest run first; reorder as needed.
    layer('art', () => {
      // s0  box [437 68 872 789]  length 1225px  width 35.2
      //   a circle, within 0.7px over 185 degrees, fitted
      //   from 39 corrected samples.
      arc({ cx: 513.1, cy: 427.7, r: 359.2, from: -102.2, to: 83.1, stroke: INK, width: 35.2 });

      // s1  box [154 153 382 762]  length 786px  width 35.2
      //   a circle, within 0.5px over 119 degrees, fitted
      //   from 24 corrected samples.
      arc({ cx: 512.9, cy: 427.9, r: 359, from: -129.9, to: -248.6, stroke: INK, width: 35.2 });

      // s2  box [302 113 543 578]  length 711px  width 35.2
      //   width snapped from 35.1 to the shared pen weight 35.2
      // ! turns sharply at (545, 570)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      //   width runs 34.6 to 57.8, so this is a measured profile rather than one number.
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

      // s3  box [364 348 716 611]  length 518px  width 35.2
      //   width snapped from 35.1 to the shared pen weight 35.2
      //   width runs 35.7 to 45.7, so this is a measured profile rather than one number.
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

      // s4  box [260 64 438 381]  length 477px  width 35.1
      // ! turns sharply at (358, 375)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      //   width runs 35.3 to 58.9, so this is a measured profile rather than one number.
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

      // s5  box [400 422 653 584]  length 329px  width 35.8
      //   width runs 35.5 to 57.7, so this is a measured profile rather than one number.
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

      // s6  box [505 737 569 956]  length 284px  width 35.2
      //   width snapped from 35.3 to the shared pen weight 35.2
      //   width runs 26.2 to 46, so this is a measured profile rather than one number.
      ribbon([
        [505.3, 737.1], [506.9, 742.9], [509.1, 760.9], [509.2, 761.8], [508.6, 931.5], [508, 942.6],
        [509.9, 949.2], [510.9, 950.6], [511.8, 951.6], [514.5, 953.5], [515.7, 954.1], [524.7, 955.8],
        [545.2, 954.3], [569.4, 954.4],
      ], [
        22.2, 19.9, 17.9, 17.9, 19, 21.5,
        22.7, 22.9, 23, 23, 23, 22,
        18.7, 13.1,
      ], { fill: INK });

      // s7  box [398 803 441 907]  length 167px  width 35.2
      // ! turns sharply at (405, 907)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      //   width runs 34.6 to 43.2, so this is a measured profile rather than one number.
      ribbon([
        [432.6, 803.3], [422.1, 806.9], [417.5, 810.4], [410.4, 821.5], [399, 866.1], [397.7, 874.4],
        [400.1, 897.9], [401.8, 900.7], [405.8, 904.8], [416.9, 907.3], [425.7, 904], [426.8, 903.3],
        [436, 895.4], [441.2, 889.5],
      ], [
        21.6, 19.8, 19, 17.6, 18, 18.5,
        19.8, 19.9, 19.8, 19.3, 18.6, 18.6,
        17.8, 17.3,
      ], { fill: INK });

      // s8  box [506 635 598 739]  length 154px  width 35.2
      //   width snapped from 35.8 to the shared pen weight 35.2
      //   width runs 35.4 to 44.3, so this is a measured profile rather than one number.
      ribbon([
        [598.3, 634.7], [541.8, 687.7], [539.5, 688.4], [531.4, 691.1], [523.9, 694.7], [518.8, 698.3],
        [516.9, 700.1], [511.4, 707.8], [508, 716.9], [506.2, 727.8], [505.8, 739.1],
      ], [
        17.7, 18.1, 18.6, 20.3, 21.6, 22.1,
        22.1, 21.9, 21.3, 21, 21.4,
      ], { fill: INK });

      // s9  box [508 579 511 695]  length 118px  width 35.2
      //   width snapped from 35.3 to the shared pen weight 35.2
      //   a straight line, within 1.1px over its whole length
      line({ from: [508.9, 578.9], to: [510.3, 695.4], stroke: INK, width: 35.2 });

      // s10  box [432 738 504 804]  length 108px  width 35.2
      //   width snapped from 35.8 to the shared pen weight 35.2
      //   width runs 33.2 to 45, so this is a measured profile rather than one number.
      ribbon([
        [503.9, 737.5], [501.6, 738.1], [490.6, 741.6], [484, 744.4], [481.2, 745.8], [479.2, 746.8],
        [476.3, 748.3], [464.8, 755.9], [441.3, 782.2], [440.2, 784.1], [438.7, 786.8], [435, 795.3],
        [433.9, 798.3], [432.8, 802], [432.2, 804.2],
      ], [
        22.5, 22, 19.7, 18.6, 18.2, 17.9,
        17.6, 16.6, 18, 18.3, 18.6, 20.1,
        20.6, 21.4, 21.8,
      ], { fill: INK });

      // s11  box [434 803 457 880]  length 90px  width 35.2
      //   width snapped from 34.8 to the shared pen weight 35.2
      //   width runs 34.5 to 43.2, so this is a measured profile rather than one number.
      ribbon([
        [433.9, 802.8], [439.8, 809.1], [444.9, 815.8], [445.6, 817], [457.3, 849.2], [456.2, 866],
        [455, 869.9], [451.5, 877.5], [449.9, 880.1],
      ], [
        21.6, 19.8, 18.6, 18.4, 17.3, 17.6,
        17.6, 17.6, 17.5,
      ], { fill: INK });

      // s12  box [446 952 508 954]  length 65px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 471 935 c -23 5 -32 8 -37 14 -8 7 0 15 19 20 8 3 28 6 33 6 2 0 6 -3 13 -10 l 10 -10 -10 -11 -10 -10 -7 0 c -4 0 -9 1 -11 1 z', fill: INK });

      // s13  box [389 73 438 73]  length 50px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 436 58 c -2 1 -8 2 -14 4 -7 1 -13 3 -14 3 -1 0 -7 2 -13 4 -5 2 -10 4 -10 4 0 1 3 3 9 3 9 2 22 6 28 10 2 1 2 1 9 -6 7 -6 7 -6 5 -8 -2 -2 -2 -2 2 -7 4 -4 4 -4 2 -6 -1 -1 -2 -2 -4 -1 z', fill: INK });

      // s14  box [382 755 408 759]  length 28px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 384 746 c -1 2 -2 3 -1 3 0 1 0 2 -1 3 -1 1 -1 1 1 3 1 2 2 3 1 4 -1 0 1 3 5 7 l 7 6 8 -9 9 -9 -3 -1 c -7 -3 -17 -6 -19 -7 -1 0 -2 -1 -3 -1 0 -2 -1 -1 -4 1 z', fill: INK });

      // s15  box [425 870 437 890]  length 25px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 425 870 c -1 1 -2 4 -2 7 -1 8 -7 13 -7 6 0 -2 0 -2 -1 -1 -3 2 -2 4 0 7 2 1 4 1 12 1 8 0 9 0 12 -2 3 -3 3 -3 2 -7 -1 -2 -3 -4 -6 -6 -4 -2 -4 -2 -5 0 -1 2 -2 -1 -2 -4 0 -3 -1 -4 -3 -1 z', fill: INK });

      // s16  box [283 154 301 155]  length 18px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 289 149 c -4 5 -5 6 -4 7 2 1 2 1 1 3 -2 1 -2 2 2 5 l 4 4 6 -5 c 4 -3 7 -6 7 -7 1 0 -1 -3 -4 -6 -3 -3 -6 -6 -6 -6 0 0 -3 2 -6 5 z', fill: INK });

      // s17  box [434 860 438 869]  length 11px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 439 857 c 1 2 1 4 1 5 -1 3 -4 2 -5 -1 -1 -4 -2 -1 -2 6 l -1 7 4 2 c 3 1 3 1 5 -1 4 -3 6 -12 4 -16 -1 -1 -2 -3 -4 -4 l -3 -2 1 4 z', fill: INK });

      // s18  box [424 860 425 870]  length 10px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 424 862 c -1 1 -1 4 -1 6 0 3 0 3 2 2 1 -2 2 -3 1 -5 -1 -4 -2 -5 -2 -3 z', fill: INK });
    });
  },
);

export default craneGolfIcon;
