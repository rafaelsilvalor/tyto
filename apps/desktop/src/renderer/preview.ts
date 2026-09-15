import { type IpcResponse } from '../../shared/ipc.js';

/**
 * The preview pane: which frame is showing, at what size, and how it gets on screen.
 *
 * Everything here is a function of state and a DOM node, and none of it knows about the
 * bridge — `main.ts` owns the round trip. That split is what lets the interesting parts be
 * tested in jsdom, and it is also the shape the card's two harder acceptance criteria take:
 * *switching a format tab must not re-render* is a claim about this module never asking for
 * anything, and *stale results are discarded* is `requestGate` below.
 */

/** One frame, as it comes off the bridge. */
export type Frame = IpcResponse<'brief:preview'>['frames'][number];
export type Diagnostic = IpcResponse<'brief:preview'>['diagnostics'][number];

/** What the pane is currently showing. `undefined` before the first answer arrives. */
export interface Selection {
  readonly format: string | undefined;
  readonly artwork: string | undefined;
}

/** `fit` recomputes from the stage on every paint; a number is what the user chose. */
export type Zoom = number | 'fit';

export const ZOOM_STEPS: readonly number[] = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2];

/** Unique values in the order the frames first mention them. */
const distinct = (values: readonly string[]): readonly string[] => [...new Set(values)];

export const formatsOf = (frames: readonly Frame[]): readonly string[] =>
  distinct(frames.map((frame) => frame.format));

export const artworksOf = (frames: readonly Frame[]): readonly string[] =>
  distinct(frames.map((frame) => frame.artwork));

/**
 * The selection to use once `frames` replaces what was on screen.
 *
 * **Keeps what the user picked whenever it still exists**, and that is the point rather than
 * a nicety: a preview runs on every keystroke, so a selection reset per answer would drag
 * the pane back to the first slide of the first format while somebody is typing on the
 * third. It falls back to the first frame's, which is also what the first answer of all
 * gets, since nothing was selected before it.
 */
export function keepSelection(previous: Selection, frames: readonly Frame[]): Selection {
  const formats = formatsOf(frames);
  const artworks = artworksOf(frames);

  return {
    format:
      previous.format !== undefined && formats.includes(previous.format)
        ? previous.format
        : formats[0],
    artwork:
      previous.artwork !== undefined && artworks.includes(previous.artwork)
        ? previous.artwork
        : artworks[0],
  };
}

/**
 * The frame a selection names, or `undefined` when the pair does not exist.
 *
 * A pair can be missing without either half being: a brief whose second slide renders only
 * to `story` has a `feed` and a slide 2, and no `feed` of slide 2. Returning `undefined` and
 * letting the pane say so is better than silently showing a different slide.
 */
export function frameFor(frames: readonly Frame[], selection: Selection): Frame | undefined {
  return frames.find(
    (frame) => frame.format === selection.format && frame.artwork === selection.artwork,
  );
}

/** The largest whole-frame scale that fits `stage`, never enlarging past 1:1. */
export function fitZoom(frame: Frame, stage: { width: number; height: number }): number {
  if (stage.width <= 0 || stage.height <= 0) return 1;
  return Math.min(1, stage.width / frame.width, stage.height / frame.height);
}

/**
 * The room inside `stage`, with its padding taken off.
 *
 * `clientWidth` and `clientHeight` **include** padding, so fitting to them puts a frame that
 * is exactly as tall as the box inside a box that is 32px shorter than that — and the stage
 * scrolls at the one zoom level whose whole job is not to. Seen at 900×600 before it was
 * subtracted (TYTO-41).
 */
export function stageBox(stage: HTMLElement): { width: number; height: number } {
  const style = stage.ownerDocument.defaultView?.getComputedStyle(stage);
  const pixels = (value: string | undefined): number => Number.parseFloat(value ?? '0') || 0;

  return {
    width: stage.clientWidth - pixels(style?.paddingLeft) - pixels(style?.paddingRight),
    height: stage.clientHeight - pixels(style?.paddingTop) - pixels(style?.paddingBottom),
  };
}

/** The next step up or down from `current`, clamped at the ends of {@link ZOOM_STEPS}. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const steps = ZOOM_STEPS;
  if (direction === 1) return steps.find((step) => step > current + 1e-6) ?? steps.at(-1) ?? 1;
  return [...steps].reverse().find((step) => step < current - 1e-6) ?? steps[0] ?? 1;
}

/**
 * Hands out request ids and says whether an answer is still wanted.
 *
 * The renderer asks on every keystroke and the answers resolve out of order — a compile of
 * three slides can land after the compile of the two-character brief that replaced it. So
 * the gate remembers only the last id it issued, and `accept` is true for that one and
 * nothing else. Main does not cancel and does not need to: a compile is milliseconds, and
 * cancellation would be more machinery than it saves.
 */
export interface RequestGate {
  next(): number;
  accept(requestId: number): boolean;
}

export function createRequestGate(): RequestGate {
  let issued = 0;
  let wanted = -1;

  return {
    next: () => {
      issued += 1;
      wanted = issued;
      return issued;
    },
    accept: (requestId: number) => requestId === wanted,
  };
}

/** The elements the pane writes into. Looked up once by `main.ts`. */
export interface PreviewElements {
  readonly tabs: HTMLElement;
  readonly slide: HTMLSelectElement;
  readonly slideLabel: HTMLElement;
  readonly stage: HTMLElement;
  readonly paper: HTMLElement;
  readonly frame: HTMLIFrameElement;
  readonly empty: HTMLElement;
  readonly zoomLevel: HTMLElement;
}

export interface PreviewState {
  readonly frames: readonly Frame[];
  readonly selection: Selection;
  readonly zoom: Zoom;
}

/** The attribute a format tab carries, which is how a click knows what it selected. */
export const FORMAT_ATTRIBUTE = 'data-format';

/** Rewrites the tab strip, marking the selected one. Returns nothing; the DOM is the state. */
function paintTabs(tabs: HTMLElement, state: PreviewState): void {
  const document_ = tabs.ownerDocument;

  tabs.replaceChildren(
    ...formatsOf(state.frames).map((format) => {
      const tab = document_.createElement('button');
      tab.type = 'button';
      tab.className = 'preview__tab';
      tab.setAttribute(FORMAT_ATTRIBUTE, format);
      tab.setAttribute('role', 'tab');
      // The format's own name, so **not** from the catalogue: `feed` and `story` are what
      // `formats.yaml` calls them and what the author typed in the brief. Translating them
      // would mean the tab and the brief disagreed about the name of the same thing.
      tab.textContent = format;
      const selected = format === state.selection.format;
      tab.setAttribute('aria-selected', String(selected));
      tab.classList.toggle('preview__tab--on', selected);
      return tab;
    }),
  );
}

/** Fills the slide picker, and hides it for a brief with only one artwork. */
function paintSlides(elements: PreviewElements, state: PreviewState): void {
  const artworks = artworksOf(state.frames);
  const document_ = elements.slide.ownerDocument;

  elements.slide.replaceChildren(
    ...artworks.map((artwork, index) => {
      const option = document_.createElement('option');
      option.value = artwork;
      // A number and not the artwork's id: `artwork-1` is the IR's name for it, and a
      // person counting slides in a carousel is counting 1, 2, 3.
      option.textContent = String(index + 1);
      option.selected = artwork === state.selection.artwork;
      return option;
    }),
  );

  // One slide is not a choice, and a picker with one option in it is furniture that reads
  // like a control. The label goes with it, or it labels nothing.
  const single = artworks.length <= 1;
  elements.slide.hidden = single;
  elements.slideLabel.hidden = single;
}

/**
 * Puts one frame on screen at one scale.
 *
 * The document goes in at its **own** size and the scale is a transform on top, which is the
 * difference between a preview and a different artwork: `width: 1080px` laid out in a 300px
 * box would reflow the text and show a layout nobody is going to export.
 */
function paintFrame(elements: PreviewElements, frame: Frame, zoom: number): void {
  const { paper, frame: iframe } = elements;

  iframe.style.width = `${String(frame.width)}px`;
  iframe.style.height = `${String(frame.height)}px`;
  iframe.style.transform = `scale(${String(zoom)})`;
  iframe.style.transformOrigin = 'top left';

  // The box that takes up room in the layout is the *scaled* size; the iframe inside it is
  // full size and transformed, and a transform does not affect layout.
  paper.style.width = `${String(Math.round(frame.width * zoom))}px`;
  paper.style.height = `${String(Math.round(frame.height * zoom))}px`;

  // `srcdoc` and not a blob URL: the document is already a string in this process, and a
  // blob would be a second thing to revoke. `sandbox` is on the element in the HTML — no
  // scripts, unique origin — because a preview document is a picture, not a program.
  if (iframe.getAttribute('srcdoc') !== frame.html) iframe.setAttribute('srcdoc', frame.html);
}

/**
 * Paints the whole pane from state, and returns the zoom actually used.
 *
 * `fit` has to be resolved here rather than stored, because it depends on the size of the
 * stage — which changes when the window does, with no state change to notice it.
 */
export function paintPreview(elements: PreviewElements, state: PreviewState): number {
  paintTabs(elements.tabs, state);
  paintSlides(elements, state);

  const frame = frameFor(state.frames, state.selection);

  if (frame === undefined) {
    elements.paper.hidden = true;
    elements.empty.hidden = false;
    elements.zoomLevel.textContent = '';
    return 1;
  }

  elements.paper.hidden = false;
  elements.empty.hidden = true;

  const zoom = state.zoom === 'fit' ? fitZoom(frame, stageBox(elements.stage)) : state.zoom;

  paintFrame(elements, frame, zoom);
  elements.zoomLevel.textContent = `${String(Math.round(zoom * 100))}%`;
  return zoom;
}

/** How many of `diagnostics` are errors, which is the number the status line leads with. */
export const errorCount = (diagnostics: readonly Diagnostic[]): number =>
  diagnostics.filter((item) => item.severity === 'error').length;
