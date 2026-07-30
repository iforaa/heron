/**
 * Compatible-command SVG path interpolation.
 *
 * This intentionally does not guess correspondences between unrelated shapes.
 * Every key must use the same commands in the same order, which makes the
 * interpolation deterministic and keeps authored contour topology intact.
 */

import { type Easing, linear } from './easing.ts';

export type PathMorphTuple = [time: number, d: string, ease?: Easing];

export interface PathMorphKey {
  t: number;
  d: string;
  ease: Easing;
  tokens: Array<string | number>;
}

export interface PathMorph {
  readonly kind: 'path-morph';
  readonly keys: PathMorphKey[];
}

const TOKEN = /[A-Za-z]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g;

function tokens(d: string): Array<string | number> {
  const found = [...d.matchAll(TOKEN)];
  const remainder = d.replace(TOKEN, '').replace(/[\s,]/g, '');
  if (!found.length || remainder) throw new Error(`heron: invalid SVG path data "${d}"`);
  const out = found.map((match) => /[A-Za-z]/.test(match[0]) ? match[0] : Number(match[0]));
  if (out[0] !== 'M' && out[0] !== 'm') throw new Error('heron: a morph path must begin with M or m');
  if (out.some((v) => typeof v === 'string' && v.toLowerCase() === 'a')) {
    throw new Error('heron: path morphing does not support arc commands; convert arcs to cubic curves first');
  }
  return out;
}

/** Creates a keyed path morph. All paths must have compatible command topology. */
export function pathMorph(input: PathMorphTuple[], ease: Easing = linear): PathMorph {
  if (input.length < 2) throw new Error('heron: pathMorph() needs at least two keys');
  const keys = input.map(([t, d, keyEase]) => ({ t, d, ease: keyEase ?? ease, tokens: tokens(d) }));
  if (keys[0].t !== 0 || keys[keys.length - 1].t !== 1) {
    throw new Error('heron: pathMorph() keys must start at 0 and end at 1');
  }
  for (let i = 0; i < keys.length; i++) {
    if (!Number.isFinite(keys[i].t) || (i && keys[i].t <= keys[i - 1].t)) {
      throw new Error('heron: pathMorph() key times must be finite and strictly increasing');
    }
    if (i === 0) continue;
    const previous = keys[0].tokens;
    const current = keys[i].tokens;
    if (current.length !== previous.length || current.some((v, k) =>
      typeof v === 'string' ? v !== previous[k] : typeof previous[k] !== 'number')) {
      throw new Error(`heron: pathMorph() key ${i} has incompatible commands`);
    }
  }
  return { kind: 'path-morph', keys };
}

function format(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Evaluates path geometry at normalized animation time. */
export function pathAt(morph: PathMorph, t: number): string {
  const keys = morph.keys;
  if (t <= 0) return keys[0].d;
  if (t >= 1) return keys[keys.length - 1].d;
  let i = 0;
  while (i + 1 < keys.length && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = a.ease.fn((t - a.t) / (b.t - a.t));
  return a.tokens.map((value, k) => {
    if (typeof value === 'string') return value;
    const target = b.tokens[k] as number;
    return format(value + (target - value) * u);
  }).join(' ');
}
