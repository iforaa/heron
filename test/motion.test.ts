/**
 * The acting primitives: springs, scores, and the channels built on them.
 *
 * Each test here guards a property a scene relies on without being able to see
 * it — that a settle really has settled when its beat ends, that a wobble really
 * closes its own loop, that a solved angle really points where it claims.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, part, field, limb, swap, circle, line, arc, keys, sampled, compile, renderStatic, lint, easeOut, easeInOut,
  spring, settleTime, criticalDamping, score, cueSheet, during, within, withinAdditive, swell, shift, hold,
  noise, aim, jump, journey, walkCycle, channelAt, netPose, evaluate, frameAt,
  strokeLength, pathLength,
  type Vec2,
} from '../src/index.ts';
import { rasterise, coverage, totalCoverage } from '../src/raster.ts';

function pointClose(actual: Vec2, expected: Vec2, epsilon = 1e-8): void {
  assert.ok(
    Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) <= epsilon,
    `${actual} is not within ${epsilon} of ${expected}`,
  );
}

test('a spring is a solution, not an integration: it starts where it says it does', () => {
  const f = spring({ from: 40, to: 0, stiffness: 200, damping: 12 });
  assert.equal(f(0), 40);
  // Pure function of time — asking out of order changes nothing.
  assert.equal(f(0.3), f(0.3));
  assert.ok(Math.abs(f(4)) < 0.01, 'and it does get there');
});

test('damping decides whether it overshoots, and critical is exactly the edge', () => {
  const base = { from: 0, to: 100, stiffness: 200 };
  const bouncy = spring({ ...base, damping: 6 });
  const critical = spring({ ...base, damping: criticalDamping({ stiffness: 200 }) });

  let over = 0;
  let firm = 0;
  for (let i = 0; i <= 400; i++) {
    over = Math.max(over, bouncy(i / 100));
    firm = Math.max(firm, critical(i / 100));
  }
  assert.ok(over > 105, `an underdamped spring overshoots, peaked at ${over.toFixed(1)}`);
  assert.ok(firm <= 100 + 1e-6, `critical damping does not, peaked at ${firm.toFixed(4)}`);
});

test('settleTime is a measurement of the motion, not a guess about it', () => {
  for (const o of [
    { from: 26, to: 0, stiffness: 420, damping: 18 },   // underdamped
    { from: 26, to: 0, stiffness: 200, damping: criticalDamping({ stiffness: 200 }) },
    { from: 26, to: 0, stiffness: 100, damping: 40 },   // overdamped
  ]) {
    const t = settleTime(o);
    const f = spring(o);
    const eps = 0.002 * 26;
    assert.ok(Math.abs(f(t)) <= eps * 1.5, `still moving at its own settle time: ${f(t).toFixed(4)}`);
    // And not wastefully long: it was outside the tolerance shortly before.
    assert.ok(Math.abs(f(t * 0.85)) > eps * 0.5, 'reserves far more time than the motion needs');
  }
});

test('swing solves the velocity that produces it, and leaves both ends at rest', () => {
  const o = { swing: 26, stiffness: 420, damping: 18 };
  const f = spring(o);
  assert.equal(f(0), 0, 'follow-through departs from rest rather than being held displaced');

  let peak = 0;
  for (let i = 0; i <= 2000; i++) peak = Math.max(peak, f(i / 500));
  assert.ok(Math.abs(peak - 26) < 0.05, `asked to swing 26, swung ${peak.toFixed(2)}`);
  assert.ok(Math.abs(f(settleTime(o))) < 0.1, 'and comes back to rest');
});

test('a score divides the cycle, and refuses one that does not fit', () => {
  const s = score(10, [['a', 2], ['b', 3], ['rest', 0], ['c', 1]]);
  assert.equal(s.at('rest').seconds, 4, 'the zero-length beat absorbs the remainder');
  assert.deepEqual([s.at('b').from, s.at('b').to], [0.2, 0.5]);
  assert.ok(Math.abs(s.progress('b', 0.35) - 0.5) < 1e-12, 'progress is local to the beat');
  assert.equal(s.progress('b', 0.1), 0);
  assert.equal(s.progress('b', 0.9), 1);
  assert.deepEqual(s.span('a', 'b'), { name: 'a..b', from: 0, to: 0.5, seconds: 5 });
  assert.deepEqual(s.slice('b', 0.2, 0.6), { name: 'b[0.2..0.6]', from: 0.26, to: 0.38, seconds: 1.2 });

  assert.throws(() => score(2, [['a', 1], ['b', 2]]), /past a 2s cycle/);
  assert.throws(() => score(2, [['a', 1]]), /unaccounted for/);
  assert.throws(() => score(2, [['a', -1], ['rest', 0]]), /at least zero/);
  assert.throws(() => score(2, [['a', 1], ['a', 1]]), /duplicate beat/);
  assert.throws(() => s.at('nope'), /no beat "nope"/);
  assert.throws(() => s.slice('a', 0.8, 0.2), /0 <= from < to <= 1/);
  assert.throws(() => s.time('a', 1.2), /progress must be inside/);
});

test('during() places a curve in local time and holds its ends outside the beat', () => {
  const s = score(4, [['before', 1], ['beat', 2], ['after', 1]]);
  const b = s.at('beat');

  // A transient is silent everywhere else, because it starts and ends at zero.
  const gesture = during(b, swell(10));
  assert.ok(Math.abs(channelAt(gesture, 0)) < 1e-12);
  assert.ok(Math.abs(channelAt(gesture, 1)) < 1e-12);
  assert.ok(Math.abs(channelAt(gesture, 0.5) - 10) < 0.01, 'peaks in the middle of its own beat');

  // A move holds where it arrives, which is the same rule and the other intent.
  const move = during(b, shift(30));
  assert.equal(channelAt(move, 0), 0);
  assert.ok(Math.abs(channelAt(move, 1) - 30) < 1e-9, 'a move that arrives stays arrived');

  // Local seconds are the beat's own, which is what lets a spring drop straight in.
  const seen: number[] = [];
  during(b, (seconds) => { seen.push(seconds); return 0; });
  assert.ok(Math.max(...seen) <= b.seconds + 1e-9, 'a curve never sees more seconds than its beat has');
  assert.equal(channelAt(during(b, hold(7)), 0.5), 7);
});

test('within() places an exact channel in local time and holds its ends', () => {
  const b = score(4, [['before', 1], ['move', 2], ['after', 1]]).at('move');
  const local = keys([[0, 10, easeOut], [0.5, 30, easeInOut], [1, 20]]);
  const placed = within(b, local);

  assert.equal(placed.kind, 'keys', 'authored keys must remain exact');
  assert.deepEqual(placed.keys.map((k) => k.t), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(placed.keys[1].ease, easeOut, 'the first local segment keeps its easing');
  assert.equal(placed.keys[2].ease, easeInOut, 'the second local segment keeps its easing');
  assert.equal(channelAt(placed, 0.1), 10, 'holds the opening value before the window');
  assert.equal(channelAt(placed, 0.5), 30, 'local midpoint lands at the window midpoint');
  assert.equal(channelAt(placed, 0.9), 20, 'holds the closing value after the window');

  const scene = character('within', { viewBox: [0, 0, 20, 20], duration: 4 }, () => {
    part('dot', { pivot: [10, 10] }, () => circle({ cx: 10, cy: 10, r: 2 }));
  });
  scene.part('dot').animate({ x: placed });
  assert.ok(compile(scene).report.parts.every((p) => p.mode === 'exact'));
});

test('within() preserves procedural detail inside a narrow window', () => {
  const b = { name: 'gesture', from: 0.4, to: 0.6, seconds: 1 };
  const local = sampled((u) => Math.sin(Math.PI * u) * 12, 40);
  const placed = within(b, local);

  assert.equal(placed.kind, 'fn');
  assert.equal(placed.samples, 200, 'global sampling grows to keep forty samples inside the fifth-cycle window');
  assert.ok(Math.abs(channelAt(placed, 0.5) - 12) < 1e-9);
  assert.ok(Math.abs(channelAt(placed, 0.2)) < 1e-9);
  assert.ok(Math.abs(channelAt(placed, 0.8)) < 1e-9);
  for (const u of [0, 0.1, 0.37, 0.8, 1]) {
    const global = b.from + (b.to - b.from) * u;
    assert.ok(Math.abs(channelAt(placed, global) - channelAt(local, u)) < 1e-9);
  }
});

test('withinAdditive returns a separate layer to neutral outside its window', () => {
  const b = score(4, [['before', 1], ['gesture', 2], ['after', 1]]).at('gesture');
  const placed = withinAdditive(b, keys([[0, 12], [1, 30]]), {
    neutral: 0, attack: 0.1, release: 0.2,
  });
  assert.equal(channelAt(placed, 0), 0);
  assert.equal(channelAt(placed, 1), 0);
  assert.equal(channelAt(placed, b.from), 0);
  assert.equal(channelAt(placed, b.to), 0);
  assert.equal(channelAt(placed, b.from + (b.to - b.from) * 0.1), 12);
  assert.ok(Math.abs(channelAt(placed, b.from + (b.to - b.from) * 0.8) - 30) < 1e-9);
  assert.equal(placed.kind, 'keys', 'keyed input remains exact CSS keyframes');
});

test('within() refuses an empty or out-of-cycle window', () => {
  const local = keys([[0, 0], [1, 1]]);
  assert.throws(() => within({ name: 'empty', from: 0.5, to: 0.5, seconds: 0 }, local), /positive window/);
  assert.throws(() => within({ name: 'late', from: 0.8, to: 1.2, seconds: 1 }, local), /inside 0..1/);
});

test('a cue sheet names overlapping film windows in seconds', () => {
  const film = cueSheet(10, {
    runner: [0, 3],
    wipe: [2.6, 4],
    voice: [3.8, 6.2],
  });

  assert.deepEqual(film.at('wipe'), { name: 'wipe', from: 0.26, to: 0.4, seconds: 1.4 });
  assert.equal(film.time('voice', 0.5), 0.5);
  assert.equal(film.progress('runner', 0.15), 0.5);
  assert.match(film.toString(), /wipe 1\.40s \[0\.260\.\.0\.400\]/);
  assert.throws(() => film.at('missing'), /no cue "missing"/);
});

test('a cue sheet places channels, shapes and staggered instances', () => {
  const film = cueSheet(8, { reveal: [2, 6] });
  const placed = film.place('reveal', keys([[0, 2, easeOut], [1, 10]]));
  assert.equal(placed.kind, 'keys');
  assert.deepEqual(placed.keys.map((k) => k.t), [0, 0.25, 0.75, 1]);
  assert.equal(channelAt(placed, 0.5), channelAt(keys([[0, 2, easeOut], [1, 10]]), 0.5));

  const gesture = film.during('reveal', swell(9));
  assert.ok(Math.abs(channelAt(gesture, 0.5) - 9) < 0.01);
  const last = film.stagger('reveal', 3, 4, { spread: 0.5 });
  assert.equal(last.from, 0.5);
  assert.equal(last.to, 0.75);
});

test('swap cuts and playback reject times they cannot represent', () => {
  const scene = character('swap', { viewBox: [0, 0, 20, 20] }, () => {
    swap('face', {
      open: () => circle({ cx: 5, cy: 5, r: 2 }),
      shut: () => circle({ cx: 5, cy: 5, r: 1 }),
    });
  });
  const face = scene.swap('face');
  assert.throws(() => face.cut([[-0.1, 'open']]), /inside 0..1/);
  assert.throws(() => face.cut([[0.2, 'open'], [0.2, 'shut']]), /two cuts/);
  assert.throws(() => face.play({ from: 0.8, to: 0.2 }), /from < to/);
  assert.throws(() => face.play({ fps: 0 }), /positive finite/);
});

test('limb options fail visibly instead of ignoring plausible misspellings', () => {
  assert.throws(
    () => character('bad-limb', { viewBox: [0, 0, 20, 20] }, () =>
      limb('leg', { hip: [1, 1], segments: [4, 4], stroke: '#000', width: 3 } as any)),
    /unknown option width.*use widths/,
  );
});

test('a cue sheet validates each window without rejecting overlaps or gaps', () => {
  assert.throws(() => cueSheet(0, { a: [0, 1] }), /positive finite duration/);
  assert.throws(() => cueSheet(5, {}), /at least one cue/);
  assert.throws(() => cueSheet(5, { backwards: [3, 2] }), /positive window/);
  assert.throws(() => cueSheet(5, { late: [4, 6] }), /inside a 5s film/);
});

test('a field morphs through assigned formations inside a film window', () => {
  const a: Vec2[] = [[20, 20], [80, 20], [140, 20]];
  const b: Vec2[] = [[25, 80], [85, 70], [145, 80]];
  // Reversed deliberately: nearest assignment should preserve spatial identity
  // rather than trusting array order and crossing every dot through the middle.
  const c: Vec2[] = [[150, 130], [90, 120], [30, 130]];
  const scene = character('forms', { viewBox: [0, 0, 180, 160], duration: 4 }, () => {
    field('dots', a.length, (i) => circle({ cx: a[i][0], cy: a[i][1], r: 3 }));
  });
  scene.field('dots').morphThrough([
    { at: 0, points: a, scale: 0.5, opacity: 0 },
    { at: 0.5, points: b, scale: 1, opacity: 1 },
    { at: 1, points: c, scale: 0.75, opacity: 0.6 },
  ], { window: { from: 0.2, to: 0.8 } });

  const positions = (t: number) => {
    const f = frameAt(scene, t);
    return a.map((home, i) => f.point(scene.find(`dots.${i}`)!, home));
  };
  positions(0.2).forEach((p, i) => pointClose(p, a[i]));
  positions(0.5).forEach((p, i) => pointClose(p, b[i]));
  // `c` was reversed, but the three spatially nearest destinations are not.
  positions(0.8).forEach((p, i) => pointClose(p, c[2 - i]));

  const middle = netPose(evaluate(scene, 0.5).get('dots.1'));
  assert.ok(Math.abs(middle.scaleX - 1) < 1e-9);
  assert.ok(Math.abs(middle.opacity - 1) < 1e-9);
  assert.ok(compile(scene).report.parts.every((p) => p.mode === 'exact'));
});

test('field morphing fades spare dots and validates authored timing', () => {
  const points: Vec2[] = [[10, 10], [20, 10], [30, 10]];
  const build = () => character('spares', { viewBox: [0, 0, 50, 30] }, () => {
    field('dots', 3, (i) => circle({ cx: points[i][0], cy: points[i][1], r: 1 }));
  });
  const scene = build();
  scene.field('dots').morphThrough([
    { at: 0, points },
    { at: 1, points: [[12, 20], [28, 20]] },
  ]);
  const visible = [0, 1, 2].map((i) => netPose(evaluate(scene, 1).get(`dots.${i}`)).opacity);
  assert.deepEqual(visible.sort(), [0, 1, 1]);

  assert.throws(
    () => build().field('dots').morphThrough([{ at: 0, points }, { at: 0, points }]),
    /strictly increasing/,
  );
  assert.throws(
    () => build().field('dots').morphThrough([{ at: 0, points }, { at: 0.9, points, stagger: 0.2 }]),
    /inside 0..1/,
  );
});

test('noise closes its own loop and respects the amplitude asked for', () => {
  const n = noise(12, { rate: 3, octaves: 3, seed: 4 });
  // Whole cycles per cycle, so the seam closes to floating-point precision —
  // orders of magnitude inside what the compiler itself preserves.
  assert.ok(Math.abs(channelAt(n, 0) - channelAt(n, 1)) < 1e-12);

  let peak = 0;
  for (let i = 0; i <= 4000; i++) peak = Math.max(peak, Math.abs(channelAt(n, i / 4000)));
  assert.ok(peak <= 12 + 1e-9, `never exceeds what was asked: ${peak.toFixed(3)}`);
  assert.ok(peak > 6, 'and actually uses the range');

  // Seeded: the same build twice is the same drift, or every other comparison
  // in this project stops meaning anything.
  assert.equal(channelAt(noise(12, { seed: 4 }), 0.31), channelAt(noise(12, { seed: 4 }), 0.31));
  assert.notEqual(channelAt(noise(12, { seed: 4 }), 0.31), channelAt(noise(12, { seed: 9 }), 0.31));
});

test('aim solves the angle that points a marker at a target', () => {
  const BEAK: Vec2 = [220, 130];
  const build = () => character('t', { viewBox: [0, 0, 600, 400] }, () => {
    part('neck', { pivot: [300, 300] }, () => {
      part('head', { pivot: [300, 200] }, () => line({ from: [300, 200], to: BEAK, stroke: '#000', width: 6 }));
    });
  });

  const scene = build();
  assert.equal(aim(scene, 'head', { marker: BEAK, target: BEAK }), 0, 'already pointing there is no turn');

  // The check that matters: applying the answer really lands the marker on the
  // line to the target. A sign error passes every arithmetic test and fails this.
  for (const target of [[60, 340], [300, 20], [560, 200], [10, 10]] as Vec2[]) {
    const solved = aim(scene, 'head', { marker: BEAK, target });
    const posed = build();
    posed.part('head').animate({ rotate: keys([[0, solved], [1, solved]]) });
    const f = frameAt(posed, 0);
    const p = f.point(posed.find('head')!, [300, 200]);
    const m = f.point(posed.find('head')!, BEAK);
    const want = Math.atan2(target[1] - p[1], target[0] - p[0]);
    const got = Math.atan2(m[1] - p[1], m[0] - p[0]);
    assert.ok(Math.abs(want - got) < 1e-9, `aimed at ${target}: off by ${(want - got).toFixed(6)} rad`);
  }

  // And it accounts for whatever the parts above it are doing.
  const turned = build();
  turned.part('neck').animate({ rotate: keys([[0, 40], [1, 40]]) });
  const under = aim(turned, 'head', { marker: BEAK, target: [60, 340] });
  assert.notEqual(Math.round(under), Math.round(aim(scene, 'head', { marker: BEAK, target: [60, 340] })));
});

test('path length is measured, not assumed, because resvg ignores pathLength', () => {
  const r = 22;
  assert.ok(Math.abs(pathLength('M0,0 L100,0') - 100) < 1e-9);
  assert.ok(Math.abs(pathLength('M0,0 H30 V40') - 70) < 1e-9);
  assert.ok(Math.abs(pathLength('M0,0 L30,0 L0,40 Z') - 120) < 1e-9);
  // Curves are flattened, which runs slightly short — always short, never long,
  // which is the safe direction for a dash pattern.
  const ring = pathLength(`M${r},0 A${r},${r} 0 0 1 ${-r},0 A${r},${r} 0 0 1 ${r},0 Z`);
  const truth = 2 * Math.PI * r;
  assert.ok(ring <= truth && ring > truth * 0.995, `ring measured ${ring.toFixed(2)} against ${truth.toFixed(2)}`);
});

test('draw reveals a stroke, compiles exact, and is honest in the rasteriser', () => {
  const scene = character('draws', { viewBox: [0, 0, 200, 60], duration: 2 }, () => {
    part('word', () => {
      line({ from: [10, 30], to: [90, 30], stroke: '#000', width: 10 });
      arc({ cx: 140, cy: 30, r: 22, stroke: '#000', width: 10 });
    });
  });
  scene.part('word').animate({ draw: keys([[0, 0], [1, 1]], easeOut) });

  const ink = (t: number) => totalCoverage(coverage(rasterise(renderStatic(scene, t, { width: 400 }), 400, 120)));
  const full = ink(1);
  assert.equal(ink(0), 0, 'nothing is drawn at the start');
  assert.ok(full > 1000, 'and everything is drawn at the end');
  // Monotonic in between: the reveal only ever adds ink. Sampled sparsely on
  // purpose — each of these is a fresh rasteriser at a flat ~200ms, so the
  // sweep is the most expensive thing in the suite and four points prove it.
  let prev = -1;
  for (let i = 0; i <= 4; i++) {
    const v = ink(i / 4);
    assert.ok(v >= prev - 1, `ink went backwards at t=${i / 4}`);
    prev = v;
  }

  // The point of using dashoffset rather than a mask: CSS animates it natively.
  const { report, svg } = compile(scene);
  assert.ok(report.parts.every((p) => p.mode === 'exact'), 'a draw-on needs no baking at all');
  assert.match(svg, /stroke-dasharray="/);
  assert.equal(strokeLength(scene.find('word')!) > 2 * Math.PI * 22, true, 'padded past the longest stroke');
});

test('a layered scene still lints, and the seam is judged on the net of the layers', () => {
  const scene = character('t', { viewBox: [0, 0, 100, 100], duration: 2 }, () => {
    part('arm', { pivot: [50, 50] }, () => circle({ cx: 50, cy: 20, r: 3 }));
  });
  const s = score(2, [['out', 1], ['back', 1]]);
  // Neither layer closes on its own; together they do, which is how a held pose
  // and its release are written.
  scene.part('arm').animate({ rotate: during(s.at('out'), shift(25)) });
  assert.ok(lint(scene).some((f) => f.rule === 'loop-seam'), 'one-way move is a real seam');

  scene.part('arm').animate({ rotate: during(s.at('back'), shift(-25)) });
  assert.deepEqual(lint(scene).filter((f) => f.rule === 'loop-seam'), []);
  assert.ok(Math.abs(netPose(evaluate(scene, 1).get('arm')).rotate) < 1e-9);
});

test('a crouch keeps the foot where it is, however bent the leg already was', () => {
  // The one thing `jump` exists to guarantee, and the one no lint can see: a
  // crouch authored as a body translation sinks the feet, and one authored as
  // joint angles slides them. Both look like a stylistic choice in a still.
  //
  // Checked against a leg that is *already flexed*, because that is where the
  // closed-form solve for a straight leg goes wrong — quietly, proportionally,
  // and only at the bottom of the crouch.
  const [THIGH, SHIN] = [120, 160];
  const build = (restKnee: number) => {
    const scene = character('t', { viewBox: [0, 0, 400, 400], ground: 300 }, () => {
      part('body', { pivot: [200, 20] }, () => {
        part('leg', () => {
          part('thigh', { pivot: [200, 20] }, () => {
            line({ from: [200, 20], to: [200, 20 + THIGH], stroke: '#000', width: 4 });
            part('shin', { pivot: [200, 20 + THIGH] }, () => {
              line({ from: [200, 20 + THIGH], to: [200, 300], stroke: '#000', width: 4 });
              part('foot', { pivot: [200, 300], contact: [200, 300] }, () => {
                circle({ cx: 200, cy: 300, r: 2 });
              });
            });
          });
        });
      });
    });
    if (restKnee) scene.part('shin').animate({ rotate: keys([[0, restKnee], [1, restKnee]]) });
    return scene;
  };

  for (const restKnee of [0, 14]) {
    const scene = build(restKnee);
    // Straight down and back up: every depth from nothing to a deep gather.
    jump(scene, {
      legs: ['leg'], segments: [THIGH, SHIN], facing: 1,
      lift: sampled((t) => -60 * Math.sin(Math.PI * t), 64),
    });

    const foot = scene.find('foot')!;
    const start = frameAt(scene, 0).point(foot);
    let worst = 0;
    let deepest = 0;
    for (let i = 0; i <= 60; i++) {
      const f = frameAt(scene, i / 60);
      const [x, y] = f.point(foot);
      worst = Math.max(worst, Math.hypot(x - start[0], y - start[1]));
      deepest = Math.max(deepest, start[1] - f.point(scene.find('body')!, [200, 20])[1]);
    }
    assert.ok(worst < 0.02, `rest knee ${restKnee}: the foot moved ${worst.toFixed(2)} units`);
    // And it actually crouched, so the test is not passing on a no-op.
    assert.ok(deepest > 55, `rest knee ${restKnee}: only crouched ${deepest.toFixed(1)} units`);
  }
});

test('a journey with a pause is one journey, and the pause is genuinely still', () => {
  const scene = character('t', { viewBox: [0, 0, 400, 400], ground: 300 }, () => {
    part('stage', () => {
      limb('leg', { hip: [200, 100], segments: [90, 90], stroke: '#000', foot: { toe: [14, 0], heel: [-8, 0] } });
      limb('legB', { hip: [200, 100], segments: [90, 90], stroke: '#000', foot: { toe: [14, 0], heel: [-8, 0] } });
    });
  });
  const gait = walkCycle({ stance: 0.6, reach: 20, segments: [90, 90] });
  const go = journey(scene, {
    gait, stance: 0.6, legs: ['leg', 'legB'], carry: 'stage',
    moves: [
      { from: 0, to: 0.3, distance: 400, launch: 0.05, brake: 0.05 },
      { from: 0.6, to: 0.9, distance: 400, launch: 0.05, brake: 0.05 },
    ],
  });

  // Distance is cumulative and monotone across the whole cycle, which is what a
  // second journey could not have been: it would have restarted at zero.
  assert.ok(Math.abs(go.advanced(0.3) - 400) < 1e-6, 'the first move finishes its distance');
  assert.ok(Math.abs(go.advanced(0.45) - 400) < 1e-9, 'and holds it through the pause');
  assert.ok(Math.abs(go.advanced(0.9) - 800) < 1e-6, 'the second picks up from there');
  for (let i = 1; i <= 200; i++) {
    assert.ok(go.advanced(i / 200) >= go.advanced((i - 1) / 200) - 1e-9, 'never goes backwards');
  }

  // Standing means standing: the legs hold one pose through the whole gap.
  assert.equal(go.stillness(0.45), 1);
  const held = (t: number) => netPose(evaluate(scene, t).get(scene.find('leg.thigh')!.path)).rotate;
  assert.ok(Math.abs(held(0.45) - held(0.55)) < 1e-9, 'the legs do not drift while waiting');

  // `carry` is `world` inverted: the character goes forwards, not the scenery.
  assert.ok(frameAt(scene, 0.3).matrices.get('stage')![4] < -399, 'the character has moved itself');
});
