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

import { character, layer, through, type Character } from '../src/index.ts';

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

      // s4  box [265 65 437 379]  length 477px  width 36.1
      // ! width varies 1.54x along this run: probably a filled shape,
      //   not a stroke. Redraw it as path({ d }) or polygon() if it should taper.
      through([
        [265, 65], [299, 85], [337, 113], [339, 111], [379, 112], [393, 114],
        [404, 118], [417, 127], [423, 134], [433, 153], [437, 179], [432, 209],
        [417, 244], [385, 294], [363, 336], [360, 346], [357, 370], [358, 375],
        [364, 379],
      ], { stroke: INK, width: 36.1 });

      // s5  box [401 426 645 584]  length 329px  width 36.8
      // ! width varies 1.63x along this run: probably a filled shape,
      //   not a stroke. Redraw it as path({ d }) or polygon() if it should taper.
      through([
        [401, 426], [407, 443], [421, 467], [449, 497], [489, 525], [512, 537],
        [530, 544], [546, 570], [596, 580], [645, 584],
      ], { stroke: INK, width: 36.8 });

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

      // s12  box [446 954 508 954]  length 65px  width 38.5
      // ! width varies 1.39x along this run: probably a filled shape,
      //   not a stroke. Redraw it as path({ d }) or polygon() if it should taper.
      through([
        [446, 954], [508, 954],
      ], { stroke: INK, width: 38.5 });

      // s13  box [424 860 437 890]  length 35px  width 6
      // ! width varies 5.22x along this run: probably a filled shape,
      //   not a stroke. Redraw it as path({ d }) or polygon() if it should taper.
      through([
        [424, 860], [425, 878], [437, 890],
      ], { stroke: INK, width: 6 });

      // s14  box [434 860 447 878]  length 24px  width 12
      // ! width varies 13.93x along this run: probably a filled shape,
      //   not a stroke. Redraw it as path({ d }) or polygon() if it should taper.
      through([
        [434, 860], [434, 865], [447, 878],
      ], { stroke: INK, width: 12 });
    });
  },
);

export default tenforeTraced;
