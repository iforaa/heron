/**
 * Traced from tenfore-icon.png by `heron trace`.
 *
 * GEOMETRY IS MEASURED. ANATOMY IS NOT. This file renders, but it cannot move:
 * every run of ink is a sibling in one flat layer, so there is no leg to rotate.
 * Finish it in this order — the order matters, and skipping ahead is how scenes
 * end up quietly wrong.
 *
 *   1. Check the trace before touching it:
 *        heron match tenfore-traced.ts tenfore-icon.png
 *      Overlap should already be high. If it is not, re-run `heron trace` with a
 *      different --epsilon or --threshold rather than hand-editing points.
 *
 *   2. Group the strokes into named parts, nesting them the way the body is
 *      jointed: a shin lives inside a thigh, so it follows when the thigh turns.
 *      Keep the numbers below exactly as they are while you do this. They were
 *      measured; anything you retype by eye is a guess re-entering the file.
 *
 *   3. Give every moving part a `pivot`, at the joint's coordinate in this same
 *      space. A pivot is a position, not an offset.
 *
 *   4. Set `ground` on the character to the y of the floor, or the contact
 *      lints cannot run at all.
 *
 *   5. Only then animate, and re-run `heron match` afterwards to confirm the
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

export const tenforeTraced: Character = character(
  'tenforeTraced',
  {
    viewBox: [0, 0, 1024, 1024],
    duration: 1,
    // ground: 1023,   // <- the floor's y, once you know where the feet are
  },
  () => {
    // Declaration order is z-order. Longest run first; reorder as needed.
    layer('art', () => {
      // s0  box [438 68 872 790]  length 1225px  width 35.2
      //   width runs 25.5 to 37.3, so this is a measured profile rather than one number.
      ribbon([
        [437.6, 74.1], [441.7, 75.6], [445.1, 75.2], [477.1, 70.2], [502, 68.7], [516, 68.2],
        [549.9, 70.6], [575.1, 73.9], [583.9, 75.5], [616.8, 83.7], [654.7, 97.6], [688.8, 114.4],
        [715.8, 131.3], [745.9, 154.1], [778, 185], [813, 230], [830.9, 260.1], [848.6, 299.7],
        [859, 330.7], [867.8, 371.9], [872, 413], [872, 441], [868, 482.1], [859.3, 523.3],
        [847.6, 558.2], [833.4, 590.2], [813.5, 624.3], [798.5, 645.4], [767.3, 681.3], [745.4, 701.5],
        [715.3, 724.4], [691.3, 739.5], [666.3, 752.5], [629.2, 767.7], [595.2, 777.4], [589.1, 778.7],
        [563.2, 782.9], [561.3, 783.2], [558, 789.5],
      ], [
        16.3, 18.6, 18.3, 18, 18.6, 17.8,
        18.4, 17.6, 18.3, 18.1, 18.1, 18.1,
        18.1, 18.4, 18.4, 18.1, 18.1, 18,
        18, 18.1, 18.1, 18, 18, 17.7,
        18, 17.7, 17.7, 17.9, 17.9, 17.9,
        17.7, 17.8, 17.6, 17.9, 17.7, 18.1,
        18, 16.1, 12.8,
      ], { fill: INK });

      // s1  box [154 154 383 761]  length 786px  width 35.2
      //   a circle, within 0.4px over 118 degrees, fitted
      //   from 24 corrected samples.
      arc({ cx: 513.5, cy: 427.5, r: 359.6, from: -130.2, to: -248.5, stroke: INK, width: 35.2 });

      // s2  box [302 113 545 579]  length 711px  width 35.2
      //   width snapped from 35.1 to the shared pen weight 35.2
      // ! turns sharply at (545, 570)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      //   width runs 32.4 to 58.9, so this is a measured profile rather than one number.
      ribbon([
        [338, 113], [341.8, 126.1], [345.4, 139.1], [344.8, 142.3], [346.9, 145.1], [352.1, 152.9],
        [366.7, 168.4], [383.8, 180.5], [387.2, 190.8], [386.5, 195.1], [387.1, 201.5], [385.1, 202.4],
        [384.3, 209.5], [381.6, 215.3], [376.5, 225.3], [330.7, 297.4], [317.9, 324.4], [307.9, 353.2],
        [302.3, 384.1], [301.8, 398], [302.2, 410.9], [305.9, 433], [312.5, 452.8], [324.4, 475.7],
        [337.6, 493.3], [365.6, 519.5], [395.9, 539.2], [442.5, 560], [482.8, 571.9], [498, 574.1],
        [498.8, 575.8], [502, 576], [504.9, 575.3], [510, 579.1], [535, 578.9], [545, 570],
        [538.1, 578.1],
      ], [
        29.4, 19.7, 16.2, 18.1, 18.4, 18.4,
        18, 18.7, 17.6, 16.5, 18.2, 16.9,
        18, 18.2, 18, 18, 17.9, 17.7,
        17.7, 18.6, 17.9, 17.9, 18.4, 18.1,
        18.3, 18.1, 18.2, 18, 17.9, 16.9,
        17.8, 17.8, 16.2, 19.2, 19.8, 29.4,
        21.4,
      ], { fill: INK });

      // s3  box [364 347 716 611]  length 518px  width 35.2
      //   width snapped from 35.1 to the shared pen weight 35.2
      //   width runs 32.1 to 49.1, so this is a measured profile rather than one number.
      ribbon([
        [364.4, 379.8], [371.2, 376.6], [378.2, 374.7], [385.2, 373.1], [387.5, 373.8], [390.5, 371.7],
        [405.5, 362], [424.3, 353.8], [443.1, 348.9], [449, 349.4], [463, 347.3], [479, 349.3],
        [483.9, 348.7], [499.9, 352.4], [504.8, 353.5], [527.8, 362.4], [554.8, 377.4], [582.8, 398.2],
        [610.9, 425.1], [646.8, 469.2], [672, 509], [689.1, 541.9], [707.3, 584.9], [715.7, 611.2],
      ], [
        24.6, 18.7, 16.1, 16.9, 18.4, 18.5,
        17.7, 17.9, 17.8, 16.9, 18.8, 16.9,
        18, 18.3, 18, 18.1, 18.1, 18.1,
        18.4, 18, 18.1, 18, 18.2, 18.1,
      ], { fill: INK });

      // s4  box [261 63 438 381]  length 477px  width 35.1
      // ! turns sharply at (358, 375)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      //   width runs 33.1 to 62.3, so this is a measured profile rather than one number.
      ribbon([
        [260.9, 62.5], [267.3, 68.3], [269.8, 67.6], [271.3, 70.1], [274.8, 70.4], [276.5, 72.8],
        [279.9, 73.1], [281.3, 75.8], [282.6, 76.6], [298.3, 85.9], [334.6, 112.5], [335.8, 112.7],
        [341, 111], [356, 111.2], [380, 113.1], [385, 112.6], [397.2, 115.7], [400.9, 117.3],
        [408.8, 121.2], [422.8, 134.1], [433.1, 152.9], [433.4, 156.9], [435.3, 157.5], [436.6, 162.8],
        [436.9, 174.9], [438.3, 175.9], [437.2, 188.3], [435.7, 189.1], [436.4, 193.1], [433.4, 207.2],
        [428.2, 221.6], [414.6, 249.3], [376.7, 310.4], [365.6, 333.3], [361.7, 342.2], [360.4, 352.1],
        [358.6, 352.9], [359.1, 360], [357.5, 360.9], [357.2, 370], [358.6, 371], [357.4, 375.3],
        [363, 380.5],
      ], [
        18.9, 20.6, 19.3, 21.3, 20.9, 22.3,
        21.8, 23.3, 23.8, 25.9, 31.2, 30.9,
        26.9, 20.1, 17.1, 18.1, 17.8, 18.5,
        18.2, 18.2, 18.3, 16.6, 17.8, 18.2,
        17.1, 18, 17.8, 16.6, 17.9, 17.6,
        17.8, 17.8, 18, 18.1, 17.9, 16.6,
        17.8, 16.8, 18.2, 19.2, 20.9, 20.4,
        25.3,
      ], { fill: INK });

      // s5  box [400 422 652 584]  length 329px  width 35.8
      //   width runs 35.6 to 64.5, so this is a measured profile rather than one number.
      ribbon([
        [400.4, 422.3], [414.4, 455.8], [427.2, 474.8], [437.9, 486.1], [454.5, 501.6], [472.5, 514.7],
        [493, 527], [529.9, 544.3], [536.4, 550.1], [538.8, 557.6], [545.4, 568.7], [547.4, 569],
        [579.1, 575.5], [590.1, 578.4], [596.1, 579.3], [611.1, 580.4], [619, 582.7], [631, 582.4],
        [652.3, 583.8],
      ], [
        17.9, 18.2, 18, 18.4, 18.1, 17.8,
        18, 18.1, 20.5, 21.3, 30.1, 32.3,
        29, 26.1, 25.3, 24.8, 21.6, 21.8,
        19,
      ], { fill: INK });

      // s6  box [504 738 569 954]  length 284px  width 35.2
      //   width snapped from 35.3 to the shared pen weight 35.2
      //   width runs 25.8 to 50.3, so this is a measured profile rather than one number.
      ribbon([
        [504.1, 737.9], [508.2, 742], [508.8, 761], [508.9, 762], [508.8, 930], [508.3, 941],
        [508.4, 950], [508.4, 952.7], [509.9, 954.3], [515.1, 954.4], [515.8, 952.8], [527, 954.4],
        [546, 954.3], [569.1, 954.3],
      ], [
        22.7, 18.8, 18.1, 18.1, 17.9, 20.3,
        25.1, 22.6, 21.2, 20.9, 22.3, 20.9,
        18.8, 12.9,
      ], { fill: INK });

      // s7  box [398 804 439 908]  length 167px  width 35.2
      // ! turns sharply at (405, 907)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      //   width runs 33.7 to 49.2, so this is a measured profile rather than one number.
      ribbon([
        [432.9, 803.9], [423, 807.9], [416.8, 809.5], [409.7, 822.2], [400, 864.2], [399.2, 871.9],
        [398, 898], [398.3, 902.5], [404.8, 908.3], [419.5, 903.8], [428.6, 902.3], [430.1, 901.1],
        [436.5, 895.1], [438.8, 890.6],
      ], [
        21.7, 18, 19.2, 17.6, 17.8, 17.5,
        18.8, 19.7, 24.6, 16.9, 18.4, 18.1,
        18.1, 17.1,
      ], { fill: INK });

      // s8  box [504 635 598 738]  length 154px  width 35.2
      //   width snapped from 35.8 to the shared pen weight 35.2
      //   width runs 33.8 to 51.4, so this is a measured profile rather than one number.
      ribbon([
        [598.2, 634.6], [542.7, 686.7], [540.5, 689], [531.3, 690.6], [522.5, 693.3], [515.5, 696.7],
        [513, 696.7], [509.3, 707.3], [508.8, 718], [508.2, 729], [503.7, 737.9],
      ], [
        17.7, 18.3, 18.5, 16.9, 20.4, 25.7,
        22.7, 19.1, 21.3, 19.5, 22.9,
      ], { fill: INK });

      // s9  box [508 579 512 695]  length 118px  width 35.2
      //   width snapped from 35.3 to the shared pen weight 35.2
      //   a straight line, within 2px over its whole length
      line({ from: [508.8, 579], to: [510, 695], stroke: INK, width: 35.2 });

      // s10  box [433 738 504 804]  length 108px  width 35.2
      //   width snapped from 35.8 to the shared pen weight 35.2
      //   width runs 32 to 49, so this is a measured profile rather than one number.
      ribbon([
        [504, 738], [501.7, 738.4], [491, 743], [484, 744.9], [481, 745.8], [478.8, 745.3],
        [476.3, 747.4], [466.1, 757], [439.6, 782.1], [440.1, 784], [439, 787], [435.9, 796],
        [435, 799], [432.6, 801.9], [433.6, 803.8],
      ], [
        22.5, 24.5, 17, 16, 16.3, 17.8,
        18.1, 17.6, 18, 16.7, 16.6, 18.9,
        20.3, 23.8, 22.5,
      ], { fill: INK });

      // s11  box [434 803 457 879]  length 90px  width 35.2
      //   width snapped from 34.8 to the shared pen weight 35.2
      //   width runs 31.5 to 45.1, so this is a measured profile rather than one number.
      ribbon([
        [433.8, 803.2], [440, 808.9], [445, 815.3], [445.7, 816.7], [456.6, 848.7], [455.3, 866.1],
        [456, 870.7], [450.8, 878.1], [447.1, 878.5],
      ], [
        22.5, 19.2, 17.8, 18.1, 18, 15.7,
        17.5, 18, 16,
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

export default tenforeTraced;
