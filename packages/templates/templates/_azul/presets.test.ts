import { measureNothing } from '@tyto/core';
import { pillTable } from '@tyto/template-kit';
import { describe, expect, it } from 'vitest';

import { approvedTable, sessionTable } from './presets.js';
import { APPROVED } from './tokens.js';

import type { Inline, RichText } from '@tyto/core';
import type { NodeDraft } from '@tyto/core/template';

/**
 * The azul presets, drawn. The pixels are proven by rendering: `sessionTable` through
 * `agenda-semana` against `main`, `approvedTable` through `aprovados` against the
 * maintainer's reference of 2026-09-27 (TYTO-185). What is pinned here is structure — the
 * words go where the brief put them, and the rewrites happen.
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

describe('approvedTable', () => {
  const table = pillTable(approvedTable, {
    text: rich('ENDODONTIA\n1º | Ana Beatriz Souza\n2º | Carlos Menezes\n43º | daniela prado'),
    width: APPROVED.table.max,
    measure: measureNothing,
  });

  it('draws each rank as a place, the way the published badge reads', () => {
    expect(words(table.draft, 'rank')).toEqual(['1º Lugar', '2º Lugar', '43º Lugar']);
  });

  it('sets every name in capitals, whatever the brief typed', () => {
    expect(words(table.draft, 'name')).toEqual([
      'ANA BEATRIZ SOUZA',
      'CARLOS MENEZES',
      'DANIELA PRADO',
    ]);
  });

  it('heads the rows with their specialty', () => {
    expect(words(table.draft, 'specialty')).toEqual(['ENDODONTIA']);
  });

  it('is the heading, its gap and three published rows tall', () => {
    const rows = APPROVED.badge.h * 3 + APPROVED.gap.rows * 2;
    expect(table.height).toBe(APPROVED.box.specialty + APPROVED.gap.heading + rows);
  });

  it('adds nothing to a rank the brief left empty', () => {
    const empty = pillTable(approvedTable, {
      text: rich('ENDODONTIA\n | Sem colocação'),
      width: APPROVED.table.max,
      measure: measureNothing,
    });
    expect(words(empty.draft, 'rank')).toEqual([]);
  });
});

describe('sessionTable', () => {
  it('reads a discipline heading and its sessions out of one slot', () => {
    const table = pillTable(sessionTable, {
      text: rich('FARMÁCIA\n16/09 - 14:00 | Farmacologia Geral | Profª. Marcela Rocha'),
      width: WIDTH,
      measure: measureNothing,
    });

    expect(words(table.draft, 'discipline')).toEqual(['FARMÁCIA']);
    expect(words(table.draft, 'date')).toEqual(['16/09 - 14:00']);
    expect(words(table.draft, 'session-title')).toEqual(['Farmacologia Geral']);
    expect(words(table.draft, 'professor')).toEqual(['Profª. Marcela Rocha']);
  });
});
