import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  character, circle, deliveryProfile, hasFfmpeg, playbackTimes, renderVideo, videoArgs,
} from '../src/index.ts';

test('playback frame times are end-exclusive and can cover an exact window', () => {
  assert.deepEqual(playbackTimes(1, 4), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(
    playbackTimes(1.1, 4).map((t) => Number((t * 1.1).toFixed(6))),
    [0, 0.25, 0.5, 0.75, 1],
    'non-integral durations keep the encoder clock instead of redistributing frames',
  );
  assert.deepEqual(playbackTimes(2, 2, 0.25, 0.75), [0.25, 0.5]);
  assert.deepEqual(
    playbackTimes(1, 4, 0.2, 0.8),
    [0.25, 0.5, 0.75],
    'a window selects the video grid instead of inventing a new grid inside itself',
  );
  assert.throws(() => playbackTimes(1, 0), /fps must be greater/);
  assert.throws(() => playbackTimes(1, 30, 0.6, 0.4), /positive span/);
  assert.deepEqual(deliveryProfile(1.1, 4), {
    duration: 1.1, fps: 4, frameCount: 5,
    times: playbackTimes(1.1, 4), endpoint: 'exclusive',
  });
});

test('video arguments describe a raw frame stream and synchronized soundtrack', () => {
  const args = videoArgs(320, 181, 2.5, '/tmp/out.mp4', {
    fps: 24,
    codec: 'h264',
    crf: 17,
    audio: '/tmp/music.wav',
  });
  assert.deepEqual(args.slice(0, 12), [
    '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '320x181',
    '-framerate', '24', '-i', 'pipe:0', '-i',
  ]);
  assert.ok(args.includes('apad'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.equal(args.at(-1), '/tmp/out.mp4');
});

test('ffmpeg adapter renders a real playable video file', {
  skip: !hasFfmpeg(),
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'heron-video-'));
  const file = join(dir, 'test.mp4');
  try {
    const scene = character('tiny film', {
      viewBox: [0, 0, 32, 20], duration: 0.2, once: true,
    }, () => circle({ cx: 16, cy: 10, r: 7, fill: '#08f' }));
    const report = await renderVideo(scene, file, { width: 32, fps: 5, crf: 28 });
    assert.equal(report.frames, 1);
    assert.equal(report.codec, 'libx264');
    assert.equal(report.audio, false);
    assert.ok(existsSync(file));
    assert.ok(statSync(file).size > 500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('video validation fails before starting an encoder', async () => {
  const scene = character('bad video', {
    viewBox: [0, 0, 10, 10], duration: 1,
  }, () => circle({ cx: 5, cy: 5, r: 2 }));
  await assert.rejects(() => renderVideo(scene, '/tmp/no.mp4', { fps: 0 }), /fps must be greater/);
  await assert.rejects(
    () => renderVideo(scene, '/tmp/no.mp4', { audio: '/definitely/missing.wav' }),
    /does not exist/,
  );
  await assert.rejects(
    () => renderVideo(scene, '/tmp/no.mp4', { ffmpeg: '/definitely/missing-ffmpeg' }),
    /cannot run/,
  );
});
