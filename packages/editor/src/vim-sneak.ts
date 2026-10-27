import { EditorSelection, type Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';
import { getCM } from '@replit/codemirror-vim';

import type { VimOperation } from './vim-contributions.js';
import { readVimKeys } from './vim-key-reader.js';

/**
 * vim-sneak as operations a vim contribution maps keys onto (TYTO-419, ADR 0143 amendment):
 * `s{char}{char}` jumps to the next occurrence of the two characters, `S{char}{char}` to the
 * previous one, anywhere in the buffer; a count picks the Nth, the match is case-sensitive and
 * nothing wraps. The two keys are read by `vim-key-reader.ts`; Escape cancels. A jump is not an
 * edit, so `.` still repeats the last change.
 *
 * **`;` and `,` repeat the most recent find, sneak or `f`/`t`**, as vim-sneak does (Rafael,
 * 2026-10-27). Which one came last is tracked per view from the engine's public events; when
 * it was `f`, `F`, `t` or `T` the repeat is done here, by the engine's own arithmetic, because
 * the engine keeps its last character search in its internals. `;` after an operator (`d;`)
 * is still the engine's: a normal-mode mapping never matches while an operator is pending.
 */

/** The last find in a view: a sneak, or the engine's `f`/`F`/`t`/`T`. */
export type VimFind =
  | { readonly kind: 'sneak'; readonly pair: string; readonly backward: boolean }
  | {
      readonly kind: 'character';
      readonly character: string;
      readonly forward: boolean;
      readonly till: boolean;
    };

const lastFinds = new WeakMap<EditorView, VimFind>();

/** Test seam, and what the repeat reads: the last find typed in this view. */
export const lastVimFind = (view: EditorView): VimFind | undefined => lastFinds.get(view);

/** The offset of the `count`th `pair` after `head` (or before it), or nothing. */
export function sneakTarget(
  text: string,
  head: number,
  pair: string,
  backward: boolean,
  count: number,
): number | undefined {
  let at = head;
  for (let found = 0; found < count; found++) {
    at = backward ? (at <= 0 ? -1 : text.lastIndexOf(pair, at - 1)) : text.indexOf(pair, at + 1);
    if (at < 0) return undefined;
  }
  return at;
}

/**
 * Where `;` (or `,`, `reverse`) lands after `f`/`t`, on the cursor's line, as the engine's
 * `repeatLastCharacterSearch` computes it: a `t` repeat starts one character further on, so
 * `;` does not stay put on the character just before the match. `column` is the cursor's.
 */
export function characterRepeatTarget(
  line: string,
  column: number,
  find: Extract<VimFind, { kind: 'character' }>,
  reverse: boolean,
  count: number,
): number | undefined {
  const forward = find.forward !== reverse;
  const increment = (find.till ? 1 : 0) * (forward ? -1 : 1);
  let start = column - increment;
  for (let found = 0; found < count; found++) {
    start = forward
      ? line.indexOf(find.character, start + 1)
      : start <= 0
        ? -1
        : line.lastIndexOf(find.character, start - 1);
    if (start < 0) return undefined;
  }
  return start + increment;
}

const moveTo = (view: EditorView, offset: number | undefined): void => {
  if (offset === undefined) return;
  view.dispatch({ selection: EditorSelection.cursor(offset), scrollIntoView: true });
};

const jump = (view: EditorView, pair: string, backward: boolean, count: number): void => {
  lastFinds.set(view, { kind: 'sneak', pair, backward });
  const head = view.state.selection.main.head;
  moveTo(view, sneakTarget(view.state.doc.toString(), head, pair, backward, count));
};

const sneak: VimOperation = {
  kind: 'action',
  run: (view, args, repeat) => {
    readVimKeys(view, 2, (keys) => {
      jump(view, keys.join(''), args['backward'] === true, Math.max(1, repeat));
    });
  },
};

const repeatFind: VimOperation = {
  kind: 'action',
  run: (view, args, repeat) => {
    const find = lastFinds.get(view);
    const reverse = args['reverse'] === true;
    const count = Math.max(1, repeat);
    if (find === undefined) return;
    if (find.kind === 'sneak') {
      jump(view, find.pair, find.backward !== reverse, count);
      return;
    }
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const column = characterRepeatTarget(line.text, head - line.from, find, reverse, count);
    moveTo(view, column === undefined ? undefined : line.from + column);
  },
};

/** The character a key stands for in `f<character>`, as the engine names keys. */
const characterOf = (key: string): string | undefined => {
  if (key === '<Space>') return ' ';
  if (key === '<lt>') return '<';
  return [...key].length === 1 ? key : undefined;
};

const FIND_KEYS: Readonly<Record<string, { forward: boolean; till: boolean }>> = {
  f: { forward: true, till: false },
  F: { forward: false, till: false },
  t: { forward: true, till: true },
  T: { forward: false, till: true },
};

/**
 * The find a whole command's keys end in, or nothing: `fx`, `3tx`, `dFx`, `vf ` do; `rf`, `mt`
 * and `"tx` (a delete into register `t`) do not, because there the letter is another key's
 * argument rather than a motion.
 */
export function findOf(keys: readonly string[]): VimFind | undefined {
  const motion = FIND_KEYS[keys.at(-2) ?? ''];
  const character = characterOf(keys.at(-1) ?? '');
  if (motion === undefined || character === undefined || keys.at(-3) === '"') return undefined;
  return { kind: 'character', character, ...motion };
}

/**
 * Follows the engine's public events (`vim-keypress`, `vim-command-done`), as `vimStatusPlugin`
 * does, to know when `f`/`t` ran. A command's last key is reported after the command is done,
 * so a done command is read with the key that follows its signal, or alone at the end of the
 * task when no key follows (a mouse selection, an ex command).
 */
export const vimFindTracker: Extension = ViewPlugin.define((view) => {
  const adapter = getCM(view);
  let keys: string[] = [];
  let done = false;
  const finish = (): void => {
    const find = findOf(keys);
    if (find !== undefined) lastFinds.set(view, find);
    keys = [];
    done = false;
  };
  adapter?.on('vim-command-done', () => {
    done = true;
    queueMicrotask(() => {
      if (done) finish();
    });
  });
  adapter?.on('vim-keypress', (key: string) => {
    keys.push(key);
    if (done) finish();
  });
  return {};
});

export const VIM_SNEAK_OPERATIONS: ReadonlyMap<string, VimOperation> = new Map([
  ['sneak', sneak],
  ['sneak.repeat', repeatFind],
]);
