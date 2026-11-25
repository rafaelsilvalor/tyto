import { noBrandKit } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { ROXO_TABLE } from './brands.js';
import { oneImageTable } from './table.js';
import { CELL } from './table-tokens.js';

import type { Inline, SceneNode, TemplateFiles } from '@tyto/core';

/**
 * The one-image table's drawing, pinned (TYTO-878).
 *
 * `drawTable` hands its rows to the kit's `table`, and before it did, it placed each cell by
 * hand. A probe compared every leaf of the two drawings, at its absolute place, for both the
 * measured and the unmeasured path: the same rects and texts, positions within 3e-13 px. These
 * files pin the new drawing so a change in the kit's table, or in what the house hands it,
 * shows here. Update them on purpose, after looking at a render.
 *
 * The measure is a monospace stand-in: every character 0.6 of the size, lines broken greedily
 * at a space inside the box, the author's breaks kept.
 */

const ADVANCE = 0.6;

interface Run {
  readonly kind?: string;
  readonly text?: string;
  readonly size?: number;
}

function monospace(node: {
  readonly runs: readonly Run[];
  readonly box?: { readonly w?: number };
  readonly lineHeight?: number;
}) {
  const size = node.runs.find((run) => run.size !== undefined)?.size ?? 10;
  const width = node.box?.w ?? Infinity;
  const authored = [''];
  for (const run of node.runs) {
    if (run.kind === 'break') authored.push('');
    else authored[authored.length - 1] += run.text ?? '';
  }
  let lines = 0;
  let widest = 0;
  for (const line of authored) {
    lines += 1;
    let used = 0;
    for (const word of line.split(' ').filter((piece) => piece !== '')) {
      const advance = [...word].length * ADVANCE * size;
      const space = ADVANCE * size;
      if (used === 0) used = advance;
      else if (used + space + advance <= width) used += space + advance;
      else {
        lines += 1;
        used = advance;
      }
      widest = Math.max(widest, used);
    }
  }
  return {
    runs: node.runs,
    lines,
    width: widest,
    height: lines * (node.lineHeight ?? 1.2) * size,
  } as never;
}

let cursor = 0;
function rich(source: string): Inline[] {
  const parts: Inline[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) parts.push({ kind: 'break', range: { start: cursor, end: cursor++ } });
    const start = cursor;
    cursor += line.length;
    parts.push({ kind: 'text', value: line, range: { start, end: cursor } });
  }
  return parts;
}

const files: TemplateFiles = { svg: () => undefined, image: () => undefined };

/** The `table` group of the frame the roxo table draws for this `tabela`. */
function drawn(tabela: string, measured = true): SceneNode {
  const frame = oneImageTable(ROXO_TABLE)({
    format: 'grid',
    size: { w: 1080, h: 1350 },
    idPrefix: 'artwork-0-grid',
    artwork: { id: 'artwork-0', index: 0, count: 1 },
    slots: {
      titulo: {
        name: 'titulo',
        value: { kind: 'rich-text', text: rich('Título') },
        adjustments: [],
      },
      tabela: { name: 'tabela', value: { kind: 'rich-text', text: rich(tabela) }, adjustments: [] },
    },
    adjustments: {},
    measure: (measured ? monospace : () => undefined) as never,
    report: () => undefined,
    files,
    brand: noBrandKit,
  });
  const table = frame.children.find((node) => node.name === 'table');
  if (table === undefined) throw new Error('no table group');
  return table;
}

/** One line per node, indented by depth: its kind, its name, and everything else it carries. */
function outline(node: SceneNode, depth = 0): string[] {
  const { kind, name, ...rest } = node as SceneNode & { readonly children?: SceneNode[] };
  const { children, ...own } = rest as { children?: SceneNode[] };
  const line = `${'  '.repeat(depth)}${kind} ${name ?? '-'} ${JSON.stringify(own)}`;
  return [line, ...(children ?? []).flatMap((child) => outline(child, depth + 1))];
}

const CASES: readonly (readonly [string, string, boolean])[] = [
  [
    'plain',
    'Concurso | Banca | Vagas\nAlfa | Beta | 40 + CR\nGama | Delta | -\nÉpsilon | Zeta | 75',
    true,
  ],
  [
    'bands',
    'Cargo | Vagas\nNÍVEL SUPERIOR\nAnalista | 12\nAuditor | 3\nNÍVEL MÉDIO\nTécnico | 40',
    true,
  ],
  ['unmeasured', 'A | B | C\num | | três\nFAIXA\nquatro | cinco | seis', false],
];

describe('the one-image table', () => {
  it.each(CASES)('draws the %s table as pinned', async (name, tabela, measured) => {
    const lines = outline(drawn(tabela, measured));
    await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot(
      `./__snapshots__/one-image-table-${name}.txt`,
    );
  });

  it('stripes the first body row and every other one, a band not counting', () => {
    const table = drawn('A | B\num | dois\nFAIXA\ntrês | quatro\ncinco | seis\nFAIXA\nsete | oito');
    const body = (table as { children: SceneNode[] }).children.filter(
      (row) => row.name === 'body-row',
    );
    const striped = body.map((row) =>
      (row as { children: SceneNode[] }).children.some((cell) =>
        (cell as { children: SceneNode[] }).children.some((shape) => shape.kind === 'rect'),
      ),
    );

    expect(striped).toEqual([true, false, true, false]);
  });

  it('runs a band across every column, at the table’s full width', () => {
    const table = drawn('A | B | C\num | dois | três\nFAIXA') as { children: SceneNode[] };
    const header = table.children.find((row) => row.name === 'header-row') as {
      children: SceneNode[];
    };
    const band = table.children.find((row) => row.name === 'band-row') as {
      children: SceneNode[];
    };
    const width = (cell: SceneNode) =>
      (cell as { children: SceneNode[] }).children.find((shape) => shape.kind === 'rect') as {
        size: { w: number };
      };
    const across = header.children.reduce((total, cell) => total + width(cell).size.w, 0);

    expect(band.children).toHaveLength(1);
    expect(width(band.children[0]!).size.w).toBeCloseTo(across + 2 * CELL.gapX, 9);
  });
});
