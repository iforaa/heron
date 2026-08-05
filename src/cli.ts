#!/usr/bin/env node
/**
 * The agent feedback loop.
 *
 * Writing animation blind is why this project exists, so these commands are the
 * point of the library rather than an accessory to it:
 *
 *   trace     a reference image turned into measured geometry
 *   import    existing SVG geometry preserved as a Heron scene
 *   rig       named traced runs related to candidate measured joints
 *   match     that geometry checked back against the reference
 *   snapshot  one pose, as an image the agent can actually look at
 *   shapes    every run picked out in turn, which is how anatomy is decided
 *   sheet     several poses tiled, which is how motion is judged
 *   frames    every playback frame, batched into readable review sheets
 *   studio    the built animation with a scrubber, which is how timing is judged
 *   inspect   the same pose as numbers, when geometry is the question
 *   curves    every channel's range and exact values at several instants
 *   motion    where one part went and how fast, which is how spacing is judged
 *   variants  the same scene under several parameters, so constants are chosen
 *   lint      defects that are invisible in a still frame
 *   check     typecheck, compile, lint and optionally match in one report
 *   build     the deliverable, plus a report of anything that was approximated
 *
 * `trace` and `match` come first for a reason. Drawing used to be the one step
 * with no instrument on it, and eyeballing coordinates off a PNG put a uniform
 * 17-20% stroke-width error through a whole scene without anyone noticing.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Character } from './scene.ts';
import {
  renderStatic, renderSheet, renderCueSheet, renderShapeSheet, renderMotionSheet,
  renderVariantSheet, renderOverlaySheet, listShapes,
  cueFrames, sheetTimes, sheetWidth, zoomBox, MOTION_CELL, SHEET_CELL,
  type VariantCell,
} from './render.ts';
import { diffTakes, divergentTimes } from './diff.ts';
import { boxOfCorners, localCorners } from './geometry.ts';
import { VariantSet } from './variants.ts';
import type { VariantMeta } from './variants.ts';
import {
  type TrackWindow, formatTrackReport, partLine, resolveWindow, trackParts, windowTimes,
} from './track.ts';
import { compile } from './compile.ts';
import { compileLottie } from './lottie.ts';
import { checkLottie } from './lottie-check.ts';
import { lint, formatFindings } from './lint.ts';
import { sampleCurves, studio } from './studio.ts';
import { CueSheet, Score } from './score.ts';
import { frameAt, nodePose } from './timeline.ts';
import { trace } from './trace.ts';
import { importSvgSource } from './import-svg.ts';
import { analyzeRig } from './rig.ts';
import type { MeasuredRun } from './runs.ts';
import type { Vec2 } from './scene.ts';
import { halftoneFile, plateSource } from './halftone.ts';
import { match, formatMatch } from './match.ts';
import { encodePng } from './raster.ts';
import { playbackTimes } from './delivery.ts';
import { renderVideo } from './video.ts';

interface Args {
  _: string[];
  [k: string]: string | boolean | string[];
}

/**
 * Flags that mean something repeated, and the only ones that accumulate.
 *
 * Repeatability is a property of the flag, not of the parser. Accumulating
 * everything was tried and was worse than the problem it fixed: `num()` returns
 * its default for an array and `String()` comma-joins one, so `-t 0.2 -t 0.6`
 * silently rendered t=0, `-o a.svg -o b.svg` wrote a file called `a.svg,b.svg`,
 * and a repeated `--cue` silently widened the window to the whole cycle. Every
 * other flag keeps last-wins, which is at least predictable.
 */
const REPEATABLE = new Set(['part', 'compare', 'motion', 'only']);

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  const isFlag = (value: string | undefined): boolean => Boolean(
    value && (value.startsWith('--') || /^-[A-Za-z]$/.test(value)),
  );
  const set = (k: string, v: string | boolean): void => {
    const prev = out[k];
    if (prev === undefined || !REPEATABLE.has(k)) out[k] = v;
    else out[k] = [...(Array.isArray(prev) ? prev : [String(prev)]), String(v)];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      // Split at the *first* `=` only: `--only neck=9` is a flag whose value
      // legitimately contains one, and `split('=')` threw the value away.
      const eq = a.indexOf('=');
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
      set(k, eq < 0
        ? (argv[i + 1] && !isFlag(argv[i + 1]) ? argv[++i] : true)
        : a.slice(eq + 1));
    } else if (a.startsWith('-') && a.length === 2) {
      set(a.slice(1), argv[i + 1] && !isFlag(argv[i + 1]) ? argv[++i] : true);
    } else {
      (out._ as string[]).push(a);
    }
  }
  return out;
}

async function loadScene(file: string): Promise<Record<string, unknown>> {
  try {
    return (await import(pathToFileURL(resolve(file)).href)) as Record<string, unknown>;
  } catch (error) {
    const caught = error as Error;
    const absolute = resolve(file);
    const location = caught.stack?.split('\n').find((line) => line.includes(absolute));
    throw new Error(
      `heron: could not load ${file}: ${caught.message}`
      + (location ? `\n  ${location.trim()}` : ''),
    );
  }
}

async function typecheckScene(file: string): Promise<string[]> {
  const { default: ts } = await import('typescript');
  const configFile = ts.findConfigFile(resolve(file), ts.sys.fileExists, 'tsconfig.json')
    ?? ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
  if (!configFile) return ['heron: no tsconfig.json found for scene typechecking'];
  const loaded = ts.readConfigFile(configFile, ts.sys.readFile);
  if (loaded.error) return [ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n')];
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configFile));
  const rootNames = [...new Set([...parsed.fileNames, resolve(file)])];
  const program = ts.createProgram({ rootNames, options: { ...parsed.options, noEmit: true } });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (!diagnostic.file || diagnostic.start === undefined) return message;
    const at = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${relative(process.cwd(), diagnostic.file.fileName)}:${at.line + 1}:${at.character + 1} ${message}`;
  });
}

/** The first export of a given kind, preferring `default`. */
function pick<T>(mod: Record<string, unknown>, kind: new (...a: never[]) => T): T | undefined {
  if (mod.default instanceof kind) return mod.default as T;
  return Object.values(mod).find((v) => v instanceof kind) as T | undefined;
}

/**
 * The one scene every other command works on.
 *
 * A variants module exports a factory rather than a finished Character, so
 * `pick(mod, Character)` finds nothing there and `sheet`, `build`, `lint`, `video`
 * and `motion` would all fail on it. The base combination — the first value of
 * every axis — is the canonical scene, so those commands keep working and mean
 * something definite while the grid is being explored.
 */
function resolveCharacter(mod: Record<string, unknown>, file: string): Character {
  const direct = pick(mod, Character);
  if (direct) return direct;
  const set = pick(mod, VariantSet);
  if (set) return set.build(set.base);
  throw new Error(`heron: ${file} does not export a Character or a variant grid`);
}

function write(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(resolve(file), data);
}

/** Source entry while developing, compiled entry when running the packaged CLI. */
function localLibraryEntry(): string {
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  return fileURLToPath(new URL(`./index.${extension}`, import.meta.url));
}

function generatedImport(out: string): string {
  if (existsSync(resolve('node_modules/@heron/core'))) return '@heron/core';
  const directory = dirname(resolve(out));
  mkdirSync(directory, { recursive: true });
  // `/tmp` is `/private/tmp` on macOS. A relative path computed across the
  // logical spelling imports `/private/Users/...` when Node canonicalizes the
  // generated module, so resolve both sides to physical paths first.
  const rel = relative(realpathSync(directory), realpathSync(localLibraryEntry()));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Rasterises out of process, because resvg can abort rather than throw.
 *
 * It is a Rust library reached through native bindings, and some geometry — a
 * stroked multi-subpath under heavy magnification is one case — makes it panic on
 * an empty bounds computation. A panic is not catchable from JavaScript: it takes
 * the whole process down, so an in-process call would let one awkward shape
 * destroy a command that had already done all of its real work. Isolating it
 * turns that into an error we can report and recover from.
 */
function toPng(svg: string, width: number): Buffer {
  const script = `
    const { readFileSync, writeFileSync } = require('node:fs');
    const { Resvg } = require('@resvg/resvg-js');
    const svg = readFileSync(process.argv[1], 'utf8');
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: Number(process.argv[3]) }, background: 'white',
    }).render().asPng();
    writeFileSync(process.argv[2], png);
  `;
  const dir = mkdtempSync(join(tmpdir(), 'heron-png-'));
  const svgFile = join(dir, 'in.svg');
  const pngFile = join(dir, 'out.png');
  try {
    writeFileSync(svgFile, svg);
    const run = spawnSync(process.execPath, ['-e', script, svgFile, pngFile, String(width)], {
      stdio: ['ignore', 'ignore', 'pipe'],
      maxBuffer: 1 << 24,
    });
    if (run.status !== 0 || !existsSync(pngFile)) {
      const why = String(run.stderr ?? '').trim().split('\n').slice(0, 2).join(' ');
      throw new Error(
        `heron: the rasteriser could not draw this image${why ? ` (${why})` : ''}.`
        + ' Pass --svg to write the vector instead, which is always exact.',
      );
    }
    return readFileSync(pngFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Rasterises a batch in one isolated Node process, paying startup only once. */
function writePngBatch(items: Array<{ svg: string; file: string; width: number }>): void {
  if (!items.length) return;
  const script = `
    const { readFileSync, writeFileSync } = require('node:fs');
    const { Resvg } = require('@resvg/resvg-js');
    const tasks = JSON.parse(readFileSync(process.argv[1], 'utf8'));
    for (const task of tasks) {
      const svg = readFileSync(task.svg, 'utf8');
      const png = new Resvg(svg, {
        fitTo: { mode: 'width', value: task.width }, background: 'white',
      }).render().asPng();
      writeFileSync(task.png, png);
    }
  `;
  const dir = mkdtempSync(join(tmpdir(), 'heron-png-batch-'));
  try {
    const tasks = items.map((item, index) => {
      const svg = join(dir, `${index}.svg`);
      const png = join(dir, `${index}.png`);
      writeFileSync(svg, item.svg);
      return { svg, png, width: item.width };
    });
    const manifest = join(dir, 'tasks.json');
    writeFileSync(manifest, JSON.stringify(tasks));
    const run = spawnSync(process.execPath, ['-e', script, manifest], {
      stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1 << 24,
    });
    if (run.status !== 0 || tasks.some((task) => !existsSync(task.png))) {
      const why = String(run.stderr ?? '').trim().split('\n').slice(0, 2).join(' ');
      throw new Error(
        `heron: the rasteriser could not draw this frame batch${why ? ` (${why})` : ''}.`
        + ' Pass --svg to keep the exact vector sheets.',
      );
    }
    items.forEach((item, index) => write(item.file, readFileSync(tasks[index].png)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

/**
 * A repeatable, comma-separated flag as a list.
 *
 * Comma separates entries, but `head@188,30` contains a comma of its own, so an
 * `@x,y` tail is matched as one token before any splitting happens.
 */
const TOKEN = /[^,\s]+@-?[\d.]+,-?[\d.]+|[^,\s]+/g;
function argList(v: unknown): string[] {
  return (Array.isArray(v) ? v : v === undefined || v === true ? [] : [String(v)])
    .flatMap((s) => String(s).match(TOKEN) ?? []);
}

/**
 * The slice of the animation a command was pointed at.
 *
 * `--cue landing` names a cue; `--range 1.2..2.4` is seconds; a bare `--range
 * landing` is still read as a cue, which is how `motion` shipped. Shared so the
 * two commands cannot come to disagree about what a range is.
 */
function windowArg(args: Args): TrackWindow | undefined {
  if (typeof args.cue === 'string') return { kind: 'cue', name: args.cue };
  if (typeof args.range !== 'string') return undefined;
  const span = args.range.split('..');
  return span.length === 2
    ? { kind: 'seconds', from: Number(span[0]), to: Number(span[1]) }
    : { kind: 'cue', name: args.range };
}

function num(v: unknown, d: number): number {
  if (v === undefined) return d;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`heron: expected a numeric flag value, got ${String(v)}`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`heron: expected a finite number, got "${v}"`);
  return n;
}

function fraction(v: unknown, d: number, label: string): number {
  const n = num(v, d);
  if (n < 0 || n > 1) throw new Error(`heron: ${label} must be from 0 to 1, got ${n}`);
  return n;
}

const FLAGS: Record<string, string[]> = {
  import: ['o', 'name'],
  rig: ['o', 'json'],
  trace: ['o', 'epsilon', 'threshold', 'minBranch', 'min-branch', 'name', 'fit', 'ribbons', 'refine'],
  halftone: ['o', 'across', 'threshold', 'width', 'square', 'name'],
  match: ['o', 't', 'threshold', 'json'],
  diff: ['fps', 'n', 'cols', 'o', 'svg', 'json'],
  snapshot: ['t', 'o', 'w', 'svg'],
  shapes: ['o', 'cols', 'svg'],
  sheet: ['n', 'o', 'cols', 'onion', 'cues', 'svg', 't'],
  frames: ['o', 'fps', 'per-sheet', 'cols', 'range', 'cue', 'cell', 'svg'],
  motion: ['part', 'compare', 'n', 'range', 'cue', 'cues', 'zoom', 'o', 'svg', 'no-json', 'cols'],
  variants: ['t', 'strip', 'cue', 'range', 'motion', 'compare', 'zoom', 'only', 'cols', 'o', 'svg', 'no-json', 'n'],
  inspect: ['t', 'json'],
  curves: ['t', 'n', 'json'],
  check: ['fps', 'reference', 't', 'threshold', 'json'],
  lint: ['fps', 'json'],
  studio: ['o', 'w'],
  lottie: ['o', 'fps', 'strict', 'check', 't', 'threshold', 'min-overlap', 'check-width', 'json'],
  build: ['o', 'w', 'fps', 'allow-errors'],
  video: ['o', 'w', 'fps', 'audio', 'codec', 'crf', 'background'],
};

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return row[b.length];
}

function validateFlags(cmd: string, args: Args): void {
  const known = FLAGS[cmd];
  if (!known) return;
  // JSON is the common agent protocol, not a command-specific capability.
  const allowed = new Set([...known, 'json', 'help', 'h']);
  for (const key of Object.keys(args)) {
    if (key === '_' || allowed.has(key)) continue;
    const nearest = known.reduce((best, candidate) =>
      editDistance(key, candidate) < editDistance(key, best) ? candidate : best, known[0] ?? 'help');
    throw new Error(`heron: unknown flag --${key}${editDistance(key, nearest) <= 3 ? `. Did you mean --${nearest}?` : ''}`);
  }
}

const USAGE = `heron - author character animation and compile it for SVG, Lottie or video

  heron trace    <image.png> [-o scene.ts] [--epsilon 1.2] [--threshold 0.22]
                 [--fit 1.5] [--ribbons all|taper|none] [--refine 12]
  heron import   <art.svg> [-o scene.ts] [--name logo]
  heron rig      <traced.ts> [-o rig.json] [--json]
  heron halftone <image.png...> [-o plates.ts] [--across 44] [--threshold 0.15]
                 [--width 1000] [--square] [--name PLATES]
  heron match    <scene.ts> <reference.png> [-o overlay.png] [-t 0]
  heron diff     <a.ts> <b.ts> [--fps 60] [-n 6] [--cols 3] [-o diff.png] [--svg] [--json]
  heron snapshot <scene.ts> [-t 0.4] [-o frame.png] [-w 520] [--svg]
  heron shapes   <scene.ts> [-o shapes.png] [--cols 5] [--svg]
  heron sheet    <scene.ts> [-n 8] [-o sheet.png] [--cols 4] [--onion 3] [--cues] [--svg]
  heron frames   <scene.ts> [-o frames] [--fps 30] [--per-sheet 12] [--cols 4]
                 [--range <cue>|<a..b>] [--cell 260] [--svg]
  heron motion   <scene.ts> --part <path[@x,y]> [--part ...] [--compare <path>] [-n 24]
                 [--range <cue>|<a..b>] [--cues] [--zoom] [-o motion.png] [--svg] [--no-json]
  heron variants <scene.ts> [-t 0.5] [--strip 3] [--cue <name>] [--range <a..b>]
                 [--motion <path>] [--compare <path>] [--zoom] [--only axis=value] [--cols 3]
                 [-o variants.png] [--svg] [--no-json]
  heron inspect  <scene.ts> [-t 0.4]
  heron curves   <scene.ts> [-t 0,0.25,0.5,0.75,1] [-n 240] [--json]
  heron check    <scene.ts> [--fps 60] [--reference artwork.png] [--json]
  heron lint     <scene.ts> [--fps 60]
  heron studio   <scene.ts> [-o scene.html] [-w 900]
  heron lottie   <scene.ts> [-o animation.json] [--fps 60] [--strict] [--check]
                 [-t 0,0.25,0.5,0.75,1] [--min-overlap 97] [--json]
  heron build    <scene.ts> [-o out.svg] [-w 360] [--fps 60] [--allow-errors]
  heron video    <scene.ts> [-o out.mp4] [-w 1280] [--fps 30] [--audio soundtrack.wav]

Times are fractions of one cycle, 0 to 1.`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, file] = args._ as string[];

  if (!cmd || args.help || args.h) {
    console.log(USAGE);
    return;
  }
  validateFlags(cmd, args);
  if (!file) throw new Error(`heron: ${cmd} needs a scene file`);

  if (cmd === 'import') {
    const out = String(args.o ?? `${basename(file).replace(/\.svg$/i, '')}.ts`);
    const result = importSvgSource(readFileSync(resolve(file), 'utf8'), {
      name: args.name ? String(args.name) : undefined,
      importFrom: generatedImport(out),
    });
    write(out, result.source);
    if (args.json) console.log(JSON.stringify({ ok: true, file: out, ...result, source: undefined }, null, 2));
    else {
      console.log(`${out}  viewBox=[${result.viewBox.join(' ')}], ${result.parts} parts, ${result.shapes} shapes`);
      console.log('  vector geometry preserved; inspect the named groups, then add pivots where they articulate');
    }
    return;
  }

  // `trace` reads an image rather than a scene, so it runs before the loader.
  if (cmd === 'trace') {
    const out = String(args.o ?? 'scene.ts');
    const res = trace(file, {
      epsilon: num(args.epsilon, 1.2),
      threshold: num(args.threshold, 0.22),
      minBranch: num(args['min-branch'] ?? args.minBranch, 6),
      name: args.name ? String(args.name) : undefined,
      fit: num(args.fit, 1.5),
      ribbons: args.ribbons ? (String(args.ribbons) as 'taper' | 'all' | 'none') : undefined,
      refine: num(args.refine, 12),
      out: basename(out),
      importFrom: generatedImport(out),
    });
    write(out, res.source);
    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        file: out,
        width: res.width,
        height: res.height,
        colour: res.colour,
        runs: res.strokes.map((stroke, index) => ({
          name: `s${index}`,
          points: stroke.points.length,
          width: stroke.width,
          widthVariation: stroke.widthVariation,
          length: stroke.length,
          closed: stroke.closed,
          cap: stroke.cap,
          corners: stroke.corners,
        })),
        varying: res.varying,
        joints: res.joints,
        outlined: res.outlined,
        fitted: res.fitted,
        profiled: res.profiled,
        tuned: res.tuned,
      }, null, 2));
      return;
    }
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
    if (args.json) console.log(JSON.stringify({
      ok: true, file: out, images, plates: plates.length, dotCounts: counts,
      pitch: plates[0]?.pitch, options: o,
    }, null, 2));
    else {
      console.log(`${out}  ${plates.length} plate(s), ${Math.min(...counts)}-${Math.max(...counts)} dots each`);
      console.log(`  lattice ${o.across} across, pitch ${plates[0].pitch.toFixed(1)}, ink above ${o.threshold}`);
      console.log(`  a halftone keeps the silhouette and throws the rest away - check it read back`);
      console.log(`  with heron sheet, and raise --across if the figure has gone to noise.`);
    }
    return;
  }

  if (cmd === 'check') {
    const diagnostics = await typecheckScene(file);
    if (diagnostics.length) {
      if (args.json) console.log(JSON.stringify({ ok: false, typecheck: diagnostics }, null, 2));
      else {
        console.error(`typecheck: ${diagnostics.length} error(s)`);
        for (const diagnostic of diagnostics) console.error(`  ${diagnostic}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  const mod = await loadScene(file);

  if (cmd === 'rig') {
    const runs = mod.RUNS as Record<string, MeasuredRun> | undefined;
    const joints = mod.JOINTS as Vec2[] | undefined;
    if (!runs || typeof runs !== 'object') {
      throw new Error(`heron: ${file} does not export named RUNS; regenerate it with heron trace`);
    }
    const report = analyzeRig(runs, joints ?? []);
    const out = String(args.o ?? `${basename(file).replace(/\.tsx?$/i, '')}.rig.json`);
    write(out, JSON.stringify(report, null, 2) + '\n');
    if (args.json) console.log(JSON.stringify({ file: out, ...report }, null, 2));
    else {
      console.log(`${out}  ${report.runs.length} named runs, ${report.joints.length} candidate joints`);
      for (const run of report.runs) {
        console.log(`  ${run.name}  ${run.points} points, ${run.length.toFixed(1)} units, width ${run.width.min.toFixed(1)}..${run.width.max.toFixed(1)}`);
        for (const cut of run.cuts) console.log(`    candidate joint #${cut.joint}: cutRun(RUNS.${run.name}, ${cut.at.toFixed(4)})`);
      }
    }
    return;
  }

  const ch = resolveCharacter(mod, file);

  if (cmd === 'match') {
    const reference = (args._ as string[])[2];
    if (!reference) throw new Error('heron: match needs a scene file and a reference image');
    const report = match(ch, reference, { t: fraction(args.t, 0, '-t'), threshold: args.threshold ? num(args.threshold, 0.22) : undefined });
    const out = String(args.o ?? 'match.png');
    write(out, encodePng(report.overlay, report.width, report.height));
    if (args.json) {
      const { overlay: _overlay, ...serializable } = report;
      console.log(JSON.stringify({ scene: ch.name, reference, overlay: out, ...serializable }, null, 2));
    } else {
      console.log(formatMatch(report, `${ch.name} vs ${basename(reference)}`));
      console.log(`  ${out}  grey both, red reference only, blue scene only`);
    }
    return;
  }

  if (cmd === 'diff') {
    const otherFile = (args._ as string[])[2];
    if (!otherFile) throw new Error('heron: diff needs two scene files - the old take, then the new');
    const other = resolveCharacter(await loadScene(otherFile), otherFile);
    const fps = args.fps ? Math.trunc(num(args.fps, 60)) : 60;
    const report = diffTakes(ch, other, { fps, series: Boolean(args.json) });
    const count = args.n ? Math.trunc(num(args.n, 6)) : 6;
    const instants = divergentTimes(report, Math.min(count, report.frameCount));
    const cols = args.cols ? Math.trunc(num(args.cols, 3)) : Math.min(3, instants.length);
    const sheet = renderOverlaySheet(ch, other, instants, { cols });
    const out = String(args.o ?? (args.svg ? 'diff.svg' : 'diff.png'));
    if (args.svg) write(out, sheet);
    else write(out, toPng(sheet, sheetWidth(cols)));

    if (args.json) {
      console.log(JSON.stringify({ a: file, b: otherFile, sheet: out, ...report }, null, 2));
      return;
    }
    const unit = (channel: string) => (channel === 'rotate' || channel.startsWith('skew') ? '°' : '');
    console.log(`${ch.name} vs ${other.name}  ${report.frameCount} frames at ${report.fps}fps${report.durationMismatch ? '  (durations differ)' : ''}`);
    for (const p of report.parts) {
      const bits = p.deltas.map((d) => `${d.channel} Δ${d.peak.toFixed(1)}${unit(d.channel)} at t=${d.at.toFixed(2)}`);
      if (p.geometryChanged) bits.push('geometry changed');
      console.log(`  ${p.path}  ${bits.join('  ')}`);
    }
    if (report.unchanged.length) console.log(`  (${report.unchanged.length} part(s) unchanged)`);
    if (report.added.length) console.log(`  + added: ${report.added.join(', ')}`);
    if (report.removed.length) console.log(`  - removed: ${report.removed.join(', ')}`);
    console.log(`  ${out}  ${instants.length} most-diverged instant(s), old grey under new colour`);
    return;
  }

  switch (cmd) {
    case 'check': {
      const fps = num(args.fps, 60);
      const compiled = compile(ch);
      const findings = lint(ch, { fps });
      const reference = args.reference ? String(args.reference) : undefined;
      const comparison = reference
        ? match(ch, reference, {
            t: fraction(args.t, 0, '-t'),
            threshold: args.threshold ? num(args.threshold, 0.22) : undefined,
          })
        : undefined;
      const result = {
        ok: !findings.some((finding) => finding.severity === 'error'),
        typecheck: [],
        compile: {
          bytes: Buffer.byteLength(compiled.svg),
          groups: compiled.report.parts.length + compiled.report.morphs.length,
          keyframes: compiled.report.parts.reduce((n, part) => n + part.keyframes, 0)
            + compiled.report.morphs.reduce((n, morph) => n + morph.keyframes, 0),
          exactGroups: compiled.report.parts.filter((part) => part.mode === 'exact').length,
          bakedGroups: compiled.report.parts.filter((part) => part.mode === 'baked').length,
          baked: compiled.report.parts.filter((part) => part.mode === 'baked'),
          morphs: compiled.report.morphs,
          warnings: compiled.report.warnings,
          certification: compiled.report.certification,
        },
        lint: findings,
        ...(comparison ? { match: (({ overlay: _overlay, ...report }) => report)(comparison) } : {}),
      };
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`typecheck  clean`);
        console.log(`compile    ${result.compile.bytes} bytes, ${result.compile.groups} animated groups, ${result.compile.keyframes} keyframes`);
        console.log(`lint       ${formatFindings(findings)}`);
        if (comparison) console.log(formatMatch(comparison, `${ch.name} vs ${basename(reference!)}`));
      }
      if (!result.ok) process.exitCode = 1;
      break;
    }

    case 'snapshot': {
      const t = fraction(args.t, 0, '-t');
      const width = num(args.w, 520);
      const out = emit(renderStatic(ch, t, { width }), args, 'frame', width);
      console.log(args.json
        ? JSON.stringify({ ok: true, file: out, scene: ch.name, t, seconds: t * ch.duration, width }, null, 2)
        : `${out}  (${ch.name} at t=${t})`);
      break;
    }

    case 'shapes': {
      const shapes = listShapes(ch);
      const cols = num(args.cols, Math.min(5, Math.max(1, shapes.length)));
      const out = emit(renderShapeSheet(ch, { cols }), args, 'shapes', sheetWidth(cols));
      const owners = new Map<string, number>();
      for (const s of shapes) {
        const owner = s.path || '(root)';
        owners.set(owner, (owners.get(owner) ?? 0) + 1);
      }
      if (args.json) console.log(JSON.stringify({
        ok: true, file: out, scene: ch.name, shapes: shapes.length, columns: cols,
        owners: Object.fromEntries(owners),
      }, null, 2));
      else {
        console.log(`${out}  ${shapes.length} shape(s), one per cell, the rest ghosted`);
        for (const [path, n] of owners) console.log(`  ${path}: ${n}`);
        if (owners.size === 1) {
          console.log(`  every shape sits in one part, so this is geometry with no anatomy yet -`);
          console.log(`  use the sheet to decide which run is which limb before grouping them.`);
        }
      }
      break;
    }

    case 'sheet': {
      const timeline = pick(mod, CueSheet) ?? pick(mod, Score);
      if (args.cues) {
        if (!timeline) {
          throw new Error(`heron: ${file} must export a Score or CueSheet to use sheet --cues`);
        }
        const names = typeof args.cues === 'string' ? args.cues.split(',') : undefined;
        const samples = Math.max(1, num(args.n, 3));
        const frames = cueFrames(timeline, { samples, cues: names });
        const cols = num(args.cols, Math.min(4, frames.length));
        const out = emit(
          renderCueSheet(ch, timeline, { cols, samples, cues: names }),
          args, 'cues', sheetWidth(cols),
        );
        console.log(args.json ? JSON.stringify({
          ok: true, file: out, scene: ch.name, frames, columns: cols,
        }, null, 2) : `${out}  (${frames.length} cue frames across ${new Set(frames.map((f) => f.cue)).size} cues)`);
        break;
      }
      const n = Math.max(2, num(args.n, 8));
      const cols = num(args.cols, Math.min(4, n));
      const times = args.t
        ? String(args.t).split(',').map((value) => fraction(value, 0, 'sheet -t'))
        : sheetTimes(n);
      const onion = args.onion === true ? 3 : num(args.onion, 0);
      const out = emit(renderSheet(ch, times, { cols, onion }), args, 'sheet', sheetWidth(cols));
      if (args.json) console.log(JSON.stringify({
        ok: true, file: out, scene: ch.name, times,
        seconds: times.map((t) => t * ch.duration), columns: cols, onion,
      }, null, 2));
      else {
        console.log(`${out}  (${times.length} frames: ${times.map((t) => t.toFixed(2)).join(' ')})`);
        if (onion) console.log(`  each cell trails the ${onion} frames before it, so arcs and direction read`);
      }
      break;
    }

    case 'frames': {
      const fps = num(args.fps, 30);
      const perSheet = num(args['per-sheet'], 12);
      const cellWidth = num(args.cell, SHEET_CELL);
      if (!Number.isInteger(perSheet) || perSheet < 1 || perSheet > 120) {
        throw new Error('heron: frames --per-sheet must be an integer from 1 to 120');
      }
      if (!Number.isInteger(cellWidth) || cellWidth < 80 || cellWidth > 2000) {
        throw new Error('heron: frames --cell must be an integer from 80 to 2000');
      }
      const timeline = pick(mod, CueSheet) ?? pick(mod, Score);
      const window = windowArg(args) ?? { kind: 'cycle' as const };
      const span = resolveWindow(ch, window, timeline);
      const times = playbackTimes(ch.duration, fps, span.from, span.to);
      if (!times.length) {
        throw new Error(
          `heron: the selected window contains no playback frames at ${fps}fps; raise --fps or widen it`,
        );
      }
      const cols = num(args.cols, Math.min(4, perSheet));
      if (!Number.isInteger(cols) || cols < 1 || cols > perSheet) {
        throw new Error(`heron: frames --cols must be an integer from 1 to --per-sheet (${perSheet})`);
      }

      const directory = resolve(String(args.o ?? 'frames'));
      mkdirSync(directory, { recursive: true });
      const batches = Math.ceil(times.length / perSheet);
      const digits = Math.max(3, String(batches).length);
      const frameDigits = Math.max(4, String(times.length - 1).length);
      const extension = args.svg ? 'svg' : 'png';
      const sheets: Array<Record<string, unknown>> = [];
      const rasterBatch: Array<{ svg: string; file: string; width: number }> = [];

      for (let batch = 0; batch < batches; batch++) {
        const first = batch * perSheet;
        const chunk = times.slice(first, first + perSheet);
        const labels = chunk.map((t, i) =>
          `#${String(first + i).padStart(frameDigits, '0')} · ${(t * ch.duration).toFixed(3)}s`);
        const svg = renderSheet(ch, chunk, { cols, cellWidth, labels });
        const name = `frames-${String(batch + 1).padStart(digits, '0')}.${extension}`;
        const destination = join(directory, name);
        if (args.svg) write(destination, svg);
        else rasterBatch.push({ svg, file: destination, width: sheetWidth(cols, cellWidth) });
        sheets.push({
          file: name,
          firstFrame: first,
          lastFrame: first + chunk.length - 1,
          frames: chunk.map((t, i) => ({
            index: first + i,
            cell: i,
            row: Math.floor(i / cols),
            column: i % cols,
            seconds: t * ch.duration,
            time: t,
          })),
        });
      }
      writePngBatch(rasterBatch);

      const manifest = {
        scene: ch.name,
        fps,
        duration: ch.duration,
        window: {
          kind: window.kind,
          name: span.name,
          from: span.from,
          to: span.to,
          fromSeconds: span.from * ch.duration,
          toSeconds: span.to * ch.duration,
        },
        frameCount: times.length,
        perSheet,
        columns: cols,
        sheets,
      };
      write(join(directory, 'frames.json'), JSON.stringify(manifest, null, 2) + '\n');
      if (args.json) console.log(JSON.stringify({ ok: true, directory, manifest: join(directory, 'frames.json'), ...manifest }, null, 2));
      else {
        console.log(
          `${directory}  ${times.length} frame(s) at ${fps}fps in ${batches} sheet(s)`
          + ` of at most ${perSheet}`,
        );
        console.log(`  ${span.from * ch.duration}s..${span.to * ch.duration}s, end-exclusive like video`);
        console.log(`  frames.json maps every frame to its sheet, cell and exact time`);
      }
      break;
    }

    case 'motion': {
      const parts = argList(args.part);
      if (!parts.length) throw new Error('heron: motion needs at least one --part <path[@x,y]>');
      const timeline = pick(mod, CueSheet) ?? pick(mod, Score);
      const window = windowArg(args);

      const report = trackParts(ch, {
        parts,
        compare: argList(args.compare),
        samples: Math.max(2, num(args.n, 24)),
        window,
        timeline,
        perCue: Boolean(args.cues),
      });

      // One crop shared by every cell: per-cell crops would draw the same
      // trajectory at different scales and destroy the side-by-side reading.
      const viewBox = args.zoom ? zoomBox(ch, [report]) : undefined;

      const cols = num(args.cols, Math.min(3, args.cues ? (timeline?.windows.length ?? 1) : 1));
      const svg = renderMotionSheet(ch, report, {
        cols, viewBox, perCue: Boolean(args.cues),
      });
      const out = emit(svg, args, 'motion', sheetWidth(cols, MOTION_CELL));
      let json = '';
      if (!args['no-json']) {
        json = out.replace(/\.(png|svg)$/, '') + '.json';
        write(json, JSON.stringify(report, null, 2));
      }
      if (args.json) console.log(JSON.stringify({ ok: true, file: out, sidecar: json || undefined, report }, null, 2));
      else {
        console.log(`${out}${json ? `  ${json}` : ''}  ${report.parts.length} part(s), ${report.samples} samples`);
        console.log(formatTrackReport(report));
      }
      break;
    }

    case 'variants': {
      const set = pick(mod, VariantSet);
      if (!set) {
        throw new Error(
          `heron: ${file} does not declare a variant grid. Bind the scene factory to`
          + ' the numbers it varies:\n'
          + "  export const takes = grid((p) => build(p), { ride: [8, 14, 20] });",
        );
      }

      const combos = set.plan(argList(args.only)) as Array<VariantMeta & Record<string, unknown>>;
      const buildVariant = set.build as unknown as (
        params: VariantMeta & Record<string, unknown>
      ) => Character;

      // A fresh Character per cell. Re-animating one would stack layers, because
      // `PartHandle.animate` pushes a new layer on every call. The base is the
      // exception: `resolveCharacter` already built it above, so building it a
      // second time is a whole rig and gait solved for nothing.
      const builds = combos.map((params) => ({
        params, ch: params.index === 0 ? ch : buildVariant(params),
      }));
      const base = builds[0].ch;
      const odd = builds.filter((b) => String(b.ch.viewBox) !== String(base.viewBox));
      if (odd.length && !args.json) {
        // Reported, never rescaled: a cell drawn to a different scale is a lie
        // about amplitude, which is usually the thing being compared.
        console.log(
          `  ${odd.length} build(s) declare a different viewBox and are drawn in the first`
          + ` build's box [${base.viewBox.join(' ')}] — ${odd[0].params.label} is [${odd[0].ch.viewBox.join(' ')}]`,
        );
      }

      const timeline = pick(mod, CueSheet) ?? pick(mod, Score);
      const window = windowArg(args);
      const span = resolveWindow(base, window ?? { kind: 'cycle' }, timeline);
      const strip = Math.max(1, num(args.strip, 1));
      // A strip borrows the sampler's endpoint rule rather than re-deriving it,
      // so a looping cycle does not put the same pose in the first and last
      // frame. A single cell is `-t`: progress *through the window*, so it keeps
      // meaning the midpoint of whatever was selected rather than an absolute
      // cycle time that could fall outside a chosen cue.
      const times = strip > 1
        ? windowTimes(base, window ?? { kind: 'cycle' }, strip, timeline).times
        : [span.from + (span.to - span.from) * fraction(args.t, 0.5, 'variants -t')];

      const tracked = argList(args.motion);
      const tracks = tracked.length
        ? builds.map((b) => trackParts(b.ch, {
            parts: tracked,
            compare: argList(args.compare),
            samples: Math.max(2, num(args.n, 24)),
            window,
            timeline,
          }))
        : undefined;

      // Labelled by position in the whole grid, not in the filtered subset, so a
      // `--only` sheet and its sidecar name the same cell the same way.
      const cells: VariantCell[] = builds.map((b, i) => ({
        label: `#${b.params.index}  ${b.params.label}`,
        ch: b.ch,
        times,
        track: tracks?.[i],
      }));
      const cols = num(args.cols, Math.max(1, Math.min(set.columns, cells.length)));
      const cellWidth = (tracks ? MOTION_CELL : SHEET_CELL) * strip;
      // One crop over every build, so the widest build's motion is not pushed off
      // the edge of its own cell by a box fitted to the first one.
      const viewBox = args.zoom && tracks ? zoomBox(base, tracks) : undefined;
      const svg = renderVariantSheet(cells, { cols, cellWidth, viewBox });
      const out = emit(svg, args, 'variants', sheetWidth(cols, cellWidth));

      const sidecarData = {
        scene: base.name,
        axes: set.axes,
        window: span,
        times,
        viewBoxMismatch: odd.length ? {
          count: odd.length, canonical: base.viewBox,
          first: { label: odd[0].params.label, viewBox: odd[0].ch.viewBox },
        } : undefined,
        cells: builds.map((b, i) => {
          const { index, label, seed, ...values } = b.params;
          return {
            index,
            label,
            seed,
            values,
            // Stats without the sample grid. Every cell carrying its own samples
            // would make the sidecar unreadable at the size that matters, and
            // the per-sample detail is what `heron motion` is for.
            track: tracks?.[i]?.parts.map(({ samples, ...rest }) => rest),
          };
        }),
      };
      let json = '';
      if (!args['no-json']) {
        json = out.replace(/\.(png|svg)$/, '') + '.json';
        write(json, JSON.stringify(sidecarData, null, 2));
      }

      // One lookup per build, read by both the table and the extremes below.
      const lead = tracks?.map((r) => r.parts.find((p) => p.role === 'tracked'));
      if (args.json) console.log(JSON.stringify({
        ok: true, file: out, sidecar: json || undefined, ...sidecarData,
      }, null, 2));
      else {
        console.log(
          `${out}${json ? `  ${json}` : ''}  ${builds.length} build(s), ${set.describe()}`
          + (strip > 1 ? `, ${strip} frames each` : ''),
        );
        for (const [i, b] of builds.entries()) {
          const stats = lead?.[i] ? `  ${partLine(lead[i]!)}` : '';
          console.log(`  #${b.params.index}  ${b.params.label}${stats}`);
        }
        if (lead) {
          const paths = lead.map((p) => p?.pathLength ?? 0);
          const most = paths.indexOf(Math.max(...paths));
          const least = paths.indexOf(Math.min(...paths));
          console.log(
            `  widest travel #${builds[most].params.index} (${paths[most]}),`
            + ` tightest #${builds[least].params.index} (${paths[least]})`,
          );
        }
        console.log('  pick the cell that reads best; the sidecar has the numbers behind it');
      }
      break;
    }

    case 'studio': {
      const out = String(args.o ?? `${ch.name}.html`);
      // A scene that exports its score gets its beats drawn; one that does not
      // still gets every channel as a curve.
      const beats = pick(mod, Score);
      write(out, studio(ch, { width: num(args.w, 900), score: beats }));
      if (args.json) console.log(JSON.stringify({
        ok: true, file: out, scene: ch.name, width: num(args.w, 900), beats: beats?.beats.length ?? 0,
      }, null, 2));
      else {
        console.log(`${out}  scrubbable, with ${beats ? `${beats.beats.length} beats and ` : ''}every channel plotted`);
        console.log(`  the built animation itself, paused and driven by delay - not a replay of it`);
      }
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
      if (args.json) console.log(JSON.stringify({ ok: true, ...report }, null, 2));
      else {
        console.log(`${report.file}  ${report.width}x${report.height}, ${report.frames} frames at ${report.fps}fps`);
        console.log(`  ${report.duration.toFixed(2)}s ${report.codec}${report.audio ? ', soundtrack muxed' : ''}`);
      }
      break;
    }

    case 'inspect': {
      const t = fraction(args.t, 0, '-t');
      const frame = frameAt(ch, t);
      const corners = localCorners(ch);
      const inspected: Array<Record<string, unknown>> = [];
      const humanLines: string[] = [];
      for (const node of ch.nodes()) {
        if (!node.path) continue;
        const depth = node.path.split('.').length - 1;
        const p = nodePose(node, frame.pose.get(node.path));
        const bits: string[] = [];
        if (p.rotate) bits.push(`rot ${p.rotate.toFixed(1)}deg`);
        if (p.x || p.y) bits.push(`t (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
        if (p.skewX || p.skewY) bits.push(`skew ${p.skewX.toFixed(1)},${p.skewY.toFixed(1)}deg`);
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
        inspected.push({ path: node.path, name: node.name, depth, pose: p, pivot: node.pivot, contact: node.contact, box: b });
        humanLines.push(`${'  '.repeat(depth + 1)}${node.name}${bits.length ? '  ' + bits.join('  ') : ''}`);
      }
      if (args.json) {
        console.log(JSON.stringify({ scene: ch.name, t, seconds: t * ch.duration, viewBox: ch.viewBox, duration: ch.duration, ground: ch.ground, parts: inspected }, null, 2));
      } else {
        console.log(`${ch.name} at t=${t}  viewBox=[${ch.viewBox.join(' ')}]  duration=${ch.duration}s${ch.ground !== undefined ? `  ground=${ch.ground}` : ''}`);
        for (const line of humanLines) console.log(line);
      }
      break;
    }

    case 'curves': {
      const times = String(args.t ?? '0,0.25,0.5,0.75,1')
        .split(',').map((value) => fraction(value, 0, 'curves -t'));
      const report = sampleCurves(ch, times, num(args.n, 240));
      if (args.json) {
        console.log(JSON.stringify({ scene: ch.name, duration: ch.duration, times, curves: report }, null, 2));
      } else {
        console.log(`${ch.name}  ${report.length} animated channels  t=[${times.join(', ')}]`);
        for (const curve of report) {
          console.log(
            `  ${curve.label.padEnd(36)} ${curve.lo.toFixed(3)}..${curve.hi.toFixed(3)}`
            + `  ${curve.values.map((value) => value.toFixed(3)).join('  ')}`,
          );
        }
      }
      break;
    }

    case 'lint': {
      const findings = lint(ch, { fps: num(args.fps, 60) });
      console.log(args.json
        ? JSON.stringify({ scene: ch.name, ok: !findings.some((f) => f.severity === 'error'), findings }, null, 2)
        : formatFindings(findings));
      if (findings.some((f) => f.severity === 'error')) process.exitCode = 1;
      break;
    }

    case 'build': {
      const width = num(args.w, ch.viewBox[2] * 2);
      const { svg, report } = compile(ch, { width });
      const out = String(args.o ?? `${ch.name}.svg`);
      const findings = lint(ch, { fps: num(args.fps, 60) });
      const blocked = !args['allow-errors'] && findings.some((f) => f.severity === 'error');

      const baked = report.parts.filter((p) => p.mode === 'baked');
      const frames = report.parts.reduce((n, p) => n + p.keyframes, 0)
        + report.morphs.reduce((n, morph) => n + morph.keyframes, 0);
      const groups = report.parts.length + report.morphs.length;
      if (args.json) console.log(JSON.stringify({
        ok: !blocked, file: blocked ? undefined : out, bytes: Buffer.byteLength(svg),
        groups, keyframes: frames, baked, warnings: report.warnings,
        certification: report.certification, lint: findings,
      }, null, 2));
      else {
        console.log(`${blocked ? 'not written: ' : ''}${out}  ${(Buffer.byteLength(svg) / 1024).toFixed(1)} kB  ${groups} animated groups, ${frames} keyframes`);
        if (baked.length) {
          console.log(`  baked and serialization-checked against EPSILON on the compiler grid:`);
          for (const p of baked) {
            const where = p.layer ? `${p.path} layer ${p.layer}` : p.path;
            console.log(`    ${where}: ${p.reason}, ${p.keyframes} keyframes`);
          }
        }
        for (const warning of report.warnings) console.log(`  warning: ${warning}`);
        if (findings.length) console.log(formatFindings(findings));
      }
      if (blocked) process.exitCode = 1;
      else write(out, svg);
      break;
    }

    case 'lottie': {
      const fps = num(args.fps, 60);
      const timeline = pick(mod, CueSheet) ?? pick(mod, Score);
      const result = compileLottie(ch, { fps, timeline });
      const out = String(args.o ?? `${ch.name}.json`);
      const verification = args.check
        ? await checkLottie(ch, result.json, {
            times: args.t
              ? String(args.t).split(',').map((value) => fraction(value, 0, 'lottie -t'))
              : undefined,
            threshold: args.threshold ? num(args.threshold, 0.22) : undefined,
            minOverlap: num(args['min-overlap'], 97),
            width: num(args['check-width'], 1000),
          })
        : undefined;
      const blocked = Boolean(
        (args.strict && result.report.warnings.length)
        || (verification && !verification.ok),
      );
      if (!blocked) write(out, result.json + '\n');
      if (args.json) {
        console.log(JSON.stringify({
          ok: !blocked, file: blocked ? undefined : out,
          bytes: Buffer.byteLength(result.json), report: result.report,
          ...(verification ? { verification } : {}),
        }, null, 2));
      } else {
        console.log(
          `${blocked ? 'not written: ' : ''}${out}  ${(Buffer.byteLength(result.json) / 1024).toFixed(1)} kB`
          + `  ${result.report.shapes} shapes, ${result.report.layers} layers`
          + `  ${result.report.animatedProperties} animated properties`
          + (result.report.sampledProperties
            ? ` (${result.report.sampledProperties} sampled at ${fps}fps)`
            : ''),
        );
        for (const warning of result.report.warnings) console.log(`  warning: ${warning}`);
        if (verification) {
          console.log(
            `  ${verification.renderer} ${verification.rendererVersion}: worst overlap`
            + ` ${verification.worstOverlap}% across ${verification.samples.length} frame(s)`
            + ` (required ${verification.minOverlap}%)`,
          );
        }
      }
      if (blocked) process.exitCode = 1;
      break;
    }

    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((err: Error) => {
  const message = process.env.HERON_TRACE ? err.stack : err.message;
  console.error(process.argv.includes('--json')
    ? JSON.stringify({ ok: false, error: message }, null, 2)
    : message);
  process.exitCode = 1;
});
