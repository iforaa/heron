/**
 * One-time extractor for the supplied SVGator file.
 *
 * It reads the SVG as an interchange source and writes standalone TypeScript
 * literals. The generated scene never reads, embeds, or executes the SVG.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
if (!input) throw new Error('usage: node scripts/extract-chessrun-objects.ts <source.svg> [output.ts]');
const output = process.argv[3] ?? 'examples/chessrun-objects.ts';
const svg = readFileSync(input, 'utf8');

function sourcePath(id: string): string {
  const tag = svg.match(new RegExp(`<path id="${id}"[^>]*>`))?.[0];
  const d = tag?.match(/\sd="([^"]+)"/)?.[1]?.trim();
  if (!d) throw new Error(`extract-chessrun-objects: path "${id}" is missing`);
  return d;
}

function finalPath(id: string): string {
  const animation = svg.match(
    new RegExp(`<animate(?=[^>]*href="#${id}")(?=[^>]*attributeName="d")[^>]*>`),
  )?.[0];
  const d = animation?.match(/\sto="([^"]+)"/)?.[1]?.trim();
  if (!d) throw new Error(`extract-chessrun-objects: final path "${id}" is missing`);
  return d;
}

const objects = [
  {
    name: 'base',
    transform: { x: 479.885, y: 353.91, scaleX: 2.5, scaleY: 2.5 },
    shapes: [{ kind: 'path', d: finalPath('_R_G_L_5_G_D_0_P_0'), fill: '#17191a' }],
  },
  {
    // The source encodes this as four cubic arcs. Recover the semantic circle
    // so future animation can address its centre and radius directly.
    name: 'ball',
    transform: { x: 529.825, y: 321.75, scaleX: 2.5, scaleY: 2.5 },
    shapes: [{ kind: 'circle', cx: 0, cy: 0, r: 6.72, fill: '#17191a' }],
  },
  {
    name: 'runPlate',
    transform: { x: 747.4975, y: 567.0025, scaleX: 2.5, scaleY: 2.5 },
    shapes: [{ kind: 'path', d: sourcePath('_R_G_L_3_G_D_0_P_0'), fill: '#f4a54d' }],
  },
  {
    name: 'runText',
    transform: { x: 747.4975, y: 567.0025, scaleX: 2.5, scaleY: 2.5 },
    shapes: [
      { kind: 'path', d: sourcePath('_R_G_L_2_G_D_0_P_0'), fill: '#ffffff' },
      { kind: 'path', d: sourcePath('_R_G_L_2_G_D_1_P_0'), fill: '#f4a54d' },
    ],
  },
  {
    name: 'chessText',
    transform: { x: 747.4975, y: 567, scaleX: 2.5, scaleY: 2.5 },
    shapes: [{ kind: 'path', d: sourcePath('_R_G_L_1_G_D_0_P_0'), fill: '#17191a' }],
  },
  {
    name: 'rook',
    transform: { x: 479.0185, y: 177.28, scaleX: 2.489605, scaleY: 2.489605 },
    shapes: [{ kind: 'path', d: finalPath('_R_G_L_0_G_D_0_P_0'), fill: '#17191a' }],
  },
] as const;

const generated = `/**
 * Generated from the completed frame of animated_logo (1).svg.
 *
 * This file is standalone TypeScript scene data. It does not read or execute
 * the source SVG. Each visual component is a named Heron part so later motion
 * can address it directly: scene.part('ball'), scene.part('rook'), etc.
 */

import {
  character, circle, keys, part, path as drawPath,
  type Character, type Vec2,
} from '../src/index.ts';

export type ChessrunGeometry =
  | { kind: 'path'; d: string; fill: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string };

export interface ChessrunObject {
  name: string;
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
  };
  shapes: ChessrunGeometry[];
}

export const chessrunObjects: ChessrunObject[] = ${JSON.stringify(objects, null, 2)};

const fixed = (value: number) => keys([[0, value], [1, value]]);

export const chessrunObjectsScene: Character = character(
  'chessrunObjects',
  { viewBox: [0, 0, 960, 540], duration: 1, once: true },
  () => {
    for (const object of chessrunObjects) {
      part(object.name, { pivot: [0, 0] as Vec2 }, () => {
        for (const shape of object.shapes) {
          if (shape.kind === 'circle') {
            circle({
              cx: shape.cx, cy: shape.cy, r: shape.r, fill: shape.fill,
            });
          } else {
            drawPath({ d: shape.d, fill: shape.fill });
          }
        }
      });
    }
  },
);

for (const object of chessrunObjects) {
  chessrunObjectsScene.part(object.name).animate({
    x: fixed(object.transform.x),
    y: fixed(object.transform.y),
    scaleX: fixed(object.transform.scaleX),
    scaleY: fixed(object.transform.scaleY),
  });
}
`;

writeFileSync(output, generated);
console.log(`${output}  ${objects.length} semantic objects, standalone TypeScript`);
