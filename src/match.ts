/**
 * Comparing a scene against the reference art it was drawn from.
 *
 * The drawing half of Heron had no instrument. Motion has `lint`, `sheet` and
 * `inspect`; the redraw step had nothing but looking, and looking missed a
 * uniform 17-20% stroke-width deficit across an entire scene three times in a
 * row. This is the missing half of the feedback loop.
 *
 * It reports two different kinds of number on purpose:
 *
 *   - `inkRatio` catches *systematic* error — everything slightly too thin, or
 *     too thick. It is one number, it moves for the whole file at once, and it
 *     is the one the eye is worst at.
 *   - `iou` and the per-band breakdown catch *local* error — a neck in the
 *     wrong place, a missing shape.
 *
 * Widths are also probed directly, because "your strokes are 30 and should be
 * 36" is a fix, whereas "overlap is 51%" is only a symptom.
 */

import { evaluate } from './timeline.ts';
import { nodeSvg, sceneBox, svgOpen } from './render.ts';
import type { Character } from './scene.ts';
import { type Bitmap, type Mask, inkMask, loadImage, rasterise } from './raster.ts';

export interface WidthProbe {
  /** Scanline row, in reference pixels. */
  y: number;
  reference: number[];
  scene: number[];
}

export interface MatchReport {
  width: number;
  height: number;
  referenceInk: number;
  sceneInk: number;
  /** Scene ink over reference ink. Below 1 means the redraw is too thin. */
  inkRatio: number;
  /** Intersection over union of the two ink masks, as a percentage. */
  iou: number;
  /** Ink present in the reference but missing from the scene. */
  missing: number;
  /** Ink drawn by the scene that the reference does not have. */
  extra: number;
  widths: WidthProbe[];
  /** Median scene width over median reference width across all probes. */
  widthRatio: number;
  overlay: Uint8Array;
}

/**
 * Renders the scene into the reference's pixel grid.
 *
 * The scene's own viewBox is deliberately ignored. A viewBox is a crop, and
 * cropping would shift every coordinate relative to the reference, so the
 * comparison is done in the reference's coordinate system and the scene is
 * placed into it unchanged.
 */
function sceneInReferenceSpace(ch: Character, t: number, w: number, h: number): string {
  const pose = evaluate(ch, t);
  const open = svgOpen(ch, w, h).replace(/viewBox="[^"]*"/, `viewBox="0 0 ${w} ${h}"`);
  return `${open}\n${nodeSvg(ch.root, pose, '  ')}\n</svg>\n`;
}

/** Runs of consecutive ink along one scanline, as widths in pixels. */
function runs(m: Mask, y: number): number[] {
  const out: number[] = [];
  let start = -1;
  for (let x = 0; x <= m.width; x++) {
    const on = x < m.width && m.data[y * m.width + x] === 1;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      out.push(x - start);
      start = -1;
    }
  }
  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Rows worth probing: spread through the artwork's own vertical extent rather
 * than the image's, so a mark with generous padding still gets sampled where
 * the ink is.
 */
function probeRows(m: Mask, count: number): number[] {
  let top = m.height;
  let bottom = 0;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.data[y * m.width + x]) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        break;
      }
    }
  }
  if (bottom <= top) return [];
  return Array.from({ length: count }, (_, i) => Math.round(top + ((bottom - top) * (i + 1)) / (count + 1)));
}

/** Red where the reference has ink the scene lacks, blue where the scene invents it. */
function overlayPng(a: Mask, b: Mask): Uint8Array {
  const px = new Uint8Array(a.width * a.height * 4);
  for (let i = 0; i < a.width * a.height; i++) {
    const r = a.data[i];
    const s = b.data[i];
    const c = r && s ? [188, 188, 188] : r ? [214, 42, 42] : s ? [40, 88, 214] : [255, 255, 255];
    px[i * 4] = c[0];
    px[i * 4 + 1] = c[1];
    px[i * 4 + 2] = c[2];
    px[i * 4 + 3] = 255;
  }
  return px;
}

export interface MatchOptions {
  /** Cycle time to compare at. The rest pose is almost always what you want. */
  t?: number;
  threshold?: number;
  probes?: number;
}

export function match(ch: Character, referenceFile: string, o: MatchOptions = {}): MatchReport {
  const refBm = loadImage(referenceFile);
  const ref = inkMask(refBm, o.threshold);

  const svg = sceneInReferenceSpace(ch, o.t ?? 0, refBm.width, refBm.height);
  const sceneBm: Bitmap = rasterise(svg, refBm.width, refBm.height);
  const scene = inkMask(sceneBm, o.threshold);

  let both = 0;
  let missing = 0;
  let extra = 0;
  for (let i = 0; i < ref.data.length; i++) {
    const r = ref.data[i];
    const s = scene.data[i];
    if (r && s) both++;
    else if (r) missing++;
    else if (s) extra++;
  }

  const widths = probeRows(ref, o.probes ?? 5).map((y) => ({
    y,
    reference: runs(ref, y),
    scene: runs(scene, y),
  }));
  const refW = median(widths.flatMap((p) => p.reference));
  const sceneW = median(widths.flatMap((p) => p.scene));

  return {
    width: refBm.width,
    height: refBm.height,
    referenceInk: both + missing,
    sceneInk: both + extra,
    inkRatio: both + missing ? Math.round(((both + extra) / (both + missing)) * 1000) / 1000 : 0,
    iou: Math.round((both / (both + missing + extra)) * 1000) / 10,
    missing,
    extra,
    widths,
    widthRatio: refW ? Math.round((sceneW / refW) * 1000) / 1000 : 0,
    overlay: overlayPng(ref, scene),
  };
}

/**
 * Findings in the order they should be acted on.
 *
 * A uniform width error is reported first because it is both the most common
 * mistake and the cheapest fix, and because chasing local shape differences
 * while every stroke is 20% thin is wasted effort — the width error dominates
 * the overlap score and hides everything underneath it.
 */
export function formatMatch(r: MatchReport, name: string): string {
  const lines: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  lines.push(`${name}  ${r.width}x${r.height}  overlap ${r.iou}%  ink ${r.inkRatio.toFixed(2)}x`);

  if (r.widthRatio && Math.abs(r.widthRatio - 1) > 0.06) {
    const dir = r.widthRatio < 1 ? 'thin' : 'thick';
    lines.push(
      `  STROKE WIDTH: every stroke is about ${pct(Math.abs(1 - r.widthRatio))} too ${dir} ` +
      `(${r.widthRatio.toFixed(2)}x). Fix this before anything else — it moves the whole file ` +
      `at once and the eye cannot see it.`,
    );
  } else if (r.widthRatio) {
    lines.push(`  stroke width within ${pct(Math.abs(1 - r.widthRatio))} of the reference`);
  }

  if (r.inkRatio < 0.9) lines.push(`  scene is missing ink: ${r.missing} px present in the reference only`);
  else if (r.inkRatio > 1.1) lines.push(`  scene draws ${r.extra} px the reference does not have`);

  for (const p of r.widths) {
    const f = (xs: number[]) => (xs.length ? xs.join(' ') : '-');
    lines.push(`  y=${String(p.y).padEnd(5)} reference ${f(p.reference).padEnd(24)} scene ${f(p.scene)}`);
  }

  lines.push(
    r.iou >= 85
      ? '  shapes line up'
      : `  shapes differ: read the overlay, red is reference-only and blue is scene-only`,
  );
  return lines.join('\n');
}

/** Ink bounds of the scene, for checking it sits where the reference does. */
export { sceneBox };
