import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  arcPath, character, checkLottie, circle, compileLottie, cubicBezier, easeIn, easeOut, keys, layer, line,
  linearGradient, lottieContours, part, path, pathMorph, sampled, score, trackAt, type Track,
  svgShape,
} from '../src/index.ts';

test('Skottie raster playback agrees with the SVG evaluator', async () => {
  const scene = character('player-parity', {
    viewBox: [0, 0, 120, 80], duration: 1, once: true,
  }, () => {
    part('mark', { pivot: [30, 40] }, () => {
      circle({ cx: 30, cy: 40, r: 12, fill: '#17202a', stroke: '#fff', width: 3 });
    });
  });
  scene.part('mark').animate({
    x: keys([[0, 0, easeOut], [0.5, 45, easeIn], [1, 30]]),
    rotate: keys([[0, 0, easeOut], [0.5, 40, easeIn], [1, 10]]),
    opacity: keys([[0, 0.4], [1, 1]]),
  });
  const { json } = compileLottie(scene, { fps: 30 });
  const report = await checkLottie(scene, json, {
    times: [0, 0.2, 0.5, 0.8, 1], width: 600, minOverlap: 97,
  });
  assert.equal(report.renderer, 'Skia Skottie');
  assert.equal(report.ok, true, JSON.stringify(report.samples));
  assert.ok(report.worstOverlap >= 97);
});

function replayProperty(property: Record<string, any>, frame: number): number[] {
  if (!property.a) return Array.isArray(property.k) ? property.k : [property.k];
  const keys = property.k as Array<Record<string, any>>;
  if (frame <= keys[0].t) return keys[0].s;
  if (frame >= keys.at(-1)!.t) return keys.at(-1)!.s;
  const end = keys.findIndex((key) => key.t >= frame);
  const a = keys[end - 1];
  const b = keys[end];
  if (a.h) return a.s;
  const u = (frame - a.t) / (b.t - a.t);
  const eased = cubicBezier(a.o.x[0], a.o.y[0], a.i.x[0], a.i.y[0]).fn(u);
  return a.s.map((value: number, index: number) =>
    value + (b.s[index] - value) * eased);
}

test('SVG paths become Lottie cubic contours, including arcs and compound holes', () => {
  const ring = lottieContours(arcPath({ cx: 50, cy: 50, r: 20 }));
  assert.equal(ring.length, 1);
  assert.equal(ring[0].c, true);
  assert.equal(ring[0].v.length, 4);
  assert.ok(ring[0].i.some(([x, y]) => x !== 0 || y !== 0));

  const compound = lottieContours('M0 0 L20 0 L20 20 L0 20 Z M5 5 h10 v10 h-10 z');
  assert.equal(compound.length, 2);
  assert.deepEqual(compound.map((contour) => contour.c), [true, true]);
});

test('a scene compiles to parented shape layers, native keyframes, trims and markers', () => {
  const scene = character('native-mark', {
    viewBox: [10, 20, 100, 80],
    duration: 2,
    once: true,
  }, () => {
    part('body', { pivot: [50, 50] }, () => {
      circle({ cx: 50, cy: 50, r: 12, fill: '#336699' });
      layer('stroke', () => {
        line({ from: [20, 70], to: [80, 70], stroke: '#fff', width: 4 });
      });
    });
  });
  scene.part('body').animate({
    rotate: keys([[0, 0], [0.5, 30], [1, 0]]),
    opacity: keys([[0, 1], [1, 0.5]]),
  });
  scene.part('body.stroke').animate({
    x: sampled((t) => Math.sin(t * Math.PI) * 8, 24),
    draw: keys([[0, 0], [1, 1]]),
  });
  const beats = score(scene, [['move', 1.25], ['hold', 0.75]]);

  const { animation, report } = compileLottie(scene, { fps: 30, timeline: beats });
  assert.equal(animation.w, 100);
  assert.equal(animation.h, 80);
  assert.equal(animation.fr, 30);
  assert.equal(animation.op, 60);
  assert.deepEqual(animation.markers, [
    { tm: 0, dr: 37.5, cm: 'move' },
    { tm: 37.5, dr: 22.5, cm: 'hold' },
  ]);

  const layers = animation.layers as Array<Record<string, any>>;
  const viewport = layers.find((entry) => entry.nm === 'Heron viewBox');
  assert.deepEqual(viewport.ks.p.k, [-10, -20, 0]);

  const body = layers.find((entry) => entry.nm === 'body');
  const strokePart = layers.find((entry) => entry.nm === 'body.stroke');
  assert.equal(strokePart.parent, body.ind);
  assert.equal(body.ks.r.a, 1);
  assert.equal(strokePart.ks.p.x.a, 1);

  const strokedShape = layers.find((entry) =>
    entry.ty === 4 && entry.shapes.some((shape: { ty: string }) => shape.ty === 'st'));
  assert.ok(strokedShape.shapes.some((shape: { ty: string }) => shape.ty === 'tm'));
  assert.ok(report.animatedProperties >= 4);
  assert.ok(report.sampledProperties >= 1);
  assert.ok(report.warnings.some((warning) => /loop: false/.test(warning)));
});

test('Lottie keys hold authored endpoints and sampled channels use native frame time', () => {
  const scene = character('clock', {
    viewBox: [0, 0, 100, 100], duration: 1.1,
  }, () => {
    part('mark', () => circle({ cx: 10, cy: 10, r: 2, fill: '#000' }));
  });
  scene.part('mark').animate({
    rotate: keys([[0.25, 10], [0.75, 30]]),
    x: sampled((t) => t * 11, 20),
  });

  const { animation } = compileLottie(scene, { fps: 4 });
  const layer = (animation.layers as Array<Record<string, any>>)
    .find((entry) => entry.nm === 'mark');
  assert.deepEqual(layer.ks.r.k.map((key: { t: number }) => key.t), [0, 1.1, 3.3, 4.4]);
  assert.deepEqual(layer.ks.r.k.map((key: { s: number[] }) => key.s[0]), [10, 10, 30, 30]);
  assert.deepEqual(layer.ks.p.x.k.map((key: { t: number }) => key.t), [0, 1, 2, 3, 4, 4.4]);
  assert.deepEqual(layer.ks.p.x.k.map((key: { s: number[] }) => key.s[0]), [0, 2.5, 5, 7.5, 10, 11]);
});

test('Lottie shape opacity composites fill and stroke once and warns on fill-only draw', () => {
  const scene = character('paint', { viewBox: [0, 0, 20, 20] }, () => {
    part('both', () => circle({ cx: 5, cy: 5, r: 3, fill: '#000', stroke: '#fff', opacity: 0.5 }));
    part('fillOnly', () => circle({ cx: 15, cy: 5, r: 3, fill: '#000' }));
  });
  scene.part('fillOnly').animate({ draw: keys([[0, 0], [1, 1]]) });

  const { animation, report } = compileLottie(scene);
  const layers = animation.layers as Array<Record<string, any>>;
  const both = layers.find((entry) => entry.nm.startsWith('both shape'));
  assert.equal(both.ks.o.k, 50);
  assert.deepEqual(
    both.shapes.filter((item: { ty: string }) => item.ty === 'fl' || item.ty === 'st')
      .map((item: { o: { k: number } }) => item.o.k),
    [100, 100],
  );
  assert.ok(report.warnings.some((warning) => /fill-only/.test(warning)));
});

test('Lottie property playback agrees with Heron values, not just JSON structure', () => {
  const track: Track = {
    x: keys([[0, 0, easeIn], [0.4, 20, easeOut], [1, -5]]),
    y: keys([[0, 0, easeOut], [0.4, -10, easeIn], [1, 8]]),
    rotate: keys([[0, 0, easeIn], [0.4, 80, easeOut], [1, -20]]),
    scaleX: keys([[0, 1, easeOut], [0.4, 1.4, easeIn], [1, 0.8]]),
    scaleY: keys([[0, 1, easeOut], [0.4, 0.7, easeIn], [1, 1.2]]),
    opacity: keys([[0, 1, easeIn], [0.4, 0.3, easeOut], [1, 0.8]]),
    draw: keys([[0, 0, easeOut], [0.4, 0.6, easeIn], [1, 1]]),
  };
  const scene = character('parity', { viewBox: [0, 0, 100, 100], duration: 2 }, () => {
    part('mark', { pivot: [7, 9] }, () => line({ from: [0, 0], to: [20, 0], stroke: '#000' }));
  });
  scene.part('mark').animate(track);

  const fps = 10;
  const { animation } = compileLottie(scene, { fps });
  const layers = animation.layers as Array<Record<string, any>>;
  const nullLayer = layers.find((entry) => entry.nm === 'mark');
  const shapeLayer = layers.find((entry) => entry.nm.startsWith('mark shape'));
  const trim = shapeLayer.shapes.find((item: { ty: string }) => item.ty === 'tm');

  for (const t of [0, 0.13, 0.4, 0.67, 1]) {
    const expected = trackAt(track, t);
    const at = t * scene.duration * fps;
    assert.ok(Math.abs(replayProperty(nullLayer.ks.p.x, at)[0] - (7 + expected.x)) < 1e-3);
    assert.ok(Math.abs(replayProperty(nullLayer.ks.p.y, at)[0] - (9 + expected.y)) < 1e-3);
    assert.ok(Math.abs(replayProperty(nullLayer.ks.r, at)[0] - expected.rotate) < 1e-3);
    const scale = replayProperty(nullLayer.ks.s, at);
    assert.ok(Math.abs(scale[0] - 100 * expected.scaleX) < 1e-3);
    assert.ok(Math.abs(scale[1] - 100 * expected.scaleY) < 1e-3);
    assert.ok(Math.abs(replayProperty(shapeLayer.ks.o, at)[0] - 100 * expected.opacity) < 1e-3);
    assert.ok(Math.abs(replayProperty(trim.e, at)[0] - 100 * expected.draw) < 1e-3);
  }
});

test('Lottie preserves static part transforms without reporting animation', () => {
  const scene = character('rest', { viewBox: [0, 0, 100, 100] }, () => {
    part('mark', {
      pivot: [10, 20], transform: { x: 3, y: 4, rotate: 15, scaleX: 1.2, opacity: 0.4 },
    }, () => circle({ cx: 10, cy: 20, r: 3, fill: '#000' }));
  });
  const { animation, report } = compileLottie(scene);
  const layers = animation.layers as Array<Record<string, any>>;
  const rest = layers.find((entry) => entry.nm === 'mark rest');
  const shape = layers.find((entry) => entry.nm.startsWith('mark shape'));
  assert.deepEqual(rest.ks.p.k, [13, 24, 0]);
  assert.equal(rest.ks.r.k, 15);
  assert.deepEqual(rest.ks.s.k, [120, 100, 100]);
  assert.equal(shape.parent, rest.ind);
  assert.equal(shape.ks.o.k, 40);
  assert.equal(report.animatedProperties, 0);
});

test('visible shape layers receive the complete Heron opacity chain', () => {
  const scene = character('opacity-chain', { viewBox: [0, 0, 100, 100] }, () => {
    part('parent', () => {
      circle({ cx: 25, cy: 25, r: 10, fill: '#000' });
      part('child', () => {
        circle({ cx: 50, cy: 50, r: 10, fill: '#000' });
      });
    });
  });
  scene.part('parent').animate({ opacity: keys([[0, 0.5], [1, 0.5]]) });
  scene.part('parent.child').animate({ opacity: keys([[0, 0.4], [1, 0.8]]) });

  const { animation } = compileLottie(scene, { fps: 30 });
  const layers = animation.layers as Array<Record<string, any>>;
  const parentNull = layers.find((entry) => entry.nm === 'parent');
  const childNull = layers.find((entry) => entry.nm === 'parent.child');
  const parentShape = layers.find((entry) => entry.nm.startsWith('parent shape'));
  const childShape = layers.find((entry) => entry.nm.startsWith('parent.child shape'));

  assert.equal(parentNull.ks.o.k, 100);
  assert.equal(childNull.ks.o.k, 100);
  assert.equal(parentShape.ks.o.k, 50);
  assert.equal(childShape.ks.o.a, 1);
  assert.deepEqual(childShape.ks.o.k.map((key: { s: number[] }) => key.s[0]), [20, 40]);
});

test('overlapping animated ancestor opacities are multiplied on the sampled grid', () => {
  const scene = character('opacity-product', { viewBox: [0, 0, 100, 100] }, () => {
    part('parent', () => {
      part('child', () => {
        circle({ cx: 50, cy: 50, r: 10, fill: '#000' });
      });
    });
  });
  scene.part('parent').animate({ opacity: keys([[0, 0], [1, 1]]) });
  scene.part('parent.child').animate({ opacity: keys([[0, 1], [1, 0.5]]) });

  const { animation, report } = compileLottie(scene, { fps: 10 });
  const layers = animation.layers as Array<Record<string, any>>;
  const shape = layers.find((entry) => entry.nm.startsWith('parent.child shape'));
  const values = shape.ks.o.k.map((key: { s: number[] }) => key.s[0]);

  assert.equal(values[0], 0);
  assert.equal(values.at(-1), 50);
  assert.ok(values[5] > 0 && values[5] < 50);
  assert.equal(report.sampledProperties, 1);
});

test('the first Lottie backend refuses unsupported paint and geometry honestly', () => {
  const gradientScene = character('gradient', { viewBox: [0, 0, 100, 100] }, () => {
    const paint = linearGradient('fade', {
      stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }],
    });
    path({ d: 'M0 0 L100 0 L100 100 Z', fill: paint });
  });
  assert.throws(() => compileLottie(gradientScene), /gradient paint.*not supported/);

  const morphScene = character('morph', { viewBox: [0, 0, 100, 100] }, () => {
    path({
      d: pathMorph([
        [0, 'M0 0 L10 0 L10 10 Z'],
        [1, 'M0 0 L20 0 L20 20 Z'],
      ]),
      fill: '#000',
    });
  });
  assert.throws(() => compileLottie(morphScene), /pathMorph is not supported/);

  const skewScene = character('skew', { viewBox: [0, 0, 100, 100] }, () => {
    part('mark', { pivot: [50, 50] }, () => circle({ cx: 50, cy: 50, r: 10, fill: '#000' }));
  });
  skewScene.part('mark').animate({ skewX: keys([[0, 0], [1, 20]]) });
  assert.throws(() => compileLottie(skewScene), /part "mark" uses skew/);

  const transformed = character('raw-transform', { viewBox: [0, 0, 100, 100] }, () => {
    svgShape('path', { d: 'M0 0 L10 0', stroke: '#000', transform: 'translate(5 5)' });
  });
  assert.throws(() => compileLottie(transformed), /raw SVG transform.*not supported/);
});
