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

import { character, layer, path, through, type Character } from '../src/index.ts';

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
      // s0  box [389 68 871 789]  length 1275px  width 36.1
      through([
        [389, 73], [430, 72], [450, 74], [454, 72], [493, 68], [533, 68],
        [571, 72], [600, 78], [633, 88], [660, 99], [693, 116], [718, 132],
        [749, 156], [781, 188], [802, 214], [826, 251], [836, 270], [852, 309],
        [863, 348], [871, 407], [871, 447], [865, 497], [856, 533], [841, 573],
        [829, 598], [809, 630], [788, 658], [764, 684], [733, 711], [698, 735],
        [673, 749], [635, 765], [589, 778], [563, 782], [557, 789],
      ], { stroke: INK, width: 36.1 });

      // s1  box [153 154 408 760]  length 832px  width 36.1
      through([
        [301, 155], [279, 154], [246, 186], [213, 228], [200, 249], [180, 290],
        [165, 334], [156, 378], [153, 436], [156, 476], [159, 493], [173, 546],
        [186, 578], [209, 620], [229, 648], [246, 668], [273, 695], [290, 709],
        [319, 730], [339, 742], [378, 760], [408, 754],
      ], { stroke: INK, width: 36.1 });

      // s2  box [301 113 545 579]  length 711px  width 36.1
      // ! turns sharply at (545, 570)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      through([
        [338, 113], [347, 145], [355, 157], [366, 168], [382, 179], [386, 194],
        [384, 207], [380, 218], [333, 291], [318, 321], [307, 352], [303, 371],
        [301, 398], [303, 423], [313, 456], [324, 476], [333, 488], [354, 510],
        [372, 524], [401, 542], [449, 562], [493, 574], [505, 575], [510, 579],
        [536, 579], [545, 570], [538, 578],
      ], { stroke: INK, width: 36.1 });

      // s3  box [364 347 714 607]  length 518px  width 36.1
      through([
        [364, 379], [388, 372], [409, 359], [433, 350], [463, 347], [494, 350],
        [515, 356], [554, 376], [588, 402], [617, 431], [647, 469], [665, 497],
        [687, 537], [707, 585], [714, 607],
      ], { stroke: INK, width: 36.1 });

      // s4  box [265 65 437 379]  length 477px
      //   filled shape: width varied 1.54x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 250 50 c -7 5 -10 14 -6 22 1 4 6 8 31 28 9 8 21 18 30 27 l 10 9 12 -11 c 6 -6 11 -12 10 -12 -1 -2 3 0 11 4 4 3 8 6 8 6 0 0 2 2 4 3 2 1 4 3 4 3 1 1 4 1 7 1 19 -1 35 8 42 23 5 9 5 10 6 18 2 15 -2 33 -12 54 -6 12 -9 17 -25 42 -8 12 -17 27 -20 32 -6 12 -14 27 -14 29 0 1 0 2 -1 3 -1 2 -6 15 -7 22 -2 8 -2 29 0 35 2 7 3 10 4 10 1 0 20 -20 20 -21 0 0 0 -1 0 -1 0 0 0 -2 1 -3 0 -3 7 -12 10 -14 0 -1 1 -3 2 -5 2 -7 9 -22 13 -30 8 -14 9 -16 18 -31 5 -8 10 -15 10 -16 1 -1 3 -3 4 -5 1 -1 2 -3 2 -4 0 -1 0 -1 1 -1 1 0 1 0 1 -1 0 0 2 -4 5 -9 6 -12 13 -25 16 -34 1 -2 2 -4 2 -6 0 -1 2 -6 4 -13 2 -9 2 -12 2 -27 0 -9 0 -17 -1 -19 0 -1 -2 -5 -3 -9 -6 -22 -25 -42 -46 -50 -9 -3 -14 -4 -28 -5 l -13 -1 -9 -5 c -9 -5 -13 -7 -22 -12 -2 -1 -7 -4 -10 -6 -9 -5 -30 -15 -36 -17 -11 -4 -20 -6 -26 -6 -6 0 -7 0 -11 3 z', fill: INK });

      // s5  box [401 426 645 584]  length 329px
      //   filled shape: width varied 1.63x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 399 406 c -6 1 -7 1 -10 5 -5 4 -6 9 -6 15 1 5 3 13 5 16 1 1 1 2 1 3 0 3 16 31 20 36 1 1 3 3 4 5 7 9 37 37 40 37 0 0 1 1 3 2 5 5 28 18 46 27 4 2 10 5 12 6 2 1 5 3 7 5 3 3 3 4 10 4 2 1 5 1 13 2 1 1 5 -3 16 -13 11 -12 13 -14 11 -15 -3 -1 -21 -7 -24 -9 -2 0 -4 -1 -5 -2 -19 -7 -51 -24 -64 -34 -18 -13 -35 -29 -44 -43 -6 -9 -12 -22 -14 -29 -2 -9 -5 -13 -9 -15 -3 -3 -9 -4 -12 -3 z M 560 557 l -14 13 3 4 c 1 2 2 3 1 3 0 0 1 1 2 2 0 1 1 2 1 2 -1 0 0 1 1 2 0 1 1 2 1 2 -1 0 -1 1 0 2 1 0 2 2 2 3 0 1 1 3 2 4 1 2 2 3 2 3 0 3 2 6 5 7 2 0 19 0 39 0 46 0 55 -1 61 -7 8 -8 6 -22 -3 -27 -2 -2 -6 -4 -10 -5 -4 0 -8 -2 -10 -2 -4 -1 -14 -4 -18 -5 -2 0 -6 -2 -9 -2 -3 -1 -8 -2 -10 -3 -2 -1 -9 -3 -13 -4 -5 -2 -11 -4 -13 -5 -2 0 -5 -1 -5 -1 -1 0 -8 6 -15 14 z', fill: INK });

      // s6  box [504 738 569 954]  length 284px  width 36
      // ! turns sharply at (508, 953)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      through([
        [504, 738], [508, 742], [508, 953], [569, 954],
      ], { stroke: INK, width: 36 });

      // s7  box [398 804 437 906]  length 167px  width 36.1
      through([
        [433, 804], [415, 811], [409, 822], [399, 863], [398, 900], [402, 905],
        [408, 906], [429, 900], [437, 890],
      ], { stroke: INK, width: 36.1 });

      // s8  box [504 636 596 738]  length 154px  width 36.8
      through([
        [596, 636], [542, 686], [512, 696], [508, 707], [508, 729], [504, 738],
      ], { stroke: INK, width: 36.8 });

      // s9  box [508 579 512 695]  length 118px  width 36
      through([
        [509, 579], [508, 691], [512, 695],
      ], { stroke: INK, width: 36 });

      // s10  box [433 738 504 804]  length 108px  width 36.8
      through([
        [504, 738], [476, 747], [465, 757], [441, 780], [433, 804],
      ], { stroke: INK, width: 36.8 });

      // s11  box [433 804 456 878]  length 90px  width 35.4
      through([
        [433, 804], [443, 812], [454, 842], [456, 860], [453, 874], [447, 878],
      ], { stroke: INK, width: 35.4 });

      // s12  box [446 954 508 954]  length 65px
      //   filled shape: width varied 1.39x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 471 935 c -23 5 -32 8 -37 14 -8 7 0 15 19 20 8 3 28 6 33 6 2 0 6 -3 13 -10 l 10 -10 -10 -11 -10 -10 -7 0 c -4 0 -9 1 -11 1 z', fill: INK });

      // s13  box [424 860 437 890]  length 35px
      //   filled shape: width varied 5.22x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 424 863 c -1 2 -1 7 -1 11 -1 7 -1 9 -3 11 -3 2 -4 2 -4 -2 0 -2 0 -2 -1 -1 -3 2 -2 4 0 7 2 1 4 1 12 1 9 0 9 0 12 -3 l 3 -3 -5 -5 c -5 -6 -6 -6 -7 -4 -1 1 -1 1 -2 -2 0 -4 -3 -13 -4 -13 0 0 0 1 0 3 z', fill: INK });

      // s14  box [434 860 447 878]  length 24px
      //   filled shape: width varied 13.93x, so this is its exact
      //   outline rather than a constant-width stroke.
      path({ d: 'M 439 857 c 1 2 1 4 1 5 -1 3 -4 2 -5 -1 -1 -4 -2 -1 -2 6 l -1 7 5 5 5 4 3 -3 c 2 -3 2 -4 2 -8 0 -9 -1 -14 -6 -17 l -3 -2 1 4 z', fill: INK });
    });
  },
);

export default tenforeTraced;
