import { slotTable } from '@tyto/template-kit';
import { describe, expect, it } from 'vitest';

import { approvedTable, sessionTable } from './azul/presets.js';
import { examTable } from './presets.js';

import type { Inline, RichText } from '@tyto/core';
import type { Measure, SlotTableStyle } from '@tyto/template-kit';

/**
 * The drafts of the house's three slot-table presets, pinned whole (TYTO-859).
 *
 * When `pillTable` became `slotTable` over the kit's generic `table`, a probe compared the old
 * and new drafts of these presets and found them identical; these files are that output. The
 * structural tests beside each preset missed a perturbed centring that these catch. A change
 * here is a change in what the agenda, the approved list or the exam agenda draw: update the
 * snapshots on purpose, after looking at a render.
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

const characters = (node: Parameters<Measure>[0]): number =>
  node.runs.reduce((sum, run) => sum + (run.kind === 'text' ? run.text.length : 0), 0);

/** 14 px a character, wrapping at the box: rows of more than one line grow. */
const wrapping: Measure = (node) => {
  const width = node.box.w ?? 1000;
  const lines = Math.max(1, Math.ceil((characters(node) * 14) / width));
  return {
    runs: node.runs,
    lines,
    width: Math.min(width, characters(node) * 14),
    height: lines * 30,
    scale: 1,
    overflow: 0,
  } as ReturnType<Measure>;
};

const CASES: readonly (readonly [string, SlotTableStyle, string])[] = [
  [
    'session',
    sessionTable('#123456'),
    'DIREITO CIVIL\n23/09 | Contratos e obrigações em espécie, parte longa | Prof. Ana\n24/09 | Curta | Prof. Bia\nPENAL\n25/09 | Teoria do crime | Prof. Caio',
  ],
  [
    'approved',
    approvedTable('#123456'),
    'Clínica\n1º | Maria da Silva Pereira\n2º | João\nCirurgia\n3º | Ana',
  ],
  [
    'exam',
    examTable('#654321'),
    'Domingo 26/10 | Aplicação às 08h30\nSimulado A\nSimulado B com um nome longo para quebrar\nSegunda 27/10 | Correção\nSimulado C',
  ],
];

describe('the slot-table presets', () => {
  it.each(CASES)('draw the %s table as they did', async (name, style, source) => {
    const drawn = slotTable(style, { text: rich(source), width: 880, measure: wrapping });

    await expect(`${JSON.stringify(drawn, null, 1)}\n`).toMatchFileSnapshot(
      `./__snapshots__/slot-table-${name}.json`,
    );
  });
});
