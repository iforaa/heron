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
import { nodeSvg, svgOpen } from './render.ts';
import type { Character } from './scene.ts';
import {
  type Bitmap, type Mask, coverage, dilate, inkMask, loadImage, median, rasterise,
  softOverlap, totalCoverage,
} from './raster.ts';

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
  /**
   * Overlap of the two *coverage* fields, as a percentage. Sub-pixel sensitive,
   * and free of the threshold, so this is the number to optimise against.
   */
  softIou: number;
  /** Scene coverage over reference coverage. The sub-pixel form of `inkRatio`. */
  coverageRatio: number;
  /**
   * What one pixel of uniform boundary error costs on this artwork, in points of
   * overlap. Without it there is no way to tell whether a 6% shortfall is a
   * misplaced limb or a half-pixel edge.
   */
  boundaryCost: number;
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
function sceneInReferenceSpace(
  ch: Character, t: number, w: number, h: number, referenceScale: number,
): string {
  const pose = evaluate(ch, t);
  // `loadImage` caps large references for tractable comparison, but scene
  // coordinates remain in the reference's native pixel space. Using the
  // downsampled dimensions as the viewBox shrinks the scene a second time: a
  // 2048px trace compared against its own 1400px working image used to score as
  // badly misplaced geometry. The output raster is still w*h; only its logical
  // coordinate space is restored here.
  const nativeWidth = w / referenceScale;
  const nativeHeight = h / referenceScale;
  const open = svgOpen(ch, w, h).replace(
    /viewBox="[^"]*"/, `viewBox="0 0 ${nativeWidth} ${nativeHeight}"`,
  );
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

/**
 * The overlap the reference scores against a one-pixel-fatter copy of itself.
 *
 * Same shape, same everything, boundary moved outward by one pixel — so the
 * points it loses are the cost of an edge error alone, with no shape error
 * anywhere. That is the scale every other number in the report is read against:
 * on a fine-lined mark one pixel is expensive and 93% is close, while on a
 * chunky one the same 93% would mean something is genuinely in the wrong place.
 */
function boundarySensitivity(m: Mask): number {
  // A dilation contains the original — every inked pixel is its own neighbour —
  // so the intersection is just the ink and the union is just the dilation, and
  // the whole intersection-over-union collapses to a ratio of two counts.
  let ink = 0;
  let grown = 0;
  const wide = dilate(m).data;
  for (let i = 0; i < m.data.length; i++) {
    ink += m.data[i];
    grown += wide[i];
  }
  return grown ? Math.round((100 - (ink / grown) * 100) * 10) / 10 : 0;
}

/** Red where the reference has ink the scene lacks, blue where the scene invents it. */
function overlayPng(a: Mask, b: Mask): Uint8Array {
  const px = new Uint8Array(a.width * a.height * 4);
  for (let i = 0, p = 0; i < a.data.length; i++, p += 4) {
    const r = a.data[i];
    const s = b.data[i];
    px[p] = r && s ? 188 : r ? 214 : s ? 40 : 255;
    px[p + 1] = r && s ? 188 : r ? 42 : s ? 88 : 255;
    px[p + 2] = r && s ? 188 : r ? 42 : s ? 214 : 255;
    px[p + 3] = 255;
  }
  return px;
}

export interface MatchOptions {
  /** Cycle time to compare at. The rest pose is almost always what you want. */
  t?: number;
  threshold?: number;
  probes?: number;
}

/** Compares against an already decoded raster, used by real backend replayers. */
export function matchBitmap(ch: Character, refBm: Bitmap, o: MatchOptions = {}): MatchReport {
  const ref = inkMask(refBm, o.threshold);

  const svg = sceneInReferenceSpace(ch, o.t ?? 0, refBm.width, refBm.height, refBm.scale);
  const sceneBm: Bitmap = rasterise(svg, refBm.width);
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

  const refCov = coverage(refBm);
  const sceneCov = coverage(sceneBm);
  const refTotal = totalCoverage(refCov);

  return {
    softIou: Math.round(softOverlap(refCov, sceneCov) * 10) / 10,
    coverageRatio: refTotal ? Math.round((totalCoverage(sceneCov) / refTotal) * 1000) / 1000 : 0,
    boundaryCost: boundarySensitivity(ref),
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

export function match(ch: Character, referenceFile: string, o: MatchOptions = {}): MatchReport {
  return matchBitmap(ch, loadImage(referenceFile), o);
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

  lines.push(
    `${name}  ${r.width}x${r.height}  overlap ${r.softIou}%  ink ${r.coverageRatio.toFixed(3)}x` +
    `   (binary ${r.iou}% / ${r.inkRatio.toFixed(2)}x)`,
  );

  // How far out the boundary is, in pixels: the shortfall divided by what one
  // pixel of edge costs. Computed once, because both the scale line and the
  // verdict at the end read it, and two spellings of one threshold drift apart.
  const short = Math.max(0, 100 - r.softIou);
  const edge = r.boundaryCost ? short / r.boundaryCost : Infinity;

  // Without this line every other percentage is unreadable, because "6% short"
  // means a misplaced limb on one drawing and a half-pixel edge on another.
  if (r.boundaryCost) {
    lines.push(
      `  scale: one pixel of edge error costs ${r.boundaryCost}% here, so ${short.toFixed(1)}% ` +
      `short is about ${edge.toFixed(1)} pixel(s) of boundary — ` +
      (edge < 0.35 ? 'sub-pixel, and close to the limit of the raster.'
        : edge < 1 ? 'edges, not placement. Chase widths and endpoints, not coordinates.'
        : 'more than an edge. Something is in the wrong place; read the overlay.'),
    );
  }

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

  /**
   * One authority on how much ink there is, and it is the coverage one.
   *
   * Coverage catches a bias the binary count cannot: a uniform half-pixel of
   * extra edge never flips enough whole pixels to register, but it is real ink
   * and it is the signature of a systematic measurement error rather than a
   * drawing mistake. Reporting both measures with their own thresholds let them
   * contradict each other — a scene whose antialiasing differs from the
   * reference could read 1.12x by pixel count and 1.01x by coverage, with the
   * report saying both "you drew ink that is not there" and nothing at all.
   * The binary counts stay, because they name the red and blue in the overlay,
   * but they no longer decide anything.
   */
  if (Math.abs(r.coverageRatio - 1) > 0.015) {
    const heavy = r.coverageRatio > 1;
    lines.push(
      `  ink is ${pct(Math.abs(1 - r.coverageRatio))} ${heavy ? 'more' : 'less'} than the reference ` +
      `(${r.coverageRatio.toFixed(3)}x): ${heavy ? `${r.extra} px drawn that the reference does not have`
        : `${r.missing} px present in the reference only`}. ` +
      (edge < 1 ? 'Spread along the edges, so suspect a measurement bias before any one shape.'
        : 'Read the overlay — at this scale it is a shape, not a bias.'),
    );
  }

  for (const p of r.widths) {
    const f = (xs: number[]) => (xs.length ? xs.join(' ') : '-');
    lines.push(`  y=${String(p.y).padEnd(5)} reference ${f(p.reference).padEnd(24)} scene ${f(p.scene)}`);
  }

  lines.push(
    edge < 1
      ? '  shapes line up to within a pixel of edge'
      : `  shapes differ: read the overlay, red is reference-only and blue is scene-only`,
  );
  return lines.join('\n');
}
