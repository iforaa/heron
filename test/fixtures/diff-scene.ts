import { character, circle, keys, part, type Character } from '../../src/index.ts';

/**
 * The one-dot scene every diff test compares takes of. One factory serves the
 * in-process tests and both CLI fixtures, so the magic numbers exist once.
 */
export const take = (swing: number, extra = false): Character => {
  const c = character('take', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
    part('dot', { pivot: [50, 50] }, () => {
      circle({ cx: 50, cy: 50, r: 10, fill: '#123' });
    });
    part('still', () => {
      circle({ cx: 20, cy: 20, r: 4, fill: '#456' });
    });
    if (extra) part('tail', () => { circle({ cx: 80, cy: 80, r: 3, fill: '#789' }); });
  });
  c.part('dot').animate({ rotate: keys([[0, 0], [0.5, swing], [1, 0]]) });
  return c;
};
