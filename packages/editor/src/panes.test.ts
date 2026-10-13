// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { EDITOR_UNDO, createCommandRegistry } from './commands.js';
import {
  type EditorHandle,
  type EditorState,
  createEditor,
  hasBeenEdited,
  textOf,
} from './editor.js';
import { isFollower } from './mirror.js';

/**
 * Several panes over one editor, and one document shown in two of them (TYTO-286, ADR 0083).
 * Real views in jsdom, for `editor.test.ts`'s reason: what is asserted is what CodeMirror does.
 */
const mount = (): HTMLElement => {
  const parent = document.createElement('div');
  document.body.append(parent);
  return parent;
};

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

/** Types the way a person does, at the end: a user event, not a programmatic `setValue`. */
const type = (view: EditorView, text: string): void => {
  const at = view.state.doc.length;
  view.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: 'input.type',
  });
};

/** One document in the editor's own pane and a follower of it in a second one. */
const twoPanes = (doc: string) => {
  const editor = createEditor(mount(), { doc, commands: createCommandRegistry() });
  handle = editor;
  const second = editor.createPane(mount());
  second.restore(editor.followerOf(editor));
  return { editor, second };
};

describe('panes', () => {
  it('a second pane shares the editor: a theme change reaches it', () => {
    const editor = createEditor(mount(), { theme: 'light' });
    handle = editor;
    const second = editor.createPane(mount());
    editor.setTheme('dark');
    expect(second.view.state.facet(EditorView.darkTheme)).toBe(true);
  });

  it('tells the host which view a transaction happened in', () => {
    const editor = createEditor(mount(), { doc: 'a' });
    handle = editor;
    const second = editor.createPane(mount());
    second.restore(editor.blank('b'));
    const seen: [string, EditorView][] = [];
    editor.onUpdate((state, view) => seen.push([textOf(state), view]));
    type(second.view, '!');
    expect(seen).toEqual([['b!', second.view]]);
  });
});

describe('one document in two panes', () => {
  it('the copy is a follower and the record is not', () => {
    const { editor, second } = twoPanes('hello');
    expect(isFollower(second.state())).toBe(true);
    expect(isFollower(editor.state())).toBe(false);
  });

  it('typing in the follower shows in the record, and the reverse', () => {
    const { editor, second } = twoPanes('hello');
    type(second.view, ' world');
    expect(textOf(editor.state())).toBe('hello world');
    editor.view.dispatch({ changes: { from: 0, insert: '> ' }, userEvent: 'input.type' });
    expect(textOf(second.state())).toBe('> hello world');
  });

  it('the record keeps the follower’s typing in its own history', () => {
    const { editor, second } = twoPanes('hello');
    type(second.view, '!');
    expect(hasBeenEdited(editor.state())).toBe(true);
    expect(hasBeenEdited(second.state())).toBe(false);
  });

  it('undo asked of the follower undoes in the record, and both panes show it', () => {
    const { editor, second } = twoPanes('hello');
    type(second.view, '!');
    expect(second.runCommand(EDITOR_UNDO)).toBe(true);
    expect(textOf(editor.state())).toBe('hello');
    expect(textOf(second.state())).toBe('hello');
  });

  it('a copied change is not copied back: one change, one record update, one onChange', () => {
    const { editor, second } = twoPanes('hello');
    const records: EditorState[] = [];
    const changes: [string, EditorView][] = [];
    editor.onUpdate((state, view) => {
      if (view === editor.view) records.push(state);
    });
    editor.onChange((value, view) => changes.push([value, view]));
    type(second.view, '!');
    expect(records.map(textOf)).toEqual(['hello!']);
    expect(changes).toEqual([['hello!', second.view]]);
    expect(textOf(second.state())).toBe('hello!');
  });

  it('a pane showing another document is left alone', () => {
    const { editor, second } = twoPanes('hello');
    const third = editor.createPane(mount());
    third.restore(editor.blank('other'));
    type(second.view, '!');
    expect(textOf(third.state())).toBe('other');
  });
});
