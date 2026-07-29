#!/usr/bin/env node
/**
 * The agent feedback loop.
 *
 * Writing animation blind is why this project exists, so these commands are the
 * point of the library rather than an accessory to it:
 *
 *   trace     a reference image turned into measured geometry
 *   match     that geometry checked back against the reference
 *   snapshot  one pose, as an image the agent can actually look at
 *   sheet     several poses tiled, which is how motion is judged
 *   inspect   the same pose as numbers, when geometry is the question
 *   lint      defects that are invisible in a still frame
 *   build     the deliverable, plus a report of anything that was approximated
 *
 * `trace` and `match` come first for a reason. Drawing used to be the one step
 * with no instrument on it, and eyeballing coordinates off a PNG put a uniform
 * 17-20% stroke-width error through a whole scene without anyone noticing.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

import { Character } from './scene.ts';
import { renderStatic, renderSheet, boxOfCorners, localCorners, sheetTimes, sheetWidth } from './render.ts';
import { compile } from './compile.ts';
import { lint, formatFindings } from './lint.ts';
import { frameAt } from './timeline.ts';
import { trace } from './trace.ts';
import { match, formatMatch } from './match.ts';
import { encodePng } from './raster.ts';

interface Args {
  _: string[];
  [k: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : true);
    } else if (a.startsWith('-') && a.length === 2) {
      out[a.slice(1)] = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : true;
    } else {
      (out._ as string[]).push(a);
    }
  }
  return out;
}

async function loadScene(file: string): Promise<Character> {
  const url = pathToFileURL(resolve(file)).href;
  const mod = (await import(url)) as Record<string, unknown>;
  if (mod.default instanceof Character) return mod.default;
  for (const v of Object.values(mod)) if (v instanceof Character) return v;
  throw new Error(`heron: ${file} does not export a Character`);
}

function write(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(resolve(file), data);
}

function toPng(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'white' }).render().asPng();
}

function num(v: unknown, d: number): number {
  const n = typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : d;
}

const USAGE = `heron - compile character animation into a self-contained animated SVG

  heron trace    <image.png> [-o scene.ts] [--epsilon 1.2] [--threshold 0.22]
                 [--fit 1.5] [--ribbons all|taper|none] [--refine 12]
  heron match    <scene.ts> <reference.png> [-o overlay.png] [-t 0]
  heron snapshot <scene.ts> [-t 0.4] [-o frame.png] [-w 520] [--svg]
  heron sheet    <scene.ts> [-n 8] [-o sheet.png] [--cols 4] [--svg]
  heron inspect  <scene.ts> [-t 0.4]
  heron lint     <scene.ts>
  heron build    <scene.ts> [-o out.svg] [-w 360]

Times are fractions of one cycle, 0 to 1.`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, file] = args._ as string[];

  if (!cmd || args.help || args.h) {
    console.log(USAGE);
    return;
  }
  if (!file) throw new Error(`heron: ${cmd} needs a scene file`);

  // `trace` reads an image rather than a scene, so it runs before the loader.
  if (cmd === 'trace') {
    const out = String(args.o ?? 'scene.ts');
    const rel = relative(dirname(resolve(out)), fileURLToPath(new URL('./index.ts', import.meta.url)));
    const res = trace(file, {
      epsilon: num(args.epsilon, 1.2),
      threshold: num(args.threshold, 0.22),
      minBranch: num(args.minBranch, 6),
      name: args.name ? String(args.name) : undefined,
      fit: num(args.fit, 1.5),
      ribbons: args.ribbons ? (String(args.ribbons) as 'taper' | 'all' | 'none') : undefined,
      refine: num(args.refine, 12),
      out: basename(out),
      importFrom: existsSync(resolve('node_modules/@heron/core')) ? '@heron/core' : (rel.startsWith('.') ? rel : `./${rel}`),
    });
    write(out, res.source);
    console.log(`${out}  ${res.width}x${res.height}  ${res.strokes.length} strokes traced, ink ${res.colour}`);
    const w = res.strokes.map((s) => s.width);
    if (w.length) {
      console.log(`  measured widths: ${[...new Set(w.map((v) => v.toFixed(0)))].sort((a, b) => +a - +b).join(', ')} px`);
    }
    const bends = res.strokes.filter((s) => s.corners.length).length;
    if (res.tuned) {
      const t = res.tuned;
      console.log(`  corrected against the reference: overlap ${t.before.toFixed(1)}% -> ${t.after.toFixed(1)}%`);
      console.log(`    over ${t.rounds} pass(es), moving points by at most ${t.moved.toFixed(1)}px`);
    }
    if (res.profiled) {
      console.log(`  ${res.profiled} run(s) carry a measured width at every point, so a taper is drawn as`);
      console.log(`    measured rather than flattened to one number - and keeps its centreline`);
    }
    if (res.outlined) {
      console.log(`  ${res.outlined} blob(s) with no centreline to measure were traced as outlines by potrace`);
    }
    if (res.fitted) {
      console.log(`  ${res.fitted} run(s) were really a circle or a line, and are emitted as one - fitted over every`);
      console.log(`    sample, so they are more accurate than the points they replace, not just shorter`);
    }
    if (res.varying && !res.profiled && !res.outlined) {
      console.log(`  ! ${res.varying} run(s) taper but were emitted at one width - pass --ribbons all`);
    }
    if (bends) {
      console.log(`  ! ${bends} run(s) turn a sharp corner - each may be two parts traced as one`);
    }
    console.log(`  ${res.joints.length} candidate joint(s) where runs fork: ${res.joints.slice(0, 8).map((j) => `(${j[0]},${j[1]})`).join(' ')}${res.joints.length > 8 ? ' ...' : ''}`);
    console.log(`  geometry only. Next: heron match ${out} ${file}, then group the strokes into jointed parts.`);
    return;
  }

  const ch = await loadScene(file);

  if (cmd === 'match') {
    const reference = (args._ as string[])[2];
    if (!reference) throw new Error('heron: match needs a scene file and a reference image');
    const report = match(ch, reference, { t: num(args.t, 0), threshold: args.threshold ? num(args.threshold, 0.22) : undefined });
    console.log(formatMatch(report, `${ch.name} vs ${basename(reference)}`));
    const out = String(args.o ?? 'match.png');
    write(out, encodePng(report.overlay, report.width, report.height));
    console.log(`  ${out}  grey both, red reference only, blue scene only`);
    return;
  }

  switch (cmd) {
    case 'snapshot': {
      const t = num(args.t, 0);
      const width = num(args.w, 520);
      const svg = renderStatic(ch, t, { width });
      const out = String(args.o ?? (args.svg ? 'frame.svg' : 'frame.png'));
      write(out, args.svg ? svg : toPng(svg, width));
      console.log(`${out}  (${ch.name} at t=${t})`);
      break;
    }

    case 'sheet': {
      const n = Math.max(2, num(args.n, 8));
      const cols = num(args.cols, Math.min(4, n));
      const times = args.t ? String(args.t).split(',').map(Number) : sheetTimes(n);
      const svg = renderSheet(ch, times, { cols });
      const out = String(args.o ?? (args.svg ? 'sheet.svg' : 'sheet.png'));
      const width = sheetWidth(cols);
      write(out, args.svg ? svg : toPng(svg, width));
      console.log(`${out}  (${times.length} frames: ${times.map((t) => t.toFixed(2)).join(' ')})`);
      break;
    }

    case 'inspect': {
      const t = num(args.t, 0);
      const frame = frameAt(ch, t);
      const corners = localCorners(ch);
      console.log(`${ch.name} at t=${t}  viewBox=[${ch.viewBox.join(' ')}]  duration=${ch.duration}s${ch.ground !== undefined ? `  ground=${ch.ground}` : ''}`);
      for (const node of ch.nodes()) {
        if (!node.path) continue;
        const depth = node.path.split('.').length - 1;
        const p = frame.pose.get(node.path)!;
        const bits: string[] = [];
        if (p.rotate) bits.push(`rot ${p.rotate.toFixed(1)}deg`);
        if (p.x || p.y) bits.push(`t (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
        if (p.scaleX !== 1 || p.scaleY !== 1) bits.push(`scale ${p.scaleX.toFixed(2)},${p.scaleY.toFixed(2)}`);
        if (p.opacity !== 1) bits.push(`opacity ${p.opacity.toFixed(2)}`);
        if (node.pivot) bits.push(`pivot (${node.pivot[0]}, ${node.pivot[1]})`);
        if (node.contact) {
          const [wx, wy] = frame.point(node);
          bits.push(`contact -> (${wx.toFixed(1)}, ${wy.toFixed(1)})`);
        }
        const b = boxOfCorners(corners.get(node.path), frame.matrices.get(node.path));
        if (b) bits.push(`box [${b.x0.toFixed(0)} ${b.y0.toFixed(0)} ${b.x1.toFixed(0)} ${b.y1.toFixed(0)}]`);
        console.log(`${'  '.repeat(depth + 1)}${node.name}${bits.length ? '  ' + bits.join('  ') : ''}`);
      }
      break;
    }

    case 'lint': {
      const findings = lint(ch);
      console.log(formatFindings(findings));
      if (findings.some((f) => f.severity === 'error')) process.exitCode = 1;
      break;
    }

    case 'build': {
      const width = num(args.w, ch.viewBox[2] * 2);
      const { svg, report } = compile(ch, { width });
      const out = String(args.o ?? `${ch.name}.svg`);
      write(out, svg);

      const baked = report.parts.filter((p) => p.mode === 'baked');
      const frames = report.parts.reduce((n, p) => n + p.keyframes, 0);
      console.log(`${out}  ${(Buffer.byteLength(svg) / 1024).toFixed(1)} kB  ${report.parts.length} animated parts, ${frames} keyframes`);
      if (baked.length) {
        console.log(`  baked to sampled keyframes (within EPSILON of the evaluator):`);
        for (const p of baked) console.log(`    ${p.path}: ${p.reason}, ${p.keyframes} keyframes`);
      }
      const findings = lint(ch);
      if (findings.length) console.log(formatFindings(findings));
      break;
    }

    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
