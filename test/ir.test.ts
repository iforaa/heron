import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, clipPath, compile, cubicBezier, fromSceneIR, keys, linearGradient,
  mask, netPose, parseEasing, parseScene, part, path, pathMorph, sampled, serializeScene,
  toSceneIR, evaluate,
} from '../src/index.ts';

function richScene() {
  const scene = character('IR film', {
    viewBox: [0, 0, 100, 60], duration: 3, ground: 55, once: true,
  }, () => {
    const glow = linearGradient('glow', {
      stops: [{ at: 0, color: '#08f' }, { at: 1, color: '#fff' }],
    });
    const crop = clipPath('crop', () => circle({ cx: 50, cy: 30, r: 25 }));
    const fade = mask('fade', () => circle({ cx: 50, cy: 30, r: 24, fill: '#fff' }));
    part('mark', {
      pivot: [50, 30], contact: [50, 55], clip: crop, mask: fade,
      transform: { x: 3, rotate: 4, opacity: 0.8 },
    }, () => {
      circle({ cx: 50, cy: 30, r: 20, fill: glow });
      path({
        d: pathMorph([
          [0, 'M30 30 L50 10 L70 30 L50 50 Z'],
          [1, 'M25 25 L50 15 L75 25 L50 55 Z'],
        ]),
        fill: '#fff',
      });
    });
  });
  scene.part('mark').animate({
    rotate: keys([[0, 0, cubicBezier(0.2, 0, 0.8, 1)], [1, 30]]),
    x: sampled((t) => Math.sin(t * Math.PI * 2) * 4, 32),
  });
  return scene;
}

test('scene IR is JSON-safe and preserves structural scene data', () => {
  const scene = richScene();
  const ir = toSceneIR(scene, { samples: 64 });
  const json = JSON.stringify(ir);
  assert.doesNotMatch(json, /function|=>/);
  assert.equal(ir.version, 1);
  assert.equal(ir.definitions.length, 3);
  assert.equal(ir.root.content.length, 1);
  assert.equal(ir.root.content[0].node.tracks[0].x?.keys.length, 65);
  assert.equal(ir.root.content[0].node.tracks[0].rotate?.keys.length, 2);
});

test('scene IR round-trips evaluator, resources, morphs and compilation', () => {
  const original = richScene();
  const restored = parseScene(serializeScene(original, { samples: 128 }));
  assert.equal(restored.name, original.name);
  assert.deepEqual(restored.viewBox, original.viewBox);
  assert.equal(restored.once, true);
  assert.equal(restored.ground, 55);
  assert.equal(restored.definitions.length, 3);
  assert.ok(restored.find('mark')?.content.some((item) => 'shape' in item && item.shape.morph));

  for (const t of [0, 0.125, 0.5, 0.875, 1]) {
    const a = netPose(evaluate(original, t).get('mark'));
    const b = netPose(evaluate(restored, t).get('mark'));
    assert.ok(Math.abs(a.x - b.x) < 1e-9);
    assert.ok(Math.abs(a.rotate - b.rotate) < 1e-9);
  }
  const svg = compile(restored).svg;
  assert.match(svg, /linearGradient id="glow"/);
  assert.match(svg, /clipPath id="crop"/);
  assert.match(svg, /<mask id="fade"/);
  assert.match(svg, /@keyframes kf-morph-0/);
});

test('IR sampling is explicit and version/easing errors are visible', () => {
  const scene = richScene();
  assert.throws(() => toSceneIR(scene, { samples: 1 }), /at least 2/);
  assert.throws(
    () => fromSceneIR({ ...toSceneIR(scene), version: 2 } as never),
    /unsupported scene IR version 2/,
  );
  assert.throws(() => parseScene('{oops'), /invalid scene IR JSON/);
  assert.equal(parseEasing('steps(4, start)').fn(0.1), 0.25);
  assert.throws(() => parseEasing('spring(2)'), /unsupported easing/);
});
