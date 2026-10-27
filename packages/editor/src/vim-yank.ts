import { type Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import { Vim, getCM } from '@replit/codemirror-vim';

import { palette } from './theme.js';
import type { VimRange } from './vim-contributions.js';

/**
 * Knowing that vim yanked, and flashing what it yanked (TYTO-419, ADR 0143 amendment).
 *
 * The engine signals no yank, and `y` is its own operator, which cannot be wrapped. So a yank
 * is inferred from public surfaces only, never `cm.state.vim`: the engine says a command is
 * done (`vim-command-done`) **before** its motion and operator run, so that signal opens a
 * window that closes at the next one or at the end of the task. Inside it the last selection
 * that covered text is the range the operator was handed (the engine selects it first), and a
 * yank is a window that left the document as it was while it changed the registers read
 * through `Vim.getRegisterController()`: a new register `0`, or new text in the unnamed one
 * (`"ayiw` leaves `0` alone).
 *
 * The detector is its own piece so TYTO-442 can write the system clipboard from it.
 */

/** What a yank took: the ranges it covered (a line's last line break left out) and the text. */
export interface VimYank {
  readonly ranges: readonly VimRange[];
  readonly text: string;
  readonly linewise: boolean;
}

export type VimYankListener = (yank: VimYank) => void;

const listeners = new WeakMap<EditorView, Set<VimYankListener>>();

/** Calls `listener` after each yank in `view`; the function returned stops it. */
export function onVimYank(view: EditorView, listener: VimYankListener): () => void {
  const set = listeners.get(view) ?? new Set<VimYankListener>();
  listeners.set(view, set);
  set.add(listener);
  return () => set.delete(listener);
}

interface RegisterSnapshot {
  readonly zero: object;
  readonly text: string;
  readonly linewise: boolean;
}

/** `getRegister('0')` creates an empty register `0` if none exists yet, as the engine does. */
const registers = (): RegisterSnapshot => {
  const controller = Vim.getRegisterController();
  const unnamed = controller.getRegister('"');
  return {
    zero: controller.getRegister('0'),
    text: unnamed.toString(),
    linewise: unnamed.linewise === true,
  };
};

interface Window {
  readonly before: RegisterSnapshot;
  ranges: readonly VimRange[];
  docChanged: boolean;
}

const yankDetector = ViewPlugin.define((view) => {
  let open: Window | undefined;
  const close = (): void => {
    const window = open;
    open = undefined;
    if (window === undefined || window.docChanged) return;
    const after = registers();
    const { before } = window;
    if (
      after.zero === before.zero &&
      after.text === before.text &&
      after.linewise === before.linewise
    ) {
      return;
    }
    const doc = view.state.doc;
    const ranges = window.ranges.map(({ from, to }) =>
      after.linewise && to > from && doc.sliceString(to - 1, to) === '\n'
        ? { from, to: to - 1 }
        : { from, to },
    );
    for (const listener of listeners.get(view) ?? []) {
      listener({ ranges, text: after.text, linewise: after.linewise });
    }
  };
  getCM(view)?.on('vim-command-done', () => {
    close();
    open = { before: registers(), ranges: [], docChanged: false };
    queueMicrotask(close);
  });
  return {
    update: (update) => {
      if (open === undefined) return;
      for (const transaction of update.transactions) {
        if (transaction.docChanged) open.docChanged = true;
        const selection = transaction.selection;
        if (selection !== undefined && selection.ranges.some((range) => !range.empty)) {
          open.ranges = selection.ranges
            .filter((range) => !range.empty)
            .map(({ from, to }) => ({ from, to }));
        }
      }
    },
  };
});

let flashOn = true;

/** Switches the yank flash for every editor of the window, as `setVimContributions` does. */
export function setVimYankFlash(on: boolean): void {
  flashOn = on;
}

/** How long the yanked text stays marked, as vim-highlightedyank's default (ms). */
export const YANK_FLASH_MS = 200;

const setFlash = StateEffect.define<readonly VimRange[]>();

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (marks, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setFlash)) {
        return Decoration.set(
          effect.value.map(({ from, to }) => FLASH.range(from, to)),
          true,
        );
      }
    }
    return marks.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const FLASH_CLASS = 'cm-tyto-yank-flash';
const FLASH = Decoration.mark({ class: FLASH_CLASS });

/** Test seam: the ranges flashed in the view right now. */
export const flashedYank = (view: EditorView): VimRange[] => {
  const ranges: VimRange[] = [];
  view.state.field(flashField, false)?.between(0, view.state.doc.length, (from, to) => {
    ranges.push({ from, to });
  });
  return ranges;
};

const yankFlash = ViewPlugin.define((view) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = (): void => {
    timer = undefined;
    view.dispatch({ effects: setFlash.of([]) });
  };
  const stop = onVimYank(view, ({ ranges }) => {
    const marked = ranges.filter(({ from, to }) => to > from);
    if (!flashOn || marked.length === 0) return;
    clearTimeout(timer);
    view.dispatch({ effects: setFlash.of(marked) });
    timer = setTimeout(clear, YANK_FLASH_MS);
  });
  return {
    destroy: () => {
      clearTimeout(timer);
      stop();
    },
  };
});

/**
 * The detector and the flash, which `vimMode()` includes. The mark takes the selection's
 * colour, a role every theme already sets, as exchange's marked span does: no new token.
 */
export const vimYankFlash: Extension = [
  yankDetector,
  flashField,
  yankFlash,
  EditorView.baseTheme({ [`.${FLASH_CLASS}`]: { backgroundColor: palette.selection } }),
];

/** Test seam: the switch is module state, as the engine's keymap is. */
export const resetVimYankFlashForTest = (): void => {
  flashOn = true;
};
