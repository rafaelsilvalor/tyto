import {
  type EditorPane,
  type NotebookFrame,
  type NotebookMarker,
  cellOutputAt,
  notebookFrameOf,
  notebookInsertOf,
} from '@tyto/editor';
import {
  type BlockEdit,
  type RecipeBlock,
  blockAtLine,
  deleteBlock,
  moveBlock,
  recipeBlocks,
} from '@tyto/recipe';

import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';
import { type ExecutionMark, type StepSlot, blockSlot } from './recipe-notebook.js';

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
 * - **Run from here down** is Run from here; the header's **Run all** is Run recipe.
 *
 * Its second pull request adds a **"+"** on every boundary between blocks and below the last:
 * it offers **Step…**, TYTO-402's picker writing its line there, and **Note**, a `# ` line with
 * the caret after it. Each step's gutter shows its execution counter (`executionOf`).
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
  /** Run this block: its cells, `first` to `last`, and the changed cells above them. */
  readonly runBlock: (documentId: string, first: number, last: number) => void;
  /** Run from here down: cell `first`, the block's first, and every cell below it. */
  readonly runFrom: (documentId: string, first: number) => void;
  /** Run all: Run recipe. */
  readonly runAll: (documentId: string) => void;
  /** Each step's execution counter, as the text is now. */
  readonly execution: (documentId: string, text: string) => readonly ExecutionMark[];
  /** Opens the step picker and form (TYTO-402) and writes the line it answers at `slot`. */
  readonly addStep: (view: EditorView, slot: StepSlot) => void;
}

/** The frames a recipe's pane draws: one per block, the header's with no toolbar. */
export function recipeFrames(view: EditorView, host: BlockHost): readonly NotebookFrame[] {
  const text = view.state.doc.toString();
  const blocks = recipeBlocks(text);
  const documentId = host.documentOf(view);
  const locale = host.locale();
  const marks = documentId === undefined ? [] : host.execution(documentId, text);
  return blocks.map((block, index) => {
    if (block.kind === 'header') {
      return {
        from: block.from,
        to: block.to,
        kind: block.kind,
        key: ['header', locale].join('\u0000'),
        toolbar: () => headerToolbar(view, host, locale),
      };
    }
    // TYTO-676, ADR 0196: a block's result is its last step's, drawn under that step's line.
    const mark = block.steps === undefined ? undefined : blockMark(marks, block.steps);
    const at = block.steps?.lastFrom;
    const result = at !== undefined && documentId !== undefined && host.foldable(documentId, at);
    const folded = result && documentId !== undefined && host.collapsed(documentId, at);
    const up = moveBlock(text, index, 'up') !== undefined;
    const down = moveBlock(text, index, 'down') !== undefined;
    const shape = { kind: block.kind, result, folded, up, down };
    return {
      from: block.from,
      to: block.to,
      kind: block.kind,
      key: [block.kind, result, folded, up, down, locale].join('\u0000'),
      toolbar: () => toolbarOf(view, host, shape, locale),
      insertable: true,
      ...(mark === undefined ? {} : { marker: markerOf(mark, locale) }),
    };
  });
}

/**
 * A block's counter from its steps' (ADR 0196): its latest run's number, which every step that
 * run ran shares; running when a run reaches any of its steps; stale when any of them is not as
 * it ran; never ran when none of them did.
 */
export function blockMark(
  marks: readonly ExecutionMark[],
  steps: { readonly first: number; readonly last: number },
): ExecutionMark | undefined {
  const own = marks.slice(steps.first, steps.last + 1);
  if (own.length === 0) return undefined;
  if (own.some((mark) => mark.state === 'running')) return { state: 'running' };
  // The block's latest run: the highest number its steps carry, all of a run's sharing one.
  const counts = own.flatMap((mark) => (mark.count === undefined ? [] : [mark.count]));
  if (counts.length === 0) return { state: 'never' };
  const count = Math.max(...counts);
  // A step changed since, or not run, makes it stale; one main reused keeps its older number.
  const stale = own.some((mark) => mark.state !== 'ran');
  return { state: stale ? 'stale' : 'ran', count };
}

/** What a step's gutter says: `[n]`, `[*]` while it runs, `[ ]` before it ever ran. */
export function markerOf(mark: ExecutionMark, locale: Locale): NotebookMarker {
  const say = (key: CatalogueKey): string => translate(locale, key);
  switch (mark.state) {
    case 'running':
      return { text: '[*]', className: 'recipe-block-count', title: say('recipe.block.running') };
    case 'never':
      return { text: '[ ]', className: 'recipe-block-count', title: say('recipe.block.never') };
    case 'ran':
    case 'stale': {
      const text = `[${String(mark.count ?? '')}]`;
      if (mark.state === 'ran') return { text, className: 'recipe-block-count' };
      return {
        text,
        className: 'recipe-block-count recipe-block-count--stale',
        title: say('recipe.block.stale'),
      };
    }
  }
}

/** The header's toolbar: Run all. */
function headerToolbar(view: EditorView, host: BlockHost, locale: Locale): HTMLElement {
  const toolbar = document.createElement('span');
  toolbar.className = 'recipe-block-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  const label = translate(locale, 'recipe.block.runAll');
  const made = toolbarButton('runAll', label, label);
  made.classList.add('recipe-block-toolbar__button--text');
  made.addEventListener('click', () => {
    const documentId = host.documentOf(view);
    if (documentId !== undefined) host.runAll(documentId);
  });
  toolbar.append(made);
  return toolbar;
}

/** A toolbar button: its glyph or words, and its name said on hover and to a screen reader. */
function toolbarButton(action: string, shown: string, label: string): HTMLButtonElement {
  const made = document.createElement('button');
  made.type = 'button';
  made.className = 'recipe-block-toolbar__button';
  made.dataset['action'] = action;
  made.textContent = shown;
  made.title = label;
  made.setAttribute('aria-label', label);
  // The caret stays where it was: a toolbar is not a click in the text.
  made.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  return made;
}

/**
 * A "+" on a boundary: pressed, it offers Step… and Note, written at the boundary it sits on
 * when chosen (`notebookInsertOf`), not where it was built.
 */
export function insertControl(view: EditorView, host: BlockHost, locale: Locale): HTMLElement {
  const control = document.createElement('span');
  control.className = 'recipe-block-insert';
  const plus = toolbarButton('insert', '+', translate(locale, 'recipe.block.insert'));
  plus.classList.add('recipe-block-insert__plus');
  plus.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('span');
  menu.className = 'recipe-block-insert__menu';
  menu.setAttribute('role', 'menu');
  const close = (): void => {
    control.classList.remove('recipe-block-insert--open');
    plus.setAttribute('aria-expanded', 'false');
  };
  const choice = (action: 'step' | 'note', key: CatalogueKey): void => {
    const made = toolbarButton(action, translate(locale, key), translate(locale, key));
    made.setAttribute('role', 'menuitem');
    made.addEventListener('click', () => {
      close();
      insertAt(view, host, control, action);
    });
    menu.append(made);
  };
  choice('step', 'recipe.block.insertStep');
  choice('note', 'recipe.block.insertNote');
  plus.addEventListener('click', () => {
    const open = !control.classList.contains('recipe-block-insert--open');
    control.classList.toggle('recipe-block-insert--open', open);
    plus.setAttribute('aria-expanded', String(open));
  });
  control.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  control.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node) || !control.contains(event.relatedTarget)) close();
  });
  control.append(plus, menu);
  return control;
}

/** Writes a step (through the picker) or a note at the boundary a "+" sits on now. */
function insertAt(
  view: EditorView,
  host: BlockHost,
  control: HTMLElement,
  what: 'step' | 'note',
): void {
  const place = notebookInsertOf(view, control);
  if (place === undefined) return;
  const text = view.state.doc.toString();
  const index =
    place === 'end' ? -1 : recipeBlocks(text).findIndex((block) => block.from === place.from);
  const slot = blockSlot(text, index === -1 ? 'end' : index);
  if (what === 'step') {
    host.addStep(view, slot);
    return;
  }
  const insert = `${slot.prefix}# ${slot.suffix}`;
  view.dispatch({
    changes: { from: slot.at, insert },
    selection: { anchor: slot.at + slot.prefix.length + 2 },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/** The fold toggle of a cell's result: its table's, its plan's or its view's, not `run`'s. */
const FOLD = '.recipe-cell__toggle:not(.recipe-cell__included-toggle)';

type BlockAction = 'run' | 'runFrom' | 'up' | 'down' | 'delete' | 'collapse';

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
    const made = toolbarButton(action, glyph, translate(locale, key));
    made.disabled = !enabled;
    made.addEventListener('click', () => {
      blockAction(view, host, toolbar, action);
    });
    toolbar.append(made);
  };
  if (shape.kind === 'step') {
    add('run', '▶', 'recipe.block.run');
    add('runFrom', '▶▶', 'recipe.block.runFrom');
  }
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
      if (documentId !== undefined && block.steps !== undefined) {
        host.runBlock(documentId, block.steps.first, block.steps.last);
      }
      return;
    }
    case 'runFrom': {
      const documentId = host.documentOf(view);
      if (documentId !== undefined && block.steps !== undefined) {
        host.runFrom(documentId, block.steps.first);
      }
      return;
    }
    case 'collapse':
      if (block.steps !== undefined) {
        cellOutputAt(view, block.steps.lastFrom)?.querySelector<HTMLButtonElement>(FOLD)?.click();
      }
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
