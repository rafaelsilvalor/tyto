import { type Extension, Facet, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  type LayerMarker,
  ViewPlugin,
  type ViewUpdate,
  gutter,
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
 *
 * The same layer draws a **"+"** on the boundary above every frame the host marks insertable
 * and one below the last frame, each built by the host ({@link NotebookFramesOptions.insert});
 * and a gutter at the left shows each frame's marker on its first line, a notebook's execution
 * counter (TYTO-676, second pull request).
 *
 * **Command mode** (TYTO-676, third pull request, ADR 0195 decision 7) is DOM focus on the
 * toolbars' layer, a focusable element beside `.cm-content`, with one block selected: CodeMirror
 * and vim listen on `.cm-content`, so a key pressed there never reaches them, and the window's
 * `notebook` keybindings answer it. The selected block is kept here by its first line's start,
 * following its line through every edit, and its lines carry `cm-notebook-frame--selected`.
 *
 * **A block is dragged by its grip** (TYTO-676, fourth pull request), in a gutter of its own on
 * each movable frame's first line. The drag is pointer events with the pointer captured on the
 * grip, not HTML5 drag and drop: the editor's own text drag listens for `dragstart` and would
 * take a native drag for a text move, and a native drag hands no pointer to a test or a script.
 * While a block is dragged its lines carry `cm-notebook-frame--dragged` and a drop line is drawn
 * on the nearest boundary it may go to; on release the host moves it ({@link
 * NotebookFramesOptions.move}). Escape, the window losing focus, and any edit of the text while
 * dragging (a run rewriting it, say) cancel the drag and release the pointer.
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
  /** Whether a "+" sits on the boundary above this block, to insert before it. */
  readonly insertable?: boolean;
  /** What the gutter shows on the block's first line, as the text says it. */
  readonly marker?: NotebookMarker;
  /** Whether the block may be dragged, and dropped above: it gets a grip. */
  readonly movable?: boolean;
}

/** A frame's gutter mark: its text, a class for how it looks, and what it says on hover. */
export interface NotebookMarker {
  readonly text: string;
  readonly className?: string;
  readonly title?: string;
}

export interface NotebookFramesOptions {
  /** The frames of the text this view shows now, in order. */
  readonly framesOf: (view: EditorView) => readonly NotebookFrame[];
  /** Builds a "+" control; absent, none is drawn. Its place is read with `notebookInsertOf`. */
  readonly insert?: (view: EditorView) => HTMLElement;
  /**
   * Moves frame `from` to just before frame `before`, or below the last with `'end'`, as a drag
   * dropped it; absent, no grip is drawn. The host decides whether that is a move at all.
   */
  readonly move?: (view: EditorView, from: number, before: number | 'end') => void;
  /** What a grip says on hover and to a screen reader. */
  readonly gripLabel?: (view: EditorView) => string;
}

/** Reads the frames again: the host's own state changed what a toolbar shows. */
export const refreshNotebookFrames = StateEffect.define<null>();

const framesOptions = Facet.define<NotebookFramesOptions, NotebookFramesOptions | undefined>({
  combine: (values) => values[0],
});

/** Selects a block by a position on its first line, or `null` for none (command mode left). */
export const selectNotebookBlock = StateEffect.define<number | null>();

/** The start of the selected block's first line, while in command mode; `null` otherwise. */
const selectedField = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    let selected = value;
    if (selected !== null && !transaction.changes.empty) {
      selected = transaction.changes.mapPos(selected, 1);
    }
    for (const effect of transaction.effects) {
      if (effect.is(selectNotebookBlock)) selected = effect.value;
    }
    if (selected === null) return null;
    return transaction.newDoc.lineAt(Math.min(selected, transaction.newDoc.length)).from;
  },
});

/** A drag on its way: the frame dragged, and where it would drop now (`null` nowhere yet). */
export interface NotebookDrag {
  readonly from: number;
  readonly before: number | 'end' | null;
}

/** Starts, moves or (with `null`) ends a drag. */
export const setNotebookDrag = StateEffect.define<NotebookDrag | null>();

/** The drag on its way. **Any edit of the text ends it**: the frames it counted are gone. */
const dragField = StateField.define<NotebookDrag | null>({
  create: () => null,
  update(value, transaction) {
    let drag = transaction.docChanged ? null : value;
    for (const effect of transaction.effects) {
      if (effect.is(setNotebookDrag)) drag = effect.value;
    }
    return drag;
  },
});

/** The drag on its way in a view, if any. */
export const notebookDragOf = (view: EditorView): NotebookDrag | null =>
  view.state.field(dragField, false) ?? null;

const refreshed = (update: ViewUpdate): boolean =>
  update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(refreshNotebookFrames)),
  );

/** The frames' line classes, with the frame holding the caret marked. */
function decorate(view: EditorView, frames: readonly NotebookFrame[]): DecorationSet {
  const { doc, selection } = view.state;
  const caret = doc.lineAt(selection.main.head).number;
  const selected = view.state.field(selectedField, false) ?? null;
  const dragged = frames[view.state.field(dragField, false)?.from ?? -1];
  const builder = new RangeSetBuilder<Decoration>();
  for (const frame of frames) {
    if (!fits(frame, doc.length)) continue;
    const first = doc.lineAt(frame.from);
    const last = doc.lineAt(frame.to);
    const active = caret >= first.number && caret <= last.number;
    const chosen = selected !== null && selected >= first.from && selected <= last.to;
    for (let number = first.number; number <= last.number; number += 1) {
      const classes = ['cm-notebook-frame', `cm-notebook-frame--${frame.kind}`];
      if (number === first.number) classes.push('cm-notebook-frame--first');
      if (number === last.number) classes.push('cm-notebook-frame--last');
      if (active) classes.push('cm-notebook-frame--active');
      if (chosen) classes.push('cm-notebook-frame--selected');
      if (frame === dragged) classes.push('cm-notebook-frame--dragged');
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
      const reselected =
        update.startState.field(selectedField, false) !== update.state.field(selectedField, false);
      const redragged =
        update.startState.field(dragField, false) !== update.state.field(dragField, false);
      if (
        update.docChanged ||
        update.selectionSet ||
        refreshed(update) ||
        reselected ||
        redragged
      ) {
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
 * and a toolbar placed by the map then sits over the wrong line. Since TYTO-703 a fold asks
 * for the heights again (`remeasureCellOutput`), so the map follows it; the element stays the
 * source here as a guard for any block that changes height without saying so.
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

/** The element of the line holding `at`, where drawn. */
function lineElement(view: EditorView, at: number): Element | undefined {
  const { node } = view.domAtPos(at);
  const element = node instanceof Element ? node : node.parentElement;
  const line = element?.closest('.cm-line');
  return line !== null && line !== undefined && view.contentDOM.contains(line) ? line : undefined;
}

/** The top of the line holding `at`, in client coordinates: its element's, where drawn. */
function lineTop(view: EditorView, at: number): number {
  return (
    lineElement(view, at)?.getBoundingClientRect().top ??
    view.documentTop + view.lineBlockAt(at).top
  );
}

/**
 * Where the boundary below the line holding `at` is drawn, in client coordinates: the top of
 * the next line, past the result under it, or the bottom of what is drawn there when no line
 * follows.
 */
function boundaryBelow(view: EditorView, at: number): number {
  const line = lineElement(view, at);
  if (line === undefined) return view.documentTop + view.lineBlockAt(at).bottom;
  let last: Element = line;
  for (let next = line.nextElementSibling; next !== null; next = next.nextElementSibling) {
    if (next.classList.contains('cm-line')) return next.getBoundingClientRect().top;
    last = next;
  }
  return last.getBoundingClientRect().bottom;
}

/**
 * One "+" in the layer: the frame it inserts above (-1 below the last), and how far down it
 * goes; across, the host's CSS places it (`right`), since where it is out of the way depends
 * on the host's toolbars and results.
 */
class InsertMarker implements LayerMarker {
  constructor(
    readonly index: number,
    readonly top: number,
    readonly build: () => HTMLElement,
  ) {}

  eq(other: InsertMarker): boolean {
    return other.index === this.index && other.top === this.top;
  }

  draw(): HTMLElement {
    const control = this.build();
    control.classList.add('cm-notebook-insert');
    control.dataset['notebookInsert'] = this.index === -1 ? 'end' : String(this.index);
    this.place(control);
    return control;
  }

  update(dom: HTMLElement, previous: LayerMarker): boolean {
    if (!(previous instanceof InsertMarker) || previous.index !== this.index) return false;
    this.place(dom);
    return true;
  }

  private place(control: HTMLElement): void {
    control.style.top = `${String(this.top)}px`;
  }
}

/** The "+" controls in view: above each insertable frame, and below the last frame. */
function insertMarkers(view: EditorView): readonly LayerMarker[] {
  const insert = view.state.facet(framesOptions)?.insert;
  const frames = view.plugin(framesPlugin)?.frames ?? [];
  if (insert === undefined) return [];
  const build = (): HTMLElement => insert(view);
  const scroller = view.scrollDOM;
  const box = scroller.getBoundingClientRect();
  const baseTop = box.top - scroller.scrollTop;
  const { from, to } = view.viewport;
  const length = view.state.doc.length;
  const markers: LayerMarker[] = [];
  frames.forEach((frame, index) => {
    if (frame.insertable !== true || !fits(frame, length)) return;
    if (frame.from < from || frame.from > to) return;
    markers.push(new InsertMarker(index, lineTop(view, frame.from) - baseTop, build));
  });
  const last = frames.at(-1);
  if (last !== undefined && fits(last, length) && last.to >= from && last.to <= to) {
    markers.push(new InsertMarker(-1, boundaryBelow(view, last.to) - baseTop, build));
  }
  return markers;
}

const toolbarLayer = layer({
  above: true,
  class: 'cm-notebook-toolbars',
  markers: toolbarMarkers,
  // A result folded under a line moves every line below it with no edit: the toolbars follow.
  update: (update) =>
    update.docChanged || update.viewportChanged || update.heightChanged || refreshed(update),
  // CodeMirror hides a layer from a screen reader; this one holds the person's buttons. It is
  // also what command mode focuses: an element outside `.cm-content`, focusable by script only.
  mount: (dom) => {
    dom.removeAttribute('aria-hidden');
    dom.tabIndex = -1;
    dom.dataset['notebookCommand'] = '';
    dom.setAttribute('role', 'group');
  },
});

/**
 * The "+" controls, in a layer of their own: one kind of marker per layer, so a redraw matches
 * each marker with one drawn like it.
 */
const insertLayer = layer({
  above: true,
  class: 'cm-notebook-inserts',
  markers: insertMarkers,
  update: (update) =>
    update.docChanged || update.viewportChanged || update.heightChanged || refreshed(update),
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
  '.cm-notebook-inserts': { pointerEvents: 'none', width: '100%' },
  // A "+" is centred, top to bottom, on the boundary it inserts at.
  '.cm-notebook-inserts > .cm-notebook-insert': {
    pointerEvents: 'auto',
    transform: 'translateY(-50%)',
  },
});

/** A frame's gutter mark, as the host said it. */
class FrameMarker extends GutterMarker {
  constructor(readonly marker: NotebookMarker) {
    super();
  }

  override eq(other: FrameMarker): boolean {
    return (
      other.marker.text === this.marker.text &&
      other.marker.className === this.marker.className &&
      other.marker.title === this.marker.title
    );
  }

  override toDOM(): Node {
    const mark = document.createElement('span');
    mark.textContent = this.marker.text;
    if (this.marker.className !== undefined) mark.className = this.marker.className;
    if (this.marker.title !== undefined) mark.title = this.marker.title;
    return mark;
  }
}

/** Each frame's marker on its first line, in a gutter of its own at the left. */
const markerGutter = gutter({
  class: 'cm-notebook-gutter',
  lineMarker: (view, line) => {
    const frame = view.plugin(framesPlugin)?.frames.find((each) => each.from === line.from);
    return frame?.marker === undefined ? null : new FrameMarker(frame.marker);
  },
  lineMarkerChange: (update) => update.docChanged || refreshed(update),
  // Wide enough for a counter in the hundreds before it ever grows.
  initialSpacer: () => new FrameMarker({ text: '[000]' }),
});

/**
 * Where a "+" control inserts, as the frames are now: before the frame it stands above, or
 * `'end'` below the last; `undefined` for an element in no "+".
 */
export function notebookInsertOf(
  view: EditorView,
  element: Element,
): NotebookFrame | 'end' | undefined {
  const control = element.closest<HTMLElement>('[data-notebook-insert]');
  const place = control?.dataset['notebookInsert'];
  if (place === 'end') return 'end';
  const index = Number(place);
  if (place === undefined || !Number.isInteger(index)) return undefined;
  return view.plugin(framesPlugin)?.frames[index];
}

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

/** The element command mode focuses in a view, once its layer is mounted. */
const commandTarget = (view: EditorView): HTMLElement | null =>
  view.scrollDOM.querySelector<HTMLElement>(':scope > [data-notebook-command]');

/** Whether focus is in command mode: on a notebook's command target. */
export const isNotebookCommandTarget = (element: Element | null): boolean =>
  element instanceof HTMLElement && element.dataset['notebookCommand'] !== undefined;

/**
 * Enters command mode: selects the block at `at` (the caret's when absent) and moves focus off
 * the text onto the command target. `false` when the view shows no notebook.
 */
export function enterNotebookCommand(view: EditorView, at?: number): boolean {
  const target = commandTarget(view);
  if (target === null) return false;
  const frame = frameAt(view, at ?? view.state.selection.main.head);
  if (frame === undefined) return false;
  view.dispatch({ effects: selectNotebookBlock.of(frame.from), scrollIntoView: false });
  target.focus({ preventScroll: true });
  return true;
}

/** Leaves command mode for the text, the caret at `at`. */
export function leaveNotebookCommand(view: EditorView, at: number): void {
  view.dispatch({
    effects: selectNotebookBlock.of(null),
    selection: { anchor: at },
    scrollIntoView: true,
  });
  view.focus();
}

/** The frame holding a position, as the frames were read after the last edit. */
function frameAt(view: EditorView, at: number): NotebookFrame | undefined {
  const line = view.state.doc.lineAt(at);
  return view.plugin(framesPlugin)?.frames.find((frame) => {
    const first = view.state.doc.lineAt(frame.from).number;
    const last = view.state.doc.lineAt(frame.to).number;
    return first <= line.number && line.number <= last;
  });
}

/** The selected block's frame, while in command mode. */
export function selectedNotebookFrame(view: EditorView): NotebookFrame | undefined {
  const selected = view.state.field(selectedField, false) ?? null;
  return selected === null ? undefined : frameAt(view, selected);
}

/**
 * Moves the selection to the next or previous frame for which `selectable` holds (the host
 * skips its header), keeping focus where it is, and scrolls it into view. `false` at an end.
 */
export function stepNotebookSelection(
  view: EditorView,
  direction: 1 | -1,
  selectable: (frame: NotebookFrame) => boolean = () => true,
): boolean {
  const frames = view.plugin(framesPlugin)?.frames ?? [];
  const current = selectedNotebookFrame(view);
  const index = current === undefined ? -1 : frames.indexOf(current);
  for (let next = index + direction; next >= 0 && next < frames.length; next += direction) {
    const frame = frames[next];
    if (frame === undefined || !selectable(frame)) continue;
    view.dispatch({
      effects: [
        selectNotebookBlock.of(frame.from),
        EditorView.scrollIntoView(frame.from, { y: 'nearest' }),
      ],
    });
    return true;
  }
  return false;
}

/** Focus back in the text leaves command mode: nothing stays selected. */
const leaveOnTextFocus = EditorView.domEventHandlers({
  focus: (_event, view) => {
    if ((view.state.field(selectedField, false) ?? null) !== null) {
      view.dispatch({ effects: selectNotebookBlock.of(null) });
    }
    return false;
  },
});

/** A movable frame's grip, in a gutter of its own. */
class GripMarker extends GutterMarker {
  constructor(
    readonly index: number,
    readonly label: string,
  ) {
    super();
  }

  override eq(other: GripMarker): boolean {
    return other.index === this.index && other.label === this.label;
  }

  override toDOM(): Node {
    const grip = document.createElement('span');
    grip.className = 'cm-notebook-grip';
    grip.textContent = '⠿';
    grip.title = this.label;
    grip.setAttribute('aria-label', this.label);
    grip.setAttribute('role', 'button');
    // The frame it drags, read on the press: the gutter finds a line by height, the grip knows.
    grip.dataset['notebookGrip'] = String(this.index);
    return grip;
  }
}

const gripGutter = gutter({
  class: 'cm-notebook-grips',
  lineMarker: (view, line) => {
    const options = view.state.facet(framesOptions);
    if (options?.move === undefined) return null;
    const frames = view.plugin(framesPlugin)?.frames ?? [];
    const index = frames.findIndex((each) => each.from === line.from);
    if (frames[index]?.movable !== true) return null;
    return new GripMarker(index, options.gripLabel?.(view) ?? '');
  },
  lineMarkerChange: (update) => update.docChanged || refreshed(update),
  domEventHandlers: {
    pointerdown: (view, _line, event) => {
      const grip = (event.target as Element | null)?.closest?.('[data-notebook-grip]');
      if (!(grip instanceof HTMLElement) || !(event instanceof MouseEvent)) return false;
      const index = Number(grip.dataset['notebookGrip']);
      const frames = view.plugin(framesPlugin)?.frames ?? [];
      if (!Number.isInteger(index) || frames[index]?.movable !== true) return false;
      event.preventDefault();
      startDrag(view, index, grip, event);
      return true;
    },
  },
});

/** Where a drop may go: above a movable frame, or below the last, and the top of that line. */
export interface NotebookDropPlace {
  readonly before: number | 'end';
  readonly top: number;
}

/** The place nearest a pointer's height, or `undefined` with none. */
export function nearestDrop(
  places: readonly NotebookDropPlace[],
  y: number,
): NotebookDropPlace | undefined {
  let best: NotebookDropPlace | undefined;
  for (const place of places) {
    if (best === undefined || Math.abs(place.top - y) < Math.abs(best.top - y)) best = place;
  }
  return best;
}

/** Every place a dragged block may drop, as drawn now, in client coordinates. */
function dropPlaces(view: EditorView): readonly NotebookDropPlace[] {
  const frames = view.plugin(framesPlugin)?.frames ?? [];
  const length = view.state.doc.length;
  const places: NotebookDropPlace[] = [];
  frames.forEach((frame, index) => {
    if (frame.movable === true && fits(frame, length)) {
      places.push({ before: index, top: lineTop(view, frame.from) });
    }
  });
  const last = frames.at(-1);
  if (last !== undefined && fits(last, length)) {
    places.push({ before: 'end', top: boundaryBelow(view, last.to) });
  }
  return places;
}

/** How deep the band at each edge of the pane is where a drag scrolls it, at most, in px. */
const EDGE_BAND = 48;
/** How fast a drag scrolls the pane with the pointer at its edge or past it, in px a second. */
const EDGE_SPEED = 1200;
/** How often a drag in the band scrolls, in ms. */
const EDGE_TICK = 16;
/** The longest step one tick may take, in ms: a throttled timer jumps no further than this. */
const EDGE_STEP_LIMIT = 200;

/**
 * How fast a drag with the pointer at `y` scrolls a pane whose visible top and bottom are
 * `top` and `bottom` (TYTO-710), in px a second: negative up, positive down, 0 outside the
 * bands. A band is 48 px deep, or a quarter of a short pane; the speed grows from nothing at
 * its inner edge to {@link EDGE_SPEED} at the pane's edge, and stays there past it, since the
 * captured pointer may leave the pane.
 */
export function edgeScrollSpeed(y: number, top: number, bottom: number): number {
  const band = Math.min(EDGE_BAND, (bottom - top) / 4);
  if (!(band > 0)) return 0;
  if (y < top + band) return -EDGE_SPEED * Math.min(1, (top + band - y) / band);
  if (y > bottom - band) return EDGE_SPEED * Math.min(1, (y - (bottom - band)) / band);
  return 0;
}

/** One drag on its way per view: how to end it. */
const sessions = new WeakMap<EditorView, { readonly end: (drop: boolean) => void }>();

/**
 * Starts dragging frame `index` from its grip: the pointer is captured on the grip, so every
 * move and the release reach it wherever the pointer goes. Escape and the window losing focus
 * cancel; an edit of the text cancels too ({@link dragCanceller}).
 *
 * **The moves and the release are heard on the window, not the grip** (TYTO-710). A drag that
 * scrolls far takes the grip's line out of CodeMirror's viewport, which unmounts the grip and
 * its capture with it; the events then reach whatever is under the pointer, and bubble up to
 * the window still. What the drag is — the frame dragged, its dimming — lives in the state, so
 * it outlives its grip.
 *
 * With the pointer in a band at the top or bottom of the pane, a timer scrolls it, faster
 * nearer the edge ({@link edgeScrollSpeed}), and the drop place is picked again under the
 * pointer, as it is on any scroll, the wheel's included. A timer and not an animation frame:
 * a hidden window, as the desktop suite's is, runs no frames (measured on 2026-11-12), and each
 * step is scaled by the time that passed, so a throttled timer scrolls as far. The timer stops
 * at the end of the scroll, outside the bands and with the drag, and a move starts it again.
 */
function startDrag(view: EditorView, index: number, grip: HTMLElement, down: MouseEvent): void {
  sessions.get(view)?.end(false);
  const pointerId = 'pointerId' in down ? (down as PointerEvent).pointerId : undefined;
  if (pointerId !== undefined) grip.setPointerCapture?.(pointerId);
  const window = view.dom.ownerDocument.defaultView;
  const scroller = view.scrollDOM;
  let pointerY: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastTick = 0;
  const repick = (): void => {
    if (pointerY === undefined || notebookDragOf(view) === null) return;
    const before = nearestDrop(dropPlaces(view), pointerY)?.before ?? null;
    if (notebookDragOf(view)?.before === before) return;
    view.dispatch({ effects: setNotebookDrag.of({ from: index, before }) });
  };
  const speed = (): number => {
    if (pointerY === undefined) return 0;
    const box = scroller.getBoundingClientRect();
    return edgeScrollSpeed(pointerY, box.top, box.bottom);
  };
  const tick = (): void => {
    timer = undefined;
    const now = Date.now();
    const elapsed = Math.min(EDGE_STEP_LIMIT, now - lastTick);
    lastTick = now;
    const pace = speed();
    if (pace === 0) return;
    const from = scroller.scrollTop;
    // At least a pixel a step: a pane rounds a smaller step away, which would read as its end.
    const step = (pace * elapsed) / 1000;
    scroller.scrollTop = from + Math.sign(step) * Math.max(1, Math.abs(step));
    // The end of the scroll: the timer rests until the pointer moves again.
    if (scroller.scrollTop === from) return;
    repick();
    timer = setTimeout(tick, EDGE_TICK);
  };
  const startTicker = (): void => {
    if (timer === undefined && speed() !== 0) {
      lastTick = Date.now();
      timer = setTimeout(tick, EDGE_TICK);
    }
  };
  const move = (event: Event): void => {
    if (!(event instanceof MouseEvent)) return;
    pointerY = event.clientY;
    repick();
    startTicker();
  };
  const up = (): void => {
    end(true);
  };
  const cancel = (): void => {
    end(false);
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    end(false);
  };
  const end = (drop: boolean): void => {
    if (sessions.get(view)?.end !== end) return;
    sessions.delete(view);
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    window?.removeEventListener('pointermove', move);
    window?.removeEventListener('pointerup', up);
    window?.removeEventListener('pointercancel', cancel);
    window?.removeEventListener('keydown', key, true);
    window?.removeEventListener('blur', cancel);
    scroller.removeEventListener('scroll', repick);
    if (pointerId !== undefined && grip.hasPointerCapture?.(pointerId) === true) {
      grip.releasePointerCapture(pointerId);
    }
    const drag = notebookDragOf(view);
    // An edit already ended it in the state: nothing to clear, nothing to drop.
    if (drag === null) return;
    view.dispatch({ effects: setNotebookDrag.of(null) });
    if (drop && drag.before !== null)
      view.state.facet(framesOptions)?.move?.(view, drag.from, drag.before);
  };
  sessions.set(view, { end });
  window?.addEventListener('pointermove', move);
  window?.addEventListener('pointerup', up);
  window?.addEventListener('pointercancel', cancel);
  window?.addEventListener('keydown', key, true);
  window?.addEventListener('blur', cancel);
  scroller.addEventListener('scroll', repick);
  view.dispatch({ effects: setNotebookDrag.of({ from: index, before: null }) });
}

/** An edit of the text while dragging ends the drag and releases the pointer. */
const dragCanceller = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      const session = sessions.get(update.view);
      // Out of the update cycle: ending a session may dispatch, which an update must not.
      if (session !== undefined) queueMicrotask(() => session.end(false));
    }

    destroy(): void {
      sessions.get(this.view)?.end(false);
    }
  },
);

/** The drop line on its boundary, while a drag is on its way. */
class DropMarker implements LayerMarker {
  constructor(readonly top: number) {}

  eq(other: DropMarker): boolean {
    return other.top === this.top;
  }

  draw(): HTMLElement {
    const line = document.createElement('div');
    line.className = 'cm-notebook-drop';
    line.style.top = `${String(this.top)}px`;
    return line;
  }
}

function dropMarkers(view: EditorView): readonly LayerMarker[] {
  const drag = notebookDragOf(view);
  if (drag === null || drag.before === null) return [];
  const place = dropPlaces(view).find((each) => each.before === drag.before);
  if (place === undefined) return [];
  const scroller = view.scrollDOM;
  const baseTop = scroller.getBoundingClientRect().top - scroller.scrollTop;
  return [new DropMarker(place.top - baseTop)];
}

const dropLayer = layer({
  above: true,
  class: 'cm-notebook-drops',
  markers: dropMarkers,
  update: (update) =>
    update.startState.field(dragField, false) !== update.state.field(dragField, false) ||
    update.viewportChanged ||
    update.heightChanged,
});

const dragTheme = EditorView.baseTheme({
  '.cm-notebook-drops': { pointerEvents: 'none', width: '100%' },
  '.cm-notebook-drops > .cm-notebook-drop': {
    left: 0,
    right: 0,
    height: '2px',
    transform: 'translateY(-50%)',
  },
  '.cm-notebook-grip': { cursor: 'grab', touchAction: 'none', userSelect: 'none' },
});

/** Mount once per editor that shows a notebook. */
export function notebookFrames(options: NotebookFramesOptions): Extension {
  return [
    framesOptions.of(options),
    selectedField,
    dragField,
    leaveOnTextFocus,
    framesPlugin,
    gripGutter,
    markerGutter,
    toolbarLayer,
    insertLayer,
    dropLayer,
    dragCanceller,
    toolbarTheme,
    dragTheme,
  ];
}
