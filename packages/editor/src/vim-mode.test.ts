// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state';
import { type EditorView, runScopeHandlers } from '@codemirror/view';
import { Vim, getCM } from '@replit/codemirror-vim';
import { afterEach, describe, expect, it } from 'vitest';

import { type CommandRegistry, createCommandRegistry } from './commands.js';
import { createEditor, cursorOf, type EditorHandle } from './editor.js';
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

/**
 * A table binding limited to one half of vim (TYTO-207, ADR 0074).
 *
 * The engine keeps insert mode in its own state, so the binding asks it at the keystroke and
 * answers `false` in the other half, which lets the key travel on as if it were not bound.
 */
describe('a binding with when vim.normal', () => {
  const altJ = () => new KeyboardEvent('keydown', { key: 'j', altKey: true });

  it('runs in normal mode, not in insert mode, and again after Escape', () => {
    const registry = createCommandRegistry();
    const seen = seenCommands(registry, 'preview.zoomIn');
    const parent = document.createElement('div');
    document.body.append(parent);
    handle = createEditor(parent, {
      doc: BRIEF,
      commands: registry,
      vim: true,
      vimKeymap: {
        id: 'vim',
        bindings: [{ key: 'Alt-j', command: 'preview.zoomIn', when: 'vim.normal' }],
      },
    });
    const view = handle.view;

    expect(runScopeHandlers(view, altJ(), 'editor')).toBe(true);
    Vim.handleKey(vimEditor(view), 'i', 'user');
    expect(runScopeHandlers(view, altJ(), 'editor')).toBe(false);
    Vim.handleKey(vimEditor(view), '<Esc>', 'user');
    expect(runScopeHandlers(view, altJ(), 'editor')).toBe(true);

    expect(seen).toEqual(['preview.zoomIn', 'preview.zoomIn']);
  });

  it('reaches a tab built before the bindings changed, when that tab is shown', () => {
    const registry = createCommandRegistry();
    const seen = seenCommands(registry, 'preview.zoomIn');
    const editor = open(registry, true);
    const older = editor.blank('outro');

    editor.setKeymaps({
      normal: { id: 'desktop', bindings: [] },
      vim: { id: 'vim', bindings: [{ key: 'Alt-j', command: 'preview.zoomIn' }] },
    });
    editor.restore(older);

    expect(runScopeHandlers(editor.view, altJ(), 'editor')).toBe(true);
    expect(seen).toEqual(['preview.zoomIn']);
  });
});

describe('the vim status a host draws itself (TYTO-248)', () => {
  const press = (view: EditorView, key: string): void => {
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  };

  it('reports the mode and the pending keys from the public events, and null when off', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    // Born in vim: the library adds its status line only to a view created with it — a
    // reconfigure into vim does not draw one (measured, TYTO-248) — so this is the case where
    // `status: false` is what keeps the mode from being said twice.
    handle = createEditor(parent, { doc: BRIEF, vim: true, vimStatus: false });
    const seen: (string | null)[] = [];
    handle.onVimStatus((status) => {
      seen.push(status === null ? null : `${status.mode}|${status.pending}`);
    });

    press(handle.view, 'd');
    press(handle.view, 'w');
    press(handle.view, 'v');
    expect(parent.querySelector('.cm-vim-panel')).toBeNull();
    handle.setVimMode(false);
    handle.setVimMode(true);

    expect(seen).toEqual(['normal|', 'normal|d', 'normal|', 'visual|', null, 'normal|']);
  });

  it('does not let a mode change with no key behind it swallow the next key', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    handle = createEditor(parent, { doc: BRIEF, vim: true, vimStatus: false });
    let pending = '';
    handle.onVimStatus((status) => {
      pending = status?.pending ?? '';
    });

    // What a mouse selection does: the engine changes mode, and no keypress follows.
    Vim.handleKey(vimEditor(handle.view), 'v', 'user');
    Vim.handleKey(vimEditor(handle.view), '<Esc>', 'user');
    await Promise.resolve();
    press(handle.view, 'd');

    expect(pending).toBe('d');
  });
});

describe('cursorOf', () => {
  it('counts line and column from one, and every selected character', () => {
    const editor = open(createCommandRegistry());
    const at = BRIEF.indexOf('Direito');
    editor.view.dispatch({ selection: EditorSelection.range(at, at + 7) });
    expect(cursorOf(editor.state())).toEqual({ line: 4, column: 17, selected: 7 });
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
