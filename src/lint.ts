/**
 * Motion lints: turn "something looks off" into a diagnosis.
 *
 * Every check here exists because it caught a real defect while the reference
 * walk cycle was being built by hand. An agent cannot see that a planted foot
 * subtly changes speed mid-step, but it is trivially visible in the numbers.
 */

import type { Channel, Character } from './scene.ts';
import { type Frame, channelAt, sampleFrames } from './timeline.ts';
import { frameBox, localCorners } from './render.ts';

export interface Finding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  part?: string;
  message: string;
  detail?: string;
}

const SAMPLES = 60;

/** Speed variation permitted while planted before it reads as skating. */
const SLIP_THRESHOLD = 0.25;

/**
 * How close to its own lowest point a contact must be to count as planted,
 * as a fraction of the character's height.
 *
 * Measured against the point's own lowest reach rather than the declared ground
 * line, because a foot passing *above* the ground on its way through a swing is
 * airborne, not in contact — a symmetric test around the ground line quietly
 * classifies a hovering foot as planted and then judges its speed.
 */
const CONTACT_BAND = 0.02;

export function lint(ch: Character): Finding[] {
  // One pass of frames feeds every rule. Posing the scene per rule, per part,
  // per sample is how a 13-part rig ended up walking its own tree hundreds of
  // times for a single lint.
  const frames = sampleFrames(ch, SAMPLES);
  return [...loopSeam(ch), ...groundChecks(ch, frames), ...viewBoxCheck(ch, frames)];
}

/**
 * A cycle that ends somewhere other than where it started visibly jumps once
 * per loop. This is the single most common way a generated walk looks broken.
 */
function loopSeam(ch: Character): Finding[] {
  const out: Finding[] = [];
  for (const node of ch.nodes()) {
    if (!node.track) continue;
    for (const [name, chan] of Object.entries(node.track)) {
      if (name === 'phase' || !chan || typeof chan !== 'object') continue;
      const c = chan as Channel;
      const a = channelAt(c, 0);
      const b = channelAt(c, 1);
      if (Math.abs(a - b) > 1e-6) {
        out.push({
          rule: 'loop-seam',
          severity: 'error',
          part: node.path,
          message: `${name} does not return to its starting value, so the loop jumps every cycle`,
          detail: `${name}: t=0 is ${a.toFixed(2)}, t=1 is ${b.toFixed(2)}`,
        });
      }
    }
  }
  return out;
}

/**
 * Checks parts that declare a contact point:
 *   - the point must not sink below the ground plane
 *   - while planted, it must travel at a constant speed
 *
 * The second check is the subtle one. For a walk-in-place cycle the planted
 * foot should track backward like a treadmill belt; any change of speed while
 * in contact reads as the foot skating across the ground.
 */
function groundChecks(ch: Character, frames: Frame[]): Finding[] {
  const out: Finding[] = [];
  if (ch.ground === undefined) return out;
  const ground = ch.ground;
  const band = ch.viewBox[3] * CONTACT_BAND;

  for (const node of ch.nodes()) {
    if (!node.contact) continue;

    const pts = frames.map((f) => {
      const [x, y] = f.point(node);
      return { t: f.t, x, y };
    });

    const deepest = pts.reduce((m, p) => (p.y > m.y ? p : m));
    if (deepest.y > ground + band) {
      out.push({
        rule: 'ground-penetration',
        severity: 'error',
        part: node.path,
        message: 'contact point passes through the ground plane',
        detail: `lowest y=${deepest.y.toFixed(1)} at t=${deepest.t.toFixed(2)}, ground=${ground}, tolerance ${band.toFixed(1)}`,
      });
    }

    if (deepest.y < ground - band) {
      out.push({
        rule: 'no-ground-contact',
        severity: 'warning',
        part: node.path,
        message: 'contact point never reaches the ground, so the part appears to float',
        detail: `lowest it gets is y=${deepest.y.toFixed(1)} at t=${deepest.t.toFixed(2)}, ground=${ground}, tolerance ${band.toFixed(1)}`,
      });
      continue;
    }

    // Planted needs both tests. Height alone cannot separate stance from the
    // descent into touchdown, because a swinging foot passes back down through
    // the same heights it occupied while planted; direction settles it, since a
    // foot in contact tracks against the direction of travel while a swinging
    // one reaches with it. Longest run wins, treating the cycle as circular.
    const dx = pts.map((p, i) => p.x - pts[(i - 1 + SAMPLES) % SAMPLES].x);

    // Which way "backward" is, inferred rather than assumed: a character facing
    // left is just as valid, and hardcoding a sign would make this rule quietly
    // stop checking anything instead of failing loudly.
    const low = pts.map((p, i) => (p.y >= deepest.y - band ? dx[i] : 0));
    const travel = low.reduce((a, b) => a + b, 0) <= 0 ? -1 : 1;
    const planted = pts.map((p, i) => p.y >= deepest.y - band && dx[i] * travel >= 0);

    // Longest circular run, tracked by start and length so the growing run is
    // not copied on every extension.
    let bestStart = 0;
    let bestLen = 0;
    let runStart = 0;
    let runLen = 0;
    for (let i = 0; i < SAMPLES * 2 && runLen < SAMPLES; i++) {
      const k = i % SAMPLES;
      if (planted[k]) {
        if (runLen === 0) runStart = i;
        runLen++;
        if (runLen > bestLen) { bestLen = runLen; bestStart = runStart; }
      } else runLen = 0;
    }
    const best = Array.from({ length: bestLen }, (_, i) => (bestStart + i) % SAMPLES);

    // Drop the samples at each end of the run: they straddle touchdown and
    // push-off, where the foot is genuinely accelerating onto or off the
    // ground, so judging them as contact would flag every correct walk.
    if (best.length >= 6) {
      const steps = best.slice(2, -1).map((k) => dx[k]);
      const sorted = [...steps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (Math.abs(median) > 1e-6) {
        let worst = 0;
        let worstAt = 0;
        for (let i = 0; i < steps.length; i++) {
          const dev = Math.abs(steps[i] - median) / Math.abs(median);
          if (dev > worst) { worst = dev; worstAt = best[i + 2]; }
        }
        if (worst > SLIP_THRESHOLD) {
          out.push({
            rule: 'foot-slip',
            severity: 'warning',
            part: node.path,
            message: 'planted contact point changes speed, which reads as the foot skating',
            detail:
              `speed deviates ${(worst * 100).toFixed(0)}% from the median at t=${(worstAt / SAMPLES).toFixed(2)} ` +
              `(limit ${(SLIP_THRESHOLD * 100).toFixed(0)}%); ground speed is ${median.toFixed(2)} units/sample ` +
              `over ${best.length} planted samples`,
          });
        }
      }
    }
  }
  return out;
}

function viewBoxCheck(ch: Character, frames: Frame[]): Finding[] {
  const [vx, vy, vw, vh] = ch.viewBox;
  const corners = localCorners(ch);
  for (const frame of frames) {
    const t = frame.t;
    const b = frameBox(frame, corners);
    if (!b) continue;
    if (b.x0 < vx - 0.5 || b.y0 < vy - 0.5 || b.x1 > vx + vw + 0.5 || b.y1 > vy + vh + 0.5) {
      return [{
        rule: 'out-of-view',
        severity: 'warning',
        message: 'artwork leaves the viewBox during the cycle and will be clipped',
        detail: `at t=${t.toFixed(2)} bounds are [${b.x0.toFixed(1)}, ${b.y0.toFixed(1)}, ${b.x1.toFixed(1)}, ${b.y1.toFixed(1)}], viewBox is [${vx}, ${vy}, ${vx + vw}, ${vy + vh}]`,
      }];
    }
  }
  return [];
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'no issues found';
  const icon = { error: 'ERROR', warning: 'WARN ', info: 'INFO ' };
  return findings
    .map((f) => {
      const where = f.part ? ` ${f.part}` : '';
      const detail = f.detail ? `\n        ${f.detail}` : '';
      return `  ${icon[f.severity]} [${f.rule}]${where}\n        ${f.message}${detail}`;
    })
    .join('\n');
}
