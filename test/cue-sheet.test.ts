import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, cueFrames, cueSheet, part, renderCueSheet, score,
} from '../src/index.ts';

const scene = character('film', { viewBox: [0, 0, 100, 50], duration: 10, once: true }, () => {
  part('mark', () => circle({ cx: 50, cy: 25, r: 10, fill: '#000' }));
});

test('cue frames preserve authored cue context at shared boundaries', () => {
  const cues = cueSheet(scene, {
    opening: [0, 4],
    transition: [3, 6],
    finale: [6, 10],
  });
  const frames = cueFrames(cues, { samples: 3, cues: ['transition', 'finale'] });
  assert.deepEqual(
    frames.map((f) => [f.cue, f.time, f.progress, f.seconds]),
    [
      ['transition', 0.3, 0, 3],
      ['transition', 0.45, 0.5, 4.5],
      ['transition', 0.6, 1, 6],
      ['finale', 0.6, 0, 6],
      ['finale', 0.8, 0.5, 8],
      ['finale', 1, 1, 10],
    ],
  );
});

test('cue-aware sheets label local progress and absolute seconds', () => {
  const cues = cueSheet(scene, { opening: [0, 4], finale: [6, 10] });
  const svg = renderCueSheet(scene, cues, { samples: [0.25, 0.75], cols: 2 });
  assert.match(svg, /opening 25% · 1.00s/);
  assert.match(svg, /opening 75% · 3.00s/);
  assert.match(svg, /finale 25% · 7.00s/);
  assert.match(svg, /finale 75% · 9.00s/);
});

test('sequential scores can drive the same review sheet', () => {
  const beats = score(scene, [['setup', 4], ['payoff', 6]]);
  const frames = cueFrames(beats, { samples: 1 });
  assert.deepEqual(frames.map((f) => [f.cue, f.seconds]), [['setup', 2], ['payoff', 7]]);
  assert.match(renderCueSheet(scene, beats, { samples: 1 }), /payoff 50% · 7.00s/);
});

test('cue-aware sheets reject invalid selections and mismatched films', () => {
  const cues = cueSheet(scene, { opening: [0, 4] });
  assert.throws(() => cueFrames(cues, { cues: ['missing'] }), /no cue "missing"/);
  assert.throws(() => cueFrames(cues, { samples: [] }), /sample positions/);
  assert.throws(() => cueFrames(cues, { samples: 2.5 }), /positive integer/);

  const short = character('short', { viewBox: [0, 0, 10, 10], duration: 2 }, () => {
    circle({ cx: 5, cy: 5, r: 2 });
  });
  assert.throws(() => renderCueSheet(short, cues), /does not match/);
});
