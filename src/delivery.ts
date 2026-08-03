/** One authority for delivery clocks and endpoint policy. */

export interface DeliveryProfile {
  duration: number;
  fps: number;
  frameCount: number;
  /** CFR display instants, end-exclusive, normalized to the scene. */
  times: number[];
  endpoint: 'exclusive';
}

/** Exact CFR instants. Samples are never redistributed to touch the endpoint. */
export function playbackTimes(duration: number, fps: number, from = 0, to = 1): number[] {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('heron: frame fps must be greater than zero');
  if (!Number.isInteger(fps) || fps > 240) {
    throw new Error('heron: frame fps must be an integer no greater than 240');
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('heron: frame duration must be greater than zero');
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > 1 || to <= from) {
    throw new Error(`heron: frame window [${from}, ${to}] must be a positive span inside 0..1`);
  }
  const count = Math.max(1, Math.ceil(duration * fps - 1e-12));
  return Array.from({ length: count }, (_, i) => i / fps / duration)
    .filter((t) => t >= from - 1e-12 && t < to - 1e-12);
}

export function deliveryProfile(duration: number, fps: number): DeliveryProfile {
  const times = playbackTimes(duration, fps);
  return { duration, fps, frameCount: times.length, times, endpoint: 'exclusive' };
}

/** Frame coordinates for a property that must also state its held endpoint. */
export function endpointFrameClock(frames: number): number[] {
  if (!Number.isFinite(frames) || frames <= 0) {
    throw new Error(`heron: endpoint frame span must be positive and finite, got ${frames}`);
  }
  const whole = Math.floor(frames + 1e-12);
  const out = Array.from({ length: whole + 1 }, (_, frame) => frame);
  if (Math.abs(frames - whole) > 1e-9) out.push(frames);
  return out;
}
