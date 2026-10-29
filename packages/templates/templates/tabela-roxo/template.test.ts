import { measureNothing, noBrandKit, noFiles, parseManifest, resolveValues } from '@tyto/core';
import { solid } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import manifestYaml from './manifest.yaml?raw';
import { build } from './template.js';
import { NO_BREAK_SPACE, ROXO, TABLE_VALUE_DEFAULTS } from '@tyto/house-style';
import { BODY, OPTICAL_DROP, SIGNATURE, PAGE, TITLE } from '@tyto/house-style/table-tokens';

import type {
  Frame,
  Inline,
  RichText,
  SceneNode,
  TemplateContext,
  TemplateReport,
  TemplateValues,
  TextNode,
} from '@tyto/core';

/**
 * The rules of the one-image table (TYTO-218), asserted on the scene.
 *
 * **Never a pixel size.** CI has no CircularXX and draws a narrower substitute, so the fit
 * loop lands on a different size there than on a designer's machine; what must hold on both
 * is the rules — every cell's words inside its cell, no value split across lines, the
 * salary column wider than the vacancies one, the table above the signature. So the measure
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

const FOUR_COLUMNS = {
  titulo: 'Top 10 editais previstos para novembro!',
  tabela: [
    'Concurso | Banca | Vagas | Salário',
    'Guarda Fluvial VX | Alfabeta | 700 | R$ 5.100,00',
    'GM VR | Alfabeta | 1.315 | R$ 5.667,92 a R$ 13.560,00',
    'TRX 4 (QA/QB) | BXT | CR | R$ 9.776,74 a R$ 18.380,18',
    'TRZ2 (QC/QD) | Ômegas | - | R$ 9.776,74 a R$ 16.041,21',
    'DFR XA | BXT | 5 + CR | R$ 4.713,02 a R$ 8.006,38',
    'Fazex QA | Lumenprova | 200 + CR | R$ 24.102,21 a R$ 33.820,39 (bruto)',
    'Fazex QB | BXT | - | R$ 17.687,12 e R$ 39.877,31',
    'Fazex QC | BXT | 60 | R$ 7.349,47',
    'CVX | Alfabeta | 60 | R$ 20.000,00',
    'Conselho das Marinhas | Alfabeta | 150 | R$ 32.070,88',
  ].join('\n'),
};

const THREE_COLUMNS = {
  titulo: '10 concursos previstos para QC ainda em 2026!',
  tabela: [
    'Concurso | Situação | Vagas',
    'TRZ2 | Banca definida (Ômegas) | -',
    'Corex QC | Banca definida (Quintex) | 76 + CR',
    'Fazex QC (Analista) | Banca definida (BXT) | 60',
    'QC Águas | Banca definida (BLM) | 190',
    'IPX QC | Banca definida (Ômegas) | 98',
    'CDVX | Banca definida (Ômegas) | 388',
    'SEQ QC | Banca definida (BLM) | 5 mil',
    'TX QC | Em estudos | -',
    'Cetrix | Comissão formada | 107 + CR',
    'QC Regula | Grupo de Trabalho Formado | -',
  ].join('\n'),
};

/** The four-column table three times over: 30 rows. */
const THIRTY_ROWS = {
  titulo: FOUR_COLUMNS.titulo,
  tabela: [
    'Concurso | Banca | Vagas | Salário',
    ...Array.from({ length: 3 }, () => FOUR_COLUMNS.tabela.split('\n').slice(1)).flat(),
  ].join('\n'),
};

interface Built {
  readonly frame: Frame;
  readonly reports: TemplateReport[];
}

function render(
  brief: { titulo: string; tabela: string },
  measure: TemplateContext['measure'] = proportional,
  values?: TemplateValues,
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
    brand: noBrandKit,
    ...(values === undefined ? {} : { values }),
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

/** From the title's foot to the table's top, in px. */
const gapUnderTitle = (frame: Frame): number => {
  const title = placed(frame).find((item) => item.node.name === 'title')!;
  const table = placed(frame).find((item) => item.node.name === 'table')!;
  const titleHeight = title.node.kind === 'text' ? (title.node.box.h ?? 0) : Number.NaN;
  return table.y - (title.y + titleHeight);
};

/* ------------------------------------------------------------------------ the rules -- */

describe.each([
  ['four columns', FOUR_COLUMNS],
  ['three columns', THREE_COLUMNS],
])('%s', (_, brief) => {
  const { frame, reports } = render(brief);

  it('fits in one image: nothing reported, and the table ends above the signature', () => {
    expect(reports).toEqual([]);
    const table = placed(frame).find((item) => item.node.name === 'table')!;
    const bottom = Math.max(
      ...placed(frame)
        .filter((item) => item.path.includes('table') && item.node.kind === 'text')
        .map((item) => item.y + (item.node.kind === 'text' ? (item.node.box.h ?? 0) : 0)),
    );
    expect(table).toBeDefined();
    expect(bottom).toBeLessThanOrEqual(1350 - PAGE.bottom - SIGNATURE.height);
  });

  it('sets the table a fixed gap under the title', () => {
    expect(gapUnderTitle(frame)).toBeCloseTo(TITLE.gap, 6);
  });

  it('centres every cell’s words by eye: the drop below the cell’s centre, never outside it', () => {
    const size = bodySize(frame);
    for (const row of rows(frame)) {
      for (const [column, item] of row.texts.entries()) {
        const cell = row.rects[column] ?? row.rects[0];
        if (cell === undefined || cell.node.kind !== 'rect') continue;
        const box = (item.node as TextNode).box;
        const textCentre = item.y + box.h! / 2;
        const cellCentre = cell.y + cell.node.size.h / 2;
        expect(textCentre - cellCentre, row.name).toBeCloseTo(OPTICAL_DROP * size, 6);
      }
    }
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
  it('draws the header in ROXO’s registered accent, the one the mock-exam agenda draws', () => {
    const header = rows(render(FOUR_COLUMNS).frame).find((row) => row.name === 'header-row')!;
    for (const cell of header.rects) {
      expect(cell.node.kind === 'rect' && cell.node.fill).toEqual({
        kind: 'solid',
        color: { r: 0x59, g: 0x00, b: 0xa6, a: 1 },
      });
    }
    expect(ROXO.accent).toBe('#5900a6');
  });
});

describe('column widths come from the content', () => {
  it('gives the four-column table’s Salário more room than its Vagas', () => {
    const header = rows(render(FOUR_COLUMNS).frame).find((row) => row.name === 'header-row')!;
    const widths = header.rects.map((item) => (item.node.kind === 'rect' ? item.node.size.w : 0));

    expect(widths[3]).toBeGreaterThan(widths[2]!);
  });

  it('when a salary range wraps, breaks it into its two values, the connector closing line one', () => {
    const { frame } = render(FOUR_COLUMNS);
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

  it('fits the four-column table above the floor, so the floor is a floor and not the answer', () => {
    expect(bodySize(render(FOUR_COLUMNS).frame)).toBeGreaterThan(BODY.floor);
  });
});

describe('a short table, which fits by its width and leaves room below', () => {
  const FOUR_ROWS = {
    titulo: 'Top 4 editais abertos para ganhar até 32 mil por mês!',
    tabela: [
      'Concurso | Salário | Vagas | Inscrições até',
      'Conselho das Marinhas | R$ 32.070,88 | 66 + 118 CR | 17/11',
      'GM VR | Até R$ 31.439,06 | 396 | 23/10',
      'Fazex QA | R$ 25.270,68 | 40 + 60 CR | 21/10',
      'CVX | R$ 20.000,00 | 60 + CR | 04/11',
    ].join('\n'),
  };

  it('keeps the table the same fixed gap under the title, and leaves the room to the foot', () => {
    const { frame } = render(FOUR_ROWS);
    const table = placed(frame).find((item) => item.node.name === 'table')!;
    const tableHeight = Math.max(
      ...placed(frame)
        .filter((item) => item.path.includes('table') && item.node.kind === 'text')
        .map((item) => item.y + (item.node.kind === 'text' ? (item.node.box.h ?? 0) : 0)),
    );

    expect(gapUnderTitle(frame)).toBeCloseTo(TITLE.gap, 6);
    // The case this guards: centring the table here put half the room above it.
    expect(1350 - PAGE.bottom - SIGNATURE.height - tableHeight).toBeGreaterThan(TITLE.gap);
    expect(table).toBeDefined();
  });
});

describe('with nothing to measure', () => {
  it('still draws every cell, in equal columns, shrinking into its box', () => {
    const { frame } = render(FOUR_COLUMNS, measureNothing);
    const texts = placed(frame).filter((item) => item.node.name === 'cell-text');

    expect(texts).toHaveLength(4 + 10 * 4);
    for (const item of texts) expect((item.node as TextNode).overflow).toBe('shrink');
  });
});

/* ------------------------------------------------------------- declared values -- */

function valueOf<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error, undefined, 2));
  return result.value;
}

/**
 * What a configuration may change (TYTO-438, ADR 0153): every value the manifest declares,
 * set one at a time and found in the scene. Nothing reads a plugin file yet (TYTO-439), so
 * the values are set here as `compile` would hand them over, resolved.
 */
describe('declared values', () => {
  const manifest = valueOf(parseManifest(manifestYaml, 'tabela-roxo/manifest.yaml'));
  const withValues = (values: TemplateValues) => render(FOUR_COLUMNS, proportional, values).frame;

  it('declares the table’s defaults, each equal to the token it replaced', () => {
    const defaults = Object.fromEntries(
      Object.entries(manifest.values ?? {}).map(([name, declared]) => [name, declared.default]),
    );
    expect(defaults).toEqual(TABLE_VALUE_DEFAULTS);
  });

  it('draws the same scene with its declared defaults as with no values at all', () => {
    const declared = resolveValues(manifest, undefined, noFiles);
    expect(declared.diagnostics).toEqual([]);
    expect(withValues(declared.values)).toEqual(render(FOUR_COLUMNS).frame);
  });

  it('sets the gap under the title', () => {
    expect(gapUnderTitle(withValues({ 'title-gap': 57 }))).toBeCloseTo(57, 6);
  });

  it('sets the title between its floor and its ceiling', () => {
    const titleSize = (frame: Frame) => {
      const title = placed(frame).find((item) => item.node.name === 'title')!.node;
      const span = title.kind === 'text' ? title.runs.find((r) => r.kind === 'text') : undefined;
      return span?.kind === 'text' ? span.size : Number.NaN;
    };
    expect(titleSize(withValues({ 'title-floor': 70, 'title-ceiling': 70 }))).toBe(70);
    const capped = titleSize(withValues({ 'title-ceiling': 41 }));
    expect(capped).toBeLessThanOrEqual(41);
    expect(capped).toBeLessThan(titleSize(render(FOUR_COLUMNS).frame));
  });

  it('sets the body between its floor and its ceiling', () => {
    expect(bodySize(withValues({ 'body-floor': 20, 'body-ceiling': 20 }))).toBe(20);
    expect(bodySize(withValues({ 'body-ceiling': 18 }))).toBeLessThanOrEqual(18);
  });

  it('lowers a cell’s words by the configured optical drop', () => {
    const frame = withValues({ 'optical-drop': 0.3 });
    const size = bodySize(frame);
    const header = rows(frame).find((row) => row.name === 'header-row')!;
    const cell = header.rects[0]!;
    const words = header.texts[0]!;
    const textCentre = words.y + (words.node as TextNode).box.h! / 2;
    const cellCentre = cell.y + (cell.node.kind === 'rect' ? cell.node.size.h : 0) / 2;
    expect(textCentre - cellCentre).toBeCloseTo(0.3 * size, 6);
  });

  it.each([
    ['paper', (frame: Frame) => frame.background],
    [
      'zebra',
      (frame: Frame) => {
        const first = rows(frame).find((row) => row.name === 'body-row')!.rects[0]!.node;
        return first.kind === 'rect' ? first.fill : undefined;
      },
    ],
  ])('paints %s in the configured colour', (name, paintOf) => {
    expect(paintOf(withValues({ [name]: '#123456' }))).toEqual(solid('#123456'));
  });

  it.each([
    ['ink', 'body-row', 'cell-text'],
    ['on-accent', 'header-row', 'cell-text'],
    ['signature-ink', 'sign-off', 'signature'],
  ])('sets %s on the words of %s', (name, group, node) => {
    const frame = withValues({ [name]: '#123456' });
    const found = placed(frame).find(
      (item) => item.path.at(-1) === group && item.node.name === node,
    )!.node;
    const span = found.kind === 'text' ? found.runs.find((r) => r.kind === 'text') : undefined;
    expect(span?.kind === 'text' && span.color).toEqual(solid('#123456'));
  });

  it('refuses a value outside its limits at the range it was written, and keeps the default', () => {
    const range = { start: 3, end: 9 };
    const resolved = resolveValues(manifest, { 'title-gap': { value: '400px', range } }, noFiles);
    expect(resolved.values['title-gap']).toBe(20);
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({
        code: 'W_TEMPLATE_VALUE_INVALID',
        severity: 'warning',
        range,
        message: expect.stringContaining('above its maximum of 120px'),
      }),
    ]);
  });
});
