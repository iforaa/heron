/**
 * The compiled animation, with a hand on it.
 *
 * Every instrument in this project so far answers a question about one instant.
 * That is the right shape for geometry and the wrong shape for timing, and the
 * defects that survive to the end are always timing ones: a beat that lands too
 * early, a settle that rings a fraction too long, a pose that is correct and
 * arrives at the wrong moment. Judging those from stills means simulating
 * playback in your head, which is exactly the thing neither an agent nor a
 * person does reliably.
 *
 * So this is the built file, unmodified, with three things beside it: a scrubber
 * that drives it, the score drawn as bars, and every animated channel drawn as a
 * curve. The scrubbing is not a re-implementation of playback — it pauses the
 * real CSS animations and drives them with a negative `animation-delay`, so what
 * is on screen at 0.62 is precisely what the browser plays at 0.62. An
 * instrument that ran its own approximation of the timeline would be the one
 * thing worse than no instrument at all.
 *
 * One self-contained HTML file, no server and no network, for the same reason
 * the deliverable is one SVG.
 */

import { type Character, type ChannelName, activeChannels } from './scene.ts';
import { channelAt } from './timeline.ts';
import { compile } from './compile.ts';
import { round } from './render.ts';
import type { Score } from './score.ts';

export interface Curve {
  label: string;
  path: string;
  layer: number;
  channel: ChannelName;
  points: string;
  values: number[];
  lo: number;
  hi: number;
}

/** Every animated channel, sampled and drawn as a polyline in its own box. */
export function curves(ch: Character, n = 240): Curve[] {
  if (!Number.isInteger(n) || n < 2 || n > 100_000) {
    throw new Error(`heron: curves() sample count must be an integer from 2 to 100000, got ${n}`);
  }
  const out: Curve[] = [];
  for (const node of ch.nodes()) {
    node.tracks.forEach((track, layer) => {
      for (const name of activeChannels(track)) {
        const vals = Array.from({ length: n + 1 }, (_, i) => channelAt(track[name]!, i / n));
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        const span = hi - lo || 1;
        // Plotted in a unit box; the <svg> that holds it does not preserve the
        // aspect ratio, so the coordinate space is arbitrary.
        const points = vals
          .map((v, i) => `${round(i / n, 4)},${round(1 - (v - lo) / span, 4)}`)
          .join(' ');
        out.push({
          label: `${node.path || '(root)'}${node.tracks.length > 1 ? ` #${layer}` : ''} · ${name}`,
          path: node.path,
          layer,
          channel: name,
          points,
          values: vals,
          lo,
          hi,
        });
      }
    });
  }
  return out;
}

export interface CurveSample extends Omit<Curve, 'points' | 'values'> {
  values: number[];
}

/** Exact values at several instants, plus the full-cycle range for context. */
export function sampleCurves(ch: Character, times: number[], n = 240): CurveSample[] {
  if (!times.length || times.some((time) => !Number.isFinite(time) || time < 0 || time > 1)) {
    throw new Error('heron: curve sample times must be finite values inside 0..1');
  }
  const ranges = curves(ch, n);
  return ranges.map(({ points: _points, values: _values, ...curve }) => {
    const track = ch.find(curve.path)?.tracks[curve.layer];
    const channel = track?.[curve.channel];
    if (!channel) throw new Error(`heron: curve source disappeared for ${curve.label}`);
    return { ...curve, values: times.map((time) => channelAt(channel, time)) };
  });
}

const TINT: Record<ChannelName, string> = {
  rotate: '#3ba064',
  x: '#2f7fd0',
  y: '#c2571f',
  skewX: '#d1498b',
  skewY: '#d1498b',
  scaleX: '#8a52c4',
  scaleY: '#8a52c4',
  opacity: '#5a6b74',
  draw: '#b8a02a',
};

export interface StudioOptions {
  width?: number;
  /** Drawn as labelled bars above the scrubber, if the scene has one. */
  score?: Score;
}

export function studio(ch: Character, o: StudioOptions = {}): string {
  // Everything the stylesheet animates, taken from the compiler rather than
  // re-derived. Two copies of "which elements are animated" agreeing today is
  // not the same as agreeing tomorrow, and a scrubber that pauses a different
  // set than the browser animates is an instrument that lies.
  const { svg, animated } = compile(ch, { width: o.width ?? 900, reducedMotion: false });

  const W = 760;
  const H = 34;
  const plots = curves(ch);
  const bars = (o.score?.beats ?? []).map((b, i) => {
    const x = round(b.from * W, 2);
    const w = round((b.to - b.from) * W, 2);
    return `<div class="beat" style="left:${x}px;width:${w}px;background:${i % 2 ? '#e4eeea' : '#d5e7de'}">`
      + `<span>${b.name}</span></div>`;
  }).join('\n      ');

  const rows = plots.map((c) => `
      <div class="row">
        <div class="lab">${c.label}</div>
        <svg class="plot" viewBox="0 0 1 1" preserveAspectRatio="none">
          <polyline points="${c.points}" fill="none" stroke="${TINT[c.channel]}" stroke-width="1.5"
            vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="range">${round(c.lo, 2)} … ${round(c.hi, 2)}</div>
      </div>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${ch.name} — heron studio</title>
<style>
  :root { color-scheme: light dark; --ink: #1d2b24; --dim: #68757f; --line: #d3ddd7; --bg: #f6f9f7; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e6efe9; --dim: #91a099; --line: #2f3a34; --bg: #141917; }
  }
  body { margin: 0; padding: 24px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
         background: var(--bg); color: var(--ink); }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 16px; }
  h1 small { color: var(--dim); font-weight: 400; }
  .stage { display: inline-block; border: 1px solid var(--line); background: #fff; border-radius: 6px; }
  .stage svg { display: block; max-width: 100%; height: auto; }
  ${animated.join(', ')} { animation-play-state: paused !important; }
  .controls { margin: 16px 0 8px; display: flex; align-items: center; gap: 12px; }
  input[type=range] { width: ${W}px; max-width: 100%; }
  .now { font-variant-numeric: tabular-nums; color: var(--dim); }
  button { font: inherit; padding: 2px 10px; border: 1px solid var(--line); border-radius: 4px;
           background: transparent; color: inherit; cursor: pointer; }
  .beats { position: relative; height: 18px; width: ${W}px; max-width: 100%; margin-bottom: 4px; }
  .beat { position: absolute; top: 0; height: 18px; border-radius: 2px; overflow: hidden;
          font-size: 10px; color: #2c4a3b; }
  .beat span { padding: 0 4px; white-space: nowrap; }
  .rows { margin-top: 18px; border-top: 1px solid var(--line); }
  .row { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); padding: 2px 0; }
  .lab { width: 250px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .plot { width: ${W}px; max-width: 100%; height: ${H}px; }
  .range { width: 130px; color: var(--dim); font-variant-numeric: tabular-nums; }
  .cursor { position: absolute; top: 0; bottom: 0; width: 1px; background: #e0483c; pointer-events: none; }
  .track { position: relative; }
</style></head>
<body>
  <h1>${ch.name} <small>${ch.duration}s · ${plots.length} animated channels</small></h1>
  <div class="stage">${svg}</div>
  <div class="controls">
    <button id="play">play</button>
    <input id="scrub" type="range" min="0" max="1000" value="0">
    <span class="now" id="now">t = 0.000 · 0.00s</span>
  </div>
  <div class="track" id="track">
    <div class="beats">${bars}</div>
    <div class="rows">${rows}</div>
    <div class="cursor" id="cursor"></div>
  </div>
<script>
  const DURATION = ${ch.duration};
  const targets = document.querySelectorAll(${JSON.stringify(animated.join(', '))});
  const scrub = document.getElementById('scrub');
  const now = document.getElementById('now');
  const cursor = document.getElementById('cursor');
  const play = document.getElementById('play');
  let running = false, raf = 0, started = 0, base = 0;

  // Driving the real animations by their own delay, rather than posing anything
  // ourselves. What you see is what the browser plays.
  function show(t) {
    for (const el of targets) el.style.animationDelay = (-t * DURATION) + 's';
    now.textContent = 't = ' + t.toFixed(3) + ' · ' + (t * DURATION).toFixed(2) + 's';
    const box = document.querySelector('.plot') || document.querySelector('.beats');
    cursor.style.left = (box ? box.getBoundingClientRect().width * t : 0) + 'px';
    cursor.style.top = '0px';
  }
  scrub.addEventListener('input', () => { stop(); show(scrub.value / 1000); });
  function stop() { running = false; play.textContent = 'play'; cancelAnimationFrame(raf); }
  function tick(ms) {
    const t = ((base + (ms - started) / 1000 / DURATION) % 1 + 1) % 1;
    scrub.value = Math.round(t * 1000);
    show(t);
    if (running) raf = requestAnimationFrame(tick);
  }
  play.addEventListener('click', () => {
    if (running) return stop();
    running = true; play.textContent = 'pause';
    base = scrub.value / 1000;
    raf = requestAnimationFrame((ms) => { started = ms; tick(ms); });
  });
  addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 : 10;
    if (e.key === 'ArrowRight') { stop(); scrub.value = Math.min(1000, +scrub.value + step); show(scrub.value / 1000); }
    if (e.key === 'ArrowLeft') { stop(); scrub.value = Math.max(0, +scrub.value - step); show(scrub.value / 1000); }
    if (e.key === ' ') { e.preventDefault(); play.click(); }
  });
  show(0);
</script>
</body></html>
`;
}
