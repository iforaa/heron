/**
 * Closed-form kinematics for the limb shape Heron declares.
 *
 * A `limb()` rests down the positive Y axis: its upper segment starts at the
 * root, its lower segment starts at the joint, and rotations are local degrees.
 * Keeping those conventions here matters more than the triangle itself. A
 * mathematically correct solver that returns angles from +X, radians, or a
 * world-space lower angle would put every Heron knee somewhere unexpected.
 */

import {
  sampled, type Channel, type Character, type Node, type Vec2,
} from './scene.ts';
import {
  apply, invert, lazyFrameAt, nodePose, type Frame, type TrackSnapshot,
} from './timeline.ts';
import { DEG, clamp, wrapDegrees } from './num.ts';

const EPSILON = 1e-12;

export type ReachStatus = 'reachable' | 'too-close' | 'too-far';

export interface TwoBoneOptions {
  /** Fixed root of the chain, in the same coordinate space as `target`. */
  root: Vec2;
  /** Desired end point: a hand, ankle, tool tip, or any other chain end. */
  target: Vec2;
  /** Upper and lower segment lengths, root outward. Both must be positive. */
  lengths: [number, number];
  /**
   * Which of the triangle's two solutions to use.
   *
   * `1` places the joint clockwise from the root-to-target ray; `-1` places it
   * counter-clockwise. For a vertical downward leg, `-1` bends the knee toward
   * screen-right and `1` bends it toward screen-left.
   */
  bend?: 1 | -1;
}

export interface TwoBoneSolution {
  /** Upper segment rotation from its positive-Y rest pose, degrees. */
  upper: number;
  /** Lower segment rotation relative to the upper segment, degrees. */
  lower: number;
  /** Solved middle joint in the input coordinate space. */
  joint: Vec2;
  /**
   * End point the chain can actually reach.
   *
   * Equal to `target` for a reachable request. Outside the reachable annulus it
   * is clamped onto the nearest boundary along the root-to-target ray.
   */
  reached: Vec2;
  /** Original root-to-target distance. */
  distance: number;
  /** Distance used by the solution after clamping. */
  reach: number;
  status: ReachStatus;
  clamped: boolean;
}

function finitePoint(name: string, p: Vec2): void {
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
    throw new Error(`heron: two-bone ${name} must contain finite coordinates`);
  }
}


/**
 * Wraps to (-180, 180], preferring +180 over -180: a fully folded joint should
 * have one spelling, and it is the easier one to read. Every angle this module
 * hands out — analytic solutions and additive corrections alike — goes through
 * this one rule, so the fold-over boundary cannot mean two different things.
 */

/** Keeps public angles small and makes equivalent branches compare cleanly. */
function degrees(rad: number): number {
  return wrapDegrees(rad * DEG);
}

/**
 * Places the end of a two-segment chain at a target.
 *
 * This is analytic IK: one application of the law of cosines, with no
 * iteration, history, or simulation. It is therefore a pure `inputs -> pose`
 * function and can be evaluated at arbitrary animation times.
 */
export function solveTwoBone(o: TwoBoneOptions): TwoBoneSolution {
  finitePoint('root', o.root);
  finitePoint('target', o.target);
  const [upperLength, lowerLength] = o.lengths;
  if (!Number.isFinite(upperLength) || !Number.isFinite(lowerLength)
      || upperLength <= 0 || lowerLength <= 0) {
    throw new Error('heron: two-bone lengths must be finite numbers greater than zero');
  }
  const bend = o.bend ?? 1;
  if (bend !== 1 && bend !== -1) {
    throw new Error('heron: two-bone bend must be 1 or -1');
  }

  const dx = o.target[0] - o.root[0];
  const dy = o.target[1] - o.root[1];
  const distance = Math.hypot(dx, dy);
  const near = Math.abs(upperLength - lowerLength);
  const far = upperLength + lowerLength;
  const reach = clamp(distance, near, far);
  const status: ReachStatus = distance > far
    ? 'too-far'
    : distance < near
      ? 'too-close'
      : 'reachable';

  // At the root there is no target direction. Down is Heron's rest direction,
  // so it is the least surprising stable fallback; `bend` still chooses which
  // side an equal-length chain folds toward.
  const ux = distance > EPSILON ? dx / distance : 0;
  const uy = distance > EPSILON ? dy / distance : 1;
  const reached: Vec2 = [o.root[0] + ux * reach, o.root[1] + uy * reach];

  /**
   * Angle between the target ray and the upper segment.
   *
   * `reach` can be zero only for equal segments targeting their own root. The
   * limiting triangle has a ninety-degree root angle, yielding a stable fully
   * folded pose on the requested side.
   */
  const rootAngle = reach <= EPSILON
    ? Math.PI / 2
    : Math.acos(clamp(
      (upperLength ** 2 + reach ** 2 - lowerLength ** 2)
        / (2 * upperLength * reach),
      -1,
      1,
    ));
  const ray = Math.atan2(uy, ux);
  const upperWorld = ray + bend * rootAngle;
  const joint: Vec2 = [
    o.root[0] + Math.cos(upperWorld) * upperLength,
    o.root[1] + Math.sin(upperWorld) * upperLength,
  ];
  const lowerWorld = Math.atan2(reached[1] - joint[1], reached[0] - joint[0]);

  // SVG/Heron limbs rest along +Y, whose world angle is PI/2. The lower result
  // is local to the already-rotated upper segment, exactly as nested parts need.
  const upper = degrees(upperWorld - Math.PI / 2);
  const lower = degrees(lowerWorld - upperWorld);

  return {
    upper,
    lower,
    joint,
    reached,
    distance,
    reach,
    status,
    clamped: status !== 'reachable',
  };
}

export type ReachTarget =
  | Vec2
  | ((t: number, frame: Frame) => Vec2)
  | {
      /** Scene part whose pivot/contact or explicit point is the target. */
      part: string;
      point?: Vec2;
    };

export interface ReachOptions {
  /** Upper and lower part paths, in that order. The lower must descend from the upper. */
  chain: [upper: string, lower: string];
  /** Rest lengths, root outward. */
  lengths: [number, number];
  /** World-space point, time function, or point carried by another scene part. */
  target: ReachTarget;
  bend?: 1 | -1;
  samples?: number;
}

export interface ReachPose {
  /** Absolute analytic solution in the upper part's parent coordinate space. */
  solution: TwoBoneSolution;
  /** Additive rotations placed on top of the pose captured when `reach()` was called. */
  upper: number;
  lower: number;
  target: Vec2;
}

export interface Reach {
  upper: Channel;
  lower: Channel;
  /** Solves the same captured rig at an arbitrary cycle time. */
  at(t: number): ReachPose;
}

function parentOf(ch: Character, node: Node): Node {
  const cut = node.path.lastIndexOf('.');
  const path = cut < 0 ? '' : node.path.slice(0, cut);
  const parent = ch.nodes().find((candidate) => candidate.path === path);
  if (!parent) throw new Error(`heron: cannot find the parent of "${node.path}"`);
  return parent;
}

/**
 * Drives a nested two-part chain toward an animated world-space target.
 *
 * The current scene pose is captured before the IK layers are appended. That is
 * what makes this composable with authored acting: a shoulder may already sway
 * and a knee may already flex, while `reach()` contributes only the correction
 * needed to land the end. Capturing also prevents the generated sampled tracks
 * from recursively evaluating themselves.
 *
 * Apply this after the base motion and after any animation on a target part.
 */
export function reach(ch: Character, o: ReachOptions): Reach {
  const upperNode = ch.find(o.chain[0]);
  const lowerNode = ch.find(o.chain[1]);
  if (!upperNode) throw new Error(`heron: reach() has no upper part "${o.chain[0]}"`);
  if (!lowerNode) throw new Error(`heron: reach() has no lower part "${o.chain[1]}"`);
  if (!upperNode.pivot) throw new Error(`heron: reach() needs "${upperNode.path}" to have a pivot`);
  if (!lowerNode.pivot) throw new Error(`heron: reach() needs "${lowerNode.path}" to have a pivot`);
  if (!lowerNode.path.startsWith(`${upperNode.path}.`)) {
    throw new Error(`heron: reach() lower part "${lowerNode.path}" is not inside "${upperNode.path}"`);
  }
  // A traced joint will almost never land on a mathematically perfect vertical.
  // Measure its rest direction and express the analytic +Y solution relative to
  // that direction instead of rejecting the measured rig.
  const restVector: Vec2 = [
    lowerNode.pivot[0] - upperNode.pivot[0],
    lowerNode.pivot[1] - upperNode.pivot[1],
  ];
  if (Math.hypot(...restVector) < EPSILON) {
    throw new Error(`heron: reach() chain pivots "${upperNode.path}" and "${lowerNode.path}" coincide`);
  }
  // SVG's positive rotation sends +Y toward -X, hence the minus on x.
  const restUpper = Math.atan2(-restVector[0], restVector[1]) * DEG;

  // The union is discriminated once, into one shape: a function of the frame.
  const targetAt: (t: number, frame: Frame) => Vec2 = (() => {
    if (typeof o.target === 'function') {
      const fn = o.target;
      return (t: number, frame: Frame) => fn(t, frame);
    }
    if (Array.isArray(o.target)) {
      const point = o.target;
      return () => point;
    }
    const spec = o.target;
    const node = ch.find(spec.part);
    if (!node) throw new Error(`heron: reach() has no target part "${spec.part}"`);
    return (_t: number, frame: Frame) => frame.point(node, spec.point);
  })();

  const parent = parentOf(ch, upperNode);
  const captured: TrackSnapshot = new Map(
    ch.nodes().map((node) => [node.path, [...node.tracks]]),
  );
  const samples = o.samples ?? 128;
  const cache = new Map<number, ReachPose>();

  const at = (t: number): ReachPose => {
    let got = cache.get(t);
    if (got) return got;
    const frame = lazyFrameAt(ch, t, captured);
    const parentMatrix = frame.matrices.get(parent.path);
    if (!parentMatrix) throw new Error(`heron: reach() cannot evaluate parent "${parent.path}"`);
    const toParent = invert(parentMatrix);
    const rootWorld = frame.point(upperNode, upperNode.pivot);

    const target = targetAt(t, frame);
    finitePoint('target', target);

    const root = apply(toParent, rootWorld);
    const localTarget = apply(toParent, target);
    const solution = solveTwoBone({
      root,
      target: localTarget,
      lengths: o.lengths,
      bend: o.bend,
    });
    // The frame already evaluated the captured base motion; the correction is
    // the analytic answer minus what the part is authored to do on its own.
    got = {
      solution,
      upper: wrapDegrees(
        solution.upper - restUpper - nodePose(upperNode, frame.pose.get(upperNode.path)).rotate,
      ),
      lower: wrapDegrees(solution.lower - nodePose(lowerNode, frame.pose.get(lowerNode.path)).rotate),
      target,
    };
    cache.set(t, got);
    return got;
  };

  const upper = sampled((t) => at(t).upper, samples);
  const lower = sampled((t) => at(t).lower, samples);
  ch.part(upperNode.path).animate({ rotate: upper });
  ch.part(lowerNode.path).animate({ rotate: lower });
  return { upper, lower, at };
}
