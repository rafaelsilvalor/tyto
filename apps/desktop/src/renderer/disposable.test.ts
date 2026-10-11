// @vitest-environment jsdom
import { type EditorHandle, createEditor } from '@tyto/editor';
import { afterEach, describe, expect, it } from 'vitest';

import { type DocumentState, isDisposable, isUnsaved, newDocument } from './documents.js';

/**
 * Whether the tab in front may be replaced by the next file opened, asked of real editor
 * states (TYTO-120).
 *
 * Its own file, and in jsdom, because the question is about an undo history and only
 * CodeMirror can say what one holds: `documents.test.ts` runs without a DOM on stand-ins
 * that read as never edited, and a stand-in with a history would only agree with itself.
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

/** The view's document as the store would hold it — `onUpdate` writes exactly this. */
const documentOn = (handle: EditorHandle, over: Partial<DocumentState> = {}): DocumentState => ({
  ...newDocument('a', handle.state()),
  ...over,
});

/** A person typing at the end of the buffer, as opposed to `setValue`. */
const type = (handle: EditorHandle, text: string): void => {
  handle.view.dispatch({ changes: { from: handle.view.state.doc.length, insert: text } });
};

/** Select all, delete. */
const empty = (handle: EditorHandle): void => {
  handle.view.dispatch({ changes: { from: 0, to: handle.view.state.doc.length } });
};

describe('a tab nobody has typed in', () => {
  it('may be replaced, which is the tab the window opens on', () => {
    const handle = open();
    handle.restore(handle.blank(''));

    expect(isDisposable(documentOn(handle))).toBe(true);
  });

  it('may be replaced before the editor has given it a state at all', () => {
    expect(isDisposable(newDocument('a'))).toBe(true);
  });
});

describe('a tab typed in and then emptied', () => {
  it('is kept, because its undo history is the only copy of what was typed', () => {
    const handle = open();
    handle.restore(handle.blank(''));
    type(handle, '::titulo Campanha');
    empty(handle);

    const emptied = documentOn(handle);

    // Empty and clean, so the unsaved comparison alone cannot tell it from a fresh tab.
    expect(isUnsaved(emptied)).toBe(false);
    expect(isDisposable(emptied)).toBe(false);
  });

  it('is kept when it is a tab that lost its file (TYTO-104), which is the same case', () => {
    const handle = open();
    handle.restore(handle.blank('::titulo Campanha'));
    empty(handle);

    const released = documentOn(handle, { name: undefined, savedText: '' });

    expect(isDisposable(released)).toBe(false);
  });
});
