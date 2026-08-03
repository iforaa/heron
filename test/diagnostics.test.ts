import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, keys, lint, part, sampled, type Character,
} from '../src/index.ts';

test('lint discloses transform channels that force one another through baking', () => {
  const scene = character('timing', { viewBox: [0, 0, 100, 100], duration: 1, once: true }, () => {
    part('body', { pivot: [0, 0] }, () => circle({ cx: 20, cy: 20, r: 4 }));
  });
  scene.part('body').animate({
    x: keys([[0, 0], [1, 20]]),
    y: keys([[0, 0], [0.5, 10], [1, 0]]),
  });
  const warning = lint(scene).find((finding) => finding.rule === 'baked-transform');
  assert.ok(warning);
  assert.equal(warning.severity, 'warning');
  assert.match(warning.detail ?? '', /separate animate\(\) layers/);

  const exact = character('exact', { viewBox: [0, 0, 100, 100], duration: 1, once: true }, () => {
    part('body', { pivot: [0, 0] }, () => circle({ cx: 20, cy: 20, r: 4 }));
  });
  exact.part('body').animate({
    x: keys([[0, 0], [1, 20]]),
    y: keys([[0, 0], [1, 10]]),
  });
  assert.ok(!lint(exact).some((finding) => finding.rule === 'baked-transform'));
});

/** A foot on the ground, either stepping properly or sliding at one speed. */
function walker(sliding: boolean): Character {
  const scene = character('w', { viewBox: [0, 0, 300, 120], duration: 1, ground: 100 }, () => {
    part('foot', { pivot: [0, 0], contact: [50, 100], offstage: true }, () => {
      circle({ cx: 50, cy: 100, r: 2 });
    });
  });
  // Both close the loop, or the seam jump would be the fastest thing in the cycle
  // and swamp the very ratio being measured.
  scene.part('foot').animate({
    x: sampled((t) => (sliding
      // Out and back at one constant rate: the skate.
      ? (t < 0.5 ? -160 * t : -160 * (1 - t))
      // Stance tracking the ground, then a swing three times faster.
      : (t < 0.75 ? -80 * (t / 0.75) : -80 * (1 - t) / 0.25)), 60),
    y: sliding ? keys([[0, 0], [1, 0]]) : keys([[0, 0], [0.75, 0], [0.87, -30], [1, 0]]),
  });
  return scene;
}

test('linear-spacing catches a foot that slides, and clears one that steps', () => {
  const slide = lint(walker(true)).find((f) => f.rule === 'linear-spacing');
  assert.ok(slide, 'a constant-rate contact point is a skate');
  assert.equal(slide.severity, 'info', 'a preference may never fail a build');
  assert.match(slide.detail ?? '', /peak is only 1x the median/);

  assert.ok(
    !lint(walker(false)).some((f) => f.rule === 'linear-spacing'),
    'a real gait has a fast swing and is not reported',
  );
});

/** A block that travels and then halts — overshooting its mark, or not. */
function arrival(overshoot: boolean): Character {
  const scene = character('a', { viewBox: [0, 0, 200, 100], duration: 1, once: true }, () => {
    part('block', { pivot: [0, 0] }, () => circle({ cx: 20, cy: 50, r: 6 }));
  });
  scene.part('block').animate({
    x: sampled((t) => (t < 0.25
      ? 400 * t
      // Past the mark and back, damped: what anything with weight does. Or
      // straight to the mark and dead still: the cut.
      : 100 + (overshoot ? 14 * Math.sin((t - 0.25) * 22) * Math.exp(-(t - 0.25) * 9) : 0)), 60),
  });
  return scene;
}

test('abrupt-stop tells a cut from a settle by the overshoot, not by the clock', () => {
  // Every deceleration spans exactly one sample interval, so the timings cannot
  // separate these two. The reversal after the stop can.
  const cut = lint(arrival(false)).find((f) => f.rule === 'abrupt-stop');
  assert.ok(cut, 'stopping dead with no overshoot is reported');
  assert.equal(cut.severity, 'info');
  assert.match(cut.detail ?? '', /no overshoot after it/);

  assert.ok(
    !lint(arrival(true)).some((f) => f.rule === 'abrupt-stop'),
    'a settle that passes its mark and comes back is not a cut',
  );
});

test('one motion is one finding, however many parts carry it', () => {
  // The defect this guards: a parent's deceleration is measurable again at every
  // descendant, and a field of particles driven by one gesture is measurable once
  // per particle — 35 findings for a single `morphThrough` on a real scene. The
  // children need animation of their own, or they are never measured and this
  // passes without reaching the code it is named for.
  const scene = character('deep', { viewBox: [0, 0, 200, 100], duration: 1, once: true }, () => {
    part('body', { pivot: [0, 0] }, () => {
      circle({ cx: 20, cy: 50, r: 6 });
      part('arm', { pivot: [20, 50] }, () => {
        circle({ cx: 30, cy: 50, r: 3 });
        part('hand', { pivot: [30, 50] }, () => circle({ cx: 38, cy: 50, r: 2 }));
      });
    });
  });
  const halt = sampled((t: number) => (t < 0.25 ? 400 * t : 100), 60);
  scene.part('body').animate({ x: halt });
  // Their own tracks, so they are measured — and their own extra travel, so the
  // numbers they report differ from the body's and from each other's. Matching on
  // the rendered sentence let exactly this case back through as three findings.
  scene.part('body.arm').animate({ x: sampled((t: number) => (t < 0.25 ? 40 * t : 10), 60) });
  scene.part('body.arm.hand').animate({ x: sampled((t: number) => (t < 0.25 ? 20 * t : 5), 60) });

  const stops = lint(scene).filter((f) => f.rule === 'abrupt-stop');
  assert.equal(stops.length, 1, `one stop, got ${stops.map((f) => f.part).join(', ')}`);
  assert.equal(stops[0].part, 'body', 'named by the part containing all of them');
  assert.match(stops[0].detail ?? '', /and 2 more part\(s\) at the same instant/);
});

test('siblings driven by one gesture are one finding, not one each', () => {
  // Not a prefix relationship: matching on ancestor paths could never have caught
  // this, and it is the shape that actually produced 35 findings in the wild.
  const scene = character('field', { viewBox: [0, 0, 200, 100], duration: 1, once: true }, () => {
    part('motes', { pivot: [0, 0] }, () => {
      for (let i = 0; i < 6; i++) {
        part(`d${i}`, { pivot: [0, 0] }, () => circle({ cx: 10 + i * 20, cy: 50, r: 3 }));
      }
    });
  });
  // Staggered, as a field driven by one gesture actually is: they stop at six
  // different instants, so grouping by the clock could not have merged them.
  for (let i = 0; i < 6; i++) {
    const stop = 0.2 + i * 0.03;
    scene.part(`motes.d${i}`).animate({
      x: sampled((t: number) => (t < stop ? 300 * t : 300 * stop), 60),
    });
  }

  const stops = lint(scene).filter((f) => f.rule === 'abrupt-stop');
  assert.equal(stops.length, 1, `one gesture, got ${stops.map((f) => f.part).join(', ')}`);
  assert.equal(stops[0].part, 'motes', 'named by the parent that drives them');
  assert.match(stops[0].detail ?? '', /and 5 more part\(s\) between t=/);

  // Two unrelated things stopping are still two findings: the guard is that they
  // are related, not merely that they share a rule.
  const two = character('two', { viewBox: [0, 0, 200, 100], duration: 1, once: true }, () => {
    part('lift', { pivot: [0, 0] }, () => circle({ cx: 20, cy: 20, r: 4 }));
    part('drop', { pivot: [0, 0] }, () => circle({ cx: 20, cy: 80, r: 4 }));
  });
  two.part('lift').animate({ x: sampled((t: number) => (t < 0.25 ? 400 * t : 100), 60) });
  // Stops before the halfway mark, so its own median sits below its travelling
  // speed — `decelerations` only records a slowing from above the median.
  two.part('drop').animate({ y: sampled((t: number) => (t < 0.4 ? 150 * t : 60), 60) });
  assert.equal(lint(two).filter((f) => f.rule === 'abrupt-stop').length, 2);
});

test('no soft diagnostic can fail a build', () => {
  const soft = new Set(['linear-spacing', 'abrupt-stop']);
  for (const build of [walker(true), arrival(false)]) {
    for (const f of lint(build)) {
      if (soft.has(f.rule)) assert.equal(f.severity, 'info', `${f.rule} must stay advisory`);
    }
  }
});

test('lint inspects the delivered frame grid and catches a one-frame pop', () => {
  const scene = character('one-frame', {
    viewBox: [0, 0, 100, 100], duration: 1.1, once: true,
  }, () => {
    part('head', { pivot: [50, 50] }, () => circle({ cx: 50, cy: 50, r: 5 }));
  });
  const delivered = 5 / 11; // frame 5 at 10fps in a 1.1 second film
  scene.part('head').animate({
    x: keys([[0, 0], [0.453, 0], [delivered, 100], [0.456, 0], [1, 0]]),
  });
  assert.ok(
    lint(scene, { fps: 10 }).some((finding) => finding.rule === 'out-of-view'),
    'the exact visible frame must not fall between a fixed normalized lint grid',
  );
});
