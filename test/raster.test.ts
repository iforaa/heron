import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  type Mask, type Bitmap, distanceField, radiusField, coverage, softOverlap, totalCoverage,
  rasterise, ribbonPath, skeletonise, traceSkeleton, simplify, strokes, encodePng,
} from '../src/index.ts';
import { fitCircle, fitLine } from '../src/fit.ts';

/** A blank canvas to paint test shapes onto. */
function blank(w: number, h: number): Mask {
  return { width: w, height: h, data: new Uint8Array(w * h) };
}

function hline(m: Mask, x0: number, x1: number, y: number, thickness: number): void {
  const half = thickness / 2;
  for (let x = x0; x <= x1; x++) {
    for (let y2 = Math.ceil(y - half); y2 < y + half; y2++) m.data[y2 * m.width + x] = 1;
  }
}

test('the distance field measures stroke half-width exactly', () => {
  // Exactness is the point: this is what reports stroke width, and a chamfer
  // approximation's few percent of error would sit right on top of the size of
  // mistake the whole module exists to catch.
  const m = blank(80, 40);
  hline(m, 10, 70, 20, 11);
  const d = distanceField(m);
  // The centre of an 11px band is 5.5 from the edge, so 5 whole pixels clear.
  assert.equal(Math.sqrt(d[20 * 80 + 40]), 6, 'centre is 6px from background');
  assert.equal(Math.sqrt(d[15 * 80 + 40]), 1, 'one row inside the top edge');
  assert.equal(d[5 * 80 + 40], 0, 'background is zero');
});

test('a straight band skeletonises to a single centreline run', () => {
  const m = blank(120, 40);
  hline(m, 10, 110, 20, 9);
  const runs = traceSkeleton(skeletonise(m));
  assert.equal(runs.length, 1, `one stroke gives one run, got ${runs.length}`);
  const ys = runs[0].map((p) => p[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) <= 1, 'the centreline stays on one row');
  assert.ok(runs[0].length > 80, 'the run spans the band');
});

test('runs are classified by crossing number, not by neighbour count', () => {
  // The bug this guards: a thinned line still has staircase corners where three
  // pixels are mutually adjacent. Counting neighbour PIXELS calls those
  // junctions and cuts the stroke there; on a real logo it found 1954
  // "junctions" among 5106 pixels and shattered every line into fragments,
  // each of which then rendered with a visible gap at both ends.
  const m = blank(140, 140);
  // A diagonal, which is nothing but staircase corners.
  for (let i = 0; i < 100; i++) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        const x = 20 + i + dx;
        const y = 20 + i + dy;
        if (x > 0 && y > 0 && x < 140 && y < 140) m.data[y * 140 + x] = 1;
      }
    }
  }
  const runs = traceSkeleton(skeletonise(m));
  assert.equal(runs.length, 1, `a diagonal is one run, got ${runs.length}`);
});

test('a fork stays three runs, because that is where a limb separates', () => {
  const m = blank(160, 160);
  hline(m, 20, 140, 60, 9);              // spine
  for (let y = 60; y < 140; y++) {        // a branch hanging off it
    for (let x = 76; x < 85; x++) m.data[y * 160 + x] = 1;
  }
  const runs = traceSkeleton(skeletonise(m)).filter((r) => r.length > 10);
  assert.equal(runs.length, 3, `a T splits into three branches, got ${runs.length}`);
});

test('measured width comes back as the width that was drawn', () => {
  // The tolerance is deliberately tighter than one pixel. It used to be 1.5,
  // which is wider than the error it was supposed to be guarding: the distance
  // field measures to the nearest background pixel's *centre* rather than to the
  // edge of the ink, so every width came back exactly 1.0 too large and the
  // assertion waved it through. Uniform over a whole scene, that was 2.4% of
  // invented ink, invisible to every other check in the suite.
  for (const width of [11, 15, 21]) {
    const m = blank(200, 60);
    hline(m, 20, 180, 30, width);
    const found = strokes(m);
    assert.equal(found.length, 1);
    assert.ok(
      Math.abs(found[0].width - width) <= 0.5,
      `a band of ${width} rows should measure ${width}, measured ${found[0].width}`,
    );
    assert.ok(found[0].widthVariation < 1.2, 'a drawn line holds one width');
  }
});

test('the radius field measures to the edge of the ink, not to the next pixel', () => {
  const m = blank(60, 40);
  hline(m, 5, 55, 20, 11);
  // Eleven rows of ink span from y=14.5 to y=25.5, so the centre row sits 5.5
  // from the boundary while the nearest background pixel's centre is 6 away.
  assert.equal(Math.sqrt(distanceField(m)[20 * 60 + 30]), 6, 'the raw field counts whole pixels');
  assert.equal(radiusField(m)[20 * 60 + 30], 5.5, 'the radius field counts to the edge');
});

test('a centreline lands between pixels when that is where it belongs', () => {
  // An even-numbered band has its true centre on a boundary between two rows, so
  // a whole-pixel skeleton cannot sit on it and must be half a pixel out. On a
  // fine-lined mark half a pixel is worth several points of overlap, so the fit
  // has to resolve below the lattice or the error is unreachable.
  const m = blank(200, 60);
  hline(m, 20, 180, 30, 16);
  const found = strokes(m);
  assert.equal(found.length, 1);
  const mid = found[0].ridge[Math.floor(found[0].ridge.length / 2)];
  // Sixteen rows, 22 through 37, so the ink spans y 21.5 to 37.5 and its centre
  // is 29.5 -- squarely between two rows, and unreachable by a whole-pixel
  // skeleton, which must answer either 29 or 30 and be half a pixel out.
  assert.ok(
    Math.abs(mid[1] - 29.5) < 0.25,
    `the centre of rows 22..37 lies at y=29.5, fitted ${mid[1].toFixed(2)}`,
  );
  assert.ok(!Number.isInteger(mid[1]), 'a sub-pixel fit does not land on the lattice');
});

test('a wedge growing out of a band is cut off it, not averaged into it', () => {
  // The medial axis runs straight from a neck into a beak without forking, so
  // both arrive as one branch. Measured together the taper vanishes into the
  // percentiles, the whole run is drawn at one width, and the wedge gets a blunt
  // round cap partway along its point. That single mistake was two-thirds of all
  // the ink the traced crane invented.
  const m = blank(320, 80);
  hline(m, 20, 200, 40, 17);
  for (let x = 200; x < 300; x++) {
    const half = 8.5 * (1 - (x - 200) / 100);
    for (let y = Math.ceil(40 - half); y < 40 + half; y++) m.data[y * 320 + x] = 1;
  }
  const found = strokes(m);
  assert.ok(found.length >= 2, `the band and the wedge are two shapes, got ${found.length}`);
  const band = found[0];
  const wedge = found[1];
  assert.ok(band.widthVariation < 1.35, `the band holds its width, got ${band.widthVariation}`);
  assert.ok(wedge.widthVariation > 1.35, `the wedge reads as tapering, got ${wedge.widthVariation}`);
  assert.ok(
    Math.abs(band.width - 17) <= 1,
    `cutting the wedge off leaves the band's own width, got ${band.width}`,
  );
});

test('a cut end is measured as cut rather than assumed to be round', () => {
  // A flat end drawn with a round cap bulges past the tip and leaves the corners
  // bare. Both ends leave the skeleton one radius short, so the distance cannot
  // tell them apart -- only the profile can.
  const cut = blank(200, 60);
  hline(cut, 20, 180, 30, 17);
  assert.equal(strokes(cut)[0].cap, 'butt', 'a square-ended band has cut ends');

  const capped = blank(200, 60);
  hline(capped, 20, 180, 30, 17);
  for (const [cx, sign] of [[20, -1], [180, 1]] as const) {
    for (let dx = 0; dx <= 9; dx++) {
      for (let dy = -9; dy <= 9; dy++) {
        if (dx * dx + dy * dy > 72) continue;
        capped.data[(30 + dy) * 200 + cx + sign * dx] = 1;
      }
    }
  }
  assert.equal(strokes(capped)[0].cap, 'round', 'a band with domed ends is round-capped');
});

test('a circle is recovered from its samples, and survives a crossing', () => {
  const truth = { cx: 400, cy: 310, r: 180 };
  const pts: [number, number][] = [];
  for (let a = 20; a <= 250; a += 1.5) {
    const rad = (a * Math.PI) / 180;
    pts.push([truth.cx + truth.r * Math.cos(rad), truth.cy + truth.r * Math.sin(rad)]);
  }

  const clean = fitCircle(pts)!;
  assert.ok(clean, 'a well-sampled arc admits a fit');
  assert.ok(Math.abs(clean.r - truth.r) < 0.01, `radius ${clean.r}`);
  assert.ok(Math.hypot(clean.cx - truth.cx, clean.cy - truth.cy) < 0.01, 'centre');
  assert.ok(Math.abs(Math.abs(clean.to - clean.from) - 230) < 1, 'the sweep is the arc it saw');

  // Where two strokes cross, the largest circle inside the union is bigger than
  // the one inside either stroke, so the skeleton bulges off the true path for
  // as long as the overlap lasts. Those samples are wrong, not merely noisy.
  const fouled = pts.map((p, i): [number, number] =>
    (i > 60 && i < 74 ? [p[0] * 1.045, p[1] * 1.045] : p));
  const robust = fitCircle(fouled)!;
  assert.ok(
    Math.abs(robust.r - truth.r) < 1.5,
    `a crossing must not drag the radius: ${robust.r} against ${truth.r}`,
  );
  assert.ok(robust.inliers < 1 && robust.inliers > 0.8, `the outliers are named, not hidden: ${robust.inliers}`);
});

test('a line is fitted without a preferred axis, so a vertical leg fits', () => {
  // Fitting y against x has no answer for a vertical run, and a crane's leg is
  // vertical.
  const vertical: [number, number][] = [];
  for (let y = 100; y <= 300; y += 4) vertical.push([512 + (y % 8 === 0 ? 0.05 : -0.05), y]);
  const fit = fitLine(vertical)!;
  assert.ok(fit, 'a vertical run admits a fit');
  assert.ok(fit.error < 0.2, `residual ${fit.error}`);
  assert.ok(Math.abs(fit.from[0] - 512) < 0.2 && Math.abs(fit.to[0] - 512) < 0.2, 'x is recovered');
  assert.ok(Math.abs(Math.min(fit.from[1], fit.to[1]) - 100) < 1, 'the extent spans the run');

  // The two ways a line fit goes wrong need two different guards, and neither
  // one covers the other.
  //
  // Gross curvature is caught by the residual. It is not caught by trimming
  // outliers: an arc's distances from its chord are large but evenly spread, so
  // the median rises with them and nothing looks exceptional against it.
  const curved: [number, number][] = [];
  for (let a = 0; a < 90; a += 2) {
    curved.push([200 * Math.cos((a * Math.PI) / 180), 200 * Math.sin((a * Math.PI) / 180)]);
  }
  const arc = fitLine(curved)!;
  assert.ok(arc.error > 20, `an arc is not a line, residual ${arc.error.toFixed(1)}`);
  assert.ok(arc.inliers > 0.9, 'and trimming cannot tell, because nothing is an outlier');

  // A run that is straight and then bends is the opposite case: the surviving
  // fit is excellent, and only the share it describes gives it away. Without
  // that check this is accepted as a line and the bend is silently discarded.
  const hooked: [number, number][] = [];
  for (let y = 0; y < 80; y++) hooked.push([300, 100 + y]);
  for (let k = 1; k <= 20; k++) hooked.push([300 + k * k * 0.08, 180 + k]);
  const bend = fitLine(hooked)!;
  assert.ok(bend.error < 1.5, `the straight part fits well on its own, residual ${bend.error.toFixed(2)}`);
  assert.ok(bend.inliers < 0.85, `but it only describes part of the run, inliers ${bend.inliers.toFixed(2)}`);
});

test('a ribbon encloses the area its width profile describes', () => {
  // Areas, not eyeballs: each of these has a closed form, so the offsetting is
  // either right or it is not.
  const area = (d: string): number => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">`
      + `<rect width="400" height="200" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    return totalCoverage(coverage(rasterise(svg, 400, 200)));
  };
  const near = (got: number, want: number, why: string) =>
    assert.ok(Math.abs(got - want) / want < 0.01, `${why}: ${got.toFixed(0)} against ${want.toFixed(0)}`);

  const bar: [number, number][] = [];
  for (let x = 100; x <= 300; x += 10) bar.push([x, 100]);
  const flat = bar.map(() => 20);

  near(area(ribbonPath(bar, flat, { cap: 'butt' })), 200 * 40, 'a cut bar is its rectangle');
  near(area(ribbonPath(bar, flat)), 200 * 40 + Math.PI * 400, 'a round-capped bar adds a disc');

  // A width falling linearly to nothing is a triangle, plus the one cap that is
  // still open at the wide end.
  const wedge = bar.map((_, i) => 20 * (1 - i / (bar.length - 1)));
  near(area(ribbonPath(bar, wedge)), 200 * 20 + Math.PI * 400 / 2, 'a taper to a point is a triangle');

  // Closed, the two offsets are separate loops wound opposite ways, so a nonzero
  // fill leaves the middle empty. Getting the winding wrong fills the disc.
  const ring: [number, number][] = [];
  for (let a = 0; a < 360; a += 5) {
    ring.push([200 + 60 * Math.cos((a * Math.PI) / 180), 100 + 60 * Math.sin((a * Math.PI) / 180)]);
  }
  near(
    area(ribbonPath(ring, ring.map(() => 10), { closed: true })),
    Math.PI * (70 * 70 - 50 * 50),
    'a closed ribbon is an annulus, not a disc',
  );
});

test('a width profile survives simplification, and a flat one costs nothing', () => {
  // Simplifying on position alone is what makes a profile useless: a wedge is a
  // straight line that narrows, so every interior point is redundant as geometry
  // and would be dropped along with the taper it carries.
  // The profile curves, so it cannot be carried by its endpoints alone. (A
  // straight taper legitimately can, and correctly keeps only two.)
  const m = blank(320, 80);
  for (let x = 40; x < 280; x++) {
    const t = (x - 40) / 240;
    const half = 2 + 16 * (1 - t) * (1 - t);
    for (let y = Math.ceil(40 - half); y < 40 + half; y++) m.data[y * 320 + x] = 1;
  }
  const wedge = strokes(m)[0];
  assert.equal(wedge.widths.length, wedge.points.length, 'one width per point');
  assert.ok(
    wedge.points.length > simplify(wedge.ridge, 1.2).length,
    `the width turns where the shape does not, so it must add points: ` +
    `${wedge.points.length} kept against ${simplify(wedge.ridge, 1.2).length} for the path alone`,
  );
  assert.ok(
    Math.max(...wedge.widths) / Math.max(0.5, Math.min(...wedge.widths)) > 2,
    'and those samples still describe a narrowing',
  );

  const bar = blank(320, 80);
  hline(bar, 40, 280, 40, 21);
  const straight = strokes(bar)[0];
  assert.equal(straight.widths.length, straight.points.length, 'one width per point');
  assert.ok(straight.points.length <= 4, `a flat profile adds no points, got ${straight.points.length}`);
});

/**
 * A straight run of half-width 18 on y=60, and its rendered truth.
 *
 * Shared by the two correction tests so they cannot drift into asserting
 * against different ground truths while reading as though they agree.
 */
const STRAIGHT: [number, number][] = [];
for (let x = 40; x <= 200; x += 8) STRAIGHT.push([x, 60]);
const HALF = 18;
const drawRibbon = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">`
  + `<rect width="240" height="120" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
const straightTruth = () =>
  coverage(rasterise(drawRibbon(ribbonPath(STRAIGHT, STRAIGHT.map(() => HALF))), 240, 120));

test('the reference pulls a wrong stroke back onto itself', async () => {
  const { refine } = await import('../src/refine.ts');
  const line = STRAIGHT;
  const truth = straightTruth();

  // The guess is wrong in both ways the loop is meant to separate -- too narrow
  // everywhere, and sitting three pixels off to one side.
  const guess = {
    points: line.map(([x, y]): [number, number] => [x, y + 3]),
    widths: line.map(() => 12),
    closed: false,
    cap: 'round' as const,
  };

  const { ribbons, report } = refine([], [guess], truth, '#000', { rounds: 10 });
  assert.ok(report.after > report.before, `the score has to improve: ${report.before} to ${report.after}`);
  assert.ok(report.after > 97, `and land close to the truth, got ${report.after.toFixed(1)}%`);

  const mid = Math.floor(line.length / 2);
  assert.ok(
    Math.abs(ribbons[0].widths[mid] - 18) < 2.5,
    `width should find 18, got ${ribbons[0].widths[mid].toFixed(1)}`,
  );
  assert.ok(
    Math.abs(ribbons[0].points[mid][1] - 60) < 1.5,
    `and the centreline should find y=60, got ${ribbons[0].points[mid][1].toFixed(1)}`,
  );
});

test('the spline basis blends control points without moving the run', async () => {
  const { model } = await import('../src/smooth.ts');
  const ring: [number, number][] = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    ring.push([512 + Math.cos(a) * 100, 512 + Math.sin(a) * 100]);
  }
  for (const closed of [false, true]) {
    const m = model(ring, closed, 8);
    for (let j = 0; j < ring.length; j++) {
      let sum = 0;
      for (let p = 0; p < 4; p++) sum += m.weight[j * 4 + p];
      // Weights that did not sum to one would scale the run toward the origin,
      // a little more wherever the samples happened to bunch.
      assert.ok(Math.abs(sum - 1) < 1e-9, `${closed ? 'closed' : 'open'} weights sum to ${sum}`);
    }
  }
});

test('an open run keeps the ends where its caps are', async () => {
  const { model, fitScalar, evalScalar } = await import('../src/smooth.ts');
  const line: [number, number][] = [];
  for (let i = 0; i < 40; i++) line.push([100 + i * 5, 300]);
  const m = model(line, false, 6);
  const back = evalScalar(m, fitScalar(m, line.map((p) => p[0])), line.length);
  // An unclamped spline floats short of its own control polygon, which would
  // pull both caps inward and shorten every stroke in the drawing.
  assert.ok(Math.abs(back[0] - 100) < 0.5, `first end drifted to ${back[0].toFixed(2)}`);
  assert.ok(Math.abs(back[39] - 295) < 0.5, `last end drifted to ${back[39].toFixed(2)}`);
});

test('fitting keeps the shape of a profile and drops the noise on it', async () => {
  const { model, fitScalar, evalScalar, controlCount } = await import('../src/smooth.ts');
  const pts: [number, number][] = Array.from({ length: 120 }, (_, i) => [i * 3, 0]);
  const m = model(pts, false, controlCount(360, 120, false));
  // A real taper, plus the per-pixel jitter a radius field actually carries.
  const real = pts.map((_, i) => 20 + 6 * Math.sin((i / 120) * Math.PI * 2));
  const noisy = real.map((v, i) => v + (i % 2 ? 0.9 : -0.9));
  const got = evalScalar(m, fitScalar(m, noisy), pts.length);
  const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  assert.ok(rms(got.map((v, i) => v - real[i])) < 0.2, 'the taper survives, the jitter does not');
});

test('the correction cannot write a wobble the basis has no room for', async () => {
  const { refine } = await import('../src/refine.ts');
  const line = STRAIGHT;
  const truth = straightTruth();

  // A guess that is right on average but ragged sample by sample: exactly what
  // a skeleton measured off a noisy raster hands over.
  const guess = {
    points: line.map(([x, y], i): [number, number] => [x, y + (i % 2 ? 2.5 : -2.5)]),
    widths: line.map((_, i) => 18 + (i % 2 ? 3 : -3)),
    closed: false,
    cap: 'round' as const,
  };

  const { ribbons } = refine([], [guess], truth, '#000', { rounds: 10 });
  const ys = ribbons[0].points.map((p) => p[1]);
  let kink = 0;
  for (let i = 1; i < ys.length - 1; i++) kink = Math.max(kink, Math.abs(ys[i - 1] - 2 * ys[i] + ys[i + 1]));
  // The zigzag went in at 5px peak to peak. Correcting each sample on its own
  // reproduced it; a basis one control per SPAN pixels cannot express it.
  assert.ok(kink < 0.5, `output still zigzags, worst bend ${kink.toFixed(2)}px`);
  assert.ok(Math.abs(ys[Math.floor(ys.length / 2)] - 60) < 1.5, 'and it still lands on the truth');
});

test('coverage scores sub-pixel error that a threshold rounds away', () => {
  // A threshold is a cliff and the whole boundary of a mark sits on it, so a
  // binary score answers in steps and a sub-pixel correction can move nothing at
  // all. Coverage has to respond to a fraction of a pixel or there is no signal
  // for one to follow.
  const grey = (v: number, w: number, h: number): Bitmap => {
    const rgba = new Uint8Array(w * h * 4).fill(255);
    return { width: w, height: h, rgba, scale: 1 };
  };
  const paint = (bm: Bitmap, edge: number): Bitmap => {
    for (let y = 0; y < bm.height; y++) {
      for (let x = 0; x < bm.width; x++) {
        // A band whose right edge falls between pixels, so the edge column is
        // partly covered exactly as a renderer would leave it.
        const c = Math.max(0, Math.min(1, edge - x + 0.5));
        const v = Math.round(255 * (1 - c));
        for (let k = 0; k < 3; k++) bm.rgba[(y * bm.width + x) * 4 + k] = v;
      }
    }
    return bm;
  };

  const a = coverage(paint(grey(0, 40, 10), 20));
  const same = coverage(paint(grey(0, 40, 10), 20));
  const nudged = coverage(paint(grey(0, 40, 10), 20.3));

  assert.ok(softOverlap(a, same) > 99.9, 'identical fields overlap completely');
  const drop = 100 - softOverlap(a, nudged);
  assert.ok(drop > 0.5, `a third of a pixel has to register, got ${drop.toFixed(2)}%`);
  assert.ok(drop < 8, `and it must not be reported as a catastrophe, got ${drop.toFixed(2)}%`);
});

test('a tapering shape is flagged rather than emitted as a stroke', () => {
  // Constant width is what separates a stroke from a filled shape. Emitting a
  // wedge as through(points, { width }) silently flattens it.
  const m = blank(200, 120);
  for (let x = 20; x < 180; x++) {
    const half = 2 + (x - 20) * 0.18;
    for (let y = Math.ceil(60 - half); y < 60 + half; y++) m.data[y * 200 + x] = 1;
  }
  const found = strokes(m);
  assert.ok(found.length >= 1);
  assert.ok(found[0].widthVariation > 1.35, `a wedge should read as tapering, got ${found[0].widthVariation}`);
});

test('simplify keeps the ends and drops only what stays within tolerance', () => {
  const pts: [number, number][] = Array.from({ length: 50 }, (_, i) => [i, 0]);
  pts[25] = [25, 10];
  const loose = simplify(pts, 20);
  assert.deepEqual(loose, [[0, 0], [49, 0]], 'a big tolerance keeps only the ends');
  const tight = simplify(pts, 1);
  assert.ok(tight.some((p) => p[1] === 10), 'a real excursion survives a tight tolerance');
});

test('the png encoder writes a file resvg can read back', async () => {
  const { loadImage } = await import('../src/raster.ts');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const px = new Uint8Array(8 * 4 * 4);
  for (let i = 0; i < 8 * 4; i++) {
    px[i * 4] = 200; px[i * 4 + 1] = 30; px[i * 4 + 2] = 30; px[i * 4 + 3] = 255;
  }
  const file = join(mkdtempSync(join(tmpdir(), 'heron-')), 'x.png');
  writeFileSync(file, encodePng(px, 8, 4));

  const back = loadImage(file);
  assert.equal(back.width, 8);
  assert.equal(back.height, 4);
  assert.equal(back.rgba[0], 200, 'red channel survives the round trip');
});

test('trace then match round-trips the reference logo faithfully', async () => {
  // The end-to-end guard. Traced geometry is only worth having if it measurably
  // beats drawing by eye, and this is the number that says so: the hand-drawn
  // version of this same logo scores 51% overlap at 0.79x ink.
  const { match, trace } = await import('../src/index.ts');
  const { tenforeTraced } = await import('../examples/tenfore-traced.ts');

  const report = match(tenforeTraced, 'fixtures/tenfore-icon.png');
  assert.ok(report.iou > 88, `overlap regressed to ${report.iou}%`);
  assert.ok(Math.abs(report.inkRatio - 1) < 0.06, `ink ratio drifted to ${report.inkRatio}`);
  assert.ok(Math.abs(report.widthRatio - 1) < 0.06, `stroke widths drifted to ${report.widthRatio}`);

  // Widths must be measured, not inherited from whatever the author guessed.
  const res = trace('fixtures/tenfore-icon.png');
  const main = res.strokes.filter((s) => s.length > 200).map((s) => s.width);
  assert.ok(main.length >= 4, 'the logo has several long runs');
  for (const w of main) assert.ok(w > 30 && w < 45, `long runs are ~36px wide, measured ${w}`);
});

test('match keeps native scene coordinates when a large reference is downsampled', async () => {
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { character, match, rect, renderStatic } = await import('../src/index.ts');

  const size = 1600; // Above loadImage's 1400px working cap.
  const scene = character('large reference', { viewBox: [0, 0, size, size] }, () => {
    rect({ x: 180, y: 260, w: 1040, h: 760, radius: 90, fill: '#111' });
  });
  const reference = rasterise(renderStatic(scene, 0, { width: size }), size, size);
  const dir = mkdtempSync(join(tmpdir(), 'heron-large-match-'));
  const file = join(dir, 'reference.png');
  try {
    writeFileSync(file, encodePng(reference.rgba, reference.width, reference.height));
    const report = match(scene, file);
    assert.ok(report.softIou > 99, `native geometry should still align, got ${report.softIou}%`);
    assert.ok(Math.abs(report.coverageRatio - 1) < 0.01, `ink ratio drifted to ${report.coverageRatio}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('junction remnants are dropped, real strokes are not', async () => {
  const { junctions } = await import('../src/index.ts');
  // A T: the crossbar, the stem, and — at the meeting point — a stub of
  // leftover skeleton that is 40px wide and barely any length.
  const m = blank(200, 200);
  hline(m, 20, 180, 60, 40);
  for (let y = 60; y < 180; y++) for (let x = 80; x < 120; x++) m.data[y * 200 + x] = 1;

  for (const s of strokes(m)) {
    assert.ok(s.length >= s.width, `kept a ${s.length}px run that is ${s.width}px wide`);
  }
  // The fork itself is still reported: it is the best guess at where a joint is.
  const forks = junctions(skeletonise(m));
  assert.ok(forks.length >= 1, 'the T has a fork');
  assert.ok(Math.abs(forks[0][0] - 100) < 25, `fork near the stem, got x=${forks[0][0]}`);
});

test('a run that turns a hard corner is flagged as possibly two parts', () => {
  // The real case: a leg traced straight into the foot it stands on, because
  // they are one connected run of ink.
  const m = blank(200, 200);
  for (let y = 20; y < 150; y++) for (let x = 96; x < 106; x++) m.data[y * 200 + x] = 1;
  for (let x = 96; x < 180; x++) for (let y = 145; y < 155; y++) m.data[y * 200 + x] = 1;

  const found = strokes(m).filter((s) => s.length > 50);
  assert.ok(found.length >= 1);
  const bent = found.find((s) => s.corners.length > 0);
  assert.ok(bent, 'the right-angle turn should be reported');
  assert.ok(Math.abs(bent!.corners[0][1] - 150) < 20, `corner near the bend, got y=${bent!.corners[0][1]}`);
});

test('a smoothly curving stroke reports no corners', () => {
  // The flag is only useful if it stays quiet on ordinary artwork.
  const m = blank(240, 240);
  for (let a = 0; a < 200; a++) {
    const t = (a / 200) * Math.PI;
    for (let d = -5; d <= 5; d++) {
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const x = Math.round(120 + (80 + d) * Math.cos(t)) + ox;
        const y = Math.round(120 + (80 + d) * Math.sin(t)) + oy;
        if (x > 0 && y > 0 && x < 240 && y < 240) m.data[y * 240 + x] = 1;
      }
    }
  }
  const arcRun = strokes(m).find((s) => s.length > 100);
  assert.ok(arcRun, 'the arc traced');
  assert.deepEqual(arcRun!.corners, [], `a smooth arc has no corners, got ${JSON.stringify(arcRun!.corners)}`);
});

test('outline tracing lands in top-left coordinates, not flipped', async () => {
  // potrace works bottom-left like PostScript and compensates with a wrapping
  // transform. That transform is baked away on import, and if the sign is wrong
  // every filled shape lands mirrored vertically — which still renders, still
  // looks like artwork, and is entirely wrong.
  const { hasPotrace, outlinePaths } = await import('../src/index.ts');
  const { pathPoints } = await import('../src/render.ts');
  if (!hasPotrace()) return; // optional dependency

  const m = blank(200, 200);
  // A block well off-centre, so a flip cannot be mistaken for symmetry.
  for (let y = 20; y < 60; y++) for (let x = 30; x < 90; x++) m.data[y * 200 + x] = 1;

  const paths = outlinePaths(m);
  assert.ok(paths && paths.length === 1, 'one block traces to one contour');
  const pts = pathPoints(paths![0]);
  const ys = pts.map((p) => p[1]);
  const xs = pts.map((p) => p[0]);
  assert.ok(Math.min(...ys) >= 15 && Math.max(...ys) <= 65, `y should be 20..60, got ${Math.min(...ys)}..${Math.max(...ys)}`);
  assert.ok(Math.min(...xs) >= 25 && Math.max(...xs) <= 95, `x should be 30..90, got ${Math.min(...xs)}..${Math.max(...xs)}`);
});

test('ink is split between strokes at the midpoint between them', async () => {
  const { labelRegions, maskOfRegions } = await import('../src/index.ts');
  const m = blank(200, 120);
  hline(m, 20, 180, 30, 13);
  hline(m, 20, 180, 90, 13);

  const found = strokes(m);
  assert.equal(found.length, 2, 'two bands, two strokes');
  const label = labelRegions(m, found);
  const top = found[0].points[0][1] < found[1].points[0][1] ? 0 : 1;

  // Each band's own pixels go to it, and nothing is left unclaimed.
  assert.equal(label[30 * 200 + 100], top, 'the upper band claims its own row');
  assert.equal(label[90 * 200 + 100], 1 - top, 'the lower band claims its own row');
  let claimed = 0;
  for (let i = 0; i < label.length; i++) if (label[i] >= 0) claimed++;
  let ink = 0;
  for (const v of m.data) ink += v;
  assert.equal(claimed, ink, 'every ink pixel belongs to exactly one stroke');

  const justTop = maskOfRegions(m, label, new Set([top]));
  assert.equal(justTop.data[90 * 200 + 100], 0, 'isolating one stroke excludes the other');
});
