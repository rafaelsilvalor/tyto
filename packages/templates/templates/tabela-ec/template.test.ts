import { measureNothing, noFiles } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { build } from './template.js';
import { EC } from '../_estrategia/brands.js';
import { NO_BREAK_SPACE } from '../_estrategia/table-text.js';
import { BODY, HANDLE, PAGE } from '../_estrategia/table-tokens.js';

import type {
  Frame,
  Inline,
  RichText,
  SceneNode,
  TemplateContext,
  TemplateReport,
  TextNode,
} from '@tyto/core';

/**
 * The rules of the one-image table (TYTO-218), asserted on the scene.
 *
 * **Never a pixel size.** CI has no CircularXX and draws a narrower substitute, so the fit
 * loop lands on a different size there than on a designer's machine; what must hold on both
 * is the rules — every cell's words inside its cell, no value split across lines, the
 * salary column wider than the vacancies one, the table above the handle. So the measure
 * here is a stand-in with proportional advances that **wraps at spaces only**, as Tyto's
 * own layout does, and the same stand-in re-lays every cell of the result to check it.
 */

/* ---------------------------------------------------------------------- the fixture -- */

let cursor = 0;

function rich(source: string): RichText {
  const parts: Inline[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) parts.push({ kind: 'break', range: { start: cursor, end: cursor++ } });
    const start = cursor;
    cursor += line.length;
    parts.push({ kind: 'text', value: line, range: { start, end: cursor } });
  }
  return parts;
}

/** A glyph's advance, in em: wide enough that real tables wrap, as they do in the art. */
const ADVANCE = 0.55;

/** The lines a text node comes out in, broken at plain spaces only, as `layout.ts` breaks. */
function layOut(node: Pick<TextNode, 'runs' | 'box' | 'letterSpacing'>): string[] {
  const size = Math.max(...node.runs.map((r) => (r.kind === 'text' ? r.size : 0)));
  const widthOf = (words: string) => [...words].length * (ADVANCE * size + node.letterSpacing);
  const paragraphs = node.runs
    .map((r) => (r.kind === 'text' ? r.text : '\n'))
    .join('')
    .split('\n');

  const result: string[] = [];
  for (const paragraph of paragraphs) {
    let line = '';
    for (const word of paragraph.split(' ').filter((piece) => piece !== '')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (line !== '' && node.box.w !== undefined && widthOf(candidate) > node.box.w) {
        result.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    result.push(line);
  }
  return result;
}

const proportional: TemplateContext['measure'] = (node) => {
  const lines = layOut(node);
  const size = Math.max(...node.runs.map((r) => (r.kind === 'text' ? r.size : 0)));
  const width = Math.max(
    ...lines.map((line) => [...line].length * (ADVANCE * size + node.letterSpacing)),
  );
  return {
    runs: node.runs,
    lines: lines.length,
    width,
    height: lines.length * node.lineHeight * size,
    scale: 1,
    overflow: 0,
  };
};

const MCA_66477 = {
  titulo: 'Top 10 editais previstos para outubro!',
  tabela: [
    'Concurso | Banca | Vagas | Salário',
    'Polícia Penal PE | Cebraspe | 700 | R$ 5.100,00',
    'PC PE | Cebraspe | 1.315 | R$ 5.667,92 a R$ 13.560,00',
    'TRT 8 (AP/PA) | FCC | CR | R$ 9.776,74 a R$ 18.380,18',
    'TRF3 (SP/MS) | Vunesp | - | R$ 9.776,74 a R$ 16.041,21',
    'DPE AM | FCC | 5 + CR | R$ 4.713,02 a R$ 8.006,38',
    'Sefaz BA | Cesgranrio | 200 + CR | R$ 24.102,21 a R$ 33.820,39 (bruto)',
    'Sefaz RS | FCC | - | R$ 17.687,12 e R$ 39.877,31',
    'Sefaz SP | FCC | 60 | R$ 7.349,47',
    'CGU | Cebraspe | 60 | R$ 20.000,00',
    'Câmara dos Deputados | Cebraspe | 150 | R$ 32.070,88',
  ].join('\n'),
};

const MCA_66480 = {
  titulo: '10 concursos previstos para SP ainda em 2026!',
  tabela: [
    'Concurso | Situação | Vagas',
    'TRF3 | Banca definida (Vunesp) | -',
    'Coren SP | Banca definida (Quadrix) | 76 + CR',
    'Sefaz SP (Analista) | Banca definida (FCC) | 60',
    'SP Águas | Banca definida (FGV) | 190',
    'IPA SP | Banca definida (Vunesp) | 98',
    'CDHU | Banca definida (Vunesp) | 388',
    'SEE SP | Banca definida (FGV) | 5 mil',
    'TJ SP | Em estudos | -',
    'Cetesb | Comissão formada | 107 + CR',
    'SP Regula | Grupo de Trabalho Formado | -',
  ].join('\n'),
};

/** MCA-66477's table three times over: 30 rows. */
const THIRTY_ROWS = {
  titulo: MCA_66477.titulo,
  tabela: [
    'Concurso | Banca | Vagas | Salário',
    ...Array.from({ length: 3 }, () => MCA_66477.tabela.split('\n').slice(1)).flat(),
  ].join('\n'),
};

interface Built {
  readonly frame: Frame;
  readonly reports: TemplateReport[];
}

function render(
  brief: { titulo: string; tabela: string },
  measure: TemplateContext['measure'] = proportional,
): Built {
  const reports: TemplateReport[] = [];
  const frame = build({
    format: 'grid',
    size: { w: 1080, h: 1350 },
    idPrefix: 'artwork-0-grid',
    artwork: { id: 'artwork-0', index: 0, count: 1 },
    slots: {
      titulo: {
        name: 'titulo',
        value: { kind: 'rich-text', text: rich(brief.titulo) },
        adjustments: [],
      },
      tabela: {
        name: 'tabela',
        value: { kind: 'rich-text', text: rich(brief.tabela) },
        adjustments: [],
      },
    },
    adjustments: {},
    measure,
    report: (report) => reports.push(report),
    files: noFiles,
  });
  return { frame, reports };
}

/* ------------------------------------------------------------------ reading a scene -- */

interface Placed {
  readonly node: SceneNode;
  readonly x: number;
  readonly y: number;
  /** The names of the groups it sits in, outermost first. */
  readonly path: readonly string[];
}

/** Every node with its position in the frame. Only groups move their children here. */
function placed(frame: Frame): Placed[] {
  const result: Placed[] = [];
  const walk = (nodes: readonly SceneNode[], x: number, y: number, path: readonly string[]) => {
    for (const node of nodes) {
      const nx = x + node.transform.x;
      const ny = y + node.transform.y;
      result.push({ node, x: nx, y: ny, path });
      if (node.kind === 'group') walk(node.children, nx, ny, [...path, node.name ?? '']);
    }
  };
  walk(frame.children, 0, 0, []);
  return result;
}

/** Each row group's cells: a rect (when filled) and its text, paired by column. */
function rows(frame: Frame): { name: string; rects: Placed[]; texts: Placed[] }[] {
  return placed(frame).flatMap((row) => {
    if (row.node.kind !== 'group' || !/-row$/u.test(row.node.name ?? '')) return [];
    const children = row.node.children.map((node) => ({
      node,
      x: row.x + node.transform.x,
      y: row.y + node.transform.y,
      path: [...row.path, row.node.name ?? ''],
    }));
    return [
      {
        name: row.node.name ?? '',
        rects: children.filter((item) => item.node.name === 'cell'),
        texts: children.filter((item) => item.node.name === 'cell-text'),
      },
    ];
  });
}

const textOf = (node: SceneNode): string =>
  node.kind === 'text' ? node.runs.map((r) => (r.kind === 'text' ? r.text : '\n')).join('') : '';

const bodySize = (frame: Frame): number => {
  const cell = placed(frame).find((item) => item.node.name === 'cell-text');
  const span =
    cell?.node.kind === 'text' ? cell.node.runs.find((r) => r.kind === 'text') : undefined;
  return span?.kind === 'text' ? span.size : Number.NaN;
};

/* ------------------------------------------------------------------------ the rules -- */

describe.each([
  ['MCA-66477', MCA_66477],
  ['MCA-66480', MCA_66480],
])('%s', (_, brief) => {
  const { frame, reports } = render(brief);

  it('fits in one image: nothing reported, and the table ends above the handle', () => {
    expect(reports).toEqual([]);
    const table = placed(frame).find((item) => item.node.name === 'table')!;
    const bottom = Math.max(
      ...placed(frame)
        .filter((item) => item.path.includes('table') && item.node.kind === 'text')
        .map((item) => item.y + (item.node.kind === 'text' ? (item.node.box.h ?? 0) : 0)),
    );
    expect(table).toBeDefined();
    expect(bottom).toBeLessThanOrEqual(1350 - PAGE.bottom - HANDLE.height);
  });

  it('keeps every cell’s words inside the cell, wrapped to fit its box', () => {
    for (const row of rows(frame)) {
      for (const [column, item] of row.texts.entries()) {
        const node = item.node as TextNode;
        const box = { w: node.box.w!, h: node.box.h! };
        const measured = proportional(node)!;

        expect(measured.width, `${row.name} ${textOf(node)}`).toBeLessThanOrEqual(box.w + 0.01);
        expect(measured.height, `${row.name} ${textOf(node)}`).toBeLessThanOrEqual(box.h + 0.01);

        const cell = row.rects[column];
        if (cell !== undefined && cell.node.kind === 'rect') {
          expect(item.x).toBeGreaterThanOrEqual(cell.x);
          expect(item.y).toBeGreaterThanOrEqual(cell.y);
          expect(item.x + box.w).toBeLessThanOrEqual(cell.x + cell.node.size.w + 0.01);
          expect(item.y + box.h).toBeLessThanOrEqual(cell.y + cell.node.size.h + 0.01);
        }
      }
    }
  });

  it('never splits a number or a currency value across lines', () => {
    const value = /(?:R\$\s)?\d[\d.,]*(?:\s(?:mil|%))?/gu;
    for (const item of placed(frame)) {
      if (item.node.name !== 'cell-text' || item.node.kind !== 'text') continue;
      const lines = layOut(item.node).map((line) => line.replaceAll(NO_BREAK_SPACE, ' '));
      const words = textOf(item.node).replaceAll(NO_BREAK_SPACE, ' ');
      for (const [match] of words.matchAll(value)) {
        expect(
          lines.some((line) => line.includes(match)),
          `'${match}' split across ${JSON.stringify(lines)}`,
        ).toBe(true);
      }
    }
  });

  it('leaves no breakable space inside a value, at any width the cell is ever given', () => {
    // The layout breaks at U+0020 only, so a value holding none cannot be split by any
    // width — the claim the line check above can only sample at the widths this fit chose.
    const value = /(?:R\$[ \u00a0])?\d[\d.,]*(?:[ \u00a0](?:mil|%|\+[ \u00a0]CR))?/gu;
    for (const item of placed(frame)) {
      if (item.node.name !== 'cell-text') continue;
      for (const [match] of textOf(item.node).matchAll(value)) {
        expect(match, `'${match}' can break`).not.toContain(' ');
      }
    }
  });
});

describe('the brand', () => {
  it('draws the header in EC’s registered accent, the one the mock-exam agenda draws', () => {
    const header = rows(render(MCA_66477).frame).find((row) => row.name === 'header-row')!;
    for (const cell of header.rects) {
      expect(cell.node.kind === 'rect' && cell.node.fill).toEqual({
        kind: 'solid',
        color: { r: 0x59, g: 0x00, b: 0xa6, a: 1 },
      });
    }
    expect(EC.accent).toBe('#5900a6');
  });
});

describe('column widths come from the content', () => {
  it('gives MCA-66477’s Salário more room than its Vagas', () => {
    const header = rows(render(MCA_66477).frame).find((row) => row.name === 'header-row')!;
    const widths = header.rects.map((item) => (item.node.kind === 'rect' ? item.node.size.w : 0));

    expect(widths[3]).toBeGreaterThan(widths[2]!);
  });

  it('when a salary range wraps, breaks it into its two values, the connector closing line one', () => {
    const { frame } = render(MCA_66477);
    const cell = placed(frame).find(
      (item) => item.node.name === 'cell-text' && textOf(item.node).startsWith('R$\u00a05.667'),
    )!.node as TextNode;
    // Whatever width the fit loop gave it, a narrower box must still break only there.
    const narrow = { ...cell, box: { ...cell.box, w: cell.box.w! / 2 } };
    const lines = layOut(narrow).map((line) => line.replaceAll(NO_BREAK_SPACE, ' '));

    expect(lines).toEqual(['R$ 5.667,92 a', 'R$ 13.560,00']);
  });
});

describe('a table too long for one image', () => {
  it('draws 30 rows at the readable floor and reports how far past the room they run', () => {
    const { frame, reports } = render(THIRTY_ROWS);

    expect(bodySize(frame)).toBe(BODY.floor);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.code).toBe('W_TEMPLATE_OVERFLOW');
    expect(reports[0]!.overflow).toBeGreaterThan(0);
  });

  it('fits MCA-66477 above the floor, so the floor is a floor and not the answer', () => {
    expect(bodySize(render(MCA_66477).frame)).toBeGreaterThan(BODY.floor);
  });
});

describe('with nothing to measure', () => {
  it('still draws every cell, in equal columns, shrinking into its box', () => {
    const { frame } = render(MCA_66477, measureNothing);
    const texts = placed(frame).filter((item) => item.node.name === 'cell-text');

    expect(texts).toHaveLength(4 + 10 * 4);
    for (const item of texts) expect((item.node as TextNode).overflow).toBe('shrink');
  });
});
