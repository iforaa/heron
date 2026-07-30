import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, compile, geometricStrokeFont, keys, listShapes, part, strokeFont, strokeText,
} from '../src/index.ts';

test('stroke text emits deterministic geometry and reports layout metrics', () => {
  let metrics;
  const scene = character('type', { viewBox: [0, 0, 200, 80] }, () => {
    part('title', () => {
      metrics = strokeText('AI', {
        x: 100,
        y: 20,
        size: 20,
        align: 'center',
        tracking: 0.2,
        stroke: '#123',
        width: 2,
      });
    });
  });

  assert.deepEqual(metrics, { width: 35, height: 20, lines: 1 });
  assert.equal(listShapes(scene).length, 4, 'A has three strokes and I has one');
  for (const { shape } of listShapes(scene)) {
    assert.equal(shape.tag, 'line');
    assert.equal(shape.attrs.stroke, '#123');
    assert.equal(shape.attrs['stroke-width'], 2);
  }
});

test('stroke text supports multiline alignment and draw-on animation', () => {
  let metrics;
  const scene = character('title', { viewBox: [0, 0, 300, 160], duration: 2 }, () => {
    part('copy', () => {
      metrics = strokeText('NEXA\nAI', {
        x: 150,
        y: 20,
        size: 30,
        align: 'center',
        lineHeight: 1.5,
      });
    });
  });
  scene.part('copy').animate({ draw: keys([[0, 0], [1, 1]]) });

  assert.deepEqual(metrics, { width: 136.2, height: 75, lines: 2 });
  const { report, svg } = compile(scene);
  assert.ok(report.parts.every((p) => p.mode === 'exact'));
  assert.match(svg, /stroke-dasharray=/);
});

test('custom stroke fonts are data, and missing glyphs fail visibly', () => {
  const font = strokeFont({
    X: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]],
  }, { advance: 1.2, space: 0.6 });

  const scene = character('custom', { viewBox: [0, 0, 100, 100] }, () => {
    strokeText('X X', { font, x: 0, y: 0, size: 10 });
  });
  assert.equal(listShapes(scene).length, 4);
  assert.equal(font.advance, 1.2);
  assert.equal(font.space, 0.6);

  assert.throws(
    () => character('missing', { viewBox: [0, 0, 10, 10] }, () => {
      strokeText('Y', { font, x: 0, y: 0, size: 10 });
    }),
    /no glyph "Y"/,
  );
  assert.ok(geometricStrokeFont.glyphs.Y, 'the built-in face covers the complete uppercase alphabet');
});

test('stroke fonts validate their reusable geometry', () => {
  assert.throws(() => strokeFont({ BAD: [] }), /not one character/);
  assert.throws(
    () => strokeFont({ X: { segments: [], advance: 0 } }),
    /invalid advance/,
  );
});
