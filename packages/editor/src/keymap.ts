import { type Extension } from '@codemirror/state';
import { type KeyBinding, keymap } from '@codemirror/view';

import { EDITOR_REDO, EDITOR_UNDO, commandRegistryOf } from './commands.js';
import { EDITOR_FIND, EDITOR_FIND_NEXT, EDITOR_FIND_PREVIOUS, EDITOR_GOTO_LINE } from './search.js';

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
    // Find and replace (E8.5). The keys are CodeMirror's own from `searchKeymap`, rebound
    // through ids so the palette and the editor read one table — `Mod-Alt-g` for go-to-line
    // included, odd as it looks, because changing it would make this repository's editor
    // disagree with every other CodeMirror one for no reason.
    //
    // **Replace has no key, and that is the whole list CodeMirror binds.** Its panel has one
    // opener and puts the replace fields inside it, so a second opener would be a second
    // name for `Mod-f`; `replaceNext` and `replaceAll` are the panel's two buttons and the
    // palette's two entries. Inventing a keystroke for them would be this card deciding
    // something nobody asked about, and `bindingsOf` shows an entry with no key honestly.
    //
    // `Mod-Shift-g` is written out because a `CommandBinding` has no `shift`, where
    // CodeMirror writes `{ key: 'Mod-g', shift: findPrevious }` — one binding there, two ids
    // here, which is what having ids costs and buys.
    { key: 'Mod-f', command: EDITOR_FIND },
    { key: 'Mod-g', command: EDITOR_FIND_NEXT },
    { key: 'Mod-Shift-g', command: EDITOR_FIND_PREVIOUS },
    { key: 'Mod-Alt-g', command: EDITOR_GOTO_LINE },
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
 *
 * **Find is absent for the same reason undo is, and search still works.** In vim, finding is
 * `/`, `?`, `n` and `N`, and replacing is `:s` — the engine's to interpret, not a key to
 * rebind. And it is not a separate implementation: `@replit/codemirror-vim` imports
 * `SearchQuery` and `setSearchQuery` from `@codemirror/search` and drives the same query
 * state the panel does, so a `/carrossel` typed in vim leaves `carrossel` in the field when
 * `Mod-f` is pressed after switching the mode off. One copy of the package is what makes that
 * true — two would be two `StateEffect` identities and two silently separate searches, which
 * is why `@codemirror/search` is a direct dependency pinned to the version vim already
 * resolved rather than a range.
 *
 * What a person in vim mode does *not* get is the panel, its six toggles and go-to-line by
 * keystroke. The command bar still reaches all six, because it runs ids rather than keys.
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
