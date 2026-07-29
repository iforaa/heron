/**
 * Exact outlines for the regions a centreline cannot describe.
 *
 * Skeletonisation is right for strokes and wrong for filled shapes. A drawn
 * line is a centreline plus a width, so `through(points, { width })` reproduces
 * it exactly; a tapered beak or a solid foot has no single width, and forcing
 * one flattens it. Those are precisely the runs `strokes()` flags as varying.
 *
 * So this hands only those regions to potrace, which is an outline tracer and
 * therefore excellent at exactly the case skeletonisation is bad at. Measured on
 * the reference logo, potrace reproduces the whole mark at 93.2% overlap against
 * the skeleton importer's 91.1% — and every point of that difference is in the
 * filled shapes.
 *
 * It is deliberately not used for anything else. An outline traces down one side
 * of a stroke and back up the other, so a limb cut out of one needs a new
 * closing edge across the joint that does not exist in the source. That is
 * authoring, not extracting. Outlines are safe here only because each flagged
 * region is one shape *and* one part.
 *
 * potrace is optional. Without it the flagged shapes fall back to constant-width
 * strokes, which is what they were before and still renders.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Mask } from './raster.ts';

let cached: boolean | undefined;

/** Whether potrace is on PATH. Probed once. */
export function hasPotrace(): boolean {
  if (cached === undefined) {
    try {
      execFileSync('potrace', ['--version'], { stdio: 'ignore' });
      cached = true;
    } catch {
      cached = false;
    }
  }
  return cached;
}

/** Binary PBM (P4): one bit per pixel, MSB first, each row byte-aligned. */
function toPbm(m: Mask): Buffer {
  const stride = Math.ceil(m.width / 8);
  const body = Buffer.alloc(stride * m.height);
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.data[y * m.width + x]) body[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([Buffer.from(`P4\n${m.width} ${m.height}\n`, 'ascii'), body]);
}

/**
 * Rewrites potrace's path data into plain top-left SVG coordinates.
 *
 * potrace works bottom-left like PostScript and compensates with a wrapping
 * `translate(0,H) scale(1,-1)`. Carrying that transform into the scene would
 * mean every bounding box downstream had to understand it, and `shapeBox` does
 * not look at transforms — so the flip is baked in here instead, once.
 *
 * Baking needs no current-point tracking because the flip is affine and applies
 * consistently: an absolute point maps by (x, H - y), a relative delta by
 * (dx, -dy). Only the command's case decides which.
 */
function bakeFlip(d: string, height: number): string {
  const tokens = d.match(/[MmLlCcZz]|-?\d*\.?\d+/g) ?? [];
  const out: string[] = [];
  let cmd = '';
  let i = 0;
  const n = (v: number) => String(Math.round(v * 100) / 100);

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      cmd = tokens[i];
      out.push(cmd);
      i++;
      continue;
    }
    const absolute = cmd === cmd.toUpperCase();
    // Every command potrace emits takes coordinate pairs, so pairs is all we need.
    const x = Number(tokens[i]);
    const y = Number(tokens[i + 1]);
    out.push(n(x), absolute ? n(height - y) : n(-y));
    i += 2;
  }

  // Join so numbers never run together: "10-5" is legal SVG but unreadable.
  return out.reduce((s, t) => (/[A-Za-z]/.test(t) ? `${s} ${t}` : `${s} ${t}`), '').trim();
}

export interface OutlineOptions {
  /** Suppress specks smaller than this many pixels. */
  turdSize?: number;
  /** Corner threshold: lower keeps more corners sharp. potrace's default is 1. */
  alphaMax?: number;
}

/**
 * Traces a mask to outline path data, in the mask's own coordinate system.
 *
 * Returns one `d` string per connected shape, or null when potrace is missing.
 */
export function outlinePaths(m: Mask, o: OutlineOptions = {}): string[] | null {
  if (!hasPotrace()) return null;

  const dir = mkdtempSync(join(tmpdir(), 'heron-trace-'));
  const pbm = join(dir, 'in.pbm');
  writeFileSync(pbm, toPbm(m));

  const args = [
    '--svg', '-u', '1',
    '-t', String(o.turdSize ?? 2),
    '-a', String(o.alphaMax ?? 1),
    '-o', '-', pbm,
  ];
  let svg: string;
  try {
    svg = execFileSync('potrace', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }

  return [...svg.matchAll(/ d="([^"]*)"/g)].map((mt) => bakeFlip(mt[1], m.height));
}
