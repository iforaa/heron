import { character, circle, keys, part } from '../../src/index.ts';

const badLoop = character('bad loop fixture', { viewBox: [0, 0, 20, 20] }, () => {
  part('mark', () => circle({ cx: 10, cy: 10, r: 4, fill: '#000' }));
});

badLoop.part('mark').animate({ x: keys([[0, 0], [1, 8]]) });

export default badLoop;
