import { measureNothing } from '@tyto/core';
import { pillTable } from '@tyto/template-kit';
import { describe, expect, it } from 'vitest';

import { approvedTable, sessionTable } from './presets.js';
import { TABLE } from './tokens.js';

import type { Inline, RichText } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';

/**
 * The Saúde presets, drawn. `sessionTable` is proven pixel for pixel by `agenda-semana`
 * (TYTO-185 rendered it against `main`); `approvedTable` has no published slide yet, so what
 * is pinned here is its structure — the words go where the description says they do.
 */

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

function walk(draft: NodeDraft): NodeDraft[] {
  return draft.kind === 'group' ? [draft, ...draft.children.flatMap(walk)] : [draft];
}

function words(draft: NodeDraft, name: string): string[] {
  return walk(draft)
    .filter((node) => node.name === name)
    .map((node) =>
      node.kind === 'text'
        ? node.runs.map((run) => (run.kind === 'text' ? run.text : '')).join('')
        : '',
    );
}

const WIDTH = 940;

describe('approvedTable (provisional)', () => {
  const table = pillTable(approvedTable, {
    text: rich('1º | Ana Beatriz Souza\n2º | Carlos Menezes\n43º | Daniela Prado'),
    width: WIDTH,
    measure: measureNothing,
  });

  it('draws one row per line, the rank in the badge and the name in the grey pill', () => {
    expect(words(table.draft, 'rank')).toEqual(['1º', '2º', '43º']);
    expect(words(table.draft, 'name')).toEqual([
      'Ana Beatriz Souza',
      'Carlos Menezes',
      'Daniela Prado',
    ]);
  });

  it('keeps the published row height for a one-line name', () => {
    expect(table.height).toBe(TABLE.badge.h * 3 + approvedTable.rowGap * 2);
  });
});

describe('sessionTable', () => {
  it('reads a discipline heading and its sessions out of one slot', () => {
    const table = pillTable(sessionTable, {
      text: rich('FARMÁCIA\n16/09 - 14:00 | Farmacologia Geral | Profª. Rafaela Gomes'),
      width: WIDTH,
      measure: measureNothing,
    });

    expect(words(table.draft, 'discipline')).toEqual(['FARMÁCIA']);
    expect(words(table.draft, 'date')).toEqual(['16/09 - 14:00']);
    expect(words(table.draft, 'session-title')).toEqual(['Farmacologia Geral']);
    expect(words(table.draft, 'professor')).toEqual(['Profª. Rafaela Gomes']);
  });
});
