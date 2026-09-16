import { type EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type CommandRegistry,
  type EditorCommand,
  EDITOR_REDO,
  EDITOR_UNDO,
  createCommandRegistry,
} from './commands.js';
import { createEditor, type EditorHandle } from './editor.js';
import { EDITOR_RENDER, EDITOR_SAVE, defaultKeymapSet, vimKeymapSet } from './keymap.js';
import {
  EDITOR_FIND,
  EDITOR_FIND_NEXT,
  EDITOR_FIND_PREVIOUS,
  EDITOR_GOTO_LINE,
  EDITOR_REPLACE_ALL,
  EDITOR_REPLACE_NEXT,
} from './search.js';

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const open = (commands: CommandRegistry, doc = ''): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, { doc, commands });
  return handle;
};

/**
 * Runs the binding table the way CodeMirror runs it on a real keydown.
 *
 * `runScopeHandlers` is the documented entry point, and it is the right seam here: what is
 * being tested is that `Mod-s` reaches `editor.save`, not that jsdom delivers a keyboard
 * event — and a test that also depended on the second would fail for the wrong reason.
 */
const press = (view: EditorView, key: string, modifiers: KeyboardEventInit = {}): boolean =>
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...modifiers }), 'editor');

/** `Mod` is Ctrl everywhere jsdom pretends to be. */
const mod = { ctrlKey: true };

const counting = (id: string, seen: string[]): EditorCommand => ({
  id,
  run: () => {
    seen.push(id);
  },
});

describe('the keymap layer', () => {
  it('dispatches the command a binding names', () => {
    const seen: string[] = [];
    const registry = createCommandRegistry();
    registry.register(counting(EDITOR_SAVE, seen));
    const editor = open(registry);

    expect(press(editor.view, 's', mod)).toBe(true);
    expect(seen).toEqual([EDITOR_SAVE]);
  });

  it('dispatches a second binding to a different command', () => {
    const seen: string[] = [];
    const registry = createCommandRegistry();
    registry.register(counting(EDITOR_RENDER, seen));
    const editor = open(registry);

    expect(press(editor.view, 'Enter', mod)).toBe(true);
    expect(seen).toEqual([EDITOR_RENDER]);
  });

  it('lets the key fall through when the command is not installed', () => {
    const registry = createCommandRegistry();
    const editor = open(registry);

    // Nothing registered `editor.save`, so nothing claims the key and the browser's own
    // save dialog is still allowed to open. A binding for a feature the host has not
    // installed must not silently swallow the keystroke.
    expect(press(editor.view, 's', mod)).toBe(false);
  });

  /**
   * `Mod-z` has to reach the registry and not the `historyKeymap` that `baseExtensions`
   * installs underneath. The discriminator is an app-level command that changes nothing in
   * the document: CodeMirror's own undo would find no text event and do nothing.
   */
  it('sends Mod-z to the registry, ahead of CodeMirror own history binding', () => {
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
    const editor = open(registry);

    registry.run('preview.toggleFormat', { view: editor.view });
    expect(state.format).toBe('story');

    expect(press(editor.view, 'z', mod)).toBe(true);
    expect(state.format).toBe('feed');
  });

  it('redoes through Mod-y', () => {
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
    const editor = open(registry);

    registry.run('preview.toggleFormat', { view: editor.view });
    press(editor.view, 'z', mod);

    expect(press(editor.view, 'y', mod)).toBe(true);
    expect(state.format).toBe('story');
  });

  it('does nothing for a key no set binds', () => {
    const registry = createCommandRegistry();
    const editor = open(registry);

    expect(press(editor.view, 'F9')).toBe(false);
  });
});

describe('the built-in sets', () => {
  const idsOf = (set: { bindings: readonly { command: string }[] }): string[] =>
    set.bindings.map((binding) => binding.command);

  it('binds undo, redo, save, render and find in the default set', () => {
    expect(idsOf(defaultKeymapSet)).toEqual([
      EDITOR_UNDO,
      EDITOR_REDO,
      EDITOR_REDO,
      EDITOR_SAVE,
      EDITOR_RENDER,
      EDITOR_FIND,
      EDITOR_FIND_NEXT,
      EDITOR_FIND_PREVIOUS,
      EDITOR_GOTO_LINE,
    ]);
  });

  it('binds no key to either replace command, which is the list CodeMirror binds', () => {
    // Not an omission: the panel has one opener and puts the replace fields inside it, so a
    // second binding would be a second name for `Mod-f`. The two commands are reachable from
    // the panel's buttons and from the command bar, and `bindingsOf` shows them with no
    // keystroke rather than with an invented one (E8.5).
    expect(idsOf(defaultKeymapSet)).not.toContain(EDITOR_REPLACE_NEXT);
    expect(idsOf(defaultKeymapSet)).not.toContain(EDITOR_REPLACE_ALL);
  });

  it('leaves find to the vim engine in the vim set, the way it leaves undo', () => {
    // `/`, `?`, `n` and `N` are vim's, and `@replit/codemirror-vim` drives the *same*
    // `SearchQuery` state the panel does — so search is not missing in vim, it is spelled
    // differently. What is missing is the panel and its toggles, and the command bar still
    // reaches all six by id.
    for (const id of [EDITOR_FIND, EDITOR_FIND_NEXT, EDITOR_GOTO_LINE]) {
      expect(idsOf(vimKeymapSet), id).not.toContain(id);
    }
  });

  it('leaves undo and redo to the engine in the vim set', () => {
    // `u` and `Ctrl-r` are vim's, and binding them here as well would give one keystroke
    // two handlers racing for the same stack.
    expect(idsOf(vimKeymapSet)).not.toContain(EDITOR_UNDO);
    expect(idsOf(vimKeymapSet)).not.toContain(EDITOR_REDO);
  });

  it('keeps save reachable in vim mode, where the muscle memory still is', () => {
    expect(idsOf(vimKeymapSet)).toContain(EDITOR_SAVE);
  });
});
