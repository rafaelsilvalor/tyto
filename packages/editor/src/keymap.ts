import { type Extension } from '@codemirror/state';
import { type KeyBinding, keymap } from '@codemirror/view';

import { EDITOR_REDO, EDITOR_UNDO, commandRegistryOf } from './commands.js';

/**
 * A keymap is a list of bindings to command **ids**, not to functions.
 *
 * That indirection is the whole extension point (`docs/plugin-api.md`, `editor.keymap`):
 * a set can be written, shipped and rebound by someone who has never seen the function
 * that runs, and two sets can name the same command without sharing any code. It is also
 * what makes a binding harmless when the command is not installed — the key falls through
 * to whatever else wants it instead of failing.
 */

export interface CommandBinding {
  /** CodeMirror key notation: `Mod-s`, `Mod-Shift-z`, `F5`. */
  readonly key: string;
  /** Overrides `key` on macOS, the way `@codemirror/commands` spells the same idea. */
  readonly mac?: string;
  readonly command: string;
}

export interface EditorKeymap {
  readonly id: string;
  readonly bindings: readonly CommandBinding[];
}

/**
 * The ids the built-in sets bind that this package does not implement.
 *
 * Saving and rendering belong to the host — `apps/desktop` writes a file, the CLI does
 * not exist in a renderer — so the editor ships the *binding* and the host ships the
 * command. Until it does, the key does nothing and says nothing, which is the correct
 * behaviour for a menu item that is not installed.
 */
export const EDITOR_SAVE = 'editor.save';
export const EDITOR_RENDER = 'editor.render';

const toKeyBinding = (binding: CommandBinding): KeyBinding => ({
  key: binding.key,
  ...(binding.mac === undefined ? {} : { mac: binding.mac }),
  run: (view) => {
    const registry = commandRegistryOf(view);
    if (registry === undefined) return false;
    // `false` for an id nobody registered, so the keystroke keeps travelling.
    return registry.run(binding.command, { view });
  },
});

export const keymapExtension = (set: EditorKeymap): Extension =>
  keymap.of(set.bindings.map(toKeyBinding));

/**
 * The set a host gets when it asks for no particular one.
 *
 * Shaped after `historyKeymap` in `@codemirror/commands`, down to the third redo binding:
 * `Mod-y` is redo everywhere but macOS, where it is `Mod-Shift-z`, and `Ctrl-Shift-z`
 * stays bound on macOS too because a person who came from another platform will try it.
 * The commands behind them are this package's, not CodeMirror's, so an app-level command
 * sitting on top of the stack is undone before the text underneath it.
 */
export const defaultKeymapSet: EditorKeymap = {
  id: 'default',
  bindings: [
    { key: 'Mod-z', command: EDITOR_UNDO },
    { key: 'Mod-y', mac: 'Mod-Shift-z', command: EDITOR_REDO },
    { key: 'Ctrl-Shift-z', command: EDITOR_REDO },
    { key: 'Mod-s', command: EDITOR_SAVE },
    { key: 'Mod-Enter', command: EDITOR_RENDER },
  ],
};

/**
 * The set that rides along with vim mode.
 *
 * Undo and redo are deliberately absent: in vim they are `u` and `Ctrl-r`, and they are
 * the vim engine's to interpret. `vimMode` points the engine's own undo at this package's
 * registry so that the stack stays single — see `vim-mode.ts`.
 *
 * `Mod-s` survives, because a person in vim mode still has the muscle memory, and because
 * losing it would make the mode a worse editor rather than a different one.
 */
export const vimKeymapSet: EditorKeymap = {
  id: 'vim',
  bindings: [
    { key: 'Mod-s', command: EDITOR_SAVE },
    { key: 'Mod-Enter', command: EDITOR_RENDER },
  ],
};

export const keymapSets: Readonly<Record<string, EditorKeymap>> = {
  default: defaultKeymapSet,
  vim: vimKeymapSet,
};
