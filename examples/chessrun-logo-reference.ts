/**
 * Traced from logo-4.png by `heron trace`.
 *
 * GEOMETRY IS MEASURED. ANATOMY IS NOT. This file renders, but it cannot move:
 * every run of ink is a sibling in one flat layer, so there is no leg to rotate.
 * Finish it in this order — the order matters, and skipping ahead is how scenes
 * end up quietly wrong.
 *
 *   1. Check the trace before touching it:
 *        heron match chessrun-logo-reference.ts logo-4.png
 *      Overlap should already be high. If it is not, re-run `heron trace` with a
 *      different --epsilon or --threshold rather than hand-editing points.
 *
 *   2. See which run is which before grouping anything:
 *        heron shapes chessrun-logo-reference.ts
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
 *   (289, 6)  (339, 6)  (315, 7)  (363, 7)  (62, 32)  (92, 32)  (119, 33)  (291, 35)  (335, 57)  (271, 58)  (297, 58)  (361, 58)
 *
 * Lines below marked `// !` are things the trace noticed but could not resolve.
 * Read every one before animating.
 */

import { character, layer, through, path, type Character } from '../src/index.ts';

const INK = '#7c5f44';

export const logo4: Character = character(
  'logo4',
  {
    viewBox: [0, 0, 396, 67],
    duration: 1,
    // ground: 66,   // <- the floor's y, once you know where the feet are
  },
  () => {
    // Declaration order is z-order. Longest run first; reorder as needed.
    layer('art', () => {
      // s0  box [248 3 298 62]  length 169px  width 11
      // ! turns sharply at (247, 7)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      through([
        [289.8, 6.5], [284.5, 3.1], [252.1, 8.8], [248.1, 14], [248.9, 54.2], [250.3, 55.3],
        [253, 57.1], [262.1, 60.8], [263, 61], [269.4, 62], [277.2, 62.1], [290.1, 59.4],
        [290.9, 59], [294.8, 56.5], [295.5, 55.9], [296.4, 54.8], [297.3, 53.4], [297.8, 52.1],
        [298.1, 50.5], [295.8, 41.6], [292.4, 36.7], [290.1, 34.1],
      ], { stroke: INK, width: 11 });

      // s1  box [361 5 390 63]  length 100px  width 9.8
      // ! turns sharply at (385, 58)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      through([
        [363.1, 5.6], [364.8, 5.2], [385.3, 9.6], [385.8, 10], [388.8, 13.5], [389.7, 51.3],
        [386, 55.9], [383, 58.5], [371.1, 62.7], [364.7, 62.6], [360.5, 61.9],
      ], { stroke: INK, width: 9.8 });

      // s2  box [10 13 45 50]  length 83px  width 15.8  cut ends
      //   width snapped from 15.9 to the shared pen weight 15.8
      through([
        [45.2, 13.1], [20.4, 16.5], [17, 18.9], [12.3, 24.6], [9.9, 31.4], [10.4, 39.3],
        [11.1, 40.9], [11.9, 42.4], [14.3, 45.5], [17.5, 47.9], [24.1, 50.1], [25.1, 50.3],
        [26.7, 50.5], [32.8, 50.3], [35.6, 49.9], [40.9, 48.6],
      ], { stroke: INK, width: 15.8, cap: 'butt' });

      // s3  box [160 14 184 51]  length 82px  width 14.6
      through([
        [173.9, 14.3], [171.5, 14.7], [169.8, 17.3], [170.3, 19.3], [170.8, 20.5], [171.5, 21.8],
        [172.1, 22.9], [172.8, 24], [173.8, 25.4], [175.5, 28], [177.3, 30.5], [180.6, 35.8],
        [181.2, 36.8], [182.2, 38.7], [182.5, 39.3], [182.9, 40.2], [183.3, 41.4], [183.8, 44],
        [183.8, 44.7], [183.6, 45.7], [183.4, 46.5], [183.2, 46.9], [182.1, 48.3], [180.5, 49.5],
        [179.8, 49.8], [174.3, 51.1], [173.1, 51.2], [171.2, 51.2], [166.6, 51.2], [163, 50.9],
        [160.4, 50.6],
      ], { stroke: INK, width: 14.6 });

      // s4  box [200 13 227 52]  length 81px  width 14.6  cut ends
      //   width snapped from 14.3 to the shared pen weight 14.6
      through([
        [222.6, 13.3], [214.7, 16.3], [214.7, 17.9], [214.8, 18.6], [215, 19.3], [215.5, 20.6],
        [216, 21.9], [216.7, 23.2], [217.2, 24.1], [218, 25.6], [218.7, 26.8], [219.3, 27.8],
        [223.2, 34.5], [225.8, 39.8], [226.3, 41.4], [226.8, 43.3], [226.9, 44.1], [226.9, 45.1],
        [226.7, 46.2], [225.6, 48.4], [223.8, 49.9], [219.2, 51.3], [218.3, 51.4], [216.6, 51.6],
        [214.1, 51.7], [211.3, 51.6], [200.4, 50.4],
      ], { stroke: INK, width: 14.6, cap: 'butt' });

      // s5  box [61 8 97 38]  length 59px  width 15.8  cut ends
      //   width snapped from 15.7 to the shared pen weight 15.8
      through([
        [60.5, 8.1], [64.2, 31.1], [66.8, 33.3], [71.2, 35.8], [83.8, 37.9], [89.3, 36.6],
        [90.2, 36.1], [92, 35], [93.6, 33.8], [96.9, 10.2],
      ], { stroke: INK, width: 15.8, cap: 'butt' });

      // s6  box [334 6 341 57]  length 53px  width 7.3
      through([
        [339, 5.9], [339.3, 6.9], [340.7, 12], [340.4, 39.2], [335.8, 53.5], [335, 55.6],
        [334.3, 57.1],
      ], { stroke: INK, width: 7.3 });

      // s7  box [316 5 339 36]  length 51px  width 15
      through([
        [339.3, 5.4], [337.7, 5], [317.9, 7.3], [316.5, 8.7], [316.1, 9.2], [315.9, 35.7],
      ], { stroke: INK, width: 15 });

      // s8  box [119 16 139 34]  length 51px  width 17
      // ! turns sharply at (120, 33)
      //   A drawn stroke curves; a hard corner usually means two things were
      //   traced as one run because they touch. Consider splitting it there.
      through([
        [138.8, 15.9], [120.6, 16.8], [120, 17.6], [119.5, 18.6], [118.8, 25.1], [119.6, 27.4],
        [121.4, 30.2], [125.5, 33.2], [133.9, 34],
      ], { stroke: INK, width: 17 });

      // s9  box [297 60 336 61]  length 41px  width 11
      //   width snapped from 11.2 to the shared pen weight 11
      through([
        [336.1, 60], [335.8, 60], [334.6, 60], [333, 60], [331, 60], [330.1, 60],
        [321.2, 60], [320.2, 60.1], [304.9, 60.5], [296.8, 61.2],
      ], { stroke: INK, width: 11 });

      // s10  box [119 34 147 51]  length 35px  width 15.8  cut ends
      through([
        [119.6, 33.6], [119.4, 47.9], [120.4, 48.9], [121.2, 49.5], [121.7, 49.8], [125.5, 50.8],
        [126.4, 50.9], [146.5, 49.1],
      ], { stroke: INK, width: 15.8, cap: 'butt' });

      // s11  box [284 9 295 36]  length 31px  width 7.1
      through([
        [284.1, 9.2], [285.5, 9.7], [286.7, 10.4], [292, 16], [292.8, 17.7], [294.7, 27.8],
        [294.6, 34.8], [294.4, 36.2],
      ], { stroke: INK, width: 7.1 });

      // s12  box [289 6 315 8]  length 26px  width 11
      through([
        [288.9, 6.8], [292.2, 6.3], [312.7, 5.7], [314, 6.7], [314.9, 7.5],
      ], { stroke: INK, width: 11 });

      // s13  box [335 57 361 60]  length 26px  width 11
      //   width snapped from 11.3 to the shared pen weight 11
      through([
        [334.9, 57.9], [341.9, 59.7], [342.9, 59.9], [354, 59.8], [360, 58], [361.2, 57.5],
      ], { stroke: INK, width: 11 });

      // s14  box [339 5 363 8]  length 24px  width 11
      through([
        [338.9, 5], [340.2, 5.4], [360.6, 7.7], [362.1, 6.8], [363.1, 6],
      ], { stroke: INK, width: 11 });

      // s15  box [362 7 366 20]  length 16px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 360 11 l -3 4 3 5 4 5 3 -4 c 5 -4 5 -8 1 -11 l -4 -3 -4 4 z', fill: INK });

      // s16  box [62 32 63 56]  length 16px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 59 36 c -4 4 -4 4 -4 12 l 0 9 8 0 8 0 0 -8 0 -7 -4 -5 -5 -5 -3 4 z', fill: INK });

      // s17  box [358 43 362 58]  length 16px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 358 43 c -2 2 -3 4 -3 7 0 3 1 4 3 6 l 4 2 3 -4 4 -3 -4 -6 c -2 -3 -4 -5 -4 -5 0 0 -2 1 -3 3 z', fill: INK });

      // s18  box [366 20 370 32]  length 13px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 367 21 l -3 4 3 4 c 1 3 3 5 3 5 1 0 1 -4 1 -8 0 -4 0 -8 0 -8 0 0 -2 2 -4 3 z', fill: INK });

      // s19  box [356 32 358 43]  length 12px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 355 38 l 0 7 3 -3 3 -3 -3 -4 c -1 -2 -2 -4 -3 -4 0 0 0 3 0 7 z', fill: INK });

      // s20  box [282 35 291 35]  length 9px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 286 32 c -1 1 -2 2 -4 2 -2 1 -2 1 0 2 1 1 2 2 3 3 1 1 1 1 4 -1 l 2 -3 -2 -2 c -2 -1 -3 -2 -3 -1 z', fill: INK });

      // s21  box [268 40 269 47]  length 8px
      //   a filled blob with no centreline to measure, so this is its traced outline.
      path({ d: 'M 266 37 c -1 0 -1 4 -1 8 l 0 7 5 0 c 7 0 8 -1 3 -9 -3 -5 -6 -8 -7 -6 z', fill: INK });
    });
  },
);

export default logo4;
