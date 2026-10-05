import { measureNothing, noBrandKit } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { LAYOUTS, build } from './template.js';
import { ROXO } from '../_casa/brands.js';
import { FUNCTION_WORDS, NO_BREAK_SPACE } from '../_casa/breaks.js';
import { PLACEHOLDER_LOGO } from '../_casa/marks.js';

import type {
  AssetRef,
  BrandKit,
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

const PREFEITURA = 'Prefeitura Municipal de São Bento do Vale Alto **(VA)**';
const AGENCIA = 'Agência de Fomento e Vigilância Hidroviária do Vale Alto **(AFVVA)**';

interface Built {
  readonly frame: Frame;
  readonly reports: TemplateReport[];
}

function render(
  titulo: string,
  format: string,
  measure: TemplateContext['measure'] = proportional,
  brand: BrandKit = noBrandKit,
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
    brand,
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
    const { frame } = render(PREFEITURA, format);
    const [first] = frame.children;

    expect(first?.kind).toBe('image');
    if (first?.kind !== 'image') return;
    expect(first.asset.path).toBe(`assets/bg-${format}.png`);
    expect(first.size).toEqual(SIZES[format]);
    expect(first.transform).toMatchObject({ x: 0, y: 0 });
  });

  it('draws the placeholder logo in the box the painted-out logo took, over the background', () => {
    // Without a kit (ADR 0065): the box was measured on the background's pixels before the
    // logo was painted out of it, so the placeholder stands exactly where the logo stood.
    const { frame } = render(PREFEITURA, format);
    const box = LAYOUTS[format]!.logo!;
    const [, logo] = frame.children;

    expect(logo?.kind).toBe('vector');
    if (logo?.kind !== 'vector') return;
    expect(logo.name).toBe('logo');
    expect(logo.geometry).toMatchObject({ d: PLACEHOLDER_LOGO.d });
    expect(logo.transform.scaleY * logo.size.h).toBeCloseTo(box.h);
    expect(logo.transform.y).toBe(box.y);
    // Centred across the box: the placeholder has the logo's proportions, so it fills it.
    const drawnWidth = logo.transform.scaleX * logo.size.w;
    expect(logo.transform.x + drawnWidth / 2).toBeCloseTo(box.x + box.w / 2);
    expect(Math.abs(drawnWidth - box.w)).toBeLessThan(2);
  });

  it.each([PREFEITURA, AGENCIA])('keeps every line of “%s” inside its box', (titulo) => {
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

  it('never splits `(VA)` nor starts a line with it', () => {
    for (const line of linesOf(titleOf(render(PREFEITURA, format).frame))) {
      expect(line.startsWith('(')).toBe(false);
      expect(line).not.toMatch(/\([^)]*$/u);
    }
  });

  it.each([PREFEITURA, AGENCIA])('ends no line of “%s” on a function word', (titulo) => {
    const lines = linesOf(titleOf(render(titulo, format).frame));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(0, -1)) {
      const last = line.split(' ').at(-1)!.toLocaleLowerCase('pt-BR');
      expect(FUNCTION_WORDS.has(last), `“${line}”`).toBe(false);
    }
  });

  it('draws in ROXO’s accent, the state in bold, and nothing in italic', () => {
    const spans = titleOf(render(PREFEITURA, format).frame).runs.flatMap((run) =>
      run.kind === 'text' ? [run] : [],
    );

    for (const span of spans) {
      expect(span.color).toEqual({ kind: 'solid', color: expect.anything() });
      expect(span.style).toBe('normal');
    }
    expect(spans.find((span) => span.text.includes('(VA)'))?.weight).toBe(700);
    expect(spans.find((span) => span.text.includes('Prefeitura'))?.weight).toBe(400);
    expect(render(PREFEITURA, format).frame.children.length).toBe(3);
    const ink = spans[0]!.color;
    expect(ink.kind === 'solid' && ink.color).toEqual(solidOf(ROXO.accent));
  });

  it('draws a text too long for the floor at the floor, and says by how much it overflows', () => {
    const long = Array.from({ length: 6 }, () => AGENCIA.replaceAll('**', '')).join(' ');
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
      brand: noBrandKit,
    });
    const spans = titleOf(frame).runs.flatMap((run) => (run.kind === 'text' ? [run] : []));

    expect(spans.map((span) => span.text)).toEqual(['Prefeitura']);
    expect(spans[0]!.style).toBe('normal');
  });
});

describe('banner-roxo with nothing to measure', () => {
  it('still draws every word, in one block the layout fits into the box', () => {
    const node = titleOf(render(PREFEITURA, 'banner', measureNothing).frame);
    expect(node.overflow).toBe('shrink');
    expect(linesOf({ ...node, box: {} }).join(' ')).toBe(PREFEITURA.replaceAll('**', ''));
  });
});

/* -------------------------------------------------------------- with a brand kit -- */

/**
 * An invented kit (ADR 0066): a frame around a bar for a logo, two bars for a wordmark. Each
 * mark holds both tones, so a template that drew every layer in one colour would show here.
 */
const TONED_KIT: BrandKit = {
  logo: {
    box: { w: 10, h: 20 },
    layers: [
      { tone: 'secondary', d: 'M0 0H10V20H0Z M2 2V18H8V2Z', fillRule: 'evenodd' },
      { tone: 'primary', d: 'M3 6H7V16H3Z', fillRule: 'nonzero' },
    ],
  },
  wordmark: {
    box: { w: 100, h: 26 },
    layers: [
      { tone: 'primary', d: 'M0 0H100V20H0Z', fillRule: 'nonzero' },
      { tone: 'secondary', d: 'M0 22H40V26H0Z', fillRule: 'nonzero' },
    ],
  },
};

/** The two purples #301 measured on the backgrounds: the darker inside, the lighter around. */
const DARKER = solidOf('#4c30a6');
const LIGHTER = solidOf('#7560ef');

function nodeNamed(frame: Frame, name: string): SceneNode | undefined {
  return frame.children.find((child: SceneNode) => child.name === name);
}

/** A toned mark's layers as the scene holds them: each fill, and the box it is drawn in. */
function layersOf(node: SceneNode | undefined) {
  if (node?.kind !== 'group') throw new Error(`not a group: ${String(node?.kind)}`);
  return node.children.map((child) => {
    if (child.kind !== 'vector') throw new Error('a layer that is not a vector');
    return {
      fill: child.fill,
      x: node.transform.x,
      y: node.transform.y,
      w: child.size.w * child.transform.scaleX,
      h: child.size.h * child.transform.scaleY,
    };
  });
}

describe('banner-roxo with a kit whose marks have two tones (ADR 0066)', () => {
  it.each(Object.keys(SIZES))('draws the logo in %s in both purples, in its box', (format) => {
    const box = LAYOUTS[format]!.logo!;
    const layers = layersOf(
      nodeNamed(render(PREFEITURA, format, proportional, TONED_KIT).frame, 'logo'),
    );

    expect(layers.map((layer) => layer.fill)).toEqual([
      { kind: 'solid', color: LIGHTER },
      { kind: 'solid', color: DARKER },
    ]);
    for (const layer of layers) {
      expect(layer.h).toBeCloseTo(box.h);
      expect(layer.y).toBe(box.y);
      expect(layer.x + layer.w / 2).toBeCloseTo(box.x + box.w / 2);
    }
  });

  it('draws the wordmark in the square format, inside the box the painted-out one took', () => {
    const box = LAYOUTS['banner-1x1']!.wordmark!;
    const layers = layersOf(
      nodeNamed(render(PREFEITURA, 'banner-1x1', proportional, TONED_KIT).frame, 'wordmark'),
    );

    // The first line in the darker purple and the second in the lighter, as measured.
    expect(layers.map((layer) => layer.fill)).toEqual([
      { kind: 'solid', color: DARKER },
      { kind: 'solid', color: LIGHTER },
    ]);
    for (const layer of layers) {
      expect(layer.x).toBe(box.x);
      expect(layer.y).toBeGreaterThanOrEqual(box.y);
      expect(layer.y + layer.h).toBeLessThanOrEqual(box.y + box.h);
      expect(layer.w).toBeLessThanOrEqual(box.w);
      // As large as fits: this wordmark is a hair wider than the box, so the width decides.
      expect(layer.w).toBeCloseTo(box.w);
    }
  });

  it.each(['banner', 'banner-345x146'])(
    'draws no wordmark in %s, which has no room for one',
    (format) => {
      expect(
        nodeNamed(render(PREFEITURA, format, proportional, TONED_KIT).frame, 'wordmark'),
      ).toBeUndefined();
    },
  );

  it('draws no wordmark, and no stand-in for one, without a kit', () => {
    expect(nodeNamed(render(PREFEITURA, 'banner-1x1').frame, 'wordmark')).toBeUndefined();
  });

  it('draws a one-shape logo (ADR 0063) in the darker purple, as before marks had tones', () => {
    const shape = { box: { w: 10, h: 20 }, d: 'M0 0H10V20H0Z', fillRule: 'nonzero' } as const;
    const logo = nodeNamed(
      render(PREFEITURA, 'banner', proportional, { logo: shape }).frame,
      'logo',
    );

    expect(logo?.kind).toBe('vector');
    expect(logo?.kind === 'vector' && logo.fill).toEqual({ kind: 'solid', color: DARKER });
  });
});

/** `#5900a6` as the channels a solid paint carries. */
function solidOf(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, a: 1 };
}
