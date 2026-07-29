#!/usr/bin/env node
/**
 * The agent feedback loop.
 *
 * Writing animation blind is why this project exists, so these commands are the
 * point of the library rather than an accessory to it:
 *
 *   snapshot  one pose, as an image the agent can actually look at
 *   sheet     several poses tiled, which is how motion is judged
 *   inspect   the same pose as numbers, when geometry is the question
 *   lint      defects that are invisible in a still frame
 *   build     the deliverable, plus a report of anything that was approximated
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

import { Character } from './scene.ts';
import { renderStatic, renderSheet, boxOfCorners, localCorners, sheetTimes, sheetWidth } from './render.ts';
import { compile } from './compile.ts';
import { lint, formatFindings } from './lint.ts';
import { frameAt } from './timeline.ts';

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

  const ch = await loadScene(file);

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
