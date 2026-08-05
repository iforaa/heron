import { character, circle, keys, part } from '../../src/index.ts';

export const take = character('take', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
  part('dot', { pivot: [50, 50] }, () => {
    circle({ cx: 50, cy: 50, r: 10, fill: '#123' });
  });
});
take.part('dot').animate({ rotate: keys([[0, 0], [0.5, 10], [1, 0]]) });
