// @vitest-environment jsdom
import { undo } from '@codemirror/commands';
import { afterEach, describe, expect, it } from 'vitest';

import { type EditorHandle, createEditor } from './editor.js';
import {
  type Proposal,
  type ProposalOutcome,
  acceptProposal,
  pendingProposal,
  proposeInState,
  rejectProposal,
} from './proposals.js';

/**
 * An agent's proposed edit in a real editor (TYTO-566, ADR 0180 decision 5): shown, then
 * accepted as one undo step, rejected, moved by typing elsewhere, or made stale by typing in it.
 */

let handle: EditorHandle | undefined;
let outcomes: [string, ProposalOutcome][];

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const TEXT = 'titulo: Hello\nsubtitulo: World\n';

function mount(doc = TEXT): EditorHandle {
  outcomes = [];
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, {
    doc,
    proposals: {
      labels: { title: 'Agent proposal', accept: 'Take it', reject: 'Leave it' },
      onSettled: (id, outcome) => outcomes.push([id, outcome]),
    },
  });
  return handle;
}

/** Proposes `Hello` → `Olá` and `World` → `Mundo`. */
const PROPOSAL: Proposal = {
  id: 'p1',
  edits: [
    { from: 8, to: 13, insert: 'Olá' },
    { from: 25, to: 30, insert: 'Mundo' },
  ],
};

function propose(editor: EditorHandle, proposal: Proposal = PROPOSAL): void {
  const shown = proposeInState(editor.view.state, proposal);
  if (!shown.ok) throw new Error(shown.reason);
  editor.view.dispatch({ effects: shown.effect });
}

describe('an agent proposal', () => {
  it('shows the bar with the host words, strikes the old text and draws the new', () => {
    const editor = mount();
    propose(editor);
    const content = editor.view.dom;
    expect(content.querySelector('.cm-proposal-title')?.textContent).toBe('Agent proposal');
    expect(content.querySelector('.cm-proposal-accept')?.textContent).toBe('Take it');
    expect(
      [...content.querySelectorAll('.cm-proposal-removed')].map((node) => node.textContent),
    ).toEqual(['Hello', 'World']);
    expect(
      [...content.querySelectorAll('.cm-proposal-inserted')].map((node) => node.textContent),
    ).toEqual(['Olá', 'Mundo']);
    // Nothing is written until the person accepts.
    expect(editor.getValue()).toBe(TEXT);
  });

  it('applies on accept as one undo step, and says so', () => {
    const editor = mount();
    // Typed by the person right after "World", just before the proposal: what the history would
    // merge with the accepted edits if they were not an event of their own.
    editor.view.dispatch({ changes: { from: 30, insert: 'x' }, userEvent: 'input.type' });
    const before = editor.getValue();
    propose(editor);

    (editor.view.dom.querySelector('.cm-proposal-accept') as HTMLButtonElement).click();
    expect(editor.getValue()).toBe('titulo: Olá\nsubtitulo: Mundox\n');
    expect(outcomes).toEqual([['p1', 'accepted']]);
    expect(editor.view.dom.querySelector('.cm-proposal-bar')).toBeNull();

    // One Ctrl+Z gives back exactly the text from before — both edits, not the typing before.
    expect(undo(editor.view)).toBe(true);
    expect(editor.getValue()).toBe(before);
  });

  it('leaves the text alone on reject', () => {
    const editor = mount();
    propose(editor);
    expect(rejectProposal(editor.view)).toBe(true);
    expect(editor.getValue()).toBe(TEXT);
    expect(outcomes).toEqual([['p1', 'rejected']]);
    expect(pendingProposal(editor.view.state)).toBeUndefined();
  });

  it('moves with the text when the person types elsewhere, and applies where it moved', () => {
    const editor = mount();
    propose(editor);
    editor.view.dispatch({ changes: { from: 0, insert: '# head\n' } });
    expect(pendingProposal(editor.view.state)?.edits.map((edit) => edit.from)).toEqual([15, 32]);
    expect(acceptProposal(editor.view)).toBe(true);
    expect(editor.getValue()).toBe('# head\ntitulo: Olá\nsubtitulo: Mundo\n');
  });

  it('becomes stale when the person types in a proposed range, and is never applied', () => {
    const editor = mount();
    propose(editor);
    editor.view.dispatch({ changes: { from: 10, to: 11, insert: 'L' } });
    expect(outcomes).toEqual([['p1', 'stale']]);
    expect(pendingProposal(editor.view.state)).toBeUndefined();
    expect(acceptProposal(editor.view)).toBe(false);
    expect(editor.getValue()).toBe('titulo: HeLlo\nsubtitulo: World\n');
  });

  it('refuses a second proposal while one is pending, and edits that do not fit', () => {
    const editor = mount();
    propose(editor);
    expect(proposeInState(editor.view.state, { ...PROPOSAL, id: 'p2' })).toEqual({
      ok: false,
      reason: 'pending',
    });
    rejectProposal(editor.view);
    for (const edits of [
      [],
      [{ from: 5, to: 2, insert: '' }],
      [{ from: 0, to: 999, insert: '' }],
      [
        { from: 0, to: 6, insert: '' },
        { from: 4, to: 8, insert: '' },
      ],
    ]) {
      expect(proposeInState(editor.view.state, { id: 'bad', edits }).ok).toBe(false);
    }
  });
});
