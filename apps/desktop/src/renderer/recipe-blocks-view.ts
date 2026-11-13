import { type EditorPane, type NotebookFrame, cellOutputAt, notebookFrameOf } from '@tyto/editor';
import {
  type BlockEdit,
  type RecipeBlock,
  blockAtLine,
  deleteBlock,
  moveBlock,
  recipeBlocks,
} from '@tyto/recipe';

import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';

/**
 * A recipe's blocks in its tab (TYTO-676, ADR 0195): which frames the editor draws, and what
 * each block's toolbar does.
 *
 * The blocks are read from the text the pane shows now (`recipeBlocks`), on every edit. Every
 * action is an edit of that text, dispatched to the pane like a keystroke: undo takes it back,
 * the result and the fold under a line follow their line, and saving writes the text as it
 * stands. Nothing about a block is kept anywhere else.
 *
 * - **Run this block** runs from the first changed cell to this one (`until`), as Run: the
 *   person's approval, so it fetches and it runs in a folder not trusted.
 * - **Up** and **Down** swap the block with the movable one next to it; a header is never
 *   moved nor passed. **Delete** takes its lines; undo brings them back.
 * - **Collapse** presses the fold toggle of the block's own result, so the result's header and
 *   the toolbar are one control with one state, kept by line in the notebook (TYTO-451).
 *
 * A toolbar finds its block on the click, from the frames as the editor read them after the
 * last edit (`notebookFrameOf`), not from the block it was built for: an edit since may have
 * moved it. The toolbar is drawn beside the text, never in it, so a line's text is its own.
 */

/** A pane's view, named through the editor's handle: the desktop does not import CodeMirror. */
type EditorView = EditorPane['view'];

export interface BlockHost {
  readonly locale: () => Locale;
  /** The document a pane shows, or `undefined` for a pane showing none. */
  readonly documentOf: (view: EditorView) => string | undefined;
  /** Whether the line starting at `at` has a result that folds: a table or a plan's lines. */
  readonly foldable: (documentId: string, at: number) => boolean;
  /** Whether the result under the line starting at `at` is folded (TYTO-451). */
  readonly collapsed: (documentId: string, at: number) => boolean;
  /** Run this block: cell `step` and the changed cells above it. */
  readonly runBlock: (documentId: string, step: number) => void;
}

/** The frames a recipe's pane draws: one per block, the header's with no toolbar. */
export function recipeFrames(view: EditorView, host: BlockHost): readonly NotebookFrame[] {
  const text = view.state.doc.toString();
  const blocks = recipeBlocks(text);
  const documentId = host.documentOf(view);
  const locale = host.locale();
  return blocks.map((block, index) => {
    if (block.kind === 'header') {
      return { from: block.from, to: block.to, kind: block.kind, key: 'header' };
    }
    const result =
      block.kind === 'step' && documentId !== undefined && host.foldable(documentId, block.from);
    const folded = result && documentId !== undefined && host.collapsed(documentId, block.from);
    const up = moveBlock(text, index, 'up') !== undefined;
    const down = moveBlock(text, index, 'down') !== undefined;
    const shape = { kind: block.kind, result, folded, up, down };
    return {
      from: block.from,
      to: block.to,
      kind: block.kind,
      key: [block.kind, result, folded, up, down, locale].join('\u0000'),
      toolbar: () => toolbarOf(view, host, shape, locale),
    };
  });
}

/** The fold toggle of a cell's result: its table's, its plan's or its view's, not `run`'s. */
const FOLD = '.recipe-cell__toggle:not(.recipe-cell__included-toggle)';

type BlockAction = 'run' | 'up' | 'down' | 'delete' | 'collapse';

interface ToolbarShape {
  readonly kind: RecipeBlock['kind'];
  readonly result: boolean;
  readonly folded: boolean;
  readonly up: boolean;
  readonly down: boolean;
}

function toolbarOf(
  view: EditorView,
  host: BlockHost,
  shape: ToolbarShape,
  locale: Locale,
): HTMLElement {
  const toolbar = document.createElement('span');
  toolbar.className = 'recipe-block-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  const add = (action: BlockAction, glyph: string, key: CatalogueKey, enabled = true): void => {
    const made = document.createElement('button');
    made.type = 'button';
    made.className = 'recipe-block-toolbar__button';
    made.dataset['action'] = action;
    made.textContent = glyph;
    const label = translate(locale, key);
    made.title = label;
    made.setAttribute('aria-label', label);
    made.disabled = !enabled;
    // The caret stays where it was: a toolbar is not a click in the text.
    made.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    made.addEventListener('click', () => {
      blockAction(view, host, toolbar, action);
    });
    toolbar.append(made);
  };
  if (shape.kind === 'step') add('run', '▶', 'recipe.block.run');
  add('up', '↑', 'recipe.block.up', shape.up);
  add('down', '↓', 'recipe.block.down', shape.down);
  add('delete', '✕', 'recipe.block.delete');
  if (shape.result) {
    add(
      'collapse',
      shape.folded ? '▸' : '▾',
      shape.folded ? 'recipe.cell.expand' : 'recipe.cell.collapse',
    );
  }
  return toolbar;
}

/** What a toolbar's button does to the block its element sits in now. */
function blockAction(
  view: EditorView,
  host: BlockHost,
  toolbar: HTMLElement,
  action: BlockAction,
): void {
  const frame = notebookFrameOf(view, toolbar);
  if (frame === undefined || frame.from > view.state.doc.length) return;
  const line = view.state.doc.lineAt(frame.from).number;
  const text = view.state.doc.toString();
  const blocks = recipeBlocks(text);
  const block = blockAtLine(blocks, line);
  if (block === undefined) return;
  const index = blocks.indexOf(block);
  switch (action) {
    case 'run': {
      const documentId = host.documentOf(view);
      if (documentId !== undefined && block.step !== undefined) {
        host.runBlock(documentId, block.step);
      }
      return;
    }
    case 'collapse':
      cellOutputAt(view, block.from)?.querySelector<HTMLButtonElement>(FOLD)?.click();
      return;
    case 'up':
    case 'down':
      dispatchEdit(view, moveBlock(text, index, action), 'move.block');
      return;
    case 'delete':
      dispatchEdit(view, deleteBlock(text, index), 'delete.block');
      return;
  }
}

/** One edit to the pane, as a keystroke is: undone in one step, the caret on the block. */
function dispatchEdit(view: EditorView, edit: BlockEdit | undefined, userEvent: string): void {
  if (edit === undefined) return;
  const anchor = edit.at ?? edit.changes[0]?.from ?? 0;
  view.dispatch({
    changes: [...edit.changes],
    selection: { anchor: Math.min(anchor, lengthAfter(view, edit)) },
    scrollIntoView: true,
    userEvent,
  });
  view.focus();
}

/** The document's length once an edit is applied, so the caret never lands past its end. */
function lengthAfter(view: EditorView, edit: BlockEdit): number {
  return edit.changes.reduce(
    (length, change) => length - (change.to - change.from) + change.insert.length,
    view.state.doc.length,
  );
}
