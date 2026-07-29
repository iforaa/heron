import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  type Mask, distanceField, skeletonise, traceSkeleton, simplify, strokes, encodePng,
} from '../src/index.ts';

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
  const m = blank(200, 60);
  hline(m, 20, 180, 30, 15);
  const found = strokes(m);
  assert.equal(found.length, 1);
  assert.ok(Math.abs(found[0].width - 15) <= 1.5, `expected ~15, measured ${found[0].width}`);
  assert.ok(found[0].widthVariation < 1.2, 'a drawn line holds one width');
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
