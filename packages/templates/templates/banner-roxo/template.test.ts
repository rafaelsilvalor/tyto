import { measureNothing } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { LAYOUTS, build } from './template.js';
import { ROXO } from '../_casa/brands.js';
import { FUNCTION_WORDS, NO_BREAK_SPACE } from '../_casa/breaks.js';

import type {
  AssetRef,
  Frame,
  Inline,
  RichText,
  SceneNode,
  TemplateContext,
  TemplateFiles,
  TemplateReport,
  TextNode,
} from '@tyto/core';

/**
 * The rules of the product banner (TYTO-210), asserted on the scene.
 *
 * **Never a pixel size.** CI has no CircularXX and draws a narrower substitute, so the size the
 * banner lands on differs there; what must hold on both is the rules. The measure here is a
 * stand-in with proportional advances that wraps at plain spaces only, as Tyto's own layout
 * does — bold a little wider, as it is — and every line of the result is checked with it.
 */

/* ---------------------------------------------------------------------- the fixture -- */

let cursor = 0;

/** Rich text from a string: `**x**` is bold, `\n` the break between two lines of a block. */
function rich(source: string): RichText {
  const range = (length: number) => {
    const start = cursor;
    cursor += length;
    return { start, end: cursor };
  };
  const parts: Inline[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) parts.push({ kind: 'break', range: range(1) });
    for (const [part, value] of line.split('**').entries()) {
      if (value === '') continue;
      const plain: Inline = { kind: 'text', value, range: range(value.length) };
      parts.push(part % 2 === 1 ? { kind: 'bold', children: [plain], range: plain.range } : plain);
    }
  }
  return parts;
}

/** A glyph's advance, in em; bold is wider, as CircularXX Bold is. */
const ADVANCE = { regular: 0.52, bold: 0.58 };

/** One character as the stand-in measures it. */
interface Glyph {
  readonly character: string;
  readonly advance: number;
}

const widthOf = (glyphs: readonly Glyph[]) =>
  glyphs.reduce((total, glyph) => total + glyph.advance, 0);

/** A text node's characters, one paragraph per `lineBreak()`. */
function paragraphsOf(node: Pick<TextNode, 'runs'>): Glyph[][] {
  const paragraphs: Glyph[][] = [[]];
  for (const run of node.runs) {
    if (run.kind === 'break') {
      paragraphs.push([]);
      continue;
    }
    const advance = run.size * (run.weight >= 700 ? ADVANCE.bold : ADVANCE.regular);
    for (const character of run.text) paragraphs.at(-1)!.push({ character, advance });
  }
  return paragraphs;
}

/** A text node's lines as the layout would draw them: at its breaks, then at plain spaces. */
function layOut(node: Pick<TextNode, 'runs' | 'box'>): string[] {
  const result: string[] = [];
  for (const glyphs of paragraphsOf(node)) {
    let line: Glyph[] = [];
    let word: Glyph[] = [];
    const text = (part: readonly Glyph[]) => part.map((glyph) => glyph.character).join('');
    const place = () => {
      if (word.length === 0) return;
      const candidate =
        line.length === 0
          ? word
          : [...line, { character: ' ', advance: word[0]!.advance }, ...word];
      if (line.length > 0 && node.box.w !== undefined && widthOf(candidate) > node.box.w) {
        result.push(text(line));
        line = word;
      } else {
        line = candidate;
      }
      word = [];
    };
    for (const glyph of glyphs) {
      if (glyph.character === ' ') place();
      else word.push(glyph);
    }
    place();
    result.push(text(line));
  }
  return result;
}

const proportional: TemplateContext['measure'] = (node) => {
  const lines = layOut(node);
  const size = Math.max(...node.runs.map((run) => (run.kind === 'text' ? run.size : 0)));
  const whole = paragraphsOf(node).flat();
  return {
    runs: node.runs,
    lines: lines.length,
    width: lines.length === 1 ? widthOf(whole) : (node.box.w ?? widthOf(whole)),
    height: lines.length * node.lineHeight * size,
    scale: 1,
    overflow: 0,
  };
};

/** A folder holding the three backgrounds, and nothing else. */
const BACKGROUNDS = ['banner', 'banner-1x1', 'banner-345x146'];
const folder: TemplateFiles = {
  svg: () => undefined,
  image: (path): AssetRef | undefined => {
    const format = /^assets\/bg-(.+)\.png$/u.exec(path)?.[1];
    if (format === undefined || !BACKGROUNDS.includes(format)) return undefined;
    return { id: `bg-${format}`, source: 'file', path, hash: `sha256-${format}` };
  },
};

const SIZES: Record<string, { w: number; h: number }> = {
  banner: { w: 1200, h: 628 },
  'banner-1x1': { w: 600, h: 600 },
  'banner-345x146': { w: 345, h: 146 },
};

const SAO_MIGUEL = 'Prefeitura Municipal de São Bento do Altavale **(GO)**';
const AFVVA = 'Agência de Fomento e Vigilância Hidroviária do Vale Alto **(AFVVA)**';

interface Built {
  readonly frame: Frame;
  readonly reports: TemplateReport[];
}

function render(
  titulo: string,
  format: string,
  measure: TemplateContext['measure'] = proportional,
): Built {
  const reports: TemplateReport[] = [];
  const frame = build({
    format,
    size: SIZES[format]!,
    idPrefix: `artwork-0-${format}`,
    artwork: { id: 'artwork-0', index: 0, count: 1 },
    slots: {
      titulo: { name: 'titulo', value: { kind: 'rich-text', text: rich(titulo) }, adjustments: [] },
    },
    adjustments: {},
    measure,
    report: (report) => reports.push(report),
    files: folder,
  });
  return { frame, reports };
}

function titleOf(frame: Frame): TextNode {
  const node = frame.children.find(
    (child: SceneNode) => child.kind === 'text' && child.name === 'titulo',
  );
  if (node?.kind !== 'text') throw new Error('no titulo');
  return node;
}

/** The lines the template broke, as strings, with no-break spaces read as spaces. */
function linesOf(node: TextNode): string[] {
  return layOut(node).map((line) => line.replaceAll(NO_BREAK_SPACE, ' '));
}

/* --------------------------------------------------------------------------- tests -- */

describe.each(Object.keys(SIZES))('banner-roxo in %s', (format) => {
  it('draws its own background, full-bleed, under the text', () => {
    const { frame } = render(SAO_MIGUEL, format);
    const [first] = frame.children;

    expect(first?.kind).toBe('image');
    if (first?.kind !== 'image') return;
    expect(first.asset.path).toBe(`assets/bg-${format}.png`);
    expect(first.size).toEqual(SIZES[format]);
    expect(first.transform).toMatchObject({ x: 0, y: 0 });
  });

  it.each([SAO_MIGUEL, AFVVA])('keeps every line of “%s” inside its box', (titulo) => {
    const { frame, reports } = render(titulo, format);
    const node = titleOf(frame);
    const layout = LAYOUTS[format]!;

    expect(reports).toEqual([]);
    expect(node.transform).toMatchObject({ x: layout.box.x, y: layout.box.y });
    expect(node.box).toEqual({ w: layout.box.w, h: layout.box.h });
    // Laid out again at the box's width, the template's own breaks are the only breaks.
    const breaks = node.runs.filter((run) => run.kind === 'break').length;
    expect(layOut(node)).toHaveLength(breaks + 1);
  });

  it('never splits `(GO)` nor starts a line with it', () => {
    for (const line of linesOf(titleOf(render(SAO_MIGUEL, format).frame))) {
      expect(line.startsWith('(')).toBe(false);
      expect(line).not.toMatch(/\([^)]*$/u);
    }
  });

  it.each([SAO_MIGUEL, AFVVA])('ends no line of “%s” on a function word', (titulo) => {
    const lines = linesOf(titleOf(render(titulo, format).frame));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(0, -1)) {
      const last = line.split(' ').at(-1)!.toLocaleLowerCase('pt-BR');
      expect(FUNCTION_WORDS.has(last), `“${line}”`).toBe(false);
    }
  });

  it('draws in ROXO’s accent, the state in bold, and nothing in italic', () => {
    const spans = titleOf(render(SAO_MIGUEL, format).frame).runs.flatMap((run) =>
      run.kind === 'text' ? [run] : [],
    );

    for (const span of spans) {
      expect(span.color).toEqual({ kind: 'solid', color: expect.anything() });
      expect(span.style).toBe('normal');
    }
    expect(spans.find((span) => span.text.includes('(GO)'))?.weight).toBe(700);
    expect(spans.find((span) => span.text.includes('Prefeitura'))?.weight).toBe(400);
    expect(render(SAO_MIGUEL, format).frame.children.length).toBe(2);
    const ink = spans[0]!.color;
    expect(ink.kind === 'solid' && ink.color).toEqual(solidOf(ROXO.accent));
  });

  it('draws a text too long for the floor at the floor, and says by how much it overflows', () => {
    const long = Array.from({ length: 6 }, () => AFVVA.replaceAll('**', '')).join(' ');
    const { frame, reports } = render(long, format);
    const node = titleOf(frame);
    const sizes = node.runs.flatMap((run) => (run.kind === 'text' ? [run.size] : []));

    expect(new Set(sizes)).toEqual(new Set([LAYOUTS[format]!.sizes.floor]));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ code: 'W_TEMPLATE_OVERFLOW' });
    expect(reports[0]!.overflow).toBeGreaterThan(0);
    // Every word is still drawn: nothing is cut.
    expect(linesOf(node).join(' ')).toBe(long);
  });
});

describe('banner-roxo given italic', () => {
  it('draws it upright: the house faces have no italic', () => {
    const plain: Inline = { kind: 'text', value: 'Prefeitura', range: { start: 0, end: 10 } };
    const frame = build({
      format: 'banner',
      size: SIZES.banner!,
      idPrefix: 'artwork-0-banner',
      artwork: { id: 'artwork-0', index: 0, count: 1 },
      slots: {
        titulo: {
          name: 'titulo',
          value: {
            kind: 'rich-text',
            text: [{ kind: 'italic', children: [plain], range: plain.range }],
          },
          adjustments: [],
        },
      },
      adjustments: {},
      measure: proportional,
      report: () => undefined,
      files: folder,
    });
    const spans = titleOf(frame).runs.flatMap((run) => (run.kind === 'text' ? [run] : []));

    expect(spans.map((span) => span.text)).toEqual(['Prefeitura']);
    expect(spans[0]!.style).toBe('normal');
  });
});

describe('banner-roxo with nothing to measure', () => {
  it('still draws every word, in one block the layout fits into the box', () => {
    const node = titleOf(render(SAO_MIGUEL, 'banner', measureNothing).frame);
    expect(node.overflow).toBe('shrink');
    expect(linesOf({ ...node, box: {} }).join(' ')).toBe(SAO_MIGUEL.replaceAll('**', ''));
  });
});

/** `#5900a6` as the channels a solid paint carries. */
function solidOf(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, a: 1 };
}
