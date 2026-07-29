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

import { character, layer, arc, line, through, path, type Character } from '../src/index.ts';

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
      // s0  box [438 68 872 789]  length 1225px  width 35.3
      //   a circle, within 1px over 185 degrees. Fitted
      //   from 1050 samples, so it is a better estimate than any of them.
      arc({ cx: 512.4, cy: 427, r: 359.1, from: -101.9, to: 82.9, stroke: INK, width: 35.3 });

      // s1  box [154 154 382 761]  length 786px  width 35.3
      //   a circle, within 0.4px over 119 degrees. Fitted
      //   from 659 samples, so it is a better estimate than any of them.
      arc({ cx: 512.3, cy: 427.1, r: 359, from: -130, to: -248.6, stroke: INK, width: 35.3 });

      // s2  box [302 113 545 579]  length 711px  width 35.3
      //   width snapped from 35.1 to the shared pen weight 35.3
      // ! turns sharply at (545, 570)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      through([
        [338, 113], [346, 139], [345.3, 142.2], [352, 153], [366.6, 168.6], [383.3, 180.9],
        [386, 191], [385.7, 201.2], [384, 202], [383.4, 209.2], [375.9, 225], [330, 297],
        [317.1, 324.1], [307.1, 353], [301.5, 384], [301.5, 411], [305.3, 433.2], [312.1, 453],
        [324.2, 475.9], [337.4, 493.4], [365.6, 519.5], [396, 538.9], [442.7, 559.6], [482.8, 571.7],
        [498, 574], [498.8, 575.7], [505, 575], [510, 579], [535, 579], [545, 570.1],
        [538, 578],
      ], { stroke: INK, width: 35.3 });

      // s3  box [364 347 715 611]  length 518px  width 35.3
      //   width snapped from 35.1 to the shared pen weight 35.3
      through([
        [364, 379], [385, 372], [387.2, 372.7], [405.2, 361.3], [424, 353.1], [443, 348.3],
        [463, 347], [484, 348.3], [505, 353.1], [528, 362.1], [554.9, 377.2], [582.9, 398.1],
        [611, 425], [646.8, 469.1], [671.9, 509.1], [688.9, 542], [706.9, 585], [715.1, 611.4],
      ], { stroke: INK, width: 35.3 });

      // s4  box [262 62 437 380]  length 477px
      //   filled shape: width varied 1.56x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 250 50 c -7 5 -10 14 -6 22 1 4 6 8 31 28 9 8 21 18 30 27 l 10 9 12 -11 c 6 -6 11 -12 10 -12 -1 -2 3 0 11 4 4 3 8 6 8 6 0 0 2 2 4 3 2 1 4 3 4 3 1 1 4 1 7 1 19 -1 35 8 42 23 5 9 5 10 6 18 2 15 -2 33 -12 54 -6 12 -9 17 -25 42 -8 12 -17 27 -20 32 -6 12 -14 27 -14 29 0 1 0 2 -1 3 -1 2 -6 15 -7 22 -2 8 -2 29 0 35 2 7 3 10 4 10 1 0 20 -20 20 -21 0 0 0 -1 0 -1 0 0 0 -2 1 -3 0 -3 7 -12 10 -14 0 -1 1 -3 2 -5 2 -7 9 -22 13 -30 8 -14 9 -16 18 -31 5 -8 10 -15 10 -16 1 -1 3 -3 4 -5 1 -1 2 -3 2 -4 0 -1 0 -1 1 -1 1 0 1 0 1 -1 0 0 2 -4 5 -9 6 -12 13 -25 16 -34 1 -2 2 -4 2 -6 0 -1 2 -6 4 -13 2 -9 2 -12 2 -27 0 -9 0 -17 -1 -19 0 -1 -2 -5 -3 -9 -6 -22 -25 -42 -46 -50 -9 -3 -14 -4 -28 -5 l -13 -1 -9 -5 c -9 -5 -13 -7 -22 -12 -2 -1 -7 -4 -10 -6 -9 -5 -30 -15 -36 -17 -11 -4 -20 -6 -26 -6 -6 0 -7 0 -11 3 z', fill: INK });

      // s5  box [400 423 652 583]  length 329px
      //   filled shape: width varied 1.65x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 399 406 c -6 1 -7 1 -10 5 -5 4 -6 9 -6 15 1 5 3 13 5 16 1 1 1 2 1 3 0 3 16 31 20 36 1 1 3 3 4 5 7 9 37 37 40 37 0 0 1 1 3 2 5 5 28 18 46 27 4 2 10 5 12 6 2 1 5 3 7 5 3 3 3 4 10 4 2 1 5 1 13 2 1 1 5 -3 16 -13 11 -12 13 -14 11 -15 -3 -1 -21 -7 -24 -9 -2 0 -4 -1 -5 -2 -19 -7 -51 -24 -64 -34 -18 -13 -35 -29 -44 -43 -6 -9 -12 -22 -14 -29 -2 -9 -5 -13 -9 -15 -3 -3 -9 -4 -12 -3 z M 560 557 l -14 13 3 4 c 1 2 2 3 1 3 0 0 1 1 2 2 0 1 1 2 1 2 -1 0 0 1 1 2 0 1 1 2 1 2 -1 0 -1 1 0 2 1 0 2 2 2 3 0 1 1 3 2 4 1 2 2 3 2 3 0 3 2 6 5 7 2 0 19 0 39 0 46 0 55 -1 61 -7 8 -8 6 -22 -3 -27 -2 -2 -6 -4 -10 -5 -4 0 -8 -2 -10 -2 -4 -1 -14 -4 -18 -5 -2 0 -6 -2 -9 -2 -3 -1 -8 -2 -10 -3 -2 -1 -9 -3 -13 -4 -5 -2 -11 -4 -13 -5 -2 0 -5 -1 -5 -1 -1 0 -8 6 -15 14 z', fill: INK });

      // s6  box [504 738 569 954]  length 284px  width 35.3
      through([
        [504, 738], [508, 742], [508.5, 762], [508.6, 952.6], [510, 954], [515, 954],
        [515.8, 952.3], [527, 954], [569.1, 953.9],
      ], { stroke: INK, width: 35.3 });

      // s7  box [398 804 437 907]  length 167px  width 35.3
      //   width snapped from 35.2 to the shared pen weight 35.3
      through([
        [433, 804], [416.7, 809.4], [409.2, 822], [399.2, 864.1], [398, 898], [399, 902],
        [404.8, 906.7], [428.2, 900.7], [435.2, 894.1], [437, 890],
      ], { stroke: INK, width: 35.3 });

      // s8  box [504 634 598 738]  length 154px  width 35.3
      //   width snapped from 35.8 to the shared pen weight 35.3
      through([
        [597.6, 634], [540.2, 687.7], [531, 689], [512, 696], [508, 707], [508, 729],
        [504, 738],
      ], { stroke: INK, width: 35.3 });

      // s9  box [508 579 512 695]  length 118px  width 35.3
      //   a straight line, within 0.6px over its whole length
      line({ from: [508.4, 695], to: [508.4, 579], stroke: INK, width: 35.3 });

      // s10  box [432 738 504 804]  length 108px  width 35.3
      //   width snapped from 35.8 to the shared pen weight 35.3
      //   a circle, within 1.3px over 62 degrees. Fitted
      //   from 88 samples, so it is a better estimate than any of them.
      arc({ cx: 522.2, cy: 830.5, r: 93.6, from: -101.1, to: -163.5, stroke: INK, width: 35.3 });

      // s11  box [433 804 456 878]  length 90px  width 35.3
      //   width snapped from 35 to the shared pen weight 35.3
      //   a circle, within 1px over 64 degrees. Fitted
      //   from 80 samples, so it is a better estimate than any of them.
      arc({ cx: 380.9, cy: 855.4, r: 74.2, from: -44.6, to: 18.9, stroke: INK, width: 35.3 });

      // s12  box [446 952 508 954]  length 65px  width 37.7
      //   a straight line, within 0.9px over its whole length
      line({ from: [446, 953.7], to: [508, 953.7], stroke: INK, width: 37.7 });

      // s13  box [389 73 438 73]  length 50px
      //   filled shape: width varied 2.48x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 436 58 c -2 1 -8 2 -14 4 -7 1 -13 3 -14 3 -1 0 -7 2 -13 4 -5 2 -10 4 -10 4 0 1 3 3 9 3 9 2 22 6 28 10 2 1 2 1 9 -6 7 -6 7 -6 5 -8 -2 -2 -2 -2 2 -7 4 -4 4 -4 2 -6 -1 -1 -2 -2 -4 -1 z', fill: INK });

      // s14  box [382 755 408 759]  length 28px
      //   filled shape: width varied 1.77x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 384 746 c -1 2 -2 3 -1 3 0 1 0 2 -1 3 -1 1 -1 1 1 3 1 2 2 3 1 4 -1 0 1 3 5 7 l 7 6 8 -9 9 -9 -3 -1 c -7 -3 -17 -6 -19 -7 -1 0 -2 -1 -3 -1 0 -2 -1 -1 -4 1 z', fill: INK });

      // s15  box [425 870 437 890]  length 25px
      //   filled shape: width varied 3.43x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 425 870 c -1 1 -2 4 -2 7 -1 8 -7 13 -7 6 0 -2 0 -2 -1 -1 -3 2 -2 4 0 7 2 1 4 1 12 1 8 0 9 0 12 -2 3 -3 3 -3 2 -7 -1 -2 -3 -4 -6 -6 -4 -2 -4 -2 -5 0 -1 2 -2 -1 -2 -4 0 -3 -1 -4 -3 -1 z', fill: INK });

      // s16  box [283 154 301 155]  length 18px
      //   filled shape: width varied 1.48x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 289 149 c -4 5 -5 6 -4 7 2 1 2 1 1 3 -2 1 -2 2 2 5 l 4 4 6 -5 c 4 -3 7 -6 7 -7 1 0 -1 -3 -4 -6 -3 -3 -6 -6 -6 -6 0 0 -3 2 -6 5 z', fill: INK });

      // s17  box [434 860 438 869]  length 11px
      //   filled shape: width varied 2.33x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 439 857 c 1 2 1 4 1 5 -1 3 -4 2 -5 -1 -1 -4 -2 -1 -2 6 l -1 7 4 2 c 3 1 3 1 5 -1 4 -3 6 -12 4 -16 -1 -1 -2 -3 -4 -4 l -3 -2 1 4 z', fill: INK });

      // s18  box [424 860 425 870]  length 10px
      //   filled shape: width varied 3.03x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 424 862 c -1 1 -1 4 -1 6 0 3 0 3 2 2 1 -2 2 -3 1 -5 -1 -4 -2 -5 -2 -3 z', fill: INK });
    });
  },
);

export default tenforeTraced;
