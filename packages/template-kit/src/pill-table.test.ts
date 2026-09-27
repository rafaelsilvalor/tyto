import { measureNothing } from '@tyto/core';
import { systemFont } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import {
  type LabelColumn,
  type LinesColumn,
  type PillTableStyle,
  pillTable,
} from './pill-table.js';
import { rich } from './rich-text.fixture.js';

import type { GroupDraft, NodeDraft } from '@tyto/core/template';
import type { Measure, TextStyle } from './text.js';

/**
 * What the table is checked against: arithmetic and structure, as the rest of this package
 * is. Nothing renders; the pixels are proven by rendering `agenda-semana` against `main`
 * (TYTO-185), which is where a real face measures.
 */

const STYLE: TextStyle = { font: systemFont('Test'), size: 20, weight: 400, color: '#000000' };

const WIDTH = 600;

const lines: LinesColumn = {
  kind: 'lines',
  name: 'body',
  width: 'fill',
  shape: { fill: '#dddddd', radius: 10 },
  padding: { top: 10, bottom: 10, left: 20, right: 20 },
  lineGap: 4,
  lines: [
    { name: 'title', style: STYLE, minHeight: 30 },
    { name: 'byline', style: STYLE, minHeight: 20 },
  ],
};

const BASE: PillTableStyle = {
  layering: 'overlap',
  rowGap: 4,
  minRowHeight: 50,
  columns: [
    {
      kind: 'label',
      name: 'badge',
      width: 100,
      shape: { fill: '#0000ff', radius: 10 },
      text: { name: 'key', style: STYLE, align: 'center', valign: 'middle' },
    },
    lines,
  ],
  names: { table: 'table', rows: 'rows', row: 'row' },
};

const GROUPED: PillTableStyle = {
  ...BASE,
  groups: {
    heading: { name: 'heading', height: 40, style: STYLE },
    headingGap: 8,
    gap: 16,
  },
  names: { table: 'table', group: 'group', rows: 'rows', row: 'row' },
};

function walk(draft: NodeDraft): NodeDraft[] {
  return draft.kind === 'group' ? [draft, ...draft.children.flatMap(walk)] : [draft];
}

const named = (draft: NodeDraft, name: string) => walk(draft).filter((node) => node.name === name);

function childrenOf(draft: NodeDraft | undefined): readonly NodeDraft[] {
  expect(draft?.kind).toBe('group');
  return (draft as GroupDraft).children;
}

function draw(style: PillTableStyle, source: string, measure: Measure = measureNothing) {
  return pillTable(style, { text: rich(source), width: WIDTH, measure });
}

describe('overlap', () => {
  const table = draw(BASE, '1º | Ana | Turma A');
  const [row] = named(table.draft, 'row');

  it('paints the later cell first, so the earlier one covers its left end', () => {
    expect(childrenOf(row).map((node) => node.name)).toEqual(['body', 'badge']);
  });

  it('runs the later cell’s shape from the row’s left edge, and starts its words after the badge', () => {
    const [body] = named(table.draft, 'body');
    const [shape, words] = childrenOf(body);

    expect(body?.transform.x).toBe(0);
    expect(shape?.kind === 'rect' ? shape.size.w : undefined).toBe(WIDTH);
    expect(words?.transform.x).toBe(100 + 20);
  });

  it('keeps the badge its own width, and its words the whole cell', () => {
    const [badge] = named(table.draft, 'badge');
    const [shape, key] = childrenOf(badge);

    expect(shape?.kind === 'rect' ? shape.size : undefined).toEqual({ w: 100, h: 74 });
    expect(key?.kind === 'text' ? key.box : undefined).toEqual({ w: 100, h: 74 });
  });
});

describe('side-by-side', () => {
  const table = draw({ ...BASE, layering: 'side-by-side', columnGap: 12 }, '1º | Ana | Turma A');

  it('gives each cell its own slot, a gap apart, painted in order', () => {
    const [row] = named(table.draft, 'row');
    const [badge, body] = childrenOf(row);

    expect([badge?.name, body?.name]).toEqual(['badge', 'body']);
    expect(body?.transform.x).toBe(100 + 12);
    const [shape] = childrenOf(body);
    expect(shape?.kind === 'rect' ? shape.size.w : undefined).toBe(WIDTH - 100 - 12);
  });
});

describe('height', () => {
  it('is the lines plus their padding, when that beats the minimum', () => {
    // 30 + 4 + 20 lines, 10 above and below: 74, over the minimum of 50.
    expect(draw(BASE, 'a | b | c').height).toBe(74);
  });

  it('is the minimum, when the lines need less', () => {
    const short = { ...lines, lines: [lines.lines[0]!] };
    expect(draw({ ...BASE, columns: [BASE.columns[0]!, short] }, 'a | b').height).toBe(50);
  });

  it('grows with measured text, and the badge grows with it', () => {
    const tall: Measure = () => ({ height: 90, width: 100 }) as ReturnType<Measure>;
    const table = draw(BASE, 'a | a very long title | c', tall);
    const [badge] = named(table.draft, 'badge');
    const [shape] = childrenOf(badge);

    // 90 + 4 + 90, 10 above and below.
    expect(table.height).toBe(204);
    expect(shape?.kind === 'rect' ? shape.size.h : undefined).toBe(204);
  });

  it('stacks rows a gap apart', () => {
    const table = draw(BASE, 'a | b | c\nd | e | f');
    const rows = named(table.draft, 'row');

    expect(rows.map((node) => node.transform.y)).toEqual([0, 74 + 4]);
    expect(table.height).toBe(74 * 2 + 4);
  });
});

describe('an empty field', () => {
  it('draws no text node and moves nothing', () => {
    const table = draw(BASE, '1º | Ana');

    expect(named(table.draft, 'byline')).toEqual([]);
    expect(named(table.draft, 'title')).toHaveLength(1);
    expect(table.height).toBe(74);
  });
});

describe('groups', () => {
  it('draws a heading over each group’s rows', () => {
    const table = draw(GROUPED, 'A\na | b | c\nB\nd | e | f\ng | h | i');

    expect(named(table.draft, 'group')).toHaveLength(2);
    expect(named(table.draft, 'heading')).toHaveLength(2);
    expect(named(table.draft, 'rows').map((node) => named(node, 'row').length)).toEqual([1, 2]);
  });

  it('adds the heading, its gap and the gap between groups to the height', () => {
    const table = draw(GROUPED, 'A\na | b | c\nB\nd | e | f');

    // Each group: 40 heading + 8 + 74 row = 122; two of them 16 apart.
    expect(table.height).toBe(122 * 2 + 16);
  });

  it('keeps the heading’s room for rows written before any heading, and draws no text there', () => {
    const table = draw(GROUPED, 'a | b | c');

    expect(named(table.draft, 'heading')).toEqual([]);
    expect(table.height).toBe(40 + 8 + 74);
  });

  it('reads a line with no separator as a row when the style has no groups', () => {
    const table = draw(BASE, 'A\na | b | c');

    expect(named(table.draft, 'row')).toHaveLength(2);
    expect(named(table.draft, 'heading')).toEqual([]);
  });
});

describe('rewrite', () => {
  const suffixed: PillTableStyle = {
    ...BASE,
    columns: [
      {
        ...(BASE.columns[0] as LabelColumn),
        text: {
          ...(BASE.columns[0] as LabelColumn).text,
          rewrite: (value) => [...value, { kind: 'text', value: '!', range: { start: 0, end: 0 } }],
        },
      },
      lines,
    ],
  };

  it('turns what the brief wrote into what the cell draws', () => {
    const [key] = named(draw(suffixed, '1º | Ana').draft, 'key');
    expect(
      key?.kind === 'text'
        ? key.runs.map((run) => (run.kind === 'text' ? run.text : '')).join('')
        : '',
    ).toBe('1º!');
  });

  it('is not asked about an empty field, so it cannot make one draw', () => {
    expect(named(draw(suffixed, ' | Ana').draft, 'key')).toEqual([]);
  });
});

describe('fit', () => {
  // 10 px a character, one line: widths are counted rather than rendered.
  const tenPerCharacter: Measure = (node) =>
    ({
      runs: node.runs,
      lines: 1,
      width:
        node.runs.reduce((sum, run) => sum + (run.kind === 'text' ? run.text.length : 0), 0) * 10,
      height: 20,
      scale: 1,
      overflow: 0,
    }) as ReturnType<Measure>;

  const FIT: PillTableStyle = { ...GROUPED, fit: { max: 400 } };

  it('gives every row of a group the width of its widest row, and each group its own', () => {
    const table = draw(
      FIT,
      'A\na | 1234567890 | x\nb | 12345 | y\nB\nc | 123 | z',
      tenPerCharacter,
    );
    const [first, second] = named(table.draft, 'rows');

    // Badge 100, padding 20 either side, and the widest line: 100 px, then 30 px.
    expect(
      childrenOf(first).map((row) => (row.kind === 'group' ? row.children.length : 0)),
    ).toEqual([2, 2]);
    expect(first?.transform.x).toBe((WIDTH - 240) / 2);
    expect(second?.transform.x).toBe((WIDTH - 170) / 2);
  });

  it('stops at the maximum, where the words wrap instead', () => {
    const table = draw(FIT, 'A\na | ' + 'x'.repeat(80) + ' | y', tenPerCharacter);
    const [rows] = named(table.draft, 'rows');

    expect(rows?.transform.x).toBe((WIDTH - 400) / 2);
  });

  it('draws every row at the maximum when nothing can measure', () => {
    const [rows] = named(draw(FIT, 'A\na | b | c').draft, 'rows');

    expect(rows?.transform.x).toBe((WIDTH - 400) / 2);
  });
});
