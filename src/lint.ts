/**
 * Motion lints: turn "something looks off" into a diagnosis.
 *
 * Every check here exists because it caught a real defect while the reference
 * walk cycle was being built by hand. An agent cannot see that a planted foot
 * subtly changes speed mid-step, but it is trivially visible in the numbers.
 */

import { type Character, CHANNELS } from './scene.ts';
import { type Frame, evaluate, frameAt, netPose, nodePose } from './timeline.ts';
import { EPSILON, transformBakeReason } from './compile.ts';
import { frameBox, localCorners, subtreeCorners } from './geometry.ts';
import {
  type PartTrack, type TrackReport, CONTACT_BAND, plantedRun, trackParts, trackable,
} from './track.ts';
import { playbackTimes } from './delivery.ts';

export interface Finding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  part?: string;
  message: string;
  detail?: string;
  /**
   * The instant this is about, as a cycle time.
   *
   * Carried as a number rather than left inside `detail`, so findings can be
   * grouped by the event they describe. Comparing rendered sentences instead
   * looked like it worked and silently failed: two parts reporting one stop
   * differ in the speeds they print, so one event came back out as two.
   */
  at?: number;
}

const DEFAULT_FPS = 60;

export interface LintOptions {
  /** Playback rate whose exact delivered instants must be inspected. */
  fps?: number;
}

/** Speed variation permitted while planted before it reads as skating. */
const SLIP_THRESHOLD = 0.25;

// Thresholds for the soft diagnostics. These are the advisory ones, and they are
// held to `info` for that reason: they say "this is a shape that usually reads
// badly", not "this is wrong". Nothing below can fail a build, and a scene is
// free to mean any of it.

/** Peak-to-median below which a whole cycle reads as one constant slide. */
const FLAT_RATIO = 1.2;
/** How much of a part's own travel must be left for a stop to count as a stop. */
const STOP_FRACTION = 0.08;
/** Travel below this fraction of the viewBox diagonal is not really motion. */
const MOVES_AT_ALL = 0.02;
/** How long after a stop a settle's overshoot may arrive, in samples. */
const OVERSHOOT_SAMPLES = 2.5;

// The contact band and the stance decision both come from the measurement layer,
// so the two cannot drift apart on what "planted" means. What stays here is the
// judgement: how much a planted foot may vary before it reads as skating.

export function lint(ch: Character, o: LintOptions = {}): Finding[] {
  // One pass of frames feeds every rule. Posing the scene per rule, per part,
  // per sample is how a 13-part rig ended up walking its own tree hundreds of
  // times for a single lint.
  const times = playbackTimes(ch.duration, o.fps ?? DEFAULT_FPS);
  // A finite SVG holds its exact 100% pose after playback. Video does not add a
  // duplicate endpoint frame, but lint must still inspect the held end card.
  if (ch.once) times.push(1);
  const frames = times.map((t) => frameAt(ch, t));
  return [
    ...deliveryChecks(ch),
    // A film is allowed to end somewhere other than where it began. That is not
    // a seam, it is the plot.
    ...(ch.once ? [] : loopSeam(ch)),
    ...swapChecks(ch, frames),
    ...groundChecks(ch, frames),
    ...viewBoxCheck(ch, frames),
    ...kinematics(ch, times),
  ];
}

/** Delivery degradations that are correct but expensive and easy to miss. */
function deliveryChecks(ch: Character): Finding[] {
  const out: Finding[] = [];
  for (const node of ch.nodes()) {
    node.tracks.forEach((track, layer) => {
      const reason = transformBakeReason(track);
      if (!reason) return;
      out.push({
        rule: 'baked-transform',
        severity: 'warning',
        part: node.path,
        message: 'transform channels use incompatible timing and will be sampled instead of emitted exactly',
        detail: `layer ${layer}: ${reason}; align key times/easings or put the gestures in separate animate() layers`,
      });
    });
  }
  return out;
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
      const on = children.filter((c) => nodePose(c, frame.pose.get(c.path)).opacity > 0.5);
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
      // Full turns are the same visual orientation. Treating 0 -> -360 as an
      // open seam blocked the loader's deliberately continuous spinner even
      // though its first and last rendered poses are identical.
      const delta = name === 'rotate'
        ? ((b[name] - a[name] + 180) % 360 + 360) % 360 - 180
        : b[name] - a[name];
      if (Math.abs(delta) <= EPSILON[name]) continue;
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

    const pts = frames.map((f) => f.point(node));
    const lowest = pts.reduce((m, p, i) => (p[1] > pts[m][1] ? i : m), 0);
    const deepest = { y: pts[lowest][1], t: frames[lowest].t };
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

    // The stance decision itself belongs to the measurement layer, which returns
    // the run and its per-sample steps rather than a mask — those steps are what
    // this rule judges. Restating the decision here is how the two came to be
    // able to disagree about what "planted" means.
    const { deltas: dx, indices: best } = plantedRun(pts, ch.viewBox[3], true);

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
              `speed deviates ${(worst * 100).toFixed(0)}% from the median at t=${frames[worstAt].t.toFixed(2)} ` +
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

/**
 * The soft diagnostics: shapes of motion that usually read badly.
 *
 * Every rule above this one names a defect — something is through the floor, or
 * the loop jumps. These name a *preference*, so they are all `info` and none of
 * them can fail a build. They exist because the alternative is that nobody looks:
 * an agent cannot see that a walk is one flat slide or that a film stops dead, and
 * the numbers say both immediately.
 *
 * They read the same measurement pass the motion sheet and the variants overlay
 * read, so a diagnostic and the picture that would show it cannot disagree.
 */
function kinematics(ch: Character, times: number[]): Finding[] {
  // A film shorter than one delivery interval has one visible sample and no
  // measurable velocity. Structural checks still inspect that delivered frame.
  if (times.length < 2) return [];
  // One walk of the shape tree, shared with the measurement pass. Asking for the
  // ink twice — once to decide what is worth measuring, once inside `trackParts`
  // — cost up to half of everything these rules added on a path-heavy scene.
  const corners = subtreeCorners(ch);
  const parts = trackable(ch, corners);
  if (!parts.length) return [];

  const [, , vw, vh] = ch.viewBox;
  const floor = Math.hypot(vw, vh) * MOVES_AT_ALL;
  const report = trackParts(ch, { parts, times, corners });

  const out: Finding[] = [];
  for (const p of report.parts) {
    if (p.pathLength < floor) continue;
    // Each rule states its own applicability. A dispatcher that knew which rules
    // apply to a contact point and which do not would have to be edited every
    // time a rule is added, and the knowledge would sit away from the reasoning.
    for (const rule of [flatSpacing, hardStops]) out.push(...rule(p, report));
  }
  return coalesce(out);
}

/**
 * One motion, one finding.
 *
 * A part carries its ancestors' movement, so a single deceleration is measurable
 * again at every descendant; and a `field` of particles driven by one gesture is
 * measurable once per particle. Both happened on real scenes: 35 findings for one
 * `morphThrough` of one field, 30 for another, and a rigged character reporting
 * one stop at twenty joints. That is not a report anybody reads.
 *
 * So findings of the same rule on *related* parts are one event. Related means
 * either a chain — one part inside another — or siblings under one parent, which
 * is what a field is. Both are needed and neither subsumes the other: particles
 * are not inside each other, and a limb is not a sibling of the body it hangs
 * from. Instants are deliberately not part of the test, because a stagger is one
 * gesture whose parts stop at eleven different times.
 */
function coalesce(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  for (const rule of new Set(findings.map((f) => f.rule))) {
    const mine = findings.filter((f) => f.rule === rule);
    const clusters: Finding[][] = [];
    for (const f of mine) {
      const near = clusters.find((c) => c.some((g) => related(g.part, f.part)));
      if (near) near.push(f); else clusters.push([f]);
    }
    out.push(...clusters.map(([first, ...rest]) => {
      if (!rest.length) return first;
      const at = [first, ...rest].map((f) => f.at).filter((v): v is number => v !== undefined);
      const span = at.length > 1 && Math.min(...at) !== Math.max(...at)
        ? ` between t=${Math.min(...at)} and t=${Math.max(...at)}`
        : ' at the same instant';
      return {
        ...first,
        part: commonPrefix([first, ...rest].map((f) => f.part ?? '')),
        detail: `${first.detail} — and ${rest.length} more part(s)${span}`,
      };
    }));
  }
  return out;
}

/** One part inside the other, or two under the same parent: one gesture either way. */
function related(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`)) return true;
  const parent = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('.')));
  return parent(a) !== '' && parent(a) === parent(b);
}

/** The deepest dotted path containing every one of these, e.g. `cast.mom` for its limbs. */
function commonPrefix(paths: string[]): string {
  const split = paths.map((p) => p.split('.'));
  const head = split[0] ?? [];
  let n = 0;
  while (n < head.length && split.every((s) => s[n] === head[n])) n++;
  return head.slice(0, n).join('.') || (head[0] ?? '');
}

/**
 * A contact point that holds one speed for the whole cycle.
 *
 * Judged only on parts that declare a contact, because that is where a constant
 * speed *means* something: a planted foot has to track the ground and a swinging
 * one has to travel several times faster, so the two phases cannot be the same
 * number. Elsewhere a constant speed is ordinary — a scrolling backdrop and a
 * camera travel are both deliberately linear, and reporting them would be noise.
 */
function flatSpacing(p: PartTrack): Finding[] {
  if (p.trackedAt.source !== 'contact') return [];
  // A median of zero is a part that never moves between samples, not a part that
  // moves at one speed; `ratio` is 0 there and the message would be nonsense.
  if (p.speed.median <= 0 || p.speed.ratio >= FLAT_RATIO) return [];
  return [{
    rule: 'linear-spacing',
    severity: 'info',
    part: p.part,
    message: 'the contact point moves at one speed all cycle, which reads as sliding rather than stepping',
    detail: `peak is only ${p.speed.ratio}x the median (${p.speed.median}/s); a walk is usually 3-6x`
      + ', because the planted foot tracks the ground and the swing has to catch up',
  }];
}

/**
 * Motion that stops dead instead of settling.
 *
 * `decelerations` already records only the real slowings — a halving from above
 * the part's own median. What is left is the harder half: telling a *cut* from a
 * *settle*, which the timings cannot do, since every entry spans exactly one
 * sample interval whether the motion eased into rest or hit a wall.
 *
 * The discriminator is the physics rather than the clock. Anything with weight
 * overshoots its stopping point and comes back, so a settle leaves a direction
 * reversal just after it and a cut leaves none. That signal is already measured,
 * and it does not need a threshold of its own.
 *
 * Not asked of contact points: a foot landing stops dead because the ground
 * stopped it, which is correct physics rather than a missing settle.
 */
function hardStops(p: PartTrack, report: TrackReport): Finding[] {
  if (p.trackedAt.source === 'contact') return [];
  const reversals = [...p.reversals.x, ...p.reversals.y];
  // The overshoot follows the stop, so the window is one-sided. Derived from the
  // report's own grid rather than from the raw sample array, so it stays right if
  // a window narrower than the whole cycle is ever measured.
  const step = (report.window.to - report.window.from) / report.samples;
  const stop = p.decelerations.find((d) => d.to <= p.speed.median * STOP_FRACTION
    && !reversals.some((r) => r >= d.at - step && r <= d.at + OVERSHOOT_SAMPLES * step));
  if (!stop) return [];
  return [{
    rule: 'abrupt-stop',
    severity: 'info',
    part: p.part,
    at: stop.at,
    message: 'motion stops dead rather than settling, which reads as the animation being cut off',
    detail: `${stop.from}/s to ${stop.to}/s at t=${stop.at}, with no overshoot after it`
      + '; anything with weight passes its stopping point and comes back',
  }];
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
