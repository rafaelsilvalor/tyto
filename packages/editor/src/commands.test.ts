import { isolateHistory, undoDepth } from '@codemirror/commands';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type CommandContext,
  type EditorCommand,
  EDITOR_REDO,
  EDITOR_UNDO,
  createCommandRegistry,
} from './commands.js';
import { createEditor, type EditorHandle } from './editor.js';
import {
  EDITOR_FIND,
  EDITOR_FIND_NEXT,
  EDITOR_FIND_PREVIOUS,
  EDITOR_GOTO_LINE,
  EDITOR_REPLACE_ALL,
  EDITOR_REPLACE_NEXT,
} from './search.js';

/**
 * Driven through a real `EditorView`, because the claim being tested is about the order of
 * one stack that is half CodeMirror's. A fake history would let this file assert its own
 * arithmetic back at itself; `undoDepth` over a real document is the thing the registry
 * actually reads.
 */
let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const open = (doc = ''): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, { doc });
  return handle;
};

const contextOf = (editor: EditorHandle): CommandContext => ({ view: editor.view });

/**
 * One edit, isolated into its own history event.
 *
 * CodeMirror groups edits that arrive within half a second, and a test that typed twice in
 * a millisecond would be asserting against one undo event while reading as if there were
 * two.
 */
const type = (editor: EditorHandle, text: string): void => {
  editor.view.dispatch({
    changes: { from: editor.view.state.doc.length, insert: text },
    annotations: isolateHistory.of('full'),
  });
};

describe('createCommandRegistry', () => {
  it('keeps commands by id, in registration order', () => {
    const registry = createCommandRegistry();
    registry.register({ id: 'a.one', run: () => {} });
    registry.register({ id: 'a.two', run: () => {} });

    expect(registry.get('a.one')?.id).toBe('a.one');
    // Undo, redo and the six search commands are registered by the registry itself and come
    // first. The order is the order a palette shows, so it is asserted whole rather than by
    // containment: a command that quietly moved to the end would still pass a `toContain`.
    expect(registry.list().map((command) => command.id)).toEqual([
      EDITOR_UNDO,
      EDITOR_REDO,
      EDITOR_FIND,
      EDITOR_FIND_NEXT,
      EDITOR_FIND_PREVIOUS,
      EDITOR_REPLACE_NEXT,
      EDITOR_REPLACE_ALL,
      EDITOR_GOTO_LINE,
      'a.one',
      'a.two',
    ]);
  });

  it('unregisters through the function register returned', () => {
    const registry = createCommandRegistry();
    const remove = registry.register({ id: 'a.one', run: () => {} });

    remove();

    expect(registry.get('a.one')).toBeUndefined();
  });

  it('does not let a stale disposer remove the command that replaced it', () => {
    const registry = createCommandRegistry();
    const remove = registry.register({ id: 'a.one', run: () => {} });
    const replacement: EditorCommand = { id: 'a.one', label: 'replacement', run: () => {} };
    registry.register(replacement);

    remove();

    expect(registry.get('a.one')?.label).toBe('replacement');
  });

  it('answers false for an id nobody registered, so a binding falls through', () => {
    const editor = open();
    const registry = createCommandRegistry();

    expect(registry.run('nothing.here', contextOf(editor))).toBe(false);
  });

  it('runs the command it was asked for', () => {
    const editor = open();
    const registry = createCommandRegistry();
    let ran = 0;
    registry.register({ id: 'a.one', run: () => (ran += 1) });

    expect(registry.run('a.one', contextOf(editor))).toBe(true);
    expect(ran).toBe(1);
  });

  it('refuses a command that both edits the document and declares an undo', () => {
    const editor = open('start');
    const registry = createCommandRegistry();
    registry.register({
      id: 'bad.one',
      run: (context) => {
        context.view.dispatch({ changes: { from: 0, insert: 'x' } });
      },
      undo: () => {},
    });

    expect(() => registry.run('bad.one', contextOf(editor))).toThrow(/undo the change twice/u);
  });
});

describe('the single undo stack', () => {
  /** A command that changes something the document does not hold — the card's "toggle format". */
  const toggleFormat = (state: { format: string }): EditorCommand => {
    let previous = state.format;
    return {
      id: 'preview.toggleFormat',
      run: () => {
        previous = state.format;
        state.format = state.format === 'feed' ? 'story' : 'feed';
      },
      undo: () => {
        state.format = previous;
      },
    };
  };

  it('undoes an app-level command', () => {
    const editor = open();
    const registry = createCommandRegistry();
    const state = { format: 'feed' };
    registry.register(toggleFormat(state));

    registry.run('preview.toggleFormat', contextOf(editor));
    expect(state.format).toBe('story');

    expect(registry.undo(contextOf(editor))).toBe(true);
    expect(state.format).toBe('feed');
  });

  it('redoes it again', () => {
    const editor = open();
    const registry = createCommandRegistry();
    const state = { format: 'feed' };
    registry.register(toggleFormat(state));

    registry.run('preview.toggleFormat', contextOf(editor));
    registry.undo(contextOf(editor));

    expect(registry.redo(contextOf(editor))).toBe(true);
    expect(state.format).toBe('story');
  });

  /**
   * The claim the whole design rests on: text and commands come back in the order they
   * happened, out of one stack, with no bookkeeping beyond `undoDepth`.
   */
  it('interleaves text and commands in the order they happened', () => {
    const editor = open();
    const registry = createCommandRegistry();
    const state = { format: 'feed' };
    registry.register(toggleFormat(state));
    const context = contextOf(editor);

    type(editor, 'first');
    registry.run('preview.toggleFormat', context);
    type(editor, ' second');

    expect(editor.getValue()).toBe('first second');
    expect(state.format).toBe('story');

    registry.undo(context);
    expect(editor.getValue()).toBe('first');
    expect(state.format).toBe('story');

    registry.undo(context);
    expect(editor.getValue()).toBe('first');
    expect(state.format).toBe('feed');

    registry.undo(context);
    expect(editor.getValue()).toBe('');
    expect(state.format).toBe('feed');
  });

  it('redoes the same three in reverse', () => {
    const editor = open();
    const registry = createCommandRegistry();
    const state = { format: 'feed' };
    registry.register(toggleFormat(state));
    const context = contextOf(editor);

    type(editor, 'first');
    registry.run('preview.toggleFormat', context);
    type(editor, ' second');
    registry.undo(context);
    registry.undo(context);
    registry.undo(context);

    registry.redo(context);
    expect(editor.getValue()).toBe('first');
    expect(state.format).toBe('feed');

    registry.redo(context);
    expect(state.format).toBe('story');

    registry.redo(context);
    expect(editor.getValue()).toBe('first second');
  });

  it('drops the redo branch when something new happens, the way a text history does', () => {
    const editor = open();
    const registry = createCommandRegistry();
    const state = { format: 'feed' };
    registry.register(toggleFormat(state));
    const context = contextOf(editor);

    registry.run('preview.toggleFormat', context);
    registry.undo(context);
    registry.run('preview.toggleFormat', context);

    // The undone toggle is gone; redo now has only the text history to fall back on, which
    // is empty.
    expect(registry.redo(context)).toBe(false);
    expect(state.format).toBe('story');
  });

  /**
   * The card's third acceptance criterion. A template switch edits the frontmatter, so it
   * is a document change and CodeMirror's history owns it — the point is that the registry's
   * undo is the one entry point that reaches it.
   */
  it('undoes a template switch, which is a document change', () => {
    const editor = open('---\ntemplate: promo-curso\n---\n::titulo Oi\n');
    const registry = createCommandRegistry();
    registry.register({
      id: 'brief.switchTemplate',
      run: (context) => {
        const line = context.view.state.doc.line(2);
        context.view.dispatch({
          changes: { from: line.from, to: line.to, insert: 'template: carrossel-lista' },
        });
      },
    });
    const context = contextOf(editor);

    registry.run('brief.switchTemplate', context);
    expect(editor.getValue()).toContain('template: carrossel-lista');

    expect(registry.undo(context)).toBe(true);
    expect(editor.getValue()).toContain('template: promo-curso');
  });

  it('answers false when there is nothing left to undo', () => {
    const editor = open();
    const registry = createCommandRegistry();

    expect(registry.undo(contextOf(editor))).toBe(false);
    expect(undoDepth(editor.view.state)).toBe(0);
  });

  it('reaches the same stack through the editor.undo command id', () => {
    const editor = open();
    const registry = createCommandRegistry();
    const state = { format: 'feed' };
    registry.register(toggleFormat(state));
    const context = contextOf(editor);

    registry.run('preview.toggleFormat', context);
    registry.run(EDITOR_UNDO, context);

    expect(state.format).toBe('feed');

    registry.run(EDITOR_REDO, context);
    expect(state.format).toBe('story');
  });
});
