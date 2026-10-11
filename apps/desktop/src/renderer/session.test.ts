// @vitest-environment jsdom
import { type EditorHandle, createEditor } from '@tyto/editor';
import { afterEach, describe, expect, it } from 'vitest';

import { type DocumentState, newDocument } from './documents.js';
import { sessionOf } from './session.js';

/**
 * Which tabs the window asks main to keep, and with which drafts (TYTO-113, ADR 0080).
 *
 * In jsdom against a real editor, for `disposable.test.ts`'s reason: whether an untitled tab
 * is worth keeping is a question about its undo history, which only CodeMirror can answer.
 */

let editor: EditorHandle | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const open = (): EditorHandle => {
  editor = createEditor(globalThis.document.createElement('div'));
  return editor;
};

const type = (handle: EditorHandle, text: string): void => {
  handle.view.dispatch({ changes: { from: handle.view.state.doc.length, insert: text } });
};

/** A tab whose state is the view's, as `onUpdate` keeps it. */
const tab = (
  handle: EditorHandle,
  id: string,
  over: Partial<DocumentState> = {},
): DocumentState => ({
  ...newDocument(id, handle.state()),
  ...over,
});

describe('the tabs the window keeps', () => {
  it('leaves out an untitled tab nobody typed in, and keeps one somebody did', () => {
    const handle = open();
    handle.restore(handle.blank(''));
    const untouched = tab(handle, 'a');
    type(handle, '::titulo Rascunho');
    const typed = tab(handle, 'b');

    const kept = sessionOf({ documents: [untouched, typed], activeId: 'b' });

    expect(kept).toEqual({
      tabs: [
        { documentId: 'b', kind: 'brief', draft: { text: '::titulo Rascunho', savedText: '' } },
      ],
      active: 0,
    });
  });

  it('keeps an untitled tab typed in and emptied, as an empty draft', () => {
    const handle = open();
    handle.restore(handle.blank(''));
    type(handle, 'x');
    handle.view.dispatch({ changes: { from: 0, to: 1 } });

    expect(sessionOf({ documents: [tab(handle, 'a')], activeId: 'a' }).tabs).toEqual([
      { documentId: 'a', kind: 'brief', draft: { text: '', savedText: '' } },
    ]);
  });

  it('sends a saved tab with no draft, and a dirty one with its text and saved text', () => {
    const handle = open();
    handle.restore(handle.blank('::a'));
    const saved = tab(handle, 'a', { name: 'a.brief', savedText: '::a' });
    type(handle, ' mais');
    const dirty = tab(handle, 'b', { name: 'b.brief', savedText: '::a' });
    const settings = tab(handle, 'c', {
      name: 'settings.json',
      kind: 'settings',
      savedText: '::a mais',
    });

    expect(sessionOf({ documents: [saved, dirty, settings], activeId: 'c' })).toEqual({
      tabs: [
        { documentId: 'a', kind: 'brief', draft: null },
        { documentId: 'b', kind: 'brief', draft: { text: '::a mais', savedText: '::a' } },
        { documentId: 'c', kind: 'settings', draft: null },
      ],
      active: 2,
    });
  });
});
