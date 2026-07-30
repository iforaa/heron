/**
 * Deterministic vector typography for titles and wordmarks.
 *
 * SVG `<text>` would be shorter, but it delegates the actual geometry to fonts
 * installed on the viewer's machine. That breaks the promise that a compiled
 * Heron file looks the same offline in ten years. A stroke font is geometry:
 * small, draw-on animatable, and carried entirely inside the resulting SVG.
 */

import { line, type Vec2 } from './scene.ts';

export type StrokeSegment = [from: Vec2, to: Vec2];

export interface StrokeGlyph {
  /** Normalized geometry: one em high, with x normally between 0 and 1. */
  segments: StrokeSegment[];
  /** Horizontal advance in em. Defaults to the font's advance. */
  advance?: number;
  /**
   * Shift applied when placing the ink inside the advance box, in em.
   * `strokeFont()` computes it so the ink sits centered — a narrow glyph drawn
   * at mid-em (an I at x=0.5) would otherwise carry all its air on one side and
   * break every word it appears in. Authored values win when present.
   */
  offset?: number;
}

export interface StrokeFont {
  readonly glyphs: Readonly<Record<string, StrokeGlyph>>;
  readonly advance: number;
  readonly space: number;
}

export interface StrokeFontOptions {
  /** Default glyph advance in em. */
  advance?: number;
  /** Space advance in em. */
  space?: number;
}

/**
 * Creates a validated stroke font.
 *
 * Glyphs are deliberately plain data, so traced lettering or an external font
 * converter can feed this API later without changing `strokeText()`.
 */
export function strokeFont(
  glyphs: Record<string, StrokeSegment[] | StrokeGlyph>,
  o: StrokeFontOptions = {},
): StrokeFont {
  const advance = o.advance ?? 1;
  const space = o.space ?? 0.7;
  if (!Number.isFinite(advance) || advance <= 0 || !Number.isFinite(space) || space <= 0) {
    throw new Error('heron: strokeFont() advances must be finite numbers greater than zero');
  }

  const normalized: Record<string, StrokeGlyph> = {};
  for (const [name, value] of Object.entries(glyphs)) {
    if ([...name].length !== 1) throw new Error(`heron: strokeFont() glyph "${name}" is not one character`);
    const glyph = Array.isArray(value) ? { segments: value as StrokeSegment[] } : value;
    if (glyph.advance !== undefined && (!Number.isFinite(glyph.advance) || glyph.advance <= 0)) {
      throw new Error(`heron: strokeFont() glyph "${name}" has an invalid advance`);
    }
    for (const segment of glyph.segments) {
      if (segment.length !== 2 || segment.some((p) =>
        p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
        throw new Error(`heron: strokeFont() glyph "${name}" contains an invalid segment`);
      }
    }
    const xs = glyph.segments.flatMap(([a, b]) => [a[0], b[0]]);
    const ink = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    const box = glyph.advance ?? advance;
    normalized[name] = {
      segments: glyph.segments.map(([a, b]) => [[...a], [...b]] as StrokeSegment),
      advance: glyph.advance,
      offset: glyph.offset ?? (xs.length ? (box - ink) / 2 - Math.min(...xs) : 0),
    };
  }
  return { glyphs: normalized, advance, space };
}

export interface StrokeTextOptions {
  font?: StrokeFont;
  /** Anchor position. `y` is the cap-height top, not a baseline. */
  x: number;
  y: number;
  size: number;
  align?: 'left' | 'center' | 'right';
  /** Additional advance between glyphs, in em. */
  tracking?: number;
  /** Distance between multiline tops, in em. */
  lineHeight?: number;
  stroke?: string;
  width?: number;
  opacity?: number;
  cap?: 'round' | 'butt' | 'square';
}

export interface StrokeTextMetrics {
  width: number;
  height: number;
  lines: number;
}

/** The layout options both text engines share, rejected identically. */
export function validateTextLayout(
  fn: string,
  o: { x: number; y: number; size: number; tracking?: number; lineHeight?: number },
): void {
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)
      || !Number.isFinite(o.size) || o.size <= 0) {
    throw new Error(`heron: ${fn} position and size must be finite, and size must be greater than zero`);
  }
  if (o.tracking !== undefined && !Number.isFinite(o.tracking)) {
    throw new Error(`heron: ${fn} tracking must be finite`);
  }
  if (o.lineHeight !== undefined && (!Number.isFinite(o.lineHeight) || o.lineHeight <= 0)) {
    throw new Error(`heron: ${fn} lineHeight must be greater than zero`);
  }
}

/**
 * Draws text as ordinary Heron line geometry.
 *
 * Wrap it in a `part` or `layer` and the existing `draw` channel writes the
 * whole word on. Missing glyphs are errors rather than invisible holes in a
 * title card.
 */
export function strokeText(text: string, o: StrokeTextOptions): StrokeTextMetrics {
  const font = o.font ?? geometricStrokeFont;
  validateTextLayout('strokeText()', o);
  const tracking = o.tracking ?? 0.18;
  const lineHeight = o.lineHeight ?? 1.4;
  const lines = text.split('\n');

  const advanceOf = (char: string): number => {
    if (char === ' ') return font.space;
    const glyph = font.glyphs[char];
    if (!glyph) throw new Error(`heron: this stroke font has no glyph "${char}"`);
    return glyph.advance ?? font.advance;
  };
  const widthOf = (content: string): number => {
    const chars = [...content];
    return chars.reduce((sum, char) => sum + advanceOf(char), 0)
      + Math.max(0, chars.length - 1) * tracking;
  };

  const align = o.align ?? 'left';
  let widest = 0;
  for (let row = 0; row < lines.length; row++) {
    const chars = [...lines[row]];
    const emWidth = widthOf(lines[row]);
    widest = Math.max(widest, emWidth);
    let cursor = o.x - (align === 'center' ? emWidth * o.size / 2 : align === 'right' ? emWidth * o.size : 0);
    const top = o.y + row * lineHeight * o.size;

    for (const char of chars) {
      const advance = advanceOf(char);
      if (char !== ' ') {
        const glyph = font.glyphs[char];
        const shift = glyph.offset ?? 0;
        for (const [[ax, ay], [bx, by]] of glyph.segments) {
          line({
            from: [cursor + (shift + ax) * o.size, top + ay * o.size],
            to: [cursor + (shift + bx) * o.size, top + by * o.size],
            stroke: o.stroke ?? '#000',
            width: o.width,
            opacity: o.opacity,
            cap: o.cap,
          });
        }
      }
      cursor += (advance + tracking) * o.size;
    }
  }

  return {
    width: widest * o.size,
    height: o.size + Math.max(0, lines.length - 1) * lineHeight * o.size,
    lines: lines.length,
  };
}

const glyph = (segments: StrokeSegment[], advance?: number): StrokeGlyph => ({ segments, advance });

/**
 * A compact uppercase geometric face intended for motion graphics.
 *
 * It is a useful default, not a claim that one typeface fits every film. Custom
 * fonts use the same `strokeFont()` data model and can be kept with the brand
 * artwork that owns them.
 */
export const geometricStrokeFont: StrokeFont = strokeFont({
  A: glyph([[[0, 1], [0.5, 0]], [[0.5, 0], [1, 1]], [[0.22, 0.58], [0.78, 0.58]]]),
  B: glyph([[[0, 0], [0, 1]], [[0, 0], [0.66, 0]], [[0.66, 0], [0.94, 0.2]], [[0.94, 0.2], [0.66, 0.5]], [[0.66, 0.5], [0, 0.5]], [[0.66, 0.5], [1, 0.72]], [[1, 0.72], [0.66, 1]], [[0.66, 1], [0, 1]]]),
  C: glyph([[[1, 0.12], [0.72, 0]], [[0.72, 0], [0.18, 0]], [[0.18, 0], [0, 0.25]], [[0, 0.25], [0, 0.75]], [[0, 0.75], [0.18, 1]], [[0.18, 1], [0.72, 1]], [[0.72, 1], [1, 0.88]]]),
  D: glyph([[[0, 0], [0, 1]], [[0, 0], [0.62, 0]], [[0.62, 0], [1, 0.28]], [[1, 0.28], [1, 0.72]], [[1, 0.72], [0.62, 1]], [[0.62, 1], [0, 1]]]),
  E: glyph([[[0, 0], [0, 1]], [[0, 0], [1, 0]], [[0, 0.5], [0.76, 0.5]], [[0, 1], [1, 1]]]),
  F: glyph([[[0, 0], [0, 1]], [[0, 0], [1, 0]], [[0, 0.5], [0.76, 0.5]]]),
  G: glyph([[[1, 0.12], [0.72, 0]], [[0.72, 0], [0.18, 0]], [[0.18, 0], [0, 0.25]], [[0, 0.25], [0, 0.75]], [[0, 0.75], [0.18, 1]], [[0.18, 1], [0.78, 1]], [[0.78, 1], [1, 0.76]], [[1, 0.76], [1, 0.54]], [[1, 0.54], [0.58, 0.54]]]),
  H: glyph([[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]]),
  I: glyph([[[0.5, 0], [0.5, 1]]], 0.55),
  J: glyph([[[1, 0], [1, 0.78]], [[1, 0.78], [0.78, 1]], [[0.78, 1], [0.24, 1]], [[0.24, 1], [0, 0.8]]]),
  K: glyph([[[0, 0], [0, 1]], [[1, 0], [0, 0.55]], [[0, 0.55], [1, 1]]]),
  L: glyph([[[0, 0], [0, 1]], [[0, 1], [1, 1]]]),
  M: glyph([[[0, 1], [0, 0]], [[0, 0], [0.5, 0.58]], [[0.5, 0.58], [1, 0]], [[1, 0], [1, 1]]], 1.12),
  N: glyph([[[0, 1], [0, 0]], [[0, 0], [1, 1]], [[1, 1], [1, 0]]]),
  O: glyph([[[0.2, 0], [0.8, 0]], [[0.8, 0], [1, 0.24]], [[1, 0.24], [1, 0.76]], [[1, 0.76], [0.8, 1]], [[0.8, 1], [0.2, 1]], [[0.2, 1], [0, 0.76]], [[0, 0.76], [0, 0.24]], [[0, 0.24], [0.2, 0]]]),
  P: glyph([[[0, 1], [0, 0]], [[0, 0], [0.7, 0]], [[0.7, 0], [1, 0.22]], [[1, 0.22], [0.72, 0.52]], [[0.72, 0.52], [0, 0.52]]]),
  Q: glyph([[[0.2, 0], [0.8, 0]], [[0.8, 0], [1, 0.24]], [[1, 0.24], [1, 0.76]], [[1, 0.76], [0.8, 1]], [[0.8, 1], [0.2, 1]], [[0.2, 1], [0, 0.76]], [[0, 0.76], [0, 0.24]], [[0, 0.24], [0.2, 0]], [[0.58, 0.64], [1.08, 1.08]]]),
  R: glyph([[[0, 1], [0, 0]], [[0, 0], [0.7, 0]], [[0.7, 0], [1, 0.22]], [[1, 0.22], [0.72, 0.52]], [[0.72, 0.52], [0, 0.52]], [[0.58, 0.52], [1, 1]]]),
  S: glyph([[[1, 0.12], [0.72, 0]], [[0.72, 0], [0.18, 0]], [[0.18, 0], [0, 0.25]], [[0, 0.25], [0.22, 0.5]], [[0.22, 0.5], [0.78, 0.5]], [[0.78, 0.5], [1, 0.75]], [[1, 0.75], [0.82, 1]], [[0.82, 1], [0.18, 1]], [[0.18, 1], [0, 0.88]]]),
  T: glyph([[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]]),
  U: glyph([[[0, 0], [0, 0.76]], [[0, 0.76], [0.22, 1]], [[0.22, 1], [0.78, 1]], [[0.78, 1], [1, 0.76]], [[1, 0.76], [1, 0]]]),
  V: glyph([[[0, 0], [0.5, 1]], [[0.5, 1], [1, 0]]]),
  W: glyph([[[0, 0], [0.22, 1]], [[0.22, 1], [0.58, 0.42]], [[0.58, 0.42], [0.94, 1]], [[0.94, 1], [1.16, 0]]], 1.2),
  X: glyph([[[0, 0], [1, 1]], [[1, 0], [0, 1]]]),
  Y: glyph([[[0, 0], [0.5, 0.5]], [[1, 0], [0.5, 0.5]], [[0.5, 0.5], [0.5, 1]]]),
  Z: glyph([[[0, 0], [1, 0]], [[1, 0], [0, 1]], [[0, 1], [1, 1]]]),
  '0': glyph([[[0.2, 0], [0.8, 0]], [[0.8, 0], [1, 0.22]], [[1, 0.22], [1, 0.78]], [[1, 0.78], [0.8, 1]], [[0.8, 1], [0.2, 1]], [[0.2, 1], [0, 0.78]], [[0, 0.78], [0, 0.22]], [[0, 0.22], [0.2, 0]], [[0.2, 0.82], [0.8, 0.18]]]),
  '1': glyph([[[0.22, 0.2], [0.5, 0]], [[0.5, 0], [0.5, 1]], [[0.18, 1], [0.82, 1]]], 0.75),
  '2': glyph([[[0, 0.2], [0.22, 0]], [[0.22, 0], [0.78, 0]], [[0.78, 0], [1, 0.22]], [[1, 0.22], [0, 1]], [[0, 1], [1, 1]]]),
  '3': glyph([[[0, 0.1], [0.24, 0]], [[0.24, 0], [0.78, 0]], [[0.78, 0], [1, 0.22]], [[1, 0.22], [0.7, 0.5]], [[0.7, 0.5], [1, 0.75]], [[1, 0.75], [0.78, 1]], [[0.78, 1], [0.2, 1]], [[0.2, 1], [0, 0.9]]]),
  '4': glyph([[[0.78, 1], [0.78, 0]], [[0.78, 0], [0, 0.68]], [[0, 0.68], [1, 0.68]]]),
  '5': glyph([[[1, 0], [0, 0]], [[0, 0], [0, 0.5]], [[0, 0.5], [0.78, 0.5]], [[0.78, 0.5], [1, 0.72]], [[1, 0.72], [0.8, 1]], [[0.8, 1], [0.18, 1]], [[0.18, 1], [0, 0.88]]]),
  '6': glyph([[[0.9, 0.08], [0.68, 0]], [[0.68, 0], [0.18, 0.32]], [[0.18, 0.32], [0, 0.68]], [[0, 0.68], [0.2, 1]], [[0.2, 1], [0.78, 1]], [[0.78, 1], [1, 0.72]], [[1, 0.72], [0.78, 0.5]], [[0.78, 0.5], [0.12, 0.5]]]),
  '7': glyph([[[0, 0], [1, 0]], [[1, 0], [0.3, 1]]]),
  '8': glyph([[[0.22, 0], [0.78, 0]], [[0.78, 0], [1, 0.22]], [[1, 0.22], [0.76, 0.5]], [[0.76, 0.5], [0.22, 0.5]], [[0.22, 0.5], [0, 0.22]], [[0, 0.22], [0.22, 0]], [[0.22, 0.5], [0, 0.76]], [[0, 0.76], [0.22, 1]], [[0.22, 1], [0.78, 1]], [[0.78, 1], [1, 0.76]], [[1, 0.76], [0.76, 0.5]]]),
  '9': glyph([[[0.88, 0.5], [0.22, 0.5]], [[0.22, 0.5], [0, 0.28]], [[0, 0.28], [0.22, 0]], [[0.22, 0], [0.8, 0]], [[0.8, 0], [1, 0.32]], [[1, 0.32], [0.82, 0.68]], [[0.82, 0.68], [0.32, 1]], [[0.32, 1], [0.1, 0.92]]]),
  '.': glyph([[[0.45, 0.94], [0.45, 1]]], 0.42),
  ',': glyph([[[0.5, 0.9], [0.38, 1.12]]], 0.42),
  ':': glyph([[[0.48, 0.28], [0.48, 0.34]], [[0.48, 0.84], [0.48, 0.9]]], 0.42),
  '-': glyph([[[0.08, 0.52], [0.92, 0.52]]], 0.75),
  '/': glyph([[[0, 1], [1, 0]]], 0.8),
  '!': glyph([[[0.5, 0], [0.5, 0.72]], [[0.5, 0.94], [0.5, 1]]], 0.45),
  '?': glyph([[[0, 0.2], [0.22, 0]], [[0.22, 0], [0.78, 0]], [[0.78, 0], [1, 0.22]], [[1, 0.22], [0.5, 0.58]], [[0.5, 0.58], [0.5, 0.72]], [[0.5, 0.94], [0.5, 1]]]),
}, { advance: 1, space: 0.72 });
