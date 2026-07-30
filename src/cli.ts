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
 *   shapes    every run picked out in turn, which is how anatomy is decided
 *   sheet     several poses tiled, which is how motion is judged
 *   studio    the built animation with a scrubber, which is how timing is judged
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
import {
  renderStatic, renderSheet, renderCueSheet, renderShapeSheet, listShapes, boxOfCorners,
  localCorners, cueFrames, sheetTimes, sheetWidth,
} from './render.ts';
import { compile } from './compile.ts';
import { lint, formatFindings } from './lint.ts';
import { studio } from './studio.ts';
import { CueSheet, Score } from './score.ts';
import { frameAt, netPose } from './timeline.ts';
import { trace } from './trace.ts';
import { halftoneFile, plateSource } from './halftone.ts';
import { match, formatMatch } from './match.ts';
import { encodePng } from './raster.ts';
import { renderVideo } from './video.ts';

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

async function loadScene(file: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(resolve(file)).href)) as Record<string, unknown>;
}

/** The first export of a given kind, preferring `default`. */
function pick<T>(mod: Record<string, unknown>, kind: new (...a: never[]) => T): T | undefined {
  if (mod.default instanceof kind) return mod.default as T;
  return Object.values(mod).find((v) => v instanceof kind) as T | undefined;
}

function write(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(resolve(file), data);
}

function toPng(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'white' }).render().asPng();
}

/**
 * Writes a rendered SVG out, honouring `--svg`.
 *
 * The rule that `--svg` writes the vector and its absence rasterises at a given
 * width is a promise made to the user by three commands at once, so it is stated
 * once here rather than re-typed at each of them.
 */
function emit(svg: string, args: Args, stem: string, width: number): string {
  const out = String(args.o ?? `${stem}.${args.svg ? 'svg' : 'png'}`);
  write(out, args.svg ? svg : toPng(svg, width));
  return out;
}

function num(v: unknown, d: number): number {
  const n = typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : d;
}

const USAGE = `heron - compile character animation into a self-contained animated SVG

  heron trace    <image.png> [-o scene.ts] [--epsilon 1.2] [--threshold 0.22]
                 [--fit 1.5] [--ribbons all|taper|none] [--refine 12]
  heron halftone <image.png...> [-o plates.ts] [--across 44] [--threshold 0.15]
                 [--width 1000] [--square] [--name PLATES]
  heron match    <scene.ts> <reference.png> [-o overlay.png] [-t 0]
  heron snapshot <scene.ts> [-t 0.4] [-o frame.png] [-w 520] [--svg]
  heron shapes   <scene.ts> [-o shapes.png] [--cols 5] [--svg]
  heron sheet    <scene.ts> [-n 8] [-o sheet.png] [--cols 4] [--onion 3] [--cues] [--svg]
  heron inspect  <scene.ts> [-t 0.4]
  heron lint     <scene.ts>
  heron studio   <scene.ts> [-o scene.html] [-w 900]
  heron build    <scene.ts> [-o out.svg] [-w 360]
  heron video    <scene.ts> [-o out.mp4] [-w 1280] [--fps 30] [--audio soundtrack.wav]

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
      console.log(`    ${t.controls} control point(s) describing ${t.samples} samples, so a wobble`);
      console.log(`    finer than the control spacing cannot be fitted to the noise`);
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

  // Halftone reads images too, and takes a whole sequence of them.
  if (cmd === 'halftone') {
    const images = (args._ as string[]).slice(1);
    const o = {
      across: num(args.across, 44),
      threshold: num(args.threshold, 0.15),
      stagger: !args.square,
      width: args.width ? num(args.width, 1000) : undefined,
    };
    const plates = images.map((f) => halftoneFile(f, o));
    const out = String(args.o ?? 'plates.ts');
    write(out, plateSource(plates, String(args.name ?? 'PLATES')));
    const counts = plates.map((p) => p.dots.length);
    console.log(`${out}  ${plates.length} plate(s), ${Math.min(...counts)}-${Math.max(...counts)} dots each`);
    console.log(`  lattice ${o.across} across, pitch ${plates[0].pitch.toFixed(1)}, ink above ${o.threshold}`);
    console.log(`  a halftone keeps the silhouette and throws the rest away - check it read back`);
    console.log(`  with heron sheet, and raise --across if the figure has gone to noise.`);
    return;
  }

  const mod = await loadScene(file);
  const ch = pick(mod, Character);
  if (!ch) throw new Error(`heron: ${file} does not export a Character`);

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
      const out = emit(renderStatic(ch, t, { width }), args, 'frame', width);
      console.log(`${out}  (${ch.name} at t=${t})`);
      break;
    }

    case 'shapes': {
      const shapes = listShapes(ch);
      const cols = num(args.cols, Math.min(5, Math.max(1, shapes.length)));
      const out = emit(renderShapeSheet(ch, { cols }), args, 'shapes', sheetWidth(cols));
      console.log(`${out}  ${shapes.length} shape(s), one per cell, the rest ghosted`);
      const owners = new Map<string, number>();
      for (const s of shapes) {
        const owner = s.path || '(root)';
        owners.set(owner, (owners.get(owner) ?? 0) + 1);
      }
      for (const [path, n] of owners) console.log(`  ${path}: ${n}`);
      if (owners.size === 1) {
        console.log(`  every shape sits in one part, so this is geometry with no anatomy yet -`);
        console.log(`  use the sheet to decide which run is which limb before grouping them.`);
      }
      break;
    }

    case 'sheet': {
      const cues = pick(mod, CueSheet);
      if (args.cues) {
        if (!cues) throw new Error(`heron: ${file} must export a CueSheet to use sheet --cues`);
        const names = typeof args.cues === 'string' ? args.cues.split(',') : undefined;
        const samples = Math.max(1, num(args.n, 3));
        const frames = cueFrames(cues, { samples, cues: names });
        const cols = num(args.cols, Math.min(4, frames.length));
        const out = emit(
          renderCueSheet(ch, cues, { cols, samples, cues: names }),
          args, 'cues', sheetWidth(cols),
        );
        console.log(`${out}  (${frames.length} cue frames across ${new Set(frames.map((f) => f.cue)).size} cues)`);
        break;
      }
      const n = Math.max(2, num(args.n, 8));
      const cols = num(args.cols, Math.min(4, n));
      const times = args.t ? String(args.t).split(',').map(Number) : sheetTimes(n);
      const onion = args.onion === true ? 3 : num(args.onion, 0);
      const out = emit(renderSheet(ch, times, { cols, onion }), args, 'sheet', sheetWidth(cols));
      console.log(`${out}  (${times.length} frames: ${times.map((t) => t.toFixed(2)).join(' ')})`);
      if (onion) console.log(`  each cell trails the ${onion} frames before it, so arcs and direction read`);
      break;
    }

    case 'studio': {
      const out = String(args.o ?? `${ch.name}.html`);
      // A scene that exports its score gets its beats drawn; one that does not
      // still gets every channel as a curve.
      const beats = pick(mod, Score);
      write(out, studio(ch, { width: num(args.w, 900), score: beats }));
      console.log(`${out}  scrubbable, with ${beats ? `${beats.beats.length} beats and ` : ''}every channel plotted`);
      console.log(`  the built animation itself, paused and driven by delay - not a replay of it`);
      break;
    }

    case 'video': {
      const out = String(args.o ?? `${ch.name}.mp4`);
      const report = await renderVideo(ch, out, {
        width: num(args.w, ch.viewBox[2]),
        fps: num(args.fps, 30),
        audio: args.audio ? String(args.audio) : undefined,
        codec: args.codec ? String(args.codec) as 'h264' | 'h265' | 'vp9' : undefined,
        crf: num(args.crf, 18),
        background: args.background ? String(args.background) : undefined,
      });
      console.log(`${report.file}  ${report.width}x${report.height}, ${report.frames} frames at ${report.fps}fps`);
      console.log(`  ${report.duration.toFixed(2)}s ${report.codec}${report.audio ? ', soundtrack muxed' : ''}`);
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
        const p = netPose(frame.pose.get(node.path));
        const bits: string[] = [];
        if (p.rotate) bits.push(`rot ${p.rotate.toFixed(1)}deg`);
        if (p.x || p.y) bits.push(`t (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
        if (p.scaleX !== 1 || p.scaleY !== 1) bits.push(`scale ${p.scaleX.toFixed(2)},${p.scaleY.toFixed(2)}`);
        if (p.opacity !== 1) bits.push(`opacity ${p.opacity.toFixed(2)}`);
        if (node.tracks.length > 1) bits.push(`${node.tracks.length} layers`);
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
        for (const p of baked) {
          const where = p.layer ? `${p.path} layer ${p.layer}` : p.path;
          console.log(`    ${where}: ${p.reason}, ${p.keyframes} keyframes`);
        }
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
