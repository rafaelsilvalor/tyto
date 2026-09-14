import { type Extension } from '@codemirror/state';
import { type EditorView } from '@codemirror/view';
import { CodeMirror, Vim, vim } from '@replit/codemirror-vim';

import { commandRegistryOf } from './commands.js';
import { keymapExtension, EDITOR_RENDER, EDITOR_SAVE, vimKeymapSet } from './keymap.js';

/**
 * Vim mode (ADR 0006), wired so that it drives the same command registry everything else
 * does.
 *
 * The engine is `@replit/codemirror-vim` and the work here is making it stop being a second
 * editor: `:w` has to be the save the Ctrl+S menu item runs, and `u` has to undo an
 * app-level command that is sitting on top of the stack rather than stepping over it into
 * the text history.
 */

/** `:name` — and `:short` as the abbreviation vim users actually type. */
export interface VimExCommand {
  readonly name: string;
  /** `w` for `write`. Omitted when the full name is already short. */
  readonly shortName?: string;
  readonly command: string;
}

export const defaultExCommands: readonly VimExCommand[] = [
  { name: 'write', shortName: 'w', command: EDITOR_SAVE },
  { name: 'render', command: EDITOR_RENDER },
];

/**
 * The adapter hands its handlers a CM5-shaped editor whose `cm6` is the real view.
 *
 * Typed here rather than trusted: `CM5EditorInterface.cm6` is `any` in the package's own
 * declarations, and an `any` that crosses into this package is one the boundary should
 * narrow rather than spread.
 */
interface VimAdapter {
  readonly cm6: EditorView;
}

const viewOf = (adapter: unknown): EditorView | undefined => {
  const candidate = (adapter as VimAdapter | undefined)?.cm6;
  return candidate instanceof Object ? (candidate as EditorView) : undefined;
};

/**
 * Vim's registrations are global to the module, so this runs once.
 *
 * `Vim.defineEx` and `CodeMirror.commands` are statics on the engine — there is one vim,
 * however many editors are mounted. That is the library's design and not a choice made
 * here, and it is survivable because neither registration closes over an editor: both find
 * the registry through the view they are handed, so two editors with two different
 * registries still each get their own commands.
 */
let installed = false;

const install = (exCommands: readonly VimExCommand[]): void => {
  if (installed) return;
  installed = true;

  for (const entry of exCommands) {
    Vim.defineEx(entry.name, entry.shortName, (adapter: unknown) => {
      const view = viewOf(adapter);
      if (view === undefined) return;
      commandRegistryOf(view)?.run(entry.command, { view });
    });
  }

  /**
   * `u` and `Ctrl-r` go through the registry, not straight to the text history.
   *
   * Without this the editor would have two undos: Ctrl+Z would undo an app-level command
   * and `u` would skip it and undo the paragraph underneath. The card's whole point is one
   * stack, and one stack has to mean one in both modes.
   */
  CodeMirror.commands.undo = (adapter: CodeMirror) => {
    const view = viewOf(adapter);
    if (view !== undefined) commandRegistryOf(view)?.undo({ view });
  };
  CodeMirror.commands.redo = (adapter: CodeMirror) => {
    const view = viewOf(adapter);
    if (view !== undefined) commandRegistryOf(view)?.redo({ view });
  };
};

export interface VimModeOptions {
  /** Replaces the built-in list rather than adding to it. */
  readonly exCommands?: readonly VimExCommand[];
  /** The vim status line at the bottom of the editor. On by default, as vim has one. */
  readonly status?: boolean;
}

/**
 * The extension a host swaps in and out to turn vim on.
 *
 * It carries `vimKeymapSet` with it, so switching modes swaps the bindings and the engine
 * together — a host cannot end up in vim with the default set's `Mod-z` fighting `u` for
 * the same stack.
 */
export function vimMode(options: VimModeOptions = {}): Extension {
  install(options.exCommands ?? defaultExCommands);
  return [vim({ status: options.status ?? true }), keymapExtension(vimKeymapSet)];
}

/** Test seam: the registrations are global and a test that changes them has to undo that. */
export const resetVimRegistrationsForTest = (): void => {
  installed = false;
};
