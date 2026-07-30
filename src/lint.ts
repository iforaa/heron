/**
 * Motion lints: turn "something looks off" into a diagnosis.
 *
 * Every check here exists because it caught a real defect while the reference
 * walk cycle was being built by hand. An agent cannot see that a planted foot
 * subtly changes speed mid-step, but it is trivially visible in the numbers.
 */

import { type Character, CHANNELS } from './scene.ts';
import { type Frame, evaluate, netPose, sampleFrames } from './timeline.ts';
import { EPSILON } from './compile.ts';
import { frameBox, localCorners } from './render.ts';
import { CONTACT_BAND, longestRun } from './track.ts';

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

// The contact band and the longest-run scan are shared with the measurement
// layer, so the two cannot drift apart on the details of what "planted" means.
// The stance decision itself is still made twice; see `track.ts`'s header.

export function lint(ch: Character): Finding[] {
  // One pass of frames feeds every rule. Posing the scene per rule, per part,
  // per sample is how a 13-part rig ended up walking its own tree hundreds of
  // times for a single lint.
  const frames = sampleFrames(ch, SAMPLES);
  return [
    // A film is allowed to end somewhere other than where it began. That is not
    // a seam, it is the plot.
    ...(ch.once ? [] : loopSeam(ch)),
    ...swapChecks(ch, frames),
    ...groundChecks(ch, frames),
    ...viewBoxCheck(ch, frames),
  ];
}

/**
 * Holds a `swap` to the one rule that makes it a swap: exactly one variant
 * showing, at every instant.
 *
 * Both failures are invisible in the place you would look for them. Two variants
 * at once is not a doubled image — the shapes are similar and nearly aligned, so
 * it reads as a slightly heavier, slightly wrong drawing, which an agent will
 * happily accept as the intended one. None at all is a hole in the film, and a
 * hole one frame long does not survive into a contact sheet. The numbers say it
 * immediately.
 *
 * The variants' own opacity is what is judged, not their opacity in the scene,
 * so a swap that is deliberately faded out as a whole — by its group, or by a
 * shot above it — is still checked for being internally coherent.
 */
function swapChecks(ch: Character, frames: Frame[]): Finding[] {
  const out: Finding[] = [];
  for (const node of ch.nodes()) {
    if (!node.variants) continue;
    const children = node.content.flatMap((item) => ('node' in item ? [item.node] : []));
    const everShown = new Set<string>();

    for (const frame of frames) {
      const on = children.filter((c) => netPose(frame.pose.get(c.path)).opacity > 0.5);
      for (const c of on) everShown.add(c.name);
      if (on.length === 1) continue;
      out.push({
        rule: 'swap-overlap',
        severity: 'error',
        part: node.path,
        message: on.length
          ? 'more than one variant is showing, so they are drawn on top of each other'
          : 'no variant is showing, so there is a hole here',
        detail: `at t=${frame.t.toFixed(3)}, ${on.length} of ${children.length} visible`
          + (on.length ? `: ${on.map((c) => c.name).join(', ')}` : ''),
      });
      break;
    }

    for (const c of children) {
      if (everShown.has(c.name)) continue;
      out.push({
        rule: 'swap-orphan',
        severity: 'warning',
        part: c.path,
        message: 'this variant is never shown, so it is weight in the file and nothing on screen',
        detail: `"${c.name}" is one of ${children.length} variants of ${node.path || '(root)'}`,
      });
    }
  }
  return out;
}

/**
 * A cycle that ends somewhere other than where it started visibly jumps once
 * per loop. This is the single most common way a generated walk looks broken.
 */
function loopSeam(ch: Character): Finding[] {
  const out: Finding[] = [];
  // Judged on the net of every layer, not layer by layer. What jumps is the
  // composed transform, and layered acting routinely has one layer end somewhere
  // else because another puts it back — a held glance and its release are two
  // layers that only close together.
  const open = evaluate(ch, 0);
  const shut = evaluate(ch, 1);
  for (const node of ch.nodes()) {
    if (!node.tracks.length) continue;
    const a = netPose(open.get(node.path));
    const b = netPose(shut.get(node.path));
    for (const name of CHANNELS) {
      // Judged against the compiler's own error budget rather than against zero.
      // A physical settle approaches its target without ever quite arriving, and
      // demanding an exactness the compiled file does not itself preserve would
      // reject correct motion — the same 0.4 degrees a baked curve is allowed to
      // differ by cannot simultaneously be a defect when an author leaves it.
      if (Math.abs(a[name] - b[name]) <= EPSILON[name]) continue;
      out.push({
        rule: 'loop-seam',
        severity: 'error',
        part: node.path,
        message: `${name} does not return to its starting value, so the loop jumps every cycle`,
        detail: `${name}: t=0 is ${a[name].toFixed(2)}, t=1 is ${b[name].toFixed(2)}`
          + (node.tracks.length > 1 ? `, summed over ${node.tracks.length} layers` : ''),
      });
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

    const best = longestRun(planted);

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
  // Anything declared offstage is meant to run past the frame edge, so measuring
  // it here would report the pan, or the entrance, as the defect.
  for (const node of ch.nodes()) if (node.offstage) corners.delete(node.path);
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
