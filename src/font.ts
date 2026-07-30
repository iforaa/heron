/**
 * Deterministic filled typography from OpenType font files.
 *
 * Parsing a font is specialist format work, so Heron delegates that boundary to
 * opentype.js. The result crosses into the scene model as an ordinary `path`;
 * the source font is never needed by the rendered or compiled SVG.
 */

import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';

import { path as drawPath, type PaintValue } from './scene.ts';
import { type StrokeTextMetrics, validateTextLayout } from './type.ts';

type OpenTypeFont = {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  hasChar(char: string): boolean;
  getEnglishName(name: string): string | undefined;
  getAdvanceWidth(text: string, size: number, options?: unknown): number;
  getPath(text: string, x: number, y: number, size: number, options?: unknown): {
    toPathData(options?: unknown): string;
  };
};

/** A parsed font kept out of the public scene representation. */
export class OutlineFont {
  readonly source: string;
  readonly family: string;
  /** @internal */
  readonly font: OpenTypeFont;

  constructor(source: string, font: OpenTypeFont) {
    this.source = source;
    this.font = font;
    this.family = font.getEnglishName('fontFamily') ?? 'unnamed';
  }
}

/** Loads a TTF, OTF or WOFF font for conversion to path geometry. */
export function loadOutlineFont(file: string): OutlineFont {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    throw new Error(`heron: cannot read font "${file}": ${(error as Error).message}`);
  }
  try {
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new OutlineFont(file, opentype.parse(data) as OpenTypeFont);
  } catch (error) {
    throw new Error(`heron: cannot parse font "${file}": ${(error as Error).message}`);
  }
}

export interface FontPathOptions {
  font: OutlineFont;
  /** Anchor position. `y` is the top of the font metrics, not a baseline. */
  x: number;
  y: number;
  size: number;
  align?: 'left' | 'center' | 'right';
  /** Additional advance between glyphs, in em. */
  tracking?: number;
  /** Distance between multiline tops, in em. */
  lineHeight?: number;
  kerning?: boolean;
  /** OpenType feature flags such as `{ liga: false }`. */
  features?: Record<string, boolean>;
  /** Decimal places retained in SVG path coordinates. Defaults to 2. */
  precision?: number;
}

export interface FontPathMetrics extends StrokeTextMetrics {
  ascent: number;
  descent: number;
}

export interface FontPathResult {
  d: string;
  metrics: FontPathMetrics;
}

function validateTextOptions(o: FontPathOptions): void {
  validateTextLayout('fontPath()', o);
  if (o.precision !== undefined && (!Number.isInteger(o.precision) || o.precision < 0 || o.precision > 6)) {
    throw new Error('heron: fontPath() precision must be an integer from 0 to 6');
  }
}

/**
 * Converts text to one SVG path string, including shaping, ligatures and
 * kerning supplied by the font.
 */
export function fontPath(text: string, o: FontPathOptions): FontPathResult {
  validateTextOptions(o);
  const font = o.font.font;
  for (const char of [...text]) {
    if (char !== '\n' && !/\s/u.test(char) && !font.hasChar(char)) {
      throw new Error(`heron: font "${o.font.family}" (${o.font.source}) has no glyph "${char}"`);
    }
  }

  const scale = o.size / font.unitsPerEm;
  const ascent = font.ascender * scale;
  const descent = -font.descender * scale;
  const lineHeight = (o.lineHeight ?? 1.2) * o.size;
  const lines = text.split('\n');
  const renderOptions: Record<string, unknown> = {
    kerning: o.kerning ?? true,
    tracking: (o.tracking ?? 0) * 1000,
  };
  if (o.features !== undefined) renderOptions.features = o.features;
  const widths = lines.map((line) => font.getAdvanceWidth(line, o.size, renderOptions));
  const align = o.align ?? 'left';
  const paths = lines.map((line, row) => {
    const left = o.x - (align === 'center' ? widths[row] / 2 : align === 'right' ? widths[row] : 0);
    const baseline = o.y + ascent + row * lineHeight;
    return font.getPath(line, left, baseline, o.size, renderOptions)
      .toPathData({ decimalPlaces: o.precision ?? 2, optimize: true });
  }).filter(Boolean);

  return {
    d: paths.join(' '),
    metrics: {
      width: Math.max(0, ...widths),
      height: ascent + descent + Math.max(0, lines.length - 1) * lineHeight,
      lines: lines.length,
      ascent,
      descent,
    },
  };
}

export interface OutlineTextOptions extends FontPathOptions {
  fill?: PaintValue;
  stroke?: PaintValue;
  width?: number;
  opacity?: number;
  cap?: 'round' | 'butt' | 'square';
}

/** Converts text and immediately adds its filled outline as a Heron path. */
export function outlineText(text: string, o: OutlineTextOptions): FontPathMetrics {
  const { d, metrics } = fontPath(text, o);
  if (d) {
    drawPath({
      d,
      fill: o.fill ?? '#000',
      stroke: o.stroke,
      width: o.width,
      opacity: o.opacity,
      cap: o.cap,
    });
  }
  return metrics;
}
