/** A grid deliberately past the cap, so the refusal can be tested. */
import { character, circle, grid, part, type Character, type Variant } from '../../src/index.ts';

const AXES = { a: [1, 2, 3, 4, 5, 6], b: [1, 2, 3, 4, 5, 6] };

export const tooMany = grid((p: Variant<typeof AXES>): Character =>
  character('big', { viewBox: [0, 0, 10, 10], duration: 1 }, () => {
    part('mark', { pivot: [5, 5] }, () => circle({ cx: 5, cy: 5, r: p.a, fill: '#000' }));
  }), AXES);
