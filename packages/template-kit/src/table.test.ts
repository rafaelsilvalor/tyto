import { group } from '@tyto/core/template';
import { describe, expect, it } from 'vitest';

import { type Block, block } from './blocks.js';
import { type TableCell, type TableRow, type TableStyle, table } from './table.js';

import type { NodeDraft } from '@tyto/core/template';

/**
 * The generic table (TYTO-859), asserted on the drafts: where each cell sits, how tall each
 * row is, and which fill and corners each cell's shape carries. The cells' content is a
 * stand-in block of a stated size, because the table never draws words.
 */

const WIDTH = 600;

/** A cell whose content is `height` tall at any width, and `natural` wide on one line. */
function cell(height: number, natural?: number): TableCell {
  return {
    draw: (width) => block(width, height, group({ name: 'content', children: [] })),
    ...(natural === undefined ? {} : { naturalWidth: () => natural }),
  };
}

const PLAIN: TableStyle = {
  columns: [
    { name: 'left', width: 'fill', padding: { top: 10, bottom: 10, left: 20, right: 20 } },
    { name: 'right', width: 200 },
  ],
  kinds: {
    plain: { zebra: ['#dddddd', '#eeeeee'] },
    highlight: { fill: '#880000' },
  },
  columnGap: 2,
  rowGap: 2,
  minRowHeight: 40,
  names: { table: 'table', row: 'row' },
};

const plain = (...cells: TableCell[]): TableRow => ({ kind: 'plain', cells });
const highlight = (...cells: TableCell[]): TableRow => ({ kind: 'highlight', cells });

type Draft = NodeDraft & {
  readonly name?: string;
  readonly kind?: string;
  readonly children?: readonly Draft[];
  readonly transform?: { readonly x?: number; readonly y?: number };
  readonly size?: { readonly w: number; readonly h: number };
  readonly radius?: unknown;
  readonly fill?: { readonly color?: { r: number; g: number; b: number } };
};

/** Every node named `name`, depth first. */
function named(draft: NodeDraft, name: string): Draft[] {
  const found: Draft[] = [];
  const walk = (node: Draft) => {
    if (node.name === name) found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(draft as Draft);
  return found;
}

/** The first rect under a node: a cell's shape. */
function shapeOf(node: Draft): Draft | undefined {
  if (node.kind === 'rect') return node;
  for (const child of node.children ?? []) {
    const found = shapeOf(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** A cell's fill as hex, or nothing when the cell has no shape. */
function hexOf(node: Draft): string | undefined {
  const color = shapeOf(node)?.fill?.color;
  if (color === undefined) return undefined;
  return `#${[color.r, color.g, color.b].map((each) => each.toString(16).padStart(2, '0')).join('')}`;
}

const fillsOf = (drawn: Block, name: string) => named(drawn.draft, name).map(hexOf);

describe('columns', () => {
  it('gives the fill column what the fixed one and the gap leave', () => {
    const drawn = table(PLAIN, [plain(cell(20), cell(20))], WIDTH);
    const [left] = named(drawn.draft, 'left');
    const [right] = named(drawn.draft, 'right');

    expect(shapeOf(left!)?.size?.w).toBe(WIDTH - 200 - 2);
    expect(shapeOf(right!)?.size?.w).toBe(200);
    expect(right!.transform?.x).toBe(WIDTH - 200);
  });

  it('measures a column as wide as its widest content plus padding, never below its minimum', () => {
    const style: TableStyle = {
      ...PLAIN,
      columns: [
        PLAIN.columns[0]!,
        {
          name: 'right',
          width: { measured: { min: 100 } },
          padding: { top: 0, bottom: 0, left: 10, right: 10 },
        },
      ],
    };
    const wide = table(
      style,
      [plain(cell(20), cell(20, 150)), plain(cell(20), cell(20, 90))],
      WIDTH,
    );
    const narrow = table(style, [plain(cell(20), cell(20, 30))], WIDTH);

    expect(shapeOf(named(wide.draft, 'right')[0]!)?.size?.w).toBe(170);
    expect(shapeOf(named(narrow.draft, 'right')[0]!)?.size?.w).toBe(100);
  });
});

describe('rows', () => {
  it('makes a row as tall as its tallest content plus padding, never below the minimum', () => {
    const drawn = table(PLAIN, [plain(cell(60), cell(10)), plain(cell(5), cell(5))], WIDTH);

    expect(named(drawn.draft, 'row').map((row) => shapeOf(row)?.size?.h)).toEqual([80, 40]);
    expect(drawn.height).toBe(80 + 2 + 40);
  });

  it('leaves out of the height a cell that does not size its row', () => {
    const badge: TableCell = { ...cell(500), sizesRow: false };
    const drawn = table(PLAIN, [plain(cell(20), badge)], WIDTH);

    expect(drawn.height).toBe(40);
  });

  it('hands content the row’s inner height when it draws, so it can fill the cell', () => {
    const heights: (number | undefined)[] = [];
    const spy: TableCell = {
      draw: (width, height) => {
        heights.push(height);
        return block(width, 10, group({ children: [] }));
      },
    };
    table(PLAIN, [plain(cell(60), spy)], WIDTH);

    expect(heights).toEqual([undefined, 80]);
  });

  it('centres content shorter than its row, or sets it at the top or bottom', () => {
    const at = (valign: 'top' | 'middle' | 'bottom') => {
      const style: TableStyle = {
        ...PLAIN,
        columns: [PLAIN.columns[0]!, { name: 'right', width: 200, valign }],
      };
      const drawn = table(style, [plain(cell(60), cell(20))], WIDTH);
      const [right] = named(drawn.draft, 'right');
      return named(right!, 'content')[0]?.transform?.y ?? 0;
    };

    expect([at('top'), at('middle'), at('bottom')]).toEqual([0, 30, 60]);
  });

  it('keeps a kind’s own minimum height over the table’s', () => {
    const style: TableStyle = {
      ...PLAIN,
      kinds: { ...PLAIN.kinds, highlight: { fill: '#880000', minHeight: 70 } },
    };
    const drawn = table(style, [highlight(cell(5), cell(5)), plain(cell(5), cell(5))], WIDTH);

    expect(named(drawn.draft, 'row').map((row) => shapeOf(row)?.size?.h)).toEqual([70, 40]);
  });
});

describe('row kinds', () => {
  it('paints a highlighted row in its kind’s fill, at any position', () => {
    const rows = [
      highlight(cell(5), cell(5)),
      plain(cell(5), cell(5)),
      highlight(cell(5), cell(5)),
    ];

    expect(fillsOf(table(PLAIN, rows, WIDTH), 'right')).toEqual(['#880000', '#dddddd', '#880000']);
  });

  it('alternates zebra along the rows of its kind, unbroken by a row of another kind', () => {
    const rows = [
      highlight(cell(5), cell(5)),
      plain(cell(5), cell(5)),
      plain(cell(5), cell(5)),
      highlight(cell(5), cell(5)),
      plain(cell(5), cell(5)),
    ];

    expect(fillsOf(table(PLAIN, rows, WIDTH), 'left')).toEqual([
      '#880000',
      '#dddddd',
      '#eeeeee',
      '#880000',
      '#dddddd',
    ]);
  });

  it('paints one fill per column, and no shape where a column has none', () => {
    const style: TableStyle = {
      ...PLAIN,
      kinds: { plain: { fill: ['#111111', undefined] } },
    };
    const drawn = table(style, [plain(cell(5), cell(5))], WIDTH);

    expect(fillsOf(drawn, 'left')).toEqual(['#111111']);
    expect(fillsOf(drawn, 'right')).toEqual([undefined]);
  });

  it('draws no shape for a kind the style does not name', () => {
    const drawn = table(PLAIN, [{ kind: 'other', cells: [cell(5), cell(5)] }], WIDTH);

    expect(fillsOf(drawn, 'left')).toEqual([undefined]);
  });
});

describe('bands', () => {
  it('draws a band’s one cell across every column, padded by the outer columns', () => {
    const drawn = table(
      PLAIN,
      [plain(cell(5), cell(5)), { kind: 'highlight', cells: [cell(30)], span: true }],
      WIDTH,
    );
    const [band] = named(drawn.draft, 'band');

    expect(shapeOf(band!)?.size).toEqual({ w: WIDTH, h: 50 });
    expect(named(band!, 'content')[0]?.transform?.x).toBe(20);
    expect(named(drawn.draft, 'left')).toHaveLength(1);
  });
});

describe('corners', () => {
  const rows = [highlight(cell(5), cell(5)), plain(cell(5), cell(5)), highlight(cell(5), cell(5))];
  const radii = (drawn: Block, name: string) =>
    named(drawn.draft, name).map((each) => shapeOf(each)?.radius);

  it('rounds every cell alike with `every-cell`', () => {
    const drawn = table({ ...PLAIN, corners: { radius: 8, at: 'every-cell' } }, rows, WIDTH);

    const all = [8, 8, 8, 8];
    expect(radii(drawn, 'left')).toEqual([all, all, all]);
  });

  it('rounds only the table’s four outer corners with `outer`', () => {
    const drawn = table({ ...PLAIN, corners: { radius: 16, at: 'outer' } }, rows, WIDTH);

    const square = [0, 0, 0, 0];
    expect(radii(drawn, 'left')).toEqual([[16, 0, 0, 0], square, [0, 0, 0, 16]]);
    expect(radii(drawn, 'right')).toEqual([[0, 16, 0, 0], square, [0, 0, 16, 0]]);
  });

  it('rounds a band alone in the table on all four', () => {
    const drawn = table(
      { ...PLAIN, corners: { radius: 16, at: 'outer' } },
      [{ kind: 'highlight', cells: [cell(5)], span: true }],
      WIDTH,
    );

    expect(shapeOf(named(drawn.draft, 'band')[0]!)?.radius).toEqual([16, 16, 16, 16]);
  });

  it('lets a column’s own radius win over the table’s', () => {
    const style: TableStyle = {
      ...PLAIN,
      columns: [PLAIN.columns[0]!, { name: 'right', width: 200, radius: 40 }],
      corners: { radius: 16, at: 'outer' },
    };

    const all = [40, 40, 40, 40];
    expect(radii(table(style, rows, WIDTH), 'right')).toEqual([all, all, all]);
  });
});

describe('overlap', () => {
  it('runs each shape from the row’s left edge and paints the earlier cells on top', () => {
    const style: TableStyle = {
      ...PLAIN,
      layering: 'overlap',
      columns: [
        { name: 'badge', width: 100 },
        { name: 'pill', width: 'fill' },
      ],
      kinds: { plain: { fill: ['#000000', '#ffffff'] } },
    };
    const drawn = table(style, [plain(cell(5), cell(5))], WIDTH);
    const [row] = named(drawn.draft, 'row');

    expect(row!.children?.map((child) => child.name)).toEqual(['pill', 'badge']);
    expect(shapeOf(named(drawn.draft, 'pill')[0]!)?.size?.w).toBe(WIDTH);
  });
});
