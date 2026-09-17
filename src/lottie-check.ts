/** Real-player verification for the Lottie backend, using Skia's Skottie. */

import { createRequire } from 'node:module';

import type { Character } from './scene.ts';
import type { Bitmap } from './raster.ts';
import { matchBitmap, type MatchOptions } from './match.ts';

export interface LottieCheckOptions extends Pick<MatchOptions, 'threshold'> {
  /** Normalized instants. Defaults to five representative poses. */
  times?: number[];
  /** Longest raster edge. */
  width?: number;
  /** Lowest acceptable coverage overlap. */
  minOverlap?: number;
}

export interface LottieCheckSample {
  t: number;
  softIou: number;
  coverageRatio: number;
  iou: number;
  inkRatio: number;
}

export interface LottieCheckReport {
  renderer: 'Skia Skottie';
  rendererVersion: string;
  width: number;
  height: number;
  minOverlap: number;
  worstOverlap: number;
  ok: boolean;
  samples: LottieCheckSample[];
}

let canvasKitPromise: Promise<any> | undefined;

/** Whether the optional Skottie player is installed, so callers can skip rather than fail. */
export function hasCanvasKit(): boolean {
  try {
    createRequire(import.meta.url).resolve('canvaskit-wasm/bin/full/canvaskit.js');
    return true;
  } catch {
    return false;
  }
}
let canvasKitVersion = 'unknown';

async function canvasKit(): Promise<any> {
  if (!canvasKitPromise) {
    canvasKitPromise = (async () => {
      try {
        const require = createRequire(import.meta.url);
        const init = require('canvaskit-wasm/bin/full/canvaskit.js') as
          (options: { locateFile: (file: string) => string }) => Promise<any>;
        canvasKitVersion = String(require('canvaskit-wasm/package.json').version ?? 'unknown');
        return await init({
          locateFile: () => require.resolve('canvaskit-wasm/bin/full/canvaskit.wasm'),
        });
      } catch (error) {
        canvasKitPromise = undefined;
        throw new Error(
          'heron lottie --check needs the optional canvaskit-wasm package to run Skia Skottie'
          + ` (${(error as Error).message})`,
        );
      }
    })();
  }
  return canvasKitPromise;
}

interface LottieHeader { w?: unknown; h?: unknown }

/** Rasterizes one normalized instant through Skottie, not Heron's replay model. */
export async function renderLottieFrame(json: string, t: number, maxEdge = 1000): Promise<Bitmap> {
  if (!Number.isFinite(t) || t < 0 || t > 1) {
    throw new Error(`heron lottie check: time must be inside 0..1, got ${t}`);
  }
  if (!Number.isFinite(maxEdge) || maxEdge < 64 || maxEdge > 4096) {
    throw new Error(`heron lottie check: raster edge must be between 64 and 4096, got ${maxEdge}`);
  }
  const header = JSON.parse(json) as LottieHeader;
  const nativeWidth = Number(header.w);
  const nativeHeight = Number(header.h);
  if (!Number.isFinite(nativeWidth) || !Number.isFinite(nativeHeight)
      || nativeWidth <= 0 || nativeHeight <= 0) {
    throw new Error('heron lottie check: animation needs positive finite w and h');
  }
  const scale = Math.min(1, maxEdge / Math.max(nativeWidth, nativeHeight));
  const width = Math.max(1, Math.round(nativeWidth * scale));
  const height = Math.max(1, Math.round(nativeHeight * scale));
  const CK = await canvasKit();
  const animation = CK.MakeAnimation(json);
  if (!animation) throw new Error('heron lottie check: Skottie refused the generated animation');
  const surface = CK.MakeSurface(width, height);
  if (!surface) {
    animation.delete();
    throw new Error(`heron lottie check: Skottie could not allocate a ${width}x${height} surface`);
  }
  try {
    const canvas = surface.getCanvas();
    canvas.clear(CK.WHITE);
    animation.seek(t);
    animation.render(canvas, [0, 0, width, height]);
    surface.flush();
    const pixels = canvas.readPixels(0, 0, {
      width, height,
      colorType: CK.ColorType.RGBA_8888,
      alphaType: CK.AlphaType.Unpremul,
      colorSpace: CK.ColorSpace.SRGB,
    });
    if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) {
      throw new Error('heron lottie check: Skottie did not return an RGBA raster');
    }
    return { width, height, rgba: new Uint8Array(pixels), scale };
  } finally {
    surface.delete();
    animation.delete();
  }
}

/** Rasterizes and diffs representative frames against Heron's SVG evaluator. */
export async function checkLottie(
  ch: Character, json: string, options: LottieCheckOptions = {},
): Promise<LottieCheckReport> {
  const times = options.times ?? [0, 0.25, 0.5, 0.75, 1];
  if (!times.length) throw new Error('heron lottie check: provide at least one time');
  const minOverlap = options.minOverlap ?? 97;
  if (!Number.isFinite(minOverlap) || minOverlap < 0 || minOverlap > 100) {
    throw new Error(`heron lottie check: minOverlap must be inside 0..100, got ${minOverlap}`);
  }
  const samples: LottieCheckSample[] = [];
  let width = 0;
  let height = 0;
  for (const t of times) {
    const bitmap = await renderLottieFrame(json, t, options.width ?? 1000);
    width = bitmap.width;
    height = bitmap.height;
    const match = matchBitmap(ch, bitmap, { t, threshold: options.threshold, probes: 0 });
    samples.push({
      t, softIou: match.softIou, coverageRatio: match.coverageRatio,
      iou: match.iou, inkRatio: match.inkRatio,
    });
  }
  const worstOverlap = Math.min(...samples.map((sample) => sample.softIou));
  return {
    renderer: 'Skia Skottie',
    rendererVersion: canvasKitVersion,
    width, height, minOverlap, worstOverlap,
    ok: worstOverlap >= minOverlap,
    samples,
  };
}
