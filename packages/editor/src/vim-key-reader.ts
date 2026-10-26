import { type Extension, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * Reads the keys a vim operation asks for after its own, as vim's `getchar()` does
 * (TYTO-418, ADR 0143 amendment): the `)` of `ysiw)`, the `"` of `ds"`, the `"'` of `cs"'`.
 *
 * The engine has no way to ask for a key after a motion. `f<character>` and `r<character>`
 * work because the key is part of the mapping, but a mapping can end in only one
 * `<character>`, and `ys` must first let an arbitrary motion run. So the keys are taken
 * before the engine sees them: a keydown handler ahead of vim's own, which does nothing
 * unless a read is waiting on that view.
 */

interface PendingRead {
  readonly wanted: number;
  readonly keys: string[];
  readonly done: (keys: readonly string[]) => void;
}

const pending = new WeakMap<EditorView, PendingRead>();

/** Hands the next `count` typed characters to `done`, or nothing when the read is cancelled. */
export function readVimKeys(
  view: EditorView,
  count: number,
  done: (keys: readonly string[]) => void,
): void {
  pending.set(view, { wanted: count, keys: [], done });
}

/** Keys that are pressed on the way to a character and are not one, so the read waits on. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Dead']);

/**
 * A character is one printable key with no Ctrl or Meta. Anything else — Escape included —
 * cancels the read and goes on to vim, as Escape cancels a pending `ds` in vim-surround.
 */
export const vimKeyReader: Extension = Prec.highest(
  EditorView.domEventHandlers({
    keydown: (event, view) => {
      const read = pending.get(view);
      if (read === undefined || MODIFIERS.has(event.key)) return false;
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey) {
        pending.delete(view);
        return false;
      }
      event.preventDefault();
      read.keys.push(event.key);
      if (read.keys.length === read.wanted) {
        pending.delete(view);
        read.done(read.keys);
      }
      return true;
    },
  }),
);

/** Test seam: whether a read is waiting on the view. */
export const isReadingVimKeys = (view: EditorView): boolean => pending.has(view);
