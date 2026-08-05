import { character, circle, keys, part } from '../../src/index.ts';

export const take = character('take', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
  part('dot', { pivot: [50, 50] }, () => {
    circle({ cx: 50, cy: 50, r: 10, fill: '#123' });
  });
  part('tail', () => {
    circle({ cx: 80, cy: 80, r: 3, fill: '#789' });
  });
});
take.part('dot').animate({ rotate: keys([[0, 0], [0.5, 30], [1, 0]]) });
