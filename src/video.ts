/**
 * Optional raster video delivery.
 *
 * The scene model stays SVG-native. Video is an edge adapter: Heron evaluates
 * exact static frames, resvg turns them into RGBA, and ffmpeg encodes/muxes.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

import type { Character } from './scene.ts';
import { playbackTimes } from './delivery.ts';
import { outputSize, renderContext, renderStatic } from './render.ts';

export { playbackTimes } from './delivery.ts';

export interface VideoOptions {
  width?: number;
  fps?: number;
  /** Optional soundtrack; it is padded or trimmed to the animation duration. */
  audio?: string;
  codec?: 'h264' | 'h265' | 'vp9';
  /** Constant-rate factor. Lower means higher quality. Defaults to 18. */
  crf?: number;
  background?: string;
  ffmpeg?: string;
}

export interface VideoReport {
  file: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
  audio: boolean;
  codec: string;
}

const CODECS = { h264: 'libx264', h265: 'libx265', vp9: 'libvpx-vp9' } as const;

export function hasFfmpeg(command = 'ffmpeg'): boolean {
  return spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
}

/** Public for inspection/tests; ordinary callers should use `renderVideo()`. */
export function videoArgs(
  width: number,
  height: number,
  duration: number,
  out: string,
  o: Required<Pick<VideoOptions, 'fps' | 'codec' | 'crf'>> & Pick<VideoOptions, 'audio'>,
): string[] {
  const args = [
    '-y',
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${width}x${height}`,
    '-framerate', String(o.fps),
    '-i', 'pipe:0',
  ];
  if (o.audio) args.push('-i', o.audio);
  args.push(
    '-map', '0:v:0',
    ...(o.audio
      ? ['-map', '1:a:0', '-af', 'apad', '-c:a', o.codec === 'vp9' ? 'libopus' : 'aac', '-b:a', '192k']
      : []),
    '-c:v', CODECS[o.codec],
    '-crf', String(o.crf),
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-pix_fmt', 'yuv420p',
    '-t', String(duration),
  );
  if (o.codec === 'h265') args.push('-tag:v', 'hvc1');
  if (o.codec !== 'vp9') args.push('-movflags', '+faststart');
  args.push(out);
  return args;
}

/**
 * Renders an MP4/WebM-ready frame stream and optionally muxes a soundtrack.
 *
 * Frame times are `[0,duration)`, as video frames represent intervals rather
 * than instants. No duplicate endpoint frame is added beyond the requested
 * duration.
 */
export async function renderVideo(
  ch: Character,
  file: string,
  o: VideoOptions = {},
): Promise<VideoReport> {
  const fps = o.fps ?? 30;
  const width = Math.round(o.width ?? ch.viewBox[2]);
  const codec = o.codec ?? 'h264';
  const crf = o.crf ?? 18;
  const times = playbackTimes(ch.duration, fps);
  if (!Number.isFinite(width) || width <= 0) throw new Error('heron: video width must be greater than zero');
  if (!(codec in CODECS)) throw new Error(`heron: video codec must be h264, h265 or vp9, got ${codec}`);
  if (!Number.isInteger(crf) || crf < 0 || crf > 63) throw new Error('heron: video crf must be an integer from 0 to 63');
  if (o.audio && !existsSync(o.audio)) throw new Error(`heron: audio file "${o.audio}" does not exist`);
  const ffmpeg = o.ffmpeg ?? 'ffmpeg';
  if (!hasFfmpeg(ffmpeg)) throw new Error(`heron: cannot run ${ffmpeg}; install ffmpeg or pass its path`);

  const { height } = outputSize(ch, width);
  const frames = times.length;
  const target = resolve(file);
  mkdirSync(dirname(target), { recursive: true });
  const args = videoArgs(width, height, ch.duration, target, { fps, codec, crf, audio: o.audio });
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-12000);
  });
  // A mid-encode death (bad audio stream, full disk) surfaces as the exit code
  // below; without this handler the same event is an uncatchable EPIPE crash.
  child.stdin.on('error', () => {});
  const failed = new Promise<never>((_, reject) => {
    child.on('error', reject);
  });
  const closed = new Promise<number>((resolveCode) => {
    child.on('close', (value) => resolveCode(value ?? 1));
  });

  const write = async (pixels: Uint8Array): Promise<void> => {
    if (child.stdin.writable && child.stdin.write(pixels)) return;
    await Promise.race([
      new Promise<void>((resolveDrain) => child.stdin.once('drain', resolveDrain)),
      failed,
      closed.then((code) => {
        throw new Error(`heron: ffmpeg exited early with code ${code}\n${stderr.trim()}`);
      }),
    ]);
  };

  // The shape-reuse pass and definitions are frame-invariant; build them once
  // rather than once per frame.
  const context = renderContext(ch);
  for (const t of times) {
    const svg = renderStatic(ch, t, { width, context });
    const image = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      background: o.background ?? 'white',
    }).render();
    await write(image.pixels);
  }
  child.stdin.end();
  const code = await Promise.race([closed, failed]);
  if (code !== 0) throw new Error(`heron: ffmpeg failed with code ${code}\n${stderr.trim()}`);

  return {
    file: target,
    width,
    height,
    fps,
    frames,
    duration: ch.duration,
    audio: Boolean(o.audio),
    codec: CODECS[codec],
  };
}
