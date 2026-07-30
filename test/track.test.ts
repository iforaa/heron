import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, cueSheet, keys, part, rect, renderMotionSheet, resolvePart, trackParts,
} from '../src/index.ts';

/** A dot that slides right at a constant rate, so every number is known up front. */
function slider(): ReturnType<typeof character> {
  const scene = character('slider', { viewBox: [0, 0, 200, 100], duration: 2, once: true }, () => {
    part('dot', { pivot: [10, 50] }, () => circle({ cx: 10, cy: 50, r: 4, fill: '#000' }));
  });
  scene.part('dot').animate({ x: keys([[0, 0], [1, 100]]) });
  return scene;
}

test('speeds are per second, so they do not change when the sample count does', () => {
  const scene = slider();
  const coarse = trackParts(scene, { parts: ['dot'], samples: 12 });
  const fine = trackParts(scene, { parts: ['dot'], samples: 48 });

  // 100 units over 2 seconds is 50 units a second, whichever grid measures it.
  for (const r of [coarse, fine]) {
    assert.equal(r.parts[0].pathLength, 100);
    assert.ok(Math.abs(r.parts[0].speed.median - 50) < 0.01, `median was ${r.parts[0].speed.median}`);
  }
  assert.equal(coarse.parts[0].speed.median, fine.parts[0].speed.median);
});

test('a film measures its final pose; a loop does not measure its own start twice', () => {
  const film = trackParts(slider(), { parts: ['dot'], samples: 10 });
  assert.equal(film.endpoints, 'inclusive');
  assert.equal(film.parts[0].samples.at(-1)!.t, 1, 'the last thing a viewer sees must be measured');

  const cycle = character('cycle', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
    part('dot', { pivot: [50, 50] }, () => circle({ cx: 50, cy: 50, r: 4, fill: '#000' }));
  });
  cycle.part('dot').animate({ x: keys([[0, 0], [0.5, 20], [1, 0]]) });
  const looped = trackParts(cycle, { parts: ['dot'], samples: 12 });
  assert.equal(looped.endpoints, 'exclusive');
  assert.ok(looped.parts[0].samples.at(-1)!.t < 1);
  // An inclusive grid would repeat t=0 at t=1: a zero-length step, and a hold
  // reported where the motion is actually at full speed.
  assert.equal(looped.parts[0].holds.length, 0);
});

test('a part with no artwork of its own is tracked by its subtree, not the origin', () => {
  const scene = character('group', { viewBox: [0, 0, 200, 100], duration: 1, once: true }, () => {
    // A pure transform group: no shapes, and a pivot at the origin, which is the
    // ordinary way of saying "this one only translates".
    part('travel', { pivot: [0, 0] }, () => {
      part('left', { pivot: [0, 50] }, () => circle({ cx: 0, cy: 50, r: 5, fill: '#000' }));
      part('right', { pivot: [100, 50] }, () => circle({ cx: 100, cy: 50, r: 5, fill: '#000' }));
    });
  });
  const r = trackParts(scene, { parts: ['travel'], samples: 4 });
  assert.equal(r.parts[0].trackedAt.source, 'ink');
  assert.deepEqual(r.parts[0].trackedAt.local, [50, 50], 'the centre of the ink it carries');
});

test('a part hidden by an ancestor is reported as faded out', () => {
  const scene = character('shot', { viewBox: [0, 0, 100, 100], duration: 1, once: true }, () => {
    part('group', { pivot: [50, 50] }, () => {
      part('dot', { pivot: [50, 50] }, () => circle({ cx: 50, cy: 50, r: 5, fill: '#000' }));
    });
  });
  // The child never touches its own opacity; the shot above it fades away.
  scene.part('group').animate({ opacity: keys([[0, 1], [0.5, 1], [0.51, 0], [1, 0]]) });
  scene.part('group.dot').animate({ x: keys([[0, 0], [1, 40]]) });

  const r = trackParts(scene, { parts: ['group.dot'], samples: 20 });
  const visible = r.parts[0].samples.filter((s) => s.visible).length;
  assert.ok(visible > 0 && visible < 20, `expected a partial fade, got ${visible}/20 visible`);
  assert.ok(r.parts[0].invisible.length >= 1);
  assert.ok(r.parts[0].dropped > 0);
  // The chord across the vanished stretch is not travel anybody saw.
  assert.ok(r.parts[0].pathLength < 40);
});

test('part paths resolve loosely, and a miss suggests the near ones', () => {
  const scene = character('rig', { viewBox: [0, 0, 100, 100], duration: 1 }, () => {
    part('mom', { pivot: [20, 50] }, () => {
      part('head', { pivot: [20, 20] }, () => circle({ cx: 20, cy: 20, r: 4, fill: '#000' }));
    });
    part('kid', { pivot: [70, 50] }, () => {
      part('head', { pivot: [70, 30] }, () => circle({ cx: 70, cy: 30, r: 3, fill: '#000' }));
    });
  });
  assert.equal(resolvePart(scene, 'mom.head').path, 'mom.head');
  assert.equal(resolvePart(scene, 'kid').path, 'kid');
  // Ambiguity is the scene model's own rule, reported against the candidates.
  assert.throws(() => resolvePart(scene, 'head'), /ambiguous.*mom\.head.*kid\.head/s);
  // A miss suggests, rather than dumping every path in a 150-part film.
  assert.throws(() => resolvePart(scene, 'wing'), /no part "wing"/);
  assert.throws(() => resolvePart(scene, 'hea'), /Did you mean: mom\.head, kid\.head/);
});

test('an explicit point can be named on the command line', () => {
  const scene = character('beak', { viewBox: [0, 0, 100, 100], duration: 1, once: true }, () => {
    part('head', { pivot: [50, 50] }, () => circle({ cx: 50, cy: 50, r: 10, fill: '#000' }));
  });
  scene.part('head').animate({ rotate: keys([[0, 0], [1, 90]]) });
  const r = trackParts(scene, { parts: ['head@60,50'], samples: 8 });
  assert.equal(r.parts[0].trackedAt.source, 'explicit');
  assert.deepEqual(r.parts[0].trackedAt.local, [60, 50]);
  // Rotating a point offset from the pivot has to sweep an arc, not sit still.
  assert.ok(r.parts[0].pathLength > 5);
  assert.throws(() => trackParts(scene, { parts: ['head@nonsense'] }), /path@x,y/);
});

test('clearance is measured between artwork, and reports overlap', () => {
  const scene = character('pass', { viewBox: [0, 0, 200, 100], duration: 1, once: true }, () => {
    part('a', { pivot: [20, 50] }, () => rect({ x: 10, y: 40, w: 20, h: 20, fill: '#000' }));
    part('b', { pivot: [150, 50] }, () => rect({ x: 140, y: 40, w: 20, h: 20, fill: '#000' }));
  });
  // `a` slides across until it is exactly where `b` is, then back.
  scene.part('a').animate({ x: keys([[0, 0], [0.5, 130], [1, 0]]) });

  const r = trackParts(scene, { parts: ['a'], compare: ['b'], samples: 21 });
  const gap = r.parts[0].clearance['b'];
  assert.equal(gap.minimum, 0, 'the boxes meet at the crossing');
  assert.ok(gap.overlaps.length > 0);
  assert.ok(Math.abs(gap.at - 0.5) < 0.06, `closest at t=${gap.at}`);
  // The compared part is carried in the report so its path can be drawn too.
  assert.equal(r.parts[1].role, 'compare');
  assert.equal(r.parts[0].role, 'tracked');
});

test('cue tracking labels every sample and refuses a mismatched timeline', () => {
  const scene = slider();
  const cues = cueSheet(scene, { opening: [0, 1], closing: [1, 2] });
  const r = trackParts(scene, { parts: ['dot'], samples: 5, timeline: cues, perCue: true });
  assert.equal(r.samples, 10);
  assert.deepEqual([...new Set(r.parts[0].samples.map((s) => s.cue))], ['opening', 'closing']);
  assert.equal(r.parts[0].samples.filter((s) => s.boundary).length, 4);

  const wrong = cueSheet(9, { only: [0, 9] });
  assert.throws(
    () => trackParts(scene, { parts: ['dot'], timeline: wrong, perCue: true }),
    /do not line up/,
  );
});

test('the drawn path agrees with the measured one', () => {
  const scene = slider();
  const report = trackParts(scene, { parts: ['dot'], samples: 6 });
  const svg = renderMotionSheet(scene, report);
  const first = /<polyline points="([-\d.]+),([-\d.]+)/.exec(svg);
  assert.ok(first, 'a trajectory polyline is drawn');
  const sample = report.parts[0].samples[0].point;
  assert.equal(Number(first![1]), sample[0]);
  assert.equal(Number(first![2]), sample[1]);
});
