import { type Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';
import { CodeMirror, Vim, getCM, vim } from '@replit/codemirror-vim';

import { commandRegistryOf } from './commands.js';
import {
  type EditorKeymap,
  keymapExtension,
  EDITOR_RENDER,
  EDITOR_SAVE,
  vimKeymapSet,
} from './keymap.js';

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

/**
 * What vim is doing, for a host that draws its own status bar (TYTO-248, ADR 0076).
 *
 * `mode` is vim's own word — `normal`, `insert`, `visual`, `replace` — with `line` or `block`
 * after a visual one, the way the library's status line writes it. `pending` is the keys
 * typed towards a command that has not run yet, such as the `d` of `dw`.
 */
export interface VimStatus {
  readonly mode: string;
  readonly pending: string;
}

/**
 * Follows vim through the library's **public** events only (`vim-mode-change`,
 * `vim-keypress`, `vim-command-done`), never `cm.state.vim`, which is its internals.
 *
 * A key is reported after the engine has handled it, and a command that completed on that
 * very key has already said so — so the key that finishes a command, or changes the mode,
 * must not start a new pending string. `settled` is that memory, and it lasts until the end of
 * the current task only: a mode change with no key behind it — a mouse selection — must not
 * swallow the next key a person types.
 */
const vimStatusPlugin = (report: (status: VimStatus | null) => void): Extension =>
  ViewPlugin.define((view) => {
    const adapter = getCM(view);
    let mode = 'normal';
    let pending = '';
    let settled = false;
    let last = '';
    const settle = (): void => {
      settled = true;
      queueMicrotask(() => {
        settled = false;
      });
    };
    // Once per change: a key that both ends a command and is reported says nothing new.
    const emit = (): void => {
      if (`${mode}|${pending}` === last) return;
      last = `${mode}|${pending}`;
      report({ mode, pending });
    };
    adapter?.on('vim-mode-change', (event: { mode: string; subMode?: string }) => {
      // The library's own reading of `subMode`: absent or empty is a plain visual.
      const sub = event.subMode ?? '';
      mode = sub === '' ? event.mode : `${event.mode} ${sub === 'linewise' ? 'line' : 'block'}`;
      pending = '';
      settle();
      emit();
    });
    adapter?.on('vim-command-done', () => {
      pending = '';
      settle();
      emit();
    });
    adapter?.on('vim-keypress', (key: string) => {
      pending = settled ? '' : `${pending}${key}`;
      settled = false;
      emit();
    });
    emit();
    return {
      destroy: () => {
        report(null);
      },
    };
  });

export interface VimModeOptions {
  /**
   * Called with vim's mode and pending keys whenever they change, and with `null` when vim
   * is switched off. A host with its own status bar passes this and `status: false`.
   */
  readonly onStatus?: (status: VimStatus | null) => void;
  /** Replaces the built-in list rather than adding to it. */
  readonly exCommands?: readonly VimExCommand[];
  /** The vim status line at the bottom of the editor. On by default, as vim has one. */
  readonly status?: boolean;
  /**
   * The bindings that ride along with the engine. Defaults to `vimKeymapSet`; a host with a
   * keybinding table hands in its vim half (TYTO-207).
   */
  readonly keymap?: EditorKeymap;
}

/**
 * The extension a host swaps in and out to turn vim on.
 *
 * It carries a keymap set with it, so switching modes swaps the bindings and the engine
 * together — a host cannot end up in vim with the default set's `Mod-z` fighting `u` for
 * the same stack.
 */
export function vimMode(options: VimModeOptions = {}): Extension {
  install(options.exCommands ?? defaultExCommands);
  return [
    vim({ status: options.status ?? true }),
    // After `vim()`, so the adapter it builds exists when this plugin is constructed.
    ...(options.onStatus === undefined ? [] : [vimStatusPlugin(options.onStatus)]),
    keymapExtension(options.keymap ?? vimKeymapSet),
  ];
}

/** Test seam: the registrations are global and a test that changes them has to undo that. */
export const resetVimRegistrationsForTest = (): void => {
  installed = false;
};
