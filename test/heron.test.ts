import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, part, limb, ellipse, circle, path, keys, sampled,
  compile, evaluate, pointAt, lint, renderStatic,
  cubicBezier, linear, easeInOut, walkCycle, partBox,
} from '../src/index.ts';
import { crane } from '../examples/crane.ts';

test('cubic-bezier matches the CSS curve at known points', () => {
  const e = cubicBezier(0.42, 0, 0.58, 1);
  assert.equal(e.fn(0), 0);
  assert.equal(e.fn(1), 1);
  assert.ok(Math.abs(e.fn(0.5) - 0.5) < 1e-6, 'symmetric curve passes through its midpoint');
  // Monotonic, which every CSS timing function used here must be.
  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const v = e.fn(i / 20);
    assert.ok(v >= prev, 'progress never goes backwards');
    prev = v;
  }
});

test('keyframe easing applies to the segment that starts at the key', () => {
  const scene = character('t', { viewBox: [0, 0, 10, 10] }, () => {
    part('a', { pivot: [0, 0] }, () => circle({ cx: 0, cy: 0, r: 1 }));
  });
  scene.part('a').animate({ rotate: keys([[0, 0, linear], [0.5, 10, easeInOut], [1, 0]]) });

  assert.equal(evaluate(scene, 0).get('a')!.rotate, 0);
  assert.equal(evaluate(scene, 0.25).get('a')!.rotate, 5, 'linear segment interpolates linearly');
  assert.equal(evaluate(scene, 0.5).get('a')!.rotate, 10);
  // The eased segment is symmetric, so its midpoint is still halfway in value.
  assert.ok(Math.abs(evaluate(scene, 0.75).get('a')!.rotate - 5) < 1e-6);
});

test('phase offsets sample the same curve earlier', () => {
  const scene = character('t', { viewBox: [0, 0, 10, 10] }, () => {
    part('a', { pivot: [0, 0] }, () => circle({ cx: 0, cy: 0, r: 1 }));
    part('b', { pivot: [0, 0] }, () => circle({ cx: 0, cy: 0, r: 1 }));
  });
  const track = { rotate: keys([[0, 0], [0.5, 10], [1, 0]]) };
  scene.part('a').animate(track);
  scene.part('b').animate({ ...track, phase: 0.5 });

  assert.equal(evaluate(scene, 0).get('b')!.rotate, evaluate(scene, 0.5).get('a')!.rotate);
  assert.equal(evaluate(scene, 0.25).get('b')!.rotate, evaluate(scene, 0.75).get('a')!.rotate);
});

test('nested pivots compose: a child follows its parent', () => {
  const scene = character('t', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
    part('upper', { pivot: [50, 20] }, () => {
      part('lower', { pivot: [50, 60], contact: [50, 100] }, () => circle({ cx: 50, cy: 60, r: 1 }));
    });
  });
  // Rotating only the parent must still move the child's contact point.
  scene.part('upper').animate({ rotate: keys([[0, 0], [1, 90]]) });
  const [x0, y0] = pointAt(scene, 'lower', 0);
  assert.equal(Math.round(x0), 50);
  assert.equal(Math.round(y0), 100);

  const [x1, y1] = pointAt(scene, 'lower', 1);
  // A 90 degree turn about (50,20) sends the point 80 below the pivot to 80 left of it.
  assert.equal(Math.round(x1), -30);
  assert.equal(Math.round(y1), 20);
});

test('part lookup accepts a shorthand path but refuses an ambiguous one', () => {
  const scene = character('t', { viewBox: [0, 0, 10, 10] }, () => {
    part('body', () => {
      limb('legA', { hip: [0, 0], segments: [4, 4], stroke: '#000', foot: { toe: [1, 0], heel: [-1, 0] } });
      limb('legB', { hip: [2, 0], segments: [4, 4], stroke: '#000', foot: { toe: [1, 0], heel: [-1, 0] } });
    });
  });
  assert.equal(scene.find('legA.foot')!.path, 'body.legA.thigh.shin.foot');
  assert.throws(() => scene.part('foot'), /ambiguous/);
  assert.throws(() => scene.part('nope'), /no part/);
});

test('CSS-expressible keyframes compile exactly, with no resampling', () => {
  const scene = character('t', { viewBox: [0, 0, 10, 10] }, () => {
    part('a', { pivot: [0, 0] }, () => circle({ cx: 0, cy: 0, r: 1 }));
  });
  scene.part('a').animate({ rotate: keys([[0, 0, linear], [0.6, 30, easeInOut], [1, 0]]) });
  const { report, svg } = compile(scene);

  assert.equal(report.parts[0].mode, 'exact');
  assert.equal(report.parts[0].keyframes, 3, 'authored keyframes are emitted verbatim');
  // Named curves keep their CSS keyword rather than being expanded.
  assert.match(svg, /animation-timing-function: ease-in-out/);
  assert.match(svg, /60% \{ transform: rotate\(30deg\)/);
});

test('procedural motion is baked down to far fewer keyframes than samples', () => {
  // That the baked curve still matches the evaluator is checked exhaustively in
  // parity.test.ts; what matters here is that the fitter actually reduces.
  const wobble = (t: number) => Math.sin(t * Math.PI * 2) * 12;
  const scene = character('t', { viewBox: [0, 0, 10, 10] }, () => {
    part('a', { pivot: [0, 0] }, () => circle({ cx: 0, cy: 0, r: 1 }));
  });
  scene.part('a').animate({ rotate: sampled(wobble, 64) });
  const { report } = compile(scene);

  assert.equal(report.parts[0].mode, 'baked');
  assert.equal(report.parts[0].reason, 'procedural channel');
  assert.ok(report.parts[0].keyframes < 32, `expected a sparse fit, got ${report.parts[0].keyframes} keyframes`);
});

test('lints catch a cycle that does not close and a foot that floats', () => {
  const scene = character('t', { viewBox: [0, 0, 100, 200], ground: 100 }, () => {
    part('leg', { pivot: [50, 0], contact: [50, 50] }, () => circle({ cx: 50, cy: 50, r: 1 }));
  });
  scene.part('leg').animate({ rotate: keys([[0, 0], [1, 40]]) });

  const findings = lint(scene);
  assert.ok(findings.some((f) => f.rule === 'loop-seam' && f.severity === 'error'));
  assert.ok(findings.some((f) => f.rule === 'no-ground-contact'));
});

test('the reference walk keeps a planted foot at constant ground speed', () => {
  // The defect this guards against is subtle in a still frame and obvious in
  // the numbers: a foot that changes speed while planted reads as skating.
  const steps: number[] = [];
  let prev: number | null = null;
  for (let i = 0; i <= 11; i++) {
    const t = i / 20; // stance only
    const [x] = pointAt(crane, 'legNear.foot', t);
    if (prev !== null) steps.push(x - prev);
    prev = x;
  }
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  for (const s of steps) {
    assert.ok(Math.abs(s - mean) / Math.abs(mean) < 0.06, `stance step ${s.toFixed(2)} deviates from ${mean.toFixed(2)}`);
  }
  assert.ok(mean < 0, 'a walking character tracks the ground backwards');
});

test('a character with different proportions also stays clean', async () => {
  // The gopher is short-legged and round where the crane is tall and thin. It
  // exists to keep the rig, the gait rules and the lints honest about
  // generalising, rather than being tuned to one silhouette.
  const { gopher } = await import('../examples/gopher.ts');
  assert.deepEqual(lint(gopher), []);
  const { report } = compile(gopher);
  assert.ok(report.parts.length > 8);
  assert.ok(report.parts.every((p) => p.mode === 'exact'));
});

test('knee flexion is solved from geometry, not copied between characters', () => {
  // Clearance is shin * (1 - cos lift), so a short shin needs MORE flexion than
  // a long one to lift the foot the same distance.
  const longLeg = walkCycle({ segments: [36, 32], clearance: 6 });
  const shortLeg = walkCycle({ segments: [13, 13], clearance: 6 });
  const peakOf = (tr: ReturnType<typeof walkCycle>['shin']) => {
    const ch = tr.rotate as Extract<typeof tr.rotate, { kind: 'keys' }>;
    return Math.max(...ch.keys.map((k) => k.v));
  };
  assert.ok(peakOf(shortLeg.shin) > peakOf(longLeg.shin), 'shorter shin needs a bigger knee break');
});

test('facing mirrors every joint, so a left-facing character walks forward', () => {
  // No lint can catch this one: a gait run against the artwork's facing still
  // holds a perfectly constant contact speed, it just travels backwards.
  const right = walkCycle({ reach: 14, segments: [30, 30] });
  const left = walkCycle({ reach: 14, segments: [30, 30], facing: -1 });
  const at = (tr: ReturnType<typeof walkCycle>['thigh']) =>
    tr.rotate as Extract<typeof tr.rotate, { kind: 'keys' }>;

  for (const joint of ['thigh', 'shin', 'foot'] as const) {
    const a = at(right[joint]).keys;
    const b = at(left[joint]).keys;
    assert.equal(a.length, b.length, `${joint} keeps its keyframe count`);
    a.forEach((k, i) => {
      assert.equal(b[i].t, k.t, `${joint} keeps its timing`);
      assert.equal(b[i].v, -k.v, `${joint} angle is mirrored`);
    });
  }
});

test('the left-facing logo walks the way it points', async () => {
  const { tenfore } = await import('../examples/tenfore.ts');
  assert.deepEqual(lint(tenfore), []);
  // Beak points left, so the planted foot must track right, against travel.
  const [x0] = pointAt(tenfore, 'legNear.foot', 0);
  const [x1] = pointAt(tenfore, 'legNear.foot', 0.5);
  assert.ok(x1 > x0, `contact must track forward, got ${x0.toFixed(1)} -> ${x1.toFixed(1)}`);
});

test('a big arc is bounded by its own extent, not padded by its radii', () => {
  // Padding endpoints by the radii — the cheap approximation — makes a ring
  // report a box two radii too big and trips out-of-view on clean artwork.
  const r = 100;
  const scene = character('t', { viewBox: [0, 0, 300, 300] }, () => {
    part('ring', { pivot: [150, 150] }, () => {
      path({ d: `M250,150 A${r},${r} 0 1 1 50,150`, stroke: '#000', width: 2 });
    });
  });
  const box = partBox(scene, 'ring', 0)!;
  // Sweeping positive from 0 to 180 degrees traces the LOWER half of a circle
  // centred at (150,150). So the extreme at 90 degrees must be found, the one
  // at 270 must not, and naive radius padding would report 50..350 on both axes.
  assert.ok(Math.abs(box.x0 - 50) < 1.5 && Math.abs(box.x1 - 250) < 1.5, `x ${box.x0}..${box.x1}`);
  assert.ok(Math.abs(box.y0 - 150) < 1.5 && Math.abs(box.y1 - 250) < 1.5, `y ${box.y0}..${box.y1}`);
});

test('the crane example is clean and compiles to a self-contained file', () => {
  assert.deepEqual(lint(crane), []);
  const { svg, report } = compile(crane);
  assert.ok(report.parts.every((p) => p.mode === 'exact'), 'authored motion needs no baking');
  assert.ok(!/<script/i.test(svg), 'output carries no script');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), 'output references nothing external');
  assert.match(svg, /transform-box: view-box/);
  assert.match(svg, /prefers-reduced-motion/);
});

test('static render and compiled markup describe the same rig', () => {
  const still = renderStatic(crane, 0.3);
  const { svg } = compile(crane);
  for (const cls of ['h-body-legNear-thigh', 'h-body-neck-head', 'h-shadow']) {
    assert.ok(still.includes(cls), `${cls} present in the snapshot`);
    assert.ok(svg.includes(cls), `${cls} present in the build`);
  }
});

test('walkCycle parameters change the motion they claim to', () => {
  const small = walkCycle({ reach: 10 });
  const big = walkCycle({ reach: 30 });
  const at = (tr: ReturnType<typeof walkCycle>['thigh'], t: number) =>
    evaluate(
      (() => {
        const s = character('x', { viewBox: [0, 0, 1, 1] }, () => {
          part('p', { pivot: [0, 0] }, () => circle({ cx: 0, cy: 0, r: 1 }));
        });
        s.part('p').animate(tr);
        return s;
      })(),
      t,
    ).get('p')!.rotate;

  assert.ok(Math.abs(at(big.thigh, 0)) > Math.abs(at(small.thigh, 0)), 'a bigger reach is a longer stride');
});
