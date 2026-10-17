import { foldNodeProp, foldedRanges, highlightingFor } from '@codemirror/language';
import { type EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { type SyntaxNode } from '@lezer/common';
import { highlightTree } from '@lezer/highlight';

import { treeAt } from './syntax.js';
import { monoFont, palette, panels } from './theme.js';

/**
 * Sticky scroll: the head line of every block the top of the pane is inside, pinned there
 * (TYTO-295, ADR 0094) — VS Code's and Zed's "sticky scroll".
 *
 * **Which blocks come from the grammar's fold ranges, not from the text's indent.** A brief's
 * `::lamina` folds to its head line, a template's element to its opening tag, a CSS rule to its
 * selector; whatever the language says folds is what can pin, and a language that folds
 * nothing (the JSON tabs) pins nothing. Nothing here assumes a depth: in a brief today a
 * directive's body is text, so at most one line pins, and the template mode's nested elements
 * stack. A brief that one day nests blocks stacks the same way with no change here.
 *
 * Drawn as an absolutely positioned layer inside `view.dom`, starting where the scroller starts
 * (under the find panel, which is a top panel) and stopping short of the scrollbar. Not a
 * `showPanel`, which shrinks the scroller and makes the text jump as a row appears; not a
 * `layer()`, which scrolls with the content. The caret is kept clear of the rows through
 * `scrollMargins`, so arrows, vim's `j`/`k`, search and go-to-line scroll it out from under them.
 */

/** A block the position is inside: its head line, and where its fold range ends. */
export interface StickyBlock {
  /** The head line's number (1-based). */
  readonly line: number;
  /** Where the head line starts, which is where a click on the row puts the caret. */
  readonly from: number;
  /** Where the block's fold range ends: the block is over once the top passes that line. */
  readonly end: number;
}

/**
 * Every block holding `pos` whose head line is above `pos`'s line, outermost first.
 *
 * From the innermost node at `pos` up through its parents, every node with a `foldNodeProp`
 * whose range contains `pos`. A block that is folded is left out: its body is not on screen,
 * so nothing below its head can be inside it.
 */
export function stickyChain(state: EditorState, pos: number): readonly StickyBlock[] {
  const line = state.doc.lineAt(pos).number;
  const folded = foldedRanges(state);
  const blocks: StickyBlock[] = [];
  const innermost = treeAt(state, pos).resolveInner(pos, 1);
  for (let node: SyntaxNode | null = innermost; node !== null; node = node.parent) {
    const fold = node.type.prop(foldNodeProp);
    if (fold === undefined) continue;
    const range = fold(node, state);
    if (range === null || pos <= range.from || pos > range.to) continue;
    const head = state.doc.lineAt(node.from);
    if (head.number >= line) continue;
    let isFolded = false;
    folded.between(range.from, range.to, (from, to) => {
      if (from === range.from && to === range.to) isFolded = true;
    });
    if (isFolded) continue;
    blocks.push({ line: head.number, from: head.from, end: range.to });
  }
  return blocks.reverse();
}

/** At most this many rows, VS Code's default, and never more than a third of the pane. */
export const STICKY_MAX_ROWS = 5;

/** One pinned row: the block it names and its top, from the pane's top edge, in pixels. */
export interface StickyRow {
  readonly block: StickyBlock;
  readonly top: number;
}

/** What `stickyRows` needs to know about the pane, in pixels from the document's top. */
export interface StickyMeasure {
  /** The document height at the pane's top edge. */
  readonly top: number;
  readonly lineHeight: number;
  readonly paneHeight: number;
  /** The blocks the line at document height `height` is inside, outermost first. */
  chainAt(height: number): readonly StickyBlock[];
  /** The document height of the bottom of the line a block ends on. */
  endBottom(block: StickyBlock): number;
  /**
   * The caret's line, in document heights, when the caret was last moved from the keyboard;
   * `null` otherwise. A row that would cover it is not drawn, nor any below it.
   */
  readonly caret: { readonly top: number; readonly bottom: number } | null;
}

/**
 * The rows to draw, outermost first.
 *
 * The chain at the top line, then grown with the chain at the line just under the rows, until
 * it stops growing — the rows hide lines, and a block that starts under them is still one the
 * reader is inside (VS Code's algorithm). Capped at `STICKY_MAX_ROWS` and a third of the pane.
 * A block whose last line reaches its row pushes the row up with it, so a row leaves the way
 * its block does.
 */
export function stickyRows(measure: StickyMeasure): readonly StickyRow[] {
  const { top, lineHeight, paneHeight } = measure;
  if (lineHeight <= 0) return [];
  const cap = Math.min(STICKY_MAX_ROWS, Math.floor(paneHeight / 3 / lineHeight));
  if (cap <= 0) return [];
  let chain = measure.chainAt(top).slice(0, cap);
  for (let step = 0; step < cap; step += 1) {
    const under = measure.chainAt(top + chain.length * lineHeight).slice(0, cap);
    const extends_ =
      under.length > chain.length &&
      chain.every((block, index) => under[index]?.from === block.from);
    if (!extends_) break;
    chain = under;
  }
  const rows: StickyRow[] = [];
  for (const [index, block] of chain.entries()) {
    const pushed = measure.endBottom(block) - top - lineHeight;
    const rowTop = Math.min(index * lineHeight, pushed);
    const caret = measure.caret;
    if (
      caret !== null &&
      caret.top - top < rowTop + lineHeight &&
      caret.bottom - top > Math.max(rowTop, 0)
    ) {
      break;
    }
    if (rowTop + lineHeight <= 0) continue;
    rows.push({ block, top: rowTop });
  }
  return rows;
}

/** How far down the rows reach, which is what the caret is kept below. */
const stackHeight = (rows: readonly StickyRow[], lineHeight: number): number =>
  rows.reduce((height, row) => Math.max(height, row.top + lineHeight), 0);

interface Measured {
  readonly rows: readonly StickyRow[];
  readonly margin: number;
  readonly lineHeight: number;
  readonly layerTop: number;
  readonly layerLeft: number;
  readonly width: number;
  readonly numberLeft: number;
  readonly numberWidth: number;
  readonly textLeft: number;
}

/** The highlighted text of a line, as spans carrying the classes the editor's own lines get. */
function paintLine(target: HTMLElement, state: EditorState, from: number, to: number): void {
  const text = state.doc.sliceString(from, to);
  let at = from;
  const put = (end: number, classes: string): void => {
    if (end <= at) return;
    const span = document.createElement('span');
    if (classes !== '') span.className = classes;
    span.textContent = text.slice(at - from, end - from);
    target.append(span);
    at = end;
  };
  highlightTree(
    treeAt(state, to),
    { style: (tags) => highlightingFor(state, tags) },
    (start, end, classes) => {
      put(Math.max(start, from), '');
      put(Math.min(end, to), classes);
    },
    from,
    to,
  );
  put(to, '');
}

class StickyScroll {
  readonly dom: HTMLElement;
  height = 0;
  private rows: readonly StickyRow[] = [];
  /** Whether the caret was last moved from the keyboard, rather than the text by a wheel. */
  private keyboard = false;

  private readonly onScroll = (): void => {
    this.schedule();
  };
  private readonly onKey = (): void => {
    this.keyboard = true;
  };
  private readonly onWheel = (): void => {
    this.keyboard = false;
  };

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement('div');
    this.dom.className = 'cm-sticky-scroll';
    this.dom.setAttribute('aria-hidden', 'true');
    this.dom.addEventListener('mousedown', this.onMouseDown);
    view.dom.append(this.dom);
    view.scrollDOM.addEventListener('scroll', this.onScroll);
    view.dom.addEventListener('keydown', this.onKey, true);
    view.scrollDOM.addEventListener('wheel', this.onWheel, { passive: true });
    view.scrollDOM.addEventListener('mousedown', this.onWheel);
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.heightChanged ||
      update.selectionSet ||
      foldedRanges(update.startState) !== foldedRanges(update.state)
    ) {
      this.schedule();
    }
  }

  destroy(): void {
    this.dom.remove();
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.view.dom.removeEventListener('keydown', this.onKey, true);
    this.view.scrollDOM.removeEventListener('wheel', this.onWheel);
    this.view.scrollDOM.removeEventListener('mousedown', this.onWheel);
  }

  private schedule(): void {
    this.view.requestMeasure({
      key: this,
      read: (view) => this.read(view),
      write: (measured) => {
        this.write(measured);
      },
    });
  }

  private read(view: EditorView): Measured {
    const scroller = view.scrollDOM;
    const lineHeight = view.defaultLineHeight;
    const top = Math.max(scroller.getBoundingClientRect().top - view.documentTop, 0);
    const { state } = view;
    const head = state.selection.main.head;
    const caretBlock = view.lineBlockAt(head);
    const measure: StickyMeasure = {
      top,
      lineHeight,
      paneHeight: scroller.clientHeight,
      chainAt: (height) => stickyChain(state, view.lineBlockAtHeight(height).from),
      endBottom: (block) => view.lineBlockAt(block.end).bottom,
      caret: null,
    };
    const whole = stickyRows(measure);
    const rows =
      this.keyboard && view.hasFocus
        ? stickyRows({ ...measure, caret: { top: caretBlock.top, bottom: caretBlock.bottom } })
        : whole;
    const own = view.dom.getBoundingClientRect();
    const numbers = view.dom.querySelector<HTMLElement>('.cm-lineNumbers');
    const numberBox = numbers?.getBoundingClientRect();
    const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
    const padding = line === null ? 0 : Number.parseFloat(getComputedStyle(line).paddingLeft) || 0;
    return {
      rows,
      // The whole stack's height and not the drawn one: CodeMirror reveals the caret after the
      // writes, and a row hidden because the caret is under it must still push the caret out.
      margin: stackHeight(whole, lineHeight),
      lineHeight,
      layerTop: scroller.offsetTop,
      layerLeft: scroller.offsetLeft,
      width: scroller.clientWidth,
      numberLeft: numberBox === undefined ? 0 : numberBox.left - own.left - scroller.offsetLeft,
      numberWidth: numberBox?.width ?? 0,
      textLeft:
        view.contentDOM.getBoundingClientRect().left - own.left - scroller.offsetLeft + padding,
    };
  }

  private write(measured: Measured): void {
    const { rows, lineHeight } = measured;
    const height = stackHeight(rows, lineHeight);
    this.height = measured.margin;
    this.rows = rows;
    const style = this.dom.style;
    style.top = `${String(measured.layerTop)}px`;
    style.left = `${String(measured.layerLeft)}px`;
    style.width = `${String(measured.width)}px`;
    style.height = `${String(height)}px`;
    style.display = rows.length === 0 ? 'none' : '';
    const state = this.view.state;
    this.dom.replaceChildren(
      ...rows.map((row, index) => {
        const element = document.createElement('div');
        element.className = 'cm-sticky-line';
        element.dataset['line'] = String(row.block.line);
        element.style.top = `${String(row.top)}px`;
        element.style.height = `${String(lineHeight)}px`;
        element.style.lineHeight = `${String(lineHeight)}px`;
        // The outer rows over the inner ones, so an inner row pushed up slides under its parent.
        element.style.zIndex = String(rows.length - index);
        const number = document.createElement('span');
        number.className = 'cm-sticky-number';
        number.textContent = String(row.block.line);
        number.style.left = `${String(measured.numberLeft)}px`;
        number.style.width = `${String(measured.numberWidth)}px`;
        const text = document.createElement('span');
        text.className = 'cm-sticky-text';
        text.style.left = `${String(measured.textLeft)}px`;
        paintLine(text, state, row.block.from, state.doc.lineAt(row.block.from).to);
        element.append(text, number);
        return element;
      }),
    );
  }

  /** A click on a row puts the caret at the start of its head line and scrolls it to the top. */
  private readonly onMouseDown = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest('.cm-sticky-line') : null;
    const index = target === null ? -1 : [...this.dom.children].indexOf(target);
    const row = this.rows[index];
    if (row === undefined) return;
    event.preventDefault();
    this.keyboard = false;
    this.view.dispatch({
      selection: { anchor: row.block.from },
      effects: EditorView.scrollIntoView(row.block.from, { y: 'start' }),
    });
    this.view.focus();
  };
}

const stickyPlugin = ViewPlugin.fromClass(StickyScroll);

/** The caret's top margin is the rows' height, so moving it never leaves it under a row. */
const margins = EditorView.scrollMargins.of((view) => {
  const height = view.plugin(stickyPlugin)?.height ?? 0;
  return height > 0 ? { top: height } : null;
});

/**
 * The rows' look, no token of its own (ADR 0081): the buffer's surface, the line's own syntax
 * colours, the gutter's colour for the number, one hairline under the stack, flat.
 */
const stickyTheme = EditorView.theme({
  '.cm-sticky-scroll': {
    position: 'absolute',
    // Just above the scroller, which CodeMirror makes a stacking context at 0, so the gutters and
    // the text sit under the rows. Not higher: `.cm-editor` is no stacking context of its own, so
    // a large number here would paint over the window's overlays — the template mode is 9.
    zIndex: '1',
    overflow: 'hidden',
    backgroundColor: palette.background,
    borderBottom: `${panels.lineWidth} solid ${panels.line}`,
    boxSizing: 'content-box',
  },
  '.cm-sticky-line': {
    position: 'absolute',
    left: '0',
    right: '0',
    overflow: 'hidden',
    cursor: 'pointer',
    whiteSpace: 'pre',
    backgroundColor: palette.background,
    color: palette.foreground,
  },
  '.cm-sticky-line:hover': { backgroundColor: panels.hover },
  '.cm-sticky-number': {
    position: 'absolute',
    top: '0',
    boxSizing: 'border-box',
    paddingRight: '3px',
    textAlign: 'right',
    color: palette.gutterForeground,
    backgroundColor: 'inherit',
    fontFamily: 'monospace',
  },
  '.cm-sticky-text': {
    position: 'absolute',
    top: '0',
    right: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: monoFont,
  },
});

/** The pinned rows, for a compartment the `stickyScroll` setting turns on and off. */
export function stickyScroll(): Extension {
  return [stickyPlugin, margins, stickyTheme];
}
