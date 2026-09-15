import { insertNewlineAndIndent, undo as undoCommand } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { commandRegistryOf, createCommandRegistry } from './commands.js';
import { createEditor, type EditorHandle } from './editor.js';

/**
 * The handle is tested through a real `EditorView` in jsdom rather than through a stub.
 *
 * A stub would assert that this file calls CodeMirror the way this file calls CodeMirror.
 * What the host actually depends on — that `setValue` replaces the document, that
 * `onChange` fires for a keystroke and not for a `setValue`, that `readOnly` refuses an
 * edit — are all properties of the state CodeMirror builds, and only the real one has them.
 */
const open = (): { parent: HTMLElement } => {
  const parent = document.createElement('div');
  document.body.append(parent);
  return { parent };
};

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

/** What a person typing does, as opposed to what `setValue` does. */
const type = (editor: EditorHandle, text: string): void => {
  editor.view.dispatch({
    changes: { from: editor.view.state.doc.length, insert: text },
  });
};

/** CodeMirror's own undo, which is the stack an `EditorState` carries. */
const undo = (editor: EditorHandle): void => {
  undoCommand({ state: editor.view.state, dispatch: (spec) => editor.view.dispatch(spec) });
};

describe('createEditor', () => {
  it('mounts into the parent it was given', () => {
    const { parent } = open();
    handle = createEditor(parent, { doc: '::titulo Oi\n' });

    expect(parent.querySelector('.cm-editor')).not.toBeNull();
    expect(handle.getValue()).toBe('::titulo Oi\n');
  });

  it('starts empty when no document is given', () => {
    handle = createEditor(open().parent);
    expect(handle.getValue()).toBe('');
  });

  it('replaces the whole document on setValue', () => {
    handle = createEditor(open().parent, { doc: 'first' });
    handle.setValue('::titulo second\n');

    expect(handle.getValue()).toBe('::titulo second\n');
  });

  it('reports what the author typed', () => {
    handle = createEditor(open().parent, { doc: '::titulo ' });
    const seen: string[] = [];
    handle.onChange((value) => seen.push(value));

    type(handle, 'Oi');

    expect(seen).toEqual(['::titulo Oi']);
  });

  /**
   * The loop E9.2 would otherwise close: the renderer sets the document when a file is
   * opened and saves when it changes, so a `setValue` that notified would save the file it
   * has just opened.
   */
  it('stays quiet when the host writes', () => {
    handle = createEditor(open().parent, { doc: 'first' });
    const seen: string[] = [];
    handle.onChange((value) => seen.push(value));

    handle.setValue('second');

    expect(seen).toEqual([]);
    expect(handle.getValue()).toBe('second');
  });

  it('stops a listener that unsubscribed, and keeps the others', () => {
    handle = createEditor(open().parent);
    const gone: string[] = [];
    const kept: string[] = [];
    const unsubscribe = handle.onChange((value) => gone.push(value));
    handle.onChange((value) => kept.push(value));

    unsubscribe();
    type(handle, 'a');

    expect(gone).toEqual([]);
    expect(kept).toEqual(['a']);
  });

  /**
   * Asserted through a command rather than through `view.dispatch`, because `dispatch` is
   * how this package's own `setValue` writes and read-only was never meant to stop it. What
   * it stops is the author: every editing command goes through `state.readOnly`, and the
   * content element is not editable at all.
   */
  it('refuses an edit when readOnly', () => {
    const { parent } = open();
    handle = createEditor(parent, { doc: 'fixed', readOnly: true });

    const ran = insertNewlineAndIndent(handle.view);

    expect(ran).toBe(false);
    expect(handle.getValue()).toBe('fixed');
    expect(parent.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
  });

  it('applies the caller extensions', () => {
    handle = createEditor(open().parent, {
      doc: 'fixed',
      extensions: [EditorView.editable.of(false)],
    });

    expect(handle.view.state.facet(EditorView.editable)).toBe(false);
  });

  /** The precedence `EditorOptions.extensions` promises, measured against a default. */
  it('lets a caller extension outrank a default', () => {
    handle = createEditor(open().parent, {
      doc: 'fixed',
      readOnly: true,
      extensions: [EditorView.editable.of(true)],
    });

    expect(handle.view.state.facet(EditorView.editable)).toBe(true);
  });

  it('opens light and switches to dark without rebuilding the state', () => {
    handle = createEditor(open().parent, { doc: '::titulo Oi\n', theme: 'dark' });
    expect(handle.view.state.facet(EditorView.darkTheme)).toBe(true);

    handle.setTheme('light');
    expect(handle.view.state.facet(EditorView.darkTheme)).toBe(false);
    expect(handle.getValue()).toBe('::titulo Oi\n');
  });

  it('defaults to the light theme', () => {
    handle = createEditor(open().parent);
    expect(handle.view.state.facet(EditorView.darkTheme)).toBe(false);
  });

  it('paints the brief language, not plain text', () => {
    const { parent } = open();
    handle = createEditor(parent, { doc: '::titulo Direito **Constitucional**\n' });

    const painted = [...parent.querySelectorAll('.cm-line span')].map((span) => span.textContent);

    expect(painted).toContain('titulo');
    expect(painted).toContain('**Constitucional**');
  });

  it('takes the editor off the page on destroy', () => {
    const { parent } = open();
    handle = createEditor(parent, { doc: 'x' });

    handle.destroy();
    handle = undefined;

    expect(parent.querySelector('.cm-editor')).toBeNull();
  });
});

/**
 * One editor holding several documents, which is what a window with tabs needs (E9.11).
 *
 * Every test here is about the property a `setValue` could not have: that the *history* and
 * the *selection* travel with the document. Swapping text would satisfy "the right words are
 * on screen" and fail all four.
 */
describe('document snapshots', () => {
  it('puts back the text a snapshot was taken of', () => {
    handle = createEditor(open().parent, { doc: 'first' });
    const first = handle.snapshot();

    handle.restore(handle.blank('second'));
    expect(handle.getValue()).toBe('second');

    handle.restore(first);
    expect(handle.getValue()).toBe('first');
  });

  it('keeps each document undo stack to itself', () => {
    handle = createEditor(open().parent, { doc: 'a' });
    type(handle, ' edited');
    const first = handle.snapshot();

    handle.restore(handle.blank('b'));
    type(handle, ' also edited');
    // The acceptance criterion in its literal form: this undo belongs to the second
    // document and takes back only what was typed into it.
    undo(handle);
    expect(handle.getValue()).toBe('b');

    handle.restore(first);
    expect(handle.getValue()).toBe('a edited');
    undo(handle);
    expect(handle.getValue()).toBe('a');
  });

  it('does not put the tab switch itself on the undo stack', () => {
    handle = createEditor(open().parent, { doc: 'start' });
    const first = handle.snapshot();
    handle.restore(handle.blank(''));

    // A change transaction would have made the swap undoable, so one undo in the fresh
    // document would paste `start` back in. `setState` is what stops that.
    undo(handle);
    expect(handle.getValue()).toBe('');

    handle.restore(first);
    expect(handle.getValue()).toBe('start');
  });

  it('restores where the cursor was', () => {
    handle = createEditor(open().parent, { doc: 'abcdef' });
    handle.view.dispatch({ selection: { anchor: 4 } });
    const first = handle.snapshot();

    handle.restore(handle.blank('other'));
    expect(handle.view.state.selection.main.head).toBe(0);

    handle.restore(first);
    expect(handle.view.state.selection.main.head).toBe(4);
  });

  it('gives a new document this editor own extensions rather than a bare state', () => {
    const registry = createCommandRegistry();
    const { parent } = open();
    handle = createEditor(parent, { doc: 'x', commands: registry, theme: 'dark' });

    handle.restore(handle.blank('::titulo Direito\n'));

    // The registry, the language and the theme are what make two tabs behave like one
    // editor rather than like two editors that happen to share a window.
    expect(commandRegistryOf(handle.view)).toBe(registry);
    expect(handle.view.state.facet(EditorView.darkTheme)).toBe(true);
    expect([...parent.querySelectorAll('.cm-line span')].map((span) => span.textContent)).toContain(
      'titulo',
    );
  });

  it('notifies nobody when a document is swapped', () => {
    handle = createEditor(open().parent, { doc: 'x' });
    const seen: string[] = [];
    handle.onChange((value) => seen.push(value));

    const first = handle.snapshot();
    handle.restore(handle.blank('y'));
    handle.restore(first);

    // A host switching tabs already knows what it switched to; a notification here would
    // look to the host exactly like the person having typed the other document.
    expect(seen).toEqual([]);
  });
});
