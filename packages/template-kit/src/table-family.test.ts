import { measureNothing } from '@tyto/core';
import { group, systemFont } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { block } from './blocks.js';
import { parameterValues } from './parameters.js';
import { rich } from './rich-text.fixture.js';
import { oldSlotTable } from './slot-table-before.fixture.js';
import {
  SLOT_TABLE_PARAMETERS,
  type SlotTableStyle,
  slotTable,
  slotTableIn,
} from './slot-table.js';
import { oldTable } from './table-before.fixture.js';
import {
  TABLE_PARAMETERS,
  type TableCell,
  type TableRow,
  type TableStyle,
  table,
  tableIn,
} from './table.js';

import type { Measure, TextStyle } from './text.js';
import type { TextMeasurement } from '@tyto/core';
import type { TextDraft } from '@tyto/core/template';

/*
 * TYTO-891, the table family: `table` and `slotTable` are wrappers over `tableIn` and
 * `slotTableIn` now, and must draw what they drew. The oracle is the older code itself,
 * `table.ts` and `slot-table.ts` copied whole from origin/main into the `*-before.fixture.ts`
 * files; a style's numbers given as parameters must draw what the same numbers written in the
 * style drew.
 */

/** A cell whose content is `height` tall at any width, and `natural` wide on one line. */
function cell(height: number, natural?: number): TableCell {
  return {
    draw: (width, rowHeight) =>
      block(width, rowHeight ?? height, group({ name: 'content', children: [] })),
    ...(natural === undefined ? {} : { naturalWidth: () => natural }),
  };
}

const BASE: TableStyle = {
  columns: [
    { name: 'left', width: 'fill', padding: { top: 10, bottom: 10, left: 20, right: 20 } },
    { name: 'mid', width: { measured: { min: 40 } }, valign: 'top', radius: [4, 0, 0, 4] },
    { name: 'right', width: 120.5, valign: 'bottom' },
  ],
  kinds: {
    plain: { zebra: ['#dddddd', null, '#eeeeee'], minHeight: 30 },
    highlight: { fill: ['#880000', undefined, '#008800'], name: 'destaque' },
  },
  columnGap: 2,
  rowGap: 2.5,
  minRowHeight: 40,
  names: { table: 'tabela', row: 'linha', band: 'faixa' },
};

/** A style that states no column gap, so the table reads its own default. */
function withoutColumnGap(style: TableStyle): TableStyle {
  const { columnGap: _columnGap, ...rest } = style;
  return rest;
}

const STYLES: readonly TableStyle[] = [
  BASE,
  { ...BASE, layering: 'overlap', corners: { radius: 12, at: 'every-cell' } },
  { ...withoutColumnGap(BASE), corners: { radius: 8.5, at: 'outer' } },
  { ...BASE, names: { row: 'linha' }, rowGap: 0, minRowHeight: 0 },
];

const ROWS: readonly (readonly TableRow[])[] = [
  [],
  [{ kind: 'plain', cells: [cell(20), cell(10, 55.5), cell(5)] }],
  [
    { kind: 'plain', cells: [cell(20), cell(10, 55.5), cell(5)] },
    { kind: 'highlight', cells: [cell(60), undefined, { ...cell(5), sizesRow: false }] },
    { kind: 'plain', cells: [cell(33.3)], span: true },
    { kind: 'unknown', cells: [cell(10), cell(10, 80), cell(10)] },
    { kind: 'plain', cells: [cell(1), cell(70, 12), cell(2)] },
  ],
];

describe('table draws what it drew', () => {
  it('the wrapper and tableIn with nothing given equal the older table', () => {
    let compared = 0;
    for (const style of STYLES) {
      for (const rows of ROWS) {
        for (const width of [600, 333.3]) {
          const before = oldTable(style, rows, width);
          expect(table(style, rows, width)).toEqual(before);
          const drawn = tableIn({ width, height: Infinity }, style, rows);
          expect({ width: drawn.width, height: drawn.height, draft: drawn.draft }).toEqual(before);
          compared += 1;
        }
      }
    }
    expect(compared).toBe(STYLES.length * ROWS.length * 2);
  });

  it('a style’s numbers given as parameters draw what they drew written in the style', () => {
    const rows = ROWS[2]!;
    const written: TableStyle = {
      ...BASE,
      columnGap: 7,
      rowGap: 3.25,
      minRowHeight: 44,
      layering: 'overlap',
      corners: { radius: 9, at: 'outer' },
    };
    const drawn = tableIn({ width: 600, height: Infinity }, BASE, rows, {
      columnGap: 7,
      rowGap: 3.25,
      minRowHeight: 44,
      layering: 'overlap',
      cornerRadius: 9,
      cornersAt: 'outer',
    });
    expect({ width: drawn.width, height: drawn.height, draft: drawn.draft }).toEqual(
      oldTable(written, rows, 600),
    );
  });

  it('reports how far it runs past a bounded area', () => {
    const rows = ROWS[2]!;
    const whole = oldTable(BASE, rows, 600).height;
    expect(tableIn({ width: 600, height: whole - 10 }, BASE, rows).overflow).toBeCloseTo(10, 10);
    expect(tableIn({ width: 600, height: whole }, BASE, rows).overflow).toBe(0);
  });
});

/* ------------------------------------------------------------------- the slot table -- */

const TEXT: TextStyle = { font: systemFont('Test'), size: 20, weight: 400, color: '#000000' };

const SLOT_BASE: SlotTableStyle = {
  layering: 'overlap',
  rowGap: 4,
  minRowHeight: 50,
  columns: [
    {
      kind: 'label',
      name: 'badge',
      width: 100,
      shape: { fill: '#0000ff', radius: 10 },
      text: { name: 'key', style: TEXT, align: 'center', valign: 'middle' },
    },
    {
      kind: 'lines',
      name: 'body',
      width: 'fill',
      shape: { fill: '#dddddd', radius: 10 },
      padding: { top: 10, bottom: 10, left: 20, right: 20 },
      lineGap: 4,
      lines: [
        { name: 'title', style: TEXT, minHeight: 30 },
        { name: 'byline', style: TEXT, minHeight: 20 },
      ],
    },
  ],
  names: { table: 'table', rows: 'rows', row: 'row' },
};

const SLOT_STYLES: readonly SlotTableStyle[] = [
  SLOT_BASE,
  { ...SLOT_BASE, layering: 'side-by-side', columnGap: 6.5, fit: { max: 420 } },
  {
    ...SLOT_BASE,
    groups: {
      heading: { name: 'heading', height: 40, style: TEXT, align: 'center' },
      headingGap: 8,
      gap: 16,
      caption: {
        name: 'caption',
        height: 30,
        shape: { fill: '#cccccc', radius: [6, 6, 0, 0] },
        text: { name: 'caption-text', style: TEXT },
        padding: { left: 10, right: 10 },
        gap: 3,
      },
    },
    names: { table: 'table', group: 'group', rows: 'rows', row: 'row' },
  },
];

const SOURCES = [
  '',
  'A | Primeira linha | autor',
  'A | Um | x\nB | Dois mais longo | y\n\nC | Três | z',
  '# Manhã\nfaixa da manhã\nA | Um | x\n# Tarde\nB | Dois | y',
];

/** A measure that answers: 10 px a character, wrapping at the box. */
function measures(node: TextDraft): TextMeasurement {
  const chars = node.runs.reduce(
    (sum, each) => sum + (each.kind === 'text' ? [...each.text].length : 0),
    0,
  );
  const box = node.box.w ?? Infinity;
  const lines = Math.max(1, Math.ceil((chars * 10) / box));
  return {
    runs: node.runs,
    lines,
    width: Math.min(chars * 10, box),
    height: lines * 24,
  } as unknown as TextMeasurement;
}

describe('slotTable draws what it drew', () => {
  it('the wrapper and slotTableIn with nothing given equal the older slot table', () => {
    let compared = 0;
    for (const style of SLOT_STYLES) {
      for (const source of SOURCES) {
        for (const measure of [measureNothing as Measure, measures]) {
          const content = { text: rich(source), width: 600, measure };
          const before = oldSlotTable(style, content);
          expect(slotTable(style, content)).toEqual(before);
          const drawn = slotTableIn({ width: 600, height: Infinity }, style, {
            text: content.text,
            measure,
          });
          expect({ width: drawn.width, height: drawn.height, draft: drawn.draft }).toEqual(before);
          compared += 1;
        }
      }
    }
    expect(compared).toBe(SLOT_STYLES.length * SOURCES.length * 2);
  });

  it('a style’s numbers given as parameters draw what they drew written in the style', () => {
    const content = { text: rich(SOURCES[2]!), width: 600, measure: measures };
    const written: SlotTableStyle = {
      ...SLOT_BASE,
      layering: 'side-by-side',
      columnGap: 5,
      rowGap: 7,
      minRowHeight: 61,
      fit: { max: 450 },
    };
    const drawn = slotTableIn(
      { width: 600, height: Infinity },
      SLOT_BASE,
      { text: content.text, measure: measures },
      { layering: 'side-by-side', columnGap: 5, rowGap: 7, minRowHeight: 61, fitMax: 450 },
    );
    expect({ width: drawn.width, height: drawn.height, draft: drawn.draft }).toEqual(
      oldSlotTable(written, content),
    );
  });
});

describe('the table schemas', () => {
  it('take the values a table reads when its style says nothing', () => {
    expect(parameterValues(TABLE_PARAMETERS)).toEqual({
      columnGap: 0,
      rowGap: 0,
      minRowHeight: 0,
      layering: 'side-by-side',
      cornerRadius: 0,
      cornersAt: 'every-cell',
    });
    expect(parameterValues(SLOT_TABLE_PARAMETERS)).toEqual({
      columnGap: 0,
      rowGap: 0,
      minRowHeight: 0,
      layering: 'side-by-side',
      fitMax: 0,
    });
  });
});
