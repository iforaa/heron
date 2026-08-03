import { XMLParser } from 'fast-xml-parser';

type XmlNode = Record<string, unknown> & { ':@'?: Record<string, string> };

export interface ImportSvgOptions {
  name?: string;
  importFrom?: string;
}

export interface ImportSvgResult {
  source: string;
  name: string;
  viewBox: [number, number, number, number];
  parts: number;
  shapes: number;
}

const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polygon', 'polyline']);
const CONTAINERS = new Set(['svg', 'g']);
const METADATA = new Set(['title', 'desc', 'metadata']);
const PRESENTATION = new Set([
  'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity',
  'color', 'style', 'vector-effect',
]);

function numeric(text: string | undefined, label: string): number {
  const value = Number(String(text ?? '').replace(/px$/, ''));
  if (!Number.isFinite(value)) throw new Error(`heron import: ${label} must be a plain finite SVG number`);
  return value;
}

function identifier(value: string, fallback: string): string {
  const clean = value.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[-_]+|[-_]+$/g, '');
  return clean || fallback;
}

function attrsSource(attrs: Record<string, string>): string {
  return JSON.stringify(attrs);
}

/** Converts ordinary SVG groups and geometry to a runnable Heron scene module. */
export function importSvgSource(svg: string, options: ImportSvgOptions = {}): ImportSvgResult {
  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: '', preserveOrder: true, trimValues: false,
    allowBooleanAttributes: true,
  });
  const document = parser.parse(svg) as XmlNode[];
  const root = document.find((node) => 'svg' in node);
  if (!root) throw new Error('heron import: input has no <svg> root');
  const rootAttrs = root[':@'] ?? {};
  const view = rootAttrs.viewBox?.trim().split(/[ ,]+/).map(Number);
  const viewBox: [number, number, number, number] = view?.length === 4 && view.every(Number.isFinite)
    ? view as [number, number, number, number]
    : [0, 0, numeric(rootAttrs.width, 'width'), numeric(rootAttrs.height, 'height')];
  if (viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error('heron import: SVG viewBox must have positive dimensions');
  const name = identifier(options.name ?? rootAttrs.id ?? 'importedSvg', 'importedSvg');
  const lines: string[] = [
    `import { character, part, svgShape } from ${JSON.stringify(options.importFrom ?? '@heron/core')};`,
    '',
    `export const ${identifier(name, 'importedSvg').replace(/-/g, '_')} = character(${JSON.stringify(name)}, {`,
    `  viewBox: [${viewBox.join(', ')}],`,
    '}, () => {',
  ];
  let parts = 0;
  let shapes = 0;
  let generated = 0;

  const walk = (
    children: unknown, depth: number, inheritedTransform: string[], inheritedPaint: Record<string, string>,
  ): void => {
    if (!Array.isArray(children)) return;
    const siblingNames = new Set<string>();
    for (const entry of children as XmlNode[]) {
      const tag = Object.keys(entry).find((key) => key !== ':@' && key !== '#text');
      if (!tag) continue;
      const attrs = entry[':@'] ?? {};
      // Descriptive metadata carries no paint or geometry. Ignoring it preserves
      // the visual artifact and lets ordinary accessible SVGs import unchanged.
      if (METADATA.has(tag)) continue;
      if (tag === 'defs' || tag === 'style' || tag === 'use' || tag === 'text' || tag === 'image') {
        throw new Error(`heron import: <${tag}> is not yet supported; flatten or outline it before import`);
      }
      if (!CONTAINERS.has(tag) && !SHAPES.has(tag)) {
        throw new Error(`heron import: unsupported SVG element <${tag}>`);
      }
      const transform = [...inheritedTransform, ...(attrs.transform ? [attrs.transform] : [])];
      const paint = { ...inheritedPaint };
      for (const [key, value] of Object.entries(attrs)) if (PRESENTATION.has(key)) paint[key] = value;

      if (tag === 'g') {
        const base = identifier(attrs.id ?? attrs['aria-label'] ?? `group${++generated}`, `group${generated}`);
        let partName = base;
        let suffix = 2;
        while (siblingNames.has(partName)) partName = `${base}_${suffix++}`;
        siblingNames.add(partName);
        lines.push(`${'  '.repeat(depth)}part(${JSON.stringify(partName)}, () => {`);
        parts++;
        walk(entry[tag], depth + 1, transform, paint);
        lines.push(`${'  '.repeat(depth)}});`);
        continue;
      }

      const shapeAttrs: Record<string, string> = { ...paint, ...attrs };
      delete shapeAttrs.id;
      if (transform.length) shapeAttrs.transform = transform.join(' ');
      lines.push(`${'  '.repeat(depth)}svgShape(${JSON.stringify(tag)}, ${attrsSource(shapeAttrs)});`);
      shapes++;
    }
  };

  const rootPaint: Record<string, string> = {};
  for (const [key, value] of Object.entries(rootAttrs)) if (PRESENTATION.has(key)) rootPaint[key] = value;
  walk(root.svg, 1, rootAttrs.transform ? [rootAttrs.transform] : [], rootPaint);
  lines.push('});', '', `export default ${identifier(name, 'importedSvg').replace(/-/g, '_')};`, '');
  return { source: lines.join('\n'), name, viewBox, parts, shapes };
}
