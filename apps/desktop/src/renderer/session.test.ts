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

/** A tab no pane measured: the selection is whatever typing left, and the scroll the top. */
const AT_START = expect.objectContaining({ top: 0 }) as unknown;

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
        {
          documentId: 'b',
          kind: 'brief',
          draft: { text: '::titulo Rascunho', savedText: '' },
          place: AT_START,
        },
      ],
      active: 0,
      template: null,
    });
  });

  it('keeps an untitled tab typed in and emptied, as an empty draft', () => {
    const handle = open();
    handle.restore(handle.blank(''));
    type(handle, 'x');
    handle.view.dispatch({ changes: { from: 0, to: 1 } });

    expect(sessionOf({ documents: [tab(handle, 'a')], activeId: 'a' }).tabs).toEqual([
      { documentId: 'a', kind: 'brief', draft: { text: '', savedText: '' }, place: AT_START },
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
        { documentId: 'a', kind: 'brief', draft: null, place: AT_START },
        {
          documentId: 'b',
          kind: 'brief',
          draft: { text: '::a mais', savedText: '::a' },
          place: AT_START,
        },
        { documentId: 'c', kind: 'settings', draft: null, place: AT_START },
      ],
      active: 2,
      template: null,
    });
  });

  it('carries where each tab was looking: its selection and its last scroll (TYTO-265)', () => {
    const handle = open();
    handle.restore(handle.blank('::titulo Um\n::titulo Dois\n::titulo Tres'));
    handle.view.dispatch({ selection: { anchor: 14, head: 18 } });
    // In the background: the scroll its pane measured when it was last in front.
    const behind = tab(handle, 'a', { name: 'a.brief', savedText: '', scroll: { top: 12 } });
    // Never shown: no state at all, so nothing to say about where it was.
    const unborn = { ...tab(handle, 'b', { name: 'b.brief' }), state: undefined };

    const kept = sessionOf({ documents: [behind, unborn], activeId: 'a' });

    expect(kept.tabs.map((entry) => entry.place)).toEqual([
      { anchor: 14, head: 18, top: 12 },
      null,
    ]);
  });

  it('carries the template mode beside the tabs, with no folder in it (TYTO-266)', () => {
    const handle = open();
    const mode = {
      visible: 'manifest' as const,
      manifest: { text: 'name: x\n', savedText: 'name: y\n' },
      markup: null,
    };

    const kept = sessionOf({ documents: [tab(handle, 'a')], activeId: 'a' }, mode);

    expect(kept.template).toEqual(mode);
    expect(JSON.stringify(kept)).not.toContain('directory');
  });
});
