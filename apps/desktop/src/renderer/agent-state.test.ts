import { describe, expect, it } from 'vitest';

import { parseIpc } from '../../shared/ipc.js';
import { MAX_RANGES, type SelectionSource, agentStateOf } from './agent-state.js';

/**
 * What the window tells an agent about the document in front (TYTO-566, ADR 0180). The editor's
 * state is stood in for by the three things `agentStateOf` reads of it; the e2e reads a real one.
 */

const text = '---\ntemplate: cartaz\n---\ntitulo: Hello\n';

/** CodeMirror's `lineAt`, `selection.ranges` and `sliceDoc` over a plain string. */
function editorOf(doc: string, ranges: readonly { from: number; to: number }[]): SelectionSource {
  return {
    doc: {
      lineAt: (offset) => {
        const before = doc.slice(0, offset).split('\n');
        return { number: before.length, from: offset - (before.at(-1)?.length ?? 0) };
      },
    },
    selection: { ranges },
    sliceDoc: (from, to) => doc.slice(from, to),
  };
}

const front = {
  id: 'doc-3',
  name: undefined,
  kind: undefined,
  text,
  unsaved: true,
  format: 'feed',
};

describe('agentStateOf', () => {
  it('answers the text as typed, a brief by default, and each range with lines and columns', () => {
    const cursor = text.indexOf('Hello');
    const state = agentStateOf(
      front,
      editorOf(text, [
        { from: 4, to: 12 },
        { from: cursor, to: cursor },
      ]),
    );

    expect(state).toEqual({
      documentId: 'doc-3',
      name: null,
      kind: 'brief',
      text,
      unsaved: true,
      format: 'feed',
      ranges: [
        { from: { line: 2, column: 1 }, to: { line: 2, column: 9 }, text: 'template' },
        { from: { line: 4, column: 9 }, to: { line: 4, column: 9 }, text: '' },
      ],
    });
    // What the renderer sends is what main's schema accepts.
    expect(() => parseIpc('agent:reply', 'request', { askId: 1, answer: { state } })).not.toThrow();
  });

  it('answers no ranges without an editor, and null with no document', () => {
    expect(agentStateOf(front, undefined)?.ranges).toBeNull();
    expect(agentStateOf(undefined, undefined)).toBeNull();
  });

  it('caps the ranges at the schema ceiling', () => {
    const many = 'x'.repeat(300);
    const ranges = Array.from({ length: 150 }, (_, index) => ({ from: index * 2, to: index * 2 }));
    expect(agentStateOf({ ...front, text: many }, editorOf(many, ranges))?.ranges).toHaveLength(
      MAX_RANGES,
    );
  });
});
