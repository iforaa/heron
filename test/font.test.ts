import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import opentype from 'opentype.js';

import {
  character, fontPath, listShapes, loadOutlineFont, outlineText, renderStatic,
} from '../src/index.ts';

function fixtureFont(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'heron-font-'));
  const file = join(dir, 'fixture.ttf');
  const box = (left: number, right: number) => {
    const p = new opentype.Path();
    p.moveTo(left, 0);
    p.lineTo(right, 0);
    p.lineTo(right, 700);
    p.lineTo(left, 700);
    p.close();
    return p;
  };
  const font = new opentype.Font({
    familyName: 'Heron Fixture',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new opentype.Glyph({ name: '.notdef', advanceWidth: 600, path: box(50, 550) }),
      new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 300, path: new opentype.Path() }),
      new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 600, path: box(50, 550) }),
      new opentype.Glyph({ name: 'B', unicode: 66, advanceWidth: 600, path: box(80, 520) }),
    ],
  });
  writeFileSync(file, Buffer.from(font.toArrayBuffer()));
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('OpenType text becomes deterministic ordinary path geometry', () => {
  const fixture = fixtureFont();
  try {
    const font = loadOutlineFont(fixture.file);
    assert.equal(font.family, 'Heron Fixture');

    const result = fontPath('AB', { font, x: 100, y: 0, size: 100, align: 'center' });
    assert.equal(result.metrics.width, 120);
    assert.equal(result.metrics.height, 100);
    assert.equal(result.metrics.ascent, 80);
    assert.match(result.d, /^M45 10/);

    const scene = character('outlined type', { viewBox: [0, 0, 200, 100] }, () => {
      outlineText('AB', { font, x: 100, y: 0, size: 100, align: 'center', fill: '#123456' });
    });
    const shapes = listShapes(scene);
    assert.equal(shapes.length, 1);
    assert.equal(shapes[0].shape.tag, 'path');
    assert.equal(shapes[0].shape.attrs.fill, '#123456');
    const svg = renderStatic(scene, 0);
    assert.doesNotMatch(svg, /<text/);
    assert.doesNotMatch(svg, /font-family/);
    assert.match(svg, /<path d="/);
  } finally {
    fixture.cleanup();
  }
});

test('font paths support multiline layout, tracking and validation', () => {
  const fixture = fixtureFont();
  try {
    const font = loadOutlineFont(fixture.file);
    const result = fontPath('A\nB', {
      font, x: 0, y: 10, size: 50, lineHeight: 1.5, tracking: 0.1,
    });
    assert.equal(result.metrics.lines, 2);
    assert.equal(result.metrics.height, 125);
    assert.equal(result.metrics.width, 35);
    assert.match(result.d, /M2\.50 15/);
    assert.match(result.d, /M4 90/);

    assert.throws(
      () => fontPath('Z', { font, x: 0, y: 0, size: 20 }),
      /has no glyph "Z"/,
    );
    assert.throws(
      () => fontPath('A', { font, x: 0, y: 0, size: 0 }),
      /greater than zero/,
    );
    assert.throws(
      () => fontPath('A', { font, x: 0, y: 0, size: 20, precision: 9 }),
      /integer from 0 to 6/,
    );
  } finally {
    fixture.cleanup();
  }
});

test('font loading reports unreadable and malformed sources clearly', () => {
  assert.throws(() => loadOutlineFont('/definitely/not/a/font.ttf'), /cannot read font/);
  const dir = mkdtempSync(join(tmpdir(), 'heron-bad-font-'));
  const file = join(dir, 'bad.ttf');
  try {
    writeFileSync(file, 'not a font');
    assert.throws(() => loadOutlineFont(file), /cannot parse font/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
