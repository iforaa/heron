/**
 * Reading geometry out of a reference image.
 *
 * This module exists because of a measured failure. The crane logo in
 * `examples/tenfore.ts` was redrawn by eye: every coordinate was read off a PNG
 * by looking at it, and checked by looking at renders. Three rounds of that
 * never noticed that *every stroke in the file was 17-20% too thin*, because
 * "slightly narrow everywhere" is invisible to the eye and obvious the instant
 * anything measures it. One scanline would have caught it.
 *
 * So: nothing here guesses. Widths are measured from the distance field,
 * centrelines come from the medial axis, and point counts come from a stated
 * error tolerance.
 *
 * The key choice is skeletonisation rather than outline tracing. Icon artwork
 * is mostly *strokes* — a centreline plus a width — which is exactly Heron's
 * `through(points, { stroke, width })`. An outline tracer returns the two sides
 * of every stroke as one closed loop, which is the wrong shape twice over: you
 * would have to take its medial axis anyway to recover the centreline, and a
 * limb cut out of an outline needs a new closing edge across the joint that
 * does not exist in the source. A skeleton already branches at joints.
 */

import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

import type { Vec2 } from './scene.ts';

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  rgba: Uint8Array;
  /** Scale applied to the source, so coordinates can be mapped back. */
  scale: number;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

/**
 * Decodes a raster by handing it to resvg wrapped in an SVG.
 *
 * resvg already decodes every format it can embed, and already ships as a
 * dependency, so this avoids adding an image library for the sake of one call.
 */
export function loadImage(file: string, maxSize = 1400): Bitmap {
  const ext = file.split('.').pop()?.toLowerCase() ?? 'png';
  const mime = MIME[ext];
  if (!mime) throw new Error(`heron: cannot read ${ext} images`);

  const data = readFileSync(file).toString('base64');
  // A probe render reports the intrinsic size, which the caller has not given us.
  const wrap = (w?: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg"${w ? ` width="${w}" height="${w}"` : ''}>` +
    `<image href="data:${mime};base64,${data}"/></svg>`;

  const probe = new Resvg(wrap()).render();
  const native = Math.max(probe.width, probe.height);
  const scale = native > maxSize ? maxSize / native : 1;

  const img = new Resvg(wrap(), {
    fitTo: scale === 1 ? { mode: 'original' } : { mode: 'width', value: Math.round(native * scale) },
    background: 'white',
  }).render();

  return { width: img.width, height: img.height, rgba: new Uint8Array(img.pixels), scale };
}

/** Renders an SVG string to RGBA at a given width, for comparison against a reference. */
export function rasterise(svg: string, width: number, height: number): Bitmap {
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'white' }).render();
  return { width: img.width, height: img.height, rgba: new Uint8Array(img.pixels), scale: 1 };
}

export interface Mask {
  width: number;
  height: number;
  /** 1 where there is ink, 0 where there is not. */
  data: Uint8Array;
}

/**
 * Ink is anything meaningfully darker or more saturated than the background.
 *
 * Icons are usually dark-on-light, but a light mark on a dark background is
 * common enough that keying purely on luminance would silently invert. Keying
 * on distance from the corner colour handles both without a flag.
 */
export function inkMask(bm: Bitmap, threshold = 0.22): Mask {
  const { width, height, rgba } = bm;
  const at = (i: number): [number, number, number] => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
  // Corners are background far more often than not; the median of the four
  // survives one corner that happens to carry artwork.
  const corners = [0, width - 1, (height - 1) * width, height * width - 1].map(at);
  const bg = [0, 1, 2].map((c) => corners.map((p) => p[c]).sort((a, b) => a - b)[1]);

  const data = new Uint8Array(width * height);
  const limit = threshold * 255 * 3;
  for (let i = 0; i < width * height; i++) {
    const alpha = rgba[i * 4 + 3];
    const [r, g, b] = at(i);
    const dist = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
    data[i] = alpha > 128 && dist > limit ? 1 : 0;
  }
  return { width, height, data };
}

/**
 * Exact squared Euclidean distance to the nearest background pixel
 * (Felzenszwalb and Huttenlocher, separable lower envelope of parabolas).
 *
 * Exact rather than a chamfer approximation on purpose: this is what measures
 * stroke width, and a chamfer's several-percent error would sit right on top of
 * the size of mistake the whole module exists to eliminate.
 */
export function distanceField(mask: Mask): Float64Array {
  const { width: w, height: h, data } = mask;
  const INF = 1e12;
  const f = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) f[i] = data[i] ? INF : 0;

  const n = Math.max(w, h);
  const src = new Float64Array(n);
  const dst = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  const edt1d = (len: number): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (src[q] + q * q - (src[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (src[q] + q * q - (src[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      dst[q] = (q - v[k]) * (q - v[k]) + src[v[k]];
    }
  };

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) src[y] = f[y * w + x];
    edt1d(h);
    for (let y = 0; y < h; y++) f[y * w + x] = dst[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) src[x] = f[y * w + x];
    edt1d(w);
    for (let x = 0; x < w; x++) f[y * w + x] = dst[x];
  }
  return f;
}

// Neighbour order p2..p9 clockwise from north, which is what Zhang-Suen's
// transition count is defined over.
const NB: Vec2[] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/**
 * Zhang-Suen thinning: erode to a one-pixel-wide medial axis while preserving
 * connectivity, so a stroke becomes its centreline and a junction stays joined.
 */
export function skeletonise(mask: Mask): Mask {
  const { width: w, height: h } = mask;
  const data = Uint8Array.from(mask.data);
  const idx = (x: number, y: number) => y * w + x;
  const doomed: number[] = [];

  const pass = (even: boolean): boolean => {
    doomed.length = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!data[idx(x, y)]) continue;
        const p = NB.map(([dx, dy]) => data[idx(x + dx, y + dy)]);
        let b = 0;
        let a = 0;
        for (let i = 0; i < 8; i++) {
          b += p[i];
          if (!p[i] && p[(i + 1) % 8]) a++;
        }
        if (b < 2 || b > 6 || a !== 1) continue;
        // p[0]=N p[2]=E p[4]=S p[6]=W
        const c1 = even ? p[0] * p[2] * p[4] : p[0] * p[2] * p[6];
        const c2 = even ? p[2] * p[4] * p[6] : p[0] * p[4] * p[6];
        if (c1 === 0 && c2 === 0) doomed.push(idx(x, y));
      }
    }
    for (const i of doomed) data[i] = 0;
    return doomed.length > 0;
  };

  // Bounded so a pathological input cannot spin: thinning removes at least one
  // pixel per round, and no stroke is thicker than the image.
  for (let i = 0; i < Math.max(w, h); i++) {
    const a = pass(true);
    const b = pass(false);
    if (!a && !b) break;
  }
  return { width: w, height: h, data };
}

export interface Stroke {
  /** Centreline, in image pixel coordinates. */
  points: Vec2[];
  /** Median stroke width in pixels, measured from the distance field. */
  width: number;
  /** Ratio of the widest to narrowest measurement along the run. */
  widthVariation: number;
  /** Centreline length in pixels. */
  length: number;
  closed: boolean;
  /**
   * Points where the run turns sharply. A drawn stroke curves; a hard corner
   * usually means two different things were traced as one run because they
   * happen to touch, so these are the places to consider splitting.
   */
  corners: Vec2[];
  /** Every centreline pixel, unsimplified. Used to claim the ink around it. */
  centreline: Vec2[];
}

/**
 * Splits the ink between the strokes, by nearest centreline.
 *
 * A stroke's own pixels are the ones closer to it than to any other stroke,
 * which is a Voronoi partition grown from the skeleton — a flood fill outward
 * from every centreline at once, so the frontiers meet exactly halfway. This is
 * what lets one shape be pulled out of the drawing on its own, which is needed
 * to hand a single filled region to an outline tracer without dragging its
 * neighbours along.
 *
 * Returns a label per pixel: the index of the owning stroke, or -1 for
 * background.
 */
export function labelRegions(mask: Mask, runs: Stroke[]): Int32Array {
  const { width: w, height: h, data } = mask;
  const label = new Int32Array(w * h).fill(-1);
  let head = 0;
  const queue: number[] = [];

  runs.forEach((s, id) => {
    for (const [x, y] of s.centreline) {
      const i = y * w + x;
      if (data[i] && label[i] === -1) {
        label[i] = id;
        queue.push(i);
      }
    }
  });

  // Breadth-first from all centrelines simultaneously, so distance from the
  // frontier grows uniformly and ties break at the true midpoint.
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of NB) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!data[j] || label[j] !== -1) continue;
      label[j] = label[i];
      queue.push(j);
    }
  }
  return label;
}

/** The ink belonging to a subset of strokes, as a mask of its own. */
export function maskOfRegions(mask: Mask, label: Int32Array, ids: Set<number>): Mask {
  const data = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < data.length; i++) if (ids.has(label[i])) data[i] = 1;
  return { width: mask.width, height: mask.height, data };
}

/** Turn angle in degrees at each interior point that exceeds `limit`. */
function sharpCorners(pts: Vec2[], limit = 55): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i][0] - pts[i - 1][0];
    const ay = pts[i][1] - pts[i - 1][1];
    const bx = pts[i + 1][0] - pts[i][0];
    const by = pts[i + 1][1] - pts[i][1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 4 || lb < 4) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    if ((Math.acos(cos) * 180) / Math.PI > limit) out.push(pts[i]);
  }
  return out;
}

const key = (a: number, b: number) => (a < b ? a * 4194304 + b : b * 4194304 + a);

/**
 * The crossing number: how many 8-connected *groups* of neighbours a pixel has,
 * counted as 0-to-1 transitions around the ring. 1 is a tip, 2 is mid-run,
 * 3 or more is a genuine fork.
 *
 * Counting neighbour pixels instead is wrong, and wrong in a way that looks
 * plausible right up until you check it. A thinned line still has staircase
 * corners where three pixels are mutually adjacent, so a plain neighbour count
 * reports 3 or 4 along perfectly ordinary runs: on one logo it found 1954
 * "junctions" among 5106 pixels. By crossing number the same skeleton has 14
 * tips, 5082 run pixels and 10 junctions — which is what the drawing has.
 * Everything downstream depends on this, because a false junction cuts a
 * stroke and every cut end renders as a visible gap.
 */
export function crossingNumber(m: Mask, i: number): number {
  const x = i % m.width;
  const y = (i - x) / m.width;
  const on = (k: number): number => {
    const nx = x + NB[k][0];
    const ny = y + NB[k][1];
    return nx >= 0 && ny >= 0 && nx < m.width && ny < m.height ? m.data[ny * m.width + nx] : 0;
  };
  let a = 0;
  for (let k = 0; k < 8; k++) if (!on(k) && on((k + 1) % 8)) a++;
  return a;
}

/**
 * Where runs meet on the skeleton.
 *
 * These are the single most useful hint the pixels can offer about anatomy: a
 * medial axis forks exactly where a limb leaves a body, so a junction is the
 * best available guess at a joint. It is only a guess — the drawing decides —
 * but it beats reading a coordinate off the image by eye.
 */
export function junctions(skel: Mask, mergeWithin = 10): Vec2[] {
  const raw: Vec2[] = [];
  for (let i = 0; i < skel.data.length; i++) {
    if (skel.data[i] && crossingNumber(skel, i) >= 3) raw.push([i % skel.width, Math.floor(i / skel.width)]);
  }
  // A fork is often two or three adjacent pixels; report the place, not each pixel.
  const out: Vec2[] = [];
  for (const p of raw) {
    const near = out.find((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= mergeWithin);
    if (!near) out.push(p);
  }
  return out;
}

/**
 * Walks a skeleton into polylines, cut at endpoints and junctions.
 *
 * Branches are the useful unit: a limb is a branch of the medial axis, so this
 * is the step where a leg becomes separable from the body it is fused to in the
 * source pixels.
 */
export function traceSkeleton(skel: Mask, minBranch = 6): Vec2[][] {
  const { width: w, height: h, data } = skel;
  const idx = (x: number, y: number) => y * w + x;
  const nbrs = (i: number): number[] => {
    const x = i % w;
    const y = (i - x) / w;
    const out: number[] = [];
    for (const [dx, dy] of NB) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && data[idx(nx, ny)]) out.push(idx(nx, ny));
    }
    return out;
  };

  const deg = new Uint8Array(w * h);
  const live: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!data[i]) continue;
    deg[i] = crossingNumber(skel, i);
    live.push(i);
  }

  const used = new Set<number>();
  const out: Vec2[][] = [];
  const pt = (i: number): Vec2 => [i % w, Math.floor(i / w)];

  const touching = (a: number, b: number): boolean => {
    const ax = a % w;
    const bx = b % w;
    return Math.abs(ax - bx) <= 1 && Math.abs((a - ax) / w - (b - bx) / w) <= 1;
  };

  const walk = (start: number, first: number): number[] => {
    const path = [start, first];
    used.add(key(start, first));
    let prev = start;
    let cur = first;
    while (deg[cur] === 2) {
      const open = nbrs(cur).filter((n) => n !== prev && !used.has(key(cur, n)));
      // A neighbour that still touches `prev` is the far corner of a staircase,
      // not a step forward. Taking it walks sideways and stalls the run.
      const next = open.find((n) => !touching(n, prev)) ?? open[0];
      if (next === undefined) break;
      // Retire the corner pixels passed over, so they cannot seed stray runs.
      for (const n of open) if (n !== next) used.add(key(cur, n));
      used.add(key(cur, next));
      path.push(next);
      prev = cur;
      cur = next;
    }
    return path;
  };

  // Branches first, rooted at every endpoint and junction.
  for (const i of live) {
    if (deg[i] === 2) continue;
    for (const n of nbrs(i)) {
      if (used.has(key(i, n))) continue;
      out.push(walk(i, n).map(pt));
    }
  }
  // Anything still untouched is a closed loop with no node to start from.
  for (const i of live) {
    if (deg[i] !== 2) continue;
    const n = nbrs(i).find((m) => !used.has(key(i, m)));
    if (n === undefined) continue;
    out.push(walk(i, n).map(pt));
  }

  // Thinning leaves short spurs at corners and stroke ends. They are noise, and
  // left in they become stray one-segment shapes in the emitted scene.
  return joinRuns(out.filter((p) => p.length >= minBranch));
}

/**
 * Rejoins runs that only got cut because a spur used to meet them.
 *
 * This step is not optional, and skipping it is visible: thinning throws off a
 * one- or two-pixel side spur every so often along an otherwise clean stroke,
 * which makes that pixel a junction and splits the stroke there. Dropping the
 * spur does not heal the split, so a single line arrives as a dozen fragments —
 * and because a medial axis stops short of the ink at every free end, each
 * fragment boundary renders as a visible gap. One long line becomes a dashed
 * one.
 *
 * Only degree-2 meetings are joined. A three-way meeting is a real fork, and
 * those are precisely the limb boundaries worth keeping apart.
 */
function joinRuns(runs: Vec2[][]): Vec2[][] {
  const at = (p: Vec2) => `${p[0]},${p[1]}`;
  let list = runs.filter((r) => r.length >= 2).map((r) => r.slice());

  for (let pass = 0; pass < 64; pass++) {
    const ends = new Map<string, number[]>();
    list.forEach((r, i) => {
      for (const p of [r[0], r[r.length - 1]]) {
        const k = at(p);
        const slot = ends.get(k);
        if (slot) slot.push(i);
        else ends.set(k, [i]);
      }
    });

    const dead = new Set<number>();
    let joined = false;
    for (const [k, idx] of ends) {
      // Exactly two run-ends, belonging to two different runs. A run whose own
      // two ends land here is a closed loop and must be left alone.
      if (idx.length !== 2 || idx[0] === idx[1]) continue;
      const [a, b] = idx;
      if (dead.has(a) || dead.has(b)) continue;

      let A = list[a];
      let B = list[b];
      if (at(A[A.length - 1]) !== k) A = [...A].reverse();
      if (at(B[0]) !== k) B = [...B].reverse();
      if (at(A[A.length - 1]) !== k || at(B[0]) !== k) continue;

      list[a] = A.concat(B.slice(1));
      dead.add(b);
      joined = true;
    }
    list = list.filter((_, i) => !dead.has(i));
    if (!joined) break;
  }
  return list;
}

/** Douglas-Peucker on a polyline: the fewest points that stay within `epsilon`. */
export function simplify(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    const [ax, ay] = points[lo];
    const [bx, by] = points[hi];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = epsilon;
    let at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at > 0) {
      keep[at] = 1;
      stack.push([lo, at], [at, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function polylineLength(p: Vec2[]): number {
  let n = 0;
  for (let i = 1; i < p.length; i++) n += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return n;
}

/**
 * Centrelines with their measured widths.
 *
 * `widthVariation` is the tell that separates a stroke from a filled shape: a
 * drawn line holds one width along its run, while a tapered wedge like a beak
 * does not, and emitting the second as `through(points, { width })` would
 * quietly flatten it.
 */
export function strokes(mask: Mask, epsilon = 1.2, minBranch = 6): Stroke[] {
  const dist = distanceField(mask);
  const skel = skeletonise(mask);
  const halfWidth = (p: Vec2) => Math.sqrt(dist[p[1] * mask.width + p[0]]);

  return traceSkeleton(skel, minBranch)
    .map((raw): Stroke => {
      // Ends of a medial axis taper to zero by construction, so the extreme
      // samples describe the cap rather than the stroke.
      const trim = raw.slice(Math.floor(raw.length * 0.1), Math.ceil(raw.length * 0.9)) ;
      const ws = (trim.length ? trim : raw).map(halfWidth).map((v) => v * 2).sort((a, b) => a - b);
      const mid = ws[Math.floor(ws.length / 2)] ?? 0;
      const lo = ws[Math.floor(ws.length * 0.1)] ?? mid;
      const hi = ws[Math.floor(ws.length * 0.9)] ?? mid;
      const first = raw[0];
      const last = raw[raw.length - 1];
      const points = simplify(raw, epsilon);
      return {
        points,
        width: Math.round(mid * 10) / 10,
        widthVariation: lo > 0 ? Math.round((hi / lo) * 100) / 100 : 1,
        length: Math.round(polylineLength(raw)),
        closed: Math.hypot(last[0] - first[0], last[1] - first[1]) < 3,
        corners: sharpCorners(points),
        centreline: raw,
      };
    })
    // A run shorter than it is wide is not a stroke. It is the remnant of a
    // junction after the branches leading into it were walked away, and it
    // renders as a round blob of full stroke width sitting inside ink that is
    // already there. Comparing against the run's own measured width rather than
    // a pixel constant means this scales to any image without a flag.
    .filter((s) => s.length >= s.width)
    .sort((a, b) => b.length - a.length);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crcOver = Buffer.concat([head.subarray(4, 8), Buffer.from(body)]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(crcOver), 0);
  return Buffer.concat([head, Buffer.from(body), tail]);
}

/**
 * Minimal RGBA-to-PNG encoder.
 *
 * resvg renders *to* pixels but only writes PNGs of SVGs, and the overlay is
 * pixels this library computed rather than anything it can express as an SVG.
 * Encoding is a header, deflated scanlines and a CRC, so it is cheaper to write
 * than to justify a new dependency for.
 */
export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    // Filter type 0 (none) per scanline: the overlay is flat colour, so the
    // cleverer filters would buy nothing.
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** The dominant ink colour, for reproducing a flat-coloured mark. */
export function inkColour(bm: Bitmap, mask: Mask): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) {
    if (!mask.data[i]) continue;
    // Edge pixels are blends with the background, so weight toward the core.
    r += bm.rgba[i * 4];
    g += bm.rgba[i * 4 + 1];
    b += bm.rgba[i * 4 + 2];
    n++;
  }
  if (!n) return '#000000';
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
