import { EditorSelection } from '@codemirror/state';
import { type EditorView, runScopeHandlers } from '@codemirror/view';
import { Vim, getCM } from '@replit/codemirror-vim';
import { afterEach, describe, expect, it } from 'vitest';

import { type CommandRegistry, createCommandRegistry } from './commands.js';
import { createEditor, type EditorHandle } from './editor.js';
import { EDITOR_RENDER, EDITOR_SAVE } from './keymap.js';
import { defaultExCommands } from './vim-mode.js';

const BRIEF = ['---', 'template: promo-curso', '---', '::titulo Direito', '::subtitulo Turma'].join(
  '\n',
);

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const open = (commands: CommandRegistry, vim = false): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, { doc: BRIEF, commands, vim });
  return handle;
};

const seenCommands = (registry: CommandRegistry, ...ids: readonly string[]): string[] => {
  const seen: string[] = [];
  for (const id of ids) {
    registry.register({
      id,
      run: () => {
        seen.push(id);
      },
    });
  }
  return seen;
};

/**
 * The engine's own declarations disagree with each other, so the cast is here and once.
 *
 * `getCM` returns a `CodeMirror` whose `state.vim` is `vimState | null`, and `handleEx` and
 * `handleKey` take a `CodeMirrorV` whose `state.vim` is not nullable — the same object, two
 * spellings, and only one of them is reachable from outside the package. Narrowing it here
 * keeps the cast out of `vim-mode.ts`, where nothing needs it.
 */
type VimEditor = Parameters<typeof Vim.handleEx>[0];

const vimEditor = (view: EditorView): VimEditor => {
  const adapter = getCM(view);
  if (adapter === null) throw new Error('the view is not in vim mode');
  return adapter as unknown as VimEditor;
};

/** Runs `:input`, without going through a dialog jsdom cannot draw. */
const ex = (view: EditorView, input: string): void => {
  Vim.handleEx(vimEditor(view), input);
};

describe('vim mode', () => {
  /** The card's first acceptance criterion. */
  it('preserves the document and the cursor when it is switched on', () => {
    const editor = open(createCommandRegistry());
    const at = BRIEF.indexOf('Direito');
    editor.view.dispatch({ selection: EditorSelection.cursor(at) });

    editor.setVimMode(true);

    expect(editor.isVimMode()).toBe(true);
    expect(editor.getValue()).toBe(BRIEF);
    expect(editor.view.state.selection.main.head).toBe(at);
  });

  it('preserves them again on the way back out', () => {
    const editor = open(createCommandRegistry(), true);
    const at = BRIEF.indexOf('Turma');
    editor.view.dispatch({ selection: EditorSelection.cursor(at) });

    editor.setVimMode(false);

    expect(editor.isVimMode()).toBe(false);
    expect(editor.getValue()).toBe(BRIEF);
    expect(editor.view.state.selection.main.head).toBe(at);
  });

  it('ignores a toggle to the mode it is already in', () => {
    const editor = open(createCommandRegistry());

    editor.setVimMode(false);

    expect(editor.isVimMode()).toBe(false);
    expect(editor.getValue()).toBe(BRIEF);
  });

  /**
   * The card's second acceptance criterion, both halves of it: `:w` and `Ctrl-S` name the
   * same id, so they cannot become two different saves.
   */
  it('runs the same save command from :w and from Mod-s', () => {
    const registry = createCommandRegistry();
    const seen = seenCommands(registry, EDITOR_SAVE);
    const editor = open(registry, true);

    ex(editor.view, 'w');
    expect(seen).toEqual([EDITOR_SAVE]);

    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true }),
      'editor',
    );
    expect(seen).toEqual([EDITOR_SAVE, EDITOR_SAVE]);
  });

  it('runs render from :render', () => {
    const registry = createCommandRegistry();
    const seen = seenCommands(registry, EDITOR_RENDER);
    const editor = open(registry, true);

    ex(editor.view, 'render');

    expect(seen).toEqual([EDITOR_RENDER]);
  });

  it('says nothing and does nothing for an ex-command whose id is not installed', () => {
    const editor = open(createCommandRegistry(), true);

    expect(() => ex(editor.view, 'w')).not.toThrow();
    expect(editor.getValue()).toBe(BRIEF);
  });

  /**
   * `u` has to reach the same stack `Ctrl-Z` does. Without the engine's undo being pointed
   * at the registry, this toggle would be skipped and vim would undo the text underneath
   * it — two undos in one editor, which is the thing the card exists to prevent.
   */
  it('undoes an app-level command from vim u', () => {
    const registry = createCommandRegistry();
    const state = { format: 'feed' };
    registry.register({
      id: 'preview.toggleFormat',
      run: () => {
        state.format = 'story';
      },
      undo: () => {
        state.format = 'feed';
      },
    });
    const editor = open(registry, true);

    registry.run('preview.toggleFormat', { view: editor.view });
    expect(state.format).toBe('story');

    Vim.handleKey(vimEditor(editor.view), 'u', 'user');

    expect(state.format).toBe('feed');
  });

  it('has no vim adapter at all while the mode is off', () => {
    const editor = open(createCommandRegistry());

    expect(getCM(editor.view)).toBeNull();
  });
});

describe('defaultExCommands', () => {
  it('maps the two the card names, with w as the abbreviation of write', () => {
    expect(defaultExCommands).toEqual([
      { name: 'write', shortName: 'w', command: EDITOR_SAVE },
      { name: 'render', command: EDITOR_RENDER },
    ]);
  });
});
