import {
  type EditorPane,
  type NotebookFrame,
  cellOutputAt,
  enterNotebookCommand,
  isNotebookCommandTarget,
  leaveNotebookCommand,
  selectedNotebookFrame,
  stepNotebookSelection,
  vimToNormal,
} from '@tyto/editor';
import { type RecipeBlock, deleteBlock, recipeBlocks } from '@tyto/recipe';

import { blockSlot, type StepSlot } from './recipe-notebook.js';

/**
 * A recipe's command mode (TYTO-676, ADR 0195 decision 7): Jupyter's keys over a recipe's
 * blocks, as the window's `notebook` keybindings run them. A block is the lines between blank
 * lines (ADR 0196), so every key acts on a whole block: Shift+Enter runs all its steps, O folds
 * its result, its last step's, and A and B write a new block.
 *
 * Command mode is focus on the editor's command target, beside the text (`notebookFrames`):
 * CodeMirror and vim never hear its keys, and its keys never reach the text. It is entered with
 * Escape in the desktop's input mode, Shift+Escape (vim keeps plain Escape) or Ctrl+M, and left
 * with Enter. Every action is one of the toolbar's or the "+"'s, so it is one edit of the text.
 *
 * **Each action acts on the selected block in command mode, and on the cursor's block
 * otherwise**: the command bar lists them with their keys, and run from there, with focus in
 * the bar, they have a block to act on.
 *
 * Delete is D twice, as Jupyter's: the first press arms it on the selected block, a second
 * within {@link DELETE_WINDOW} deletes it. It is one command pressed twice rather than a key
 * sequence, which the window's table does not take (ADR 0074 decision 3); run from the bar it
 * deletes at once, since a person picked it by name.
 */

type EditorView = EditorPane['view'];

/** How long the first D waits for the second, in milliseconds. */
export const DELETE_WINDOW = 1_000;

// Declared beside the commands, which `docs-gen` reads with no DOM in its types.
export type { RecipeBlockAction } from './commands.js';
import type { RecipeBlockAction } from './commands.js';

export interface CommandModeHost {
  readonly documentOf: (view: EditorView) => string | undefined;
  /** Run this block (ADR 0196): its cells, `first` to `last`, and the changed cells above. */
  readonly runBlock: (documentId: string, first: number, last: number) => void;
  /** The step picker and form, writing their line at `slot` (TYTO-402). */
  readonly addStep: (view: EditorView, slot: StepSlot) => void;
  /** The editor's undo, which an app-level command on the stack goes through first. */
  readonly undo: (view: EditorView) => void;
  /** Milliseconds; injected so a test drives D D's window. */
  readonly now: () => number;
}

/** The fold toggle of a cell's result, as the block's toolbar presses it. */
const FOLD = '.recipe-cell__toggle:not(.recipe-cell__included-toggle)';

/** Whether focus is in command mode in this view. */
export const inCommandMode = (view: EditorView): boolean =>
  isNotebookCommandTarget(document.activeElement) &&
  view.scrollDOM.contains(document.activeElement);

/** The block an action acts on: the selected one in command mode, the cursor's otherwise. */
function targetOf(view: EditorView): { block: RecipeBlock; index: number } | undefined {
  const text = view.state.doc.toString();
  const blocks = recipeBlocks(text);
  const selected = inCommandMode(view) ? selectedNotebookFrame(view) : undefined;
  const at = selected?.from ?? view.state.selection.main.head;
  const line = view.state.doc.lineAt(at).number;
  const index = blocks.findIndex((block) => block.firstLine <= line && line <= block.lastLine);
  const block = blocks[index];
  return block === undefined ? undefined : { block, index };
}

const notHeader = (frame: NotebookFrame): boolean => frame.kind !== 'header';

/** The armed D per view: which block, and when. */
const armed = new WeakMap<EditorView, { readonly from: number; readonly at: number }>();

/** Runs one action on a recipe's pane; `false` when it had nothing to act on. */
export function runBlockAction(
  view: EditorView,
  action: RecipeBlockAction,
  host: CommandModeHost,
): boolean {
  if (action === 'commandMode') return enterNotebookCommand(view);
  const commandMode = inCommandMode(view);
  if (action === 'next' || action === 'previous') {
    return commandMode && stepNotebookSelection(view, action === 'next' ? 1 : -1, notHeader);
  }
  if (action === 'undo') {
    host.undo(view);
    return true;
  }
  const target = targetOf(view);
  if (target === undefined) return false;
  const { block, index } = target;
  const text = view.state.doc.toString();
  switch (action) {
    case 'edit':
      // The caret at the end of the block's first line, as Jupyter's Enter puts it in the cell.
      leaveNotebookCommand(view, view.state.doc.lineAt(block.from).to);
      vimToNormal(view);
      return true;
    case 'insertAbove':
    case 'insertBelow': {
      const below = index + 1 < recipeBlocks(text).length ? index + 1 : 'end';
      const place = action === 'insertAbove' && block.kind !== 'header' ? index : below;
      host.addStep(view, blockSlot(text, place));
      return true;
    }
    case 'delete':
      return deleteAction(view, block, index, commandMode, host);
    case 'runAndAdvance': {
      const documentId = host.documentOf(view);
      if (documentId !== undefined && block.steps !== undefined) {
        host.runBlock(documentId, block.steps.first, block.steps.last);
      }
      if (commandMode) {
        stepNotebookSelection(view, 1, notHeader);
        return true;
      }
      // In the text: the caret to the end of the next block's first line, as Jupyter moves to
      // the next cell.
      const next = recipeBlocks(text)[index + 1];
      if (next !== undefined) {
        const anchor = view.state.doc.lineAt(next.from).to;
        view.dispatch({ selection: { anchor }, scrollIntoView: true });
      }
      return true;
    }
    case 'toggleResult': {
      // The block's result is its last step's, drawn under that step's line (ADR 0196).
      if (block.steps === undefined) return false;
      const result = cellOutputAt(view, block.steps.lastFrom);
      const toggle = result?.querySelector<HTMLButtonElement>(FOLD);
      toggle?.click();
      return toggle !== undefined && toggle !== null;
    }
  }
}

/** D: arms in command mode and deletes on the second press; deletes at once otherwise. */
function deleteAction(
  view: EditorView,
  block: RecipeBlock,
  index: number,
  commandMode: boolean,
  host: CommandModeHost,
): boolean {
  if (block.kind === 'header') return false;
  if (commandMode) {
    const first = armed.get(view);
    const now = host.now();
    if (first === undefined || first.from !== block.from || now - first.at > DELETE_WINDOW) {
      armed.set(view, { from: block.from, at: now });
      return true;
    }
  }
  armed.delete(view);
  const edit = deleteBlock(view.state.doc.toString(), index);
  if (edit === undefined) return false;
  view.dispatch({ changes: [...edit.changes], userEvent: 'delete.block', scrollIntoView: true });
  // Command mode stays on the block that took its place, or on the one above at the end.
  if (commandMode) {
    const blocks = recipeBlocks(view.state.doc.toString());
    const next = blocks[index] ?? blocks[index - 1];
    if (next !== undefined) enterNotebookCommand(view, next.from);
  }
  return true;
}
