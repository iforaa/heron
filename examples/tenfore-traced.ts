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
      // s0  box [438 68 872 789]  length 1225px  width 35.2
      //   a circle, within 1px over 185 degrees. Fitted
      //   from 1050 samples, so it is a better estimate than any of them.
      arc({ cx: 512.4, cy: 427, r: 359.1, from: -101.9, to: 82.9, stroke: INK, width: 35.2 });

      // s1  box [154 154 382 761]  length 786px  width 35.2
      //   a circle, within 0.4px over 119 degrees. Fitted
      //   from 659 samples, so it is a better estimate than any of them.
      arc({ cx: 512.3, cy: 427.1, r: 359, from: -130, to: -248.6, stroke: INK, width: 35.2 });

      // s2  box [301 113 545 579]  length 711px  width 35.2
      //   width snapped from 35.1 to the shared pen weight 35.2
      // ! turns sharply at (545, 570)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      //   width runs 31 to 59.2, so this is a measured profile rather than one number.
      ribbon([
        [338, 113], [342, 126], [346, 139], [345.3, 142.2], [347, 145], [352, 153],
        [366.6, 168.6], [383.3, 180.9], [386, 191], [385, 195], [385.7, 201.2], [384, 202],
        [383.4, 209.2], [381, 215], [375.9, 225], [330, 297], [317.1, 324.1], [307.1, 353],
        [301.5, 384], [301, 398], [301.5, 411], [305.3, 433.2], [312.1, 453], [324.2, 475.9],
        [337.4, 493.4], [365.6, 519.5], [396, 538.9], [442.7, 559.6], [482.8, 571.7], [498, 574],
        [498.8, 575.7], [502, 575.7], [505, 575], [510, 579], [535, 579], [545, 570.1],
        [538, 578],
      ], [
        29.3, 19.4, 15.7, 17.5, 17.9, 17.9,
        17.5, 18, 16.6, 15.5, 17.2, 16.1,
        17.3, 17.9, 17.9, 17.9, 17.8, 17.5,
        17.6, 18.5, 17.6, 17.5, 17.9, 17.4,
        17.5, 17.4, 17.5, 17.4, 17.4, 16.8,
        18.1, 18.2, 16.6, 19.5, 20.1, 29.6,
        21.5,
      ], { fill: INK });

      // s3  box [364 347 715 611]  length 518px  width 35.2
      //   width snapped from 35.1 to the shared pen weight 35.2
      //   width runs 31.2 to 47.4, so this is a measured profile rather than one number.
      ribbon([
        [364, 379], [371, 376], [378, 374], [385, 372], [387.2, 372.7], [390, 371],
        [405.2, 361.3], [424, 353.1], [443, 348.3], [449, 349], [463, 347], [479, 349],
        [484, 348.3], [500, 352], [505, 353.1], [528, 362.1], [554.9, 377.2], [582.9, 398.1],
        [611, 425], [646.8, 469.1], [671.9, 509.1], [688.9, 542], [706.9, 585], [715.1, 611.4],
      ], [
        23.7, 18.2, 15.6, 16.1, 17.5, 17.9,
        17.5, 17.8, 17.5, 16.5, 18.5, 16.5,
        17.5, 17.9, 17.5, 17.5, 17.6, 17.5,
        17.9, 17.4, 17.5, 17.5, 17.8, 17.5,
      ], { fill: INK });

      // s4  box [262 62 437 380]  length 477px  width 35.1
      // ! turns sharply at (358, 375)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      //   width runs 32 to 61, so this is a measured profile rather than one number.
      ribbon([
        [261.6, 61.7], [267.7, 67.6], [270, 67], [271.6, 69.6], [275, 70], [276.6, 72.6],
        [280, 73], [281.6, 75.6], [282.9, 76.2], [298.6, 85.6], [334.8, 112.3], [335.8, 112.7],
        [341, 111], [356, 111.2], [380, 113], [385, 112.3], [397.3, 115.4], [401, 117],
        [408.9, 121.1], [422.9, 134.1], [433, 153], [433, 157], [434.7, 157.8], [435.7, 162.8],
        [436, 175], [437.5, 175.9], [436.5, 188.1], [435, 189], [435.7, 193], [432.7, 207],
        [427.5, 221.3], [413.9, 248.9], [376, 310], [365, 333], [361.2, 342], [360, 352],
        [358.3, 352.8], [359, 360], [357.3, 360.8], [357, 370], [358.7, 371], [358, 375],
        [363.7, 379.6],
      ], [
        17.9, 19.8, 18.5, 20.4, 20.1, 21.7,
        21.4, 22.9, 23.2, 25.2, 30.5, 30.5,
        26.7, 19.8, 16.5, 17.5, 17.2, 17.9,
        17.5, 17.6, 17.9, 16.3, 17.4, 17.7,
        16.5, 17.6, 17.6, 16.5, 17.7, 17.2,
        17.4, 17.5, 17.9, 17.9, 17.4, 16,
        17.3, 16.6, 18.3, 19.4, 20.8, 19.7,
        24.2,
      ], { fill: INK });

      // s5  box [400 423 652 583]  length 329px  width 35.8
      //   width runs 34.5 to 62.3, so this is a measured profile rather than one number.
      ribbon([
        [399.9, 422.5], [414.1, 456], [427.1, 474.9], [437.9, 486.1], [454.6, 501.6], [472.6, 514.6],
        [493.1, 526.9], [529.7, 544.6], [535.6, 550.6], [538, 558], [545, 569], [547.3, 569.4],
        [579, 576], [590, 579], [596, 580], [611, 581], [619, 583], [631, 582.3],
        [652.4, 583.3],
      ], [
        17.5, 17.9, 17.5, 17.9, 17.5, 17.2,
        17.5, 17.6, 19.8, 20.5, 29.2, 31.1,
        27.5, 24.5, 23.8, 23.5, 20.5, 21.2,
        18.8,
      ], { fill: INK });

      // s6  box [504 738 569 954]  length 284px  width 35.2
      //   width snapped from 35.3 to the shared pen weight 35.2
      //   width runs 23.8 to 50.1, so this is a measured profile rather than one number.
      ribbon([
        [504, 738], [508, 742], [508.5, 761], [508.5, 762], [508.5, 930], [508.2, 941],
        [508.4, 950], [508.6, 952.6], [510, 954], [515, 954], [515.8, 952.3], [527, 954],
        [546, 953.9], [569.1, 953.9],
      ], [
        22.5, 18.5, 17.6, 17.6, 17.6, 20.1,
        25.1, 22.5, 20.9, 20.5, 21.9, 20.5,
        18.2, 11.9,
      ], { fill: INK });

      // s7  box [398 804 437 907]  length 167px  width 35.2
      // ! turns sharply at (405, 907)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      //   width runs 31.2 to 46.6, so this is a measured profile rather than one number.
      ribbon([
        [433, 804], [423, 808], [416.7, 809.4], [409.2, 822], [399.2, 864.1], [398.6, 871.9],
        [398, 898], [399, 902], [404.8, 906.7], [419, 902], [428.2, 900.7], [429, 900],
        [435.2, 894.1], [437, 890],
      ], [
        21.9, 18.2, 19.2, 17.4, 17.5, 17.3,
        18.5, 18.9, 23.3, 15.6, 17.7, 17.9,
        18, 16.5,
      ], { fill: INK });

      // s8  box [504 634 598 738]  length 154px  width 35.2
      //   width snapped from 35.8 to the shared pen weight 35.2
      //   width runs 31.2 to 49.3, so this is a measured profile rather than one number.
      ribbon([
        [597.6, 634], [542, 686], [540.2, 687.7], [531, 689], [522, 692], [515.2, 695.6],
        [512, 696], [508, 707], [507.9, 718], [508, 729], [504, 738],
      ], [
        17.4, 17.9, 17.6, 15.6, 19.1, 24.7,
        21.5, 17.5, 19.8, 18.5, 22.5,
      ], { fill: INK });

      // s9  box [508 579 512 695]  length 118px  width 35.2
      //   width snapped from 35.3 to the shared pen weight 35.2
      //   a straight line, within 0.6px over its whole length
      line({ from: [508.4, 695], to: [508.4, 579], stroke: INK, width: 35.2 });

      // s10  box [432 738 504 804]  length 108px  width 35.2
      //   width snapped from 35.8 to the shared pen weight 35.2
      //   a circle, within 1.3px over 62 degrees. Fitted
      //   from 88 samples, so it is a better estimate than any of them.
      arc({ cx: 522.2, cy: 830.5, r: 93.6, from: -101.1, to: -163.5, stroke: INK, width: 35.2 });

      // s11  box [433 804 456 878]  length 90px  width 35.2
      //   width snapped from 34.8 to the shared pen weight 35.2
      //   a circle, within 1px over 64 degrees. Fitted
      //   from 80 samples, so it is a better estimate than any of them.
      arc({ cx: 380.9, cy: 855.4, r: 74.2, from: -44.6, to: 18.9, stroke: INK, width: 35.2 });

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
