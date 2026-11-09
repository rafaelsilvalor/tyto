import { describe, expect, it } from 'vitest';

import { KEPT_PROPOSALS, type LinedText, ProposalLedger, offsetsOf } from './agent-proposals.js';

/** An agent's proposal turned into offsets and checked (TYTO-566, ADR 0180 decision 5). */

/** CodeMirror's `Text` over a plain string: lines from 1, `to` before the line break. */
function textOf(doc: string): LinedText {
  const starts = [0];
  for (let index = 0; index < doc.length; index += 1)
    if (doc[index] === '\n') starts.push(index + 1);
  return {
    lines: starts.length,
    line: (number) => {
      const from = starts[number - 1] ?? 0;
      const next = starts[number];
      return { from, to: next === undefined ? doc.length : next - 1 };
    },
    sliceString: (from, to) => doc.slice(from, to),
  };
}

const DOC = textOf('titulo: Hello\nsubtitulo: World\n');
const at = (line: number, column: number) => ({ line, column });

describe('offsetsOf', () => {
  it('turns lines and columns into sorted offsets when the expected text is there', () => {
    expect(
      offsetsOf(DOC, [
        { from: at(2, 12), to: at(2, 17), insert: 'Mundo', expect: 'World' },
        { from: at(1, 9), to: at(1, 14), insert: 'Olá', expect: 'Hello' },
      ]),
    ).toEqual({
      ok: true,
      edits: [
        { from: 8, to: 13, insert: 'Olá' },
        { from: 25, to: 30, insert: 'Mundo' },
      ],
    });
  });

  it('refuses at once when the range does not hold what the agent expects', () => {
    const answer = offsetsOf(DOC, [
      { from: at(1, 9), to: at(1, 14), insert: 'x', expect: 'Hullo' },
    ]);
    expect(answer).toMatchObject({ ok: false, reason: expect.stringMatching(/^stale:/u) });
  });

  it('refuses a range outside the text, backwards, or overlapping another', () => {
    for (const edits of [
      [{ from: at(9, 1), to: at(9, 1), insert: '', expect: '' }],
      [{ from: at(1, 1), to: at(1, 99), insert: '', expect: '' }],
      [{ from: at(1, 5), to: at(1, 2), insert: '', expect: '' }],
      [
        { from: at(1, 1), to: at(1, 7), insert: '', expect: 'titulo' },
        { from: at(1, 5), to: at(1, 9), insert: '', expect: 'lo: ' },
      ],
    ]) {
      expect(offsetsOf(DOC, edits).ok).toBe(false);
    }
  });
});

describe('ProposalLedger', () => {
  it('says proposed, then how it settled, and gone once its tab closed unsettled', () => {
    const ledger = new ProposalLedger();
    const first = ledger.open('doc-1');
    const second = ledger.open('doc-2');
    expect(ledger.status(first, () => true)).toBe('proposed');
    ledger.settle(first, 'accepted');
    ledger.settle(first, 'stale');
    expect(ledger.status(first, () => false)).toBe('accepted');
    expect(ledger.status(second, (id) => id !== 'doc-2')).toBe('gone');
    expect(ledger.status('proposal-99', () => true)).toBeUndefined();
  });

  it(`forgets all but the newest ${String(KEPT_PROPOSALS)}`, () => {
    const ledger = new ProposalLedger();
    const first = ledger.open('doc');
    for (let index = 0; index < KEPT_PROPOSALS; index += 1) ledger.open('doc');
    expect(ledger.status(first, () => true)).toBeUndefined();
  });
});
