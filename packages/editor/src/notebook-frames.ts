import { type Extension, Facet, RangeSetBuilder, StateEffect } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type LayerMarker,
  ViewPlugin,
  type ViewUpdate,
  layer,
} from '@codemirror/view';

/**
 * A notebook's blocks as frames over the one editor (TYTO-676, ADR 0195): each block's lines
 * framed, and a toolbar at the right of its first line.
 *
 * The editor stays one editor: the text, the caret, vim, search and undo are untouched, and a
 * block is only a reading of the text. The host says where the blocks are, from the text as
 * it is now ({@link NotebookFramesOptions.framesOf}), and builds each toolbar; this draws them
 * and reads them again on every edit, since a block is wherever its lines are.
 *
 * **A toolbar is not in the text.** It is drawn in a layer of its own beside `.cm-content`, as
 * the selection is, placed over its block's first line: a line's text, what a screen reader
 * names it and what a test reads of it hold the line and nothing else. The layer is not hidden
 * from a screen reader, as CodeMirror's own layers are, since its buttons are the person's.
 *
 * A toolbar is built anew only when its block's place among the frames or its key changes; a
 * move of its line only moves it. A host whose own state changes what a toolbar shows (a result
 * folded) dispatches {@link refreshNotebookFrames}.
 */

export interface NotebookFrame {
  /** The offset of the block's first character; its first line holds the toolbar. */
  readonly from: number;
  /** An offset on its last line. */
  readonly to: number;
  /** A word the frame's class carries: `cm-notebook-frame--<kind>`. */
  readonly kind: string;
  /** Names what the toolbar shows: the same key keeps the toolbar already built. */
  readonly key: string;
  /** Builds the toolbar; `undefined` draws the frame with none. */
  readonly toolbar?: () => HTMLElement;
}

export interface NotebookFramesOptions {
  /** The frames of the text this view shows now, in order. */
  readonly framesOf: (view: EditorView) => readonly NotebookFrame[];
}

/** Reads the frames again: the host's own state changed what a toolbar shows. */
export const refreshNotebookFrames = StateEffect.define<null>();

const framesOptions = Facet.define<NotebookFramesOptions, NotebookFramesOptions | undefined>({
  combine: (values) => values[0],
});

const refreshed = (update: ViewUpdate): boolean =>
  update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(refreshNotebookFrames)),
  );

/** The frames' line classes, with the frame holding the caret marked. */
function decorate(view: EditorView, frames: readonly NotebookFrame[]): DecorationSet {
  const { doc, selection } = view.state;
  const caret = doc.lineAt(selection.main.head).number;
  const builder = new RangeSetBuilder<Decoration>();
  for (const frame of frames) {
    if (!fits(frame, doc.length)) continue;
    const first = doc.lineAt(frame.from);
    const last = doc.lineAt(frame.to);
    const active = caret >= first.number && caret <= last.number;
    for (let number = first.number; number <= last.number; number += 1) {
      const classes = ['cm-notebook-frame', `cm-notebook-frame--${frame.kind}`];
      if (number === first.number) classes.push('cm-notebook-frame--first');
      if (number === last.number) classes.push('cm-notebook-frame--last');
      if (active) classes.push('cm-notebook-frame--active');
      const line = doc.line(number);
      builder.add(line.from, line.from, Decoration.line({ class: classes.join(' ') }));
    }
  }
  return builder.finish();
}

const fits = (frame: NotebookFrame, length: number): boolean =>
  frame.from >= 0 && frame.to <= length && frame.from <= frame.to;

/** The frames as read after the last edit, and their line classes. */
const framesPlugin = ViewPlugin.fromClass(
  class {
    frames: readonly NotebookFrame[];
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.frames = view.state.facet(framesOptions)?.framesOf(view) ?? [];
      this.decorations = decorate(view, this.frames);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || refreshed(update)) {
        this.frames = update.state.facet(framesOptions)?.framesOf(update.view) ?? [];
      }
      if (update.docChanged || update.selectionSet || refreshed(update)) {
        this.decorations = decorate(update.view, this.frames);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** One toolbar in the layer: which frame it is, what it shows, and where it goes. */
class ToolbarMarker implements LayerMarker {
  constructor(
    readonly index: number,
    readonly key: string,
    readonly top: number,
    readonly build: () => HTMLElement,
  ) {}

  eq(other: ToolbarMarker): boolean {
    return other.index === this.index && other.key === this.key && other.top === this.top;
  }

  draw(): HTMLElement {
    const toolbar = this.build();
    toolbar.classList.add('cm-notebook-toolbar');
    toolbar.dataset['notebookFrame'] = String(this.index);
    this.place(toolbar);
    return toolbar;
  }

  /** The same toolbar at a new place: moved, not built again. */
  update(dom: HTMLElement, previous: LayerMarker): boolean {
    if (!(previous instanceof ToolbarMarker)) return false;
    if (previous.index !== this.index || previous.key !== this.key) return false;
    this.place(dom);
    return true;
  }

  private place(toolbar: HTMLElement): void {
    toolbar.style.top = `${String(this.top)}px`;
  }
}

/**
 * How far down each toolbar in view goes, in the layer's own coordinates, which scroll with
 * the text: the top of its block's first line. The layer is as wide as the scroller's visible
 * width and each toolbar sits at its right edge, so a toolbar never widens what scrolls.
 *
 * **The top is read from the line's element, not from CodeMirror's height map.** A result
 * folded in place shrinks a block widget that the map goes on counting at its old height
 * (measured in the window on 2026-11-12: a line drawn at 170 px that `lineBlockAt` put at 243),
 * and a toolbar placed by the map then sits over the wrong line.
 */
function toolbarMarkers(view: EditorView): readonly LayerMarker[] {
  const frames = view.plugin(framesPlugin)?.frames ?? [];
  const scroller = view.scrollDOM;
  const box = scroller.getBoundingClientRect();
  const baseTop = box.top - scroller.scrollTop;
  const { from, to } = view.viewport;
  const markers: LayerMarker[] = [];
  frames.forEach((frame, index) => {
    if (frame.toolbar === undefined || !fits(frame, view.state.doc.length)) return;
    if (frame.from < from || frame.from > to) return;
    const top = lineTop(view, frame.from) - baseTop;
    markers.push(new ToolbarMarker(index, frame.key, top, frame.toolbar));
  });
  return markers;
}

/** The top of the line holding `at`, in client coordinates: its element's, where drawn. */
function lineTop(view: EditorView, at: number): number {
  const { node } = view.domAtPos(at);
  const element = node instanceof Element ? node : node.parentElement;
  const line = element?.closest('.cm-line');
  if (line !== null && line !== undefined && view.contentDOM.contains(line)) {
    return line.getBoundingClientRect().top;
  }
  return view.documentTop + view.lineBlockAt(at).top;
}

const toolbarLayer = layer({
  above: true,
  class: 'cm-notebook-toolbars',
  markers: toolbarMarkers,
  // A result folded under a line moves every line below it with no edit: the toolbars follow.
  update: (update) =>
    update.docChanged || update.viewportChanged || update.heightChanged || refreshed(update),
  // CodeMirror hides a layer from a screen reader; this one holds the person's buttons.
  mount: (dom) => {
    dom.removeAttribute('aria-hidden');
  },
});

/**
 * The layer spans the visible width and lets a click through to the text, but not on a toolbar,
 * which sits at its right edge.
 */
const toolbarTheme = EditorView.baseTheme({
  '.cm-notebook-toolbars': { pointerEvents: 'none', width: '100%' },
  '.cm-notebook-toolbars > .cm-notebook-toolbar': { pointerEvents: 'auto', right: 0 },
});

/**
 * The frame a toolbar stands for, as the frames are now, or `undefined` for an element in no
 * toolbar: a host's click finds its block here rather than by the frame it built the toolbar
 * for, which an edit since may have moved.
 */
export function notebookFrameOf(view: EditorView, element: Element): NotebookFrame | undefined {
  const toolbar = element.closest<HTMLElement>('[data-notebook-frame]');
  const index = Number(toolbar?.dataset['notebookFrame']);
  if (!Number.isInteger(index)) return undefined;
  return view.plugin(framesPlugin)?.frames[index];
}

/** Mount once per editor that shows a notebook. */
export function notebookFrames(options: NotebookFramesOptions): Extension {
  return [framesOptions.of(options), framesPlugin, toolbarLayer, toolbarTheme];
}
