import { noBrandKit } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { ROXO_TABLE } from './brands.js';
import { oneImageTable, titleLineLimit } from './table.js';

import type { Inline, SceneNode, TemplateFiles } from '@tyto/core';

/**
 * A title the author broke into lines keeps exactly those lines (TYTO-775): the size comes
 * down until each fits whole, rather than one wrapping into a third line.
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

function fakeMeasure(node: {
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

/** The title's text node after a build, and the lines the stand-in measure gives it. */
function titleOf(titulo: string): { size: number; lines: number } {
  const frame = oneImageTable(ROXO_TABLE)({
    format: 'grid',
    size: { w: 1080, h: 1350 },
    idPrefix: 'artwork-0-grid',
    artwork: { id: 'artwork-0', index: 0, count: 1 },
    slots: {
      titulo: {
        name: 'titulo',
        value: { kind: 'rich-text', text: rich(titulo) },
        adjustments: [],
      },
      tabela: {
        name: 'tabela',
        value: { kind: 'rich-text', text: rich('A | B\num | dois') },
        adjustments: [],
      },
    },
    adjustments: {},
    measure: fakeMeasure as never,
    report: () => undefined,
    files,
    brand: noBrandKit,
  });
  const find = (nodes: readonly SceneNode[]): SceneNode | undefined => {
    for (const node of nodes) {
      if (node.kind === 'text' && node.name === 'title') return node;
      if ('children' in node) {
        const found = find(node.children as readonly SceneNode[]);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  const node = find(frame.children) as unknown as {
    runs: readonly Run[];
    box: { w: number };
    lineHeight: number;
  };
  const measured = fakeMeasure({ ...node, runs: node.runs }) as unknown as { lines: number };
  return { size: node.runs[0]!.size!, lines: measured.lines };
}

describe('how many lines the title may take', () => {
  it('is the lines the author wrote, when there are more than one', () => {
    expect(titleLineLimit(['A', 'B'])).toBe(2);
    expect(titleLineLimit(['A', 'B', 'C', 'D'])).toBe(4);
  });

  it('is three when the author broke nothing, as it always was', () => {
    expect(titleLineLimit(['A'])).toBe(3);
  });

  it('sets a title broken into two lines in two, smaller, where unbroken it wraps to three', () => {
    const unbroken = titleOf('25,7 mil vagas ainda em 2026 para Educação!');
    const broken = titleOf('25,7 mil vagas ainda em\n2026 para Educação!');

    expect(unbroken.lines).toBe(3);
    expect(broken.lines).toBe(2);
    expect(broken.size).toBeLessThan(unbroken.size);
  });
});
