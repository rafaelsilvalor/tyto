import { type IpcResponse } from '../../shared/ipc.js';
import { showDocument } from './show-document.js';
import type { SlideThumbnails, Thumbnail } from './slide-thumbnails.js';

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
export type Artwork = IpcResponse<'brief:preview'>['artworks'][number];
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

/**
 * The artworks a brief produced, which is **not** the artworks the current frames show.
 *
 * A slide that renders only to `story` has no `feed` frame, so deriving this from frames
 * would take that slide out of the list the moment somebody clicked the `feed` tab — a
 * carousel that loses a slide when you change tab. E9.3 sends the artworks themselves for
 * exactly this, and the frames stay what they were: one picture each.
 */
export const artworksOf = (artworks: readonly Artwork[]): readonly string[] =>
  distinct(artworks.map((artwork) => artwork.id));

/**
 * The selection to use once `frames` replaces what was on screen.
 *
 * **Keeps what the user picked whenever it still exists**, and that is the point rather than
 * a nicety: a preview runs on every keystroke, so a selection reset per answer would drag
 * the pane back to the first slide of the first format while somebody is typing on the
 * third. It falls back to the first frame's, which is also what the first answer of all
 * gets, since nothing was selected before it.
 *
 * **A slide that went clamps to the last one left** (TYTO-323): `before` is the artwork list
 * the selection was made in, and a selected slide past the end of the new one — the last slide
 * deleted, on slide 5 of 5 — lands on the new last slide rather than back on slide 1.
 */
export function keepSelection(
  previous: Selection,
  frames: readonly Frame[],
  list: readonly Artwork[],
  before: readonly Artwork[] = [],
): Selection {
  const formats = formatsOf(frames);
  const artworks = artworksOf(list);
  const was = previous.artwork === undefined ? -1 : artworksOf(before).indexOf(previous.artwork);

  return {
    format:
      previous.format !== undefined && formats.includes(previous.format)
        ? previous.format
        : formats[0],
    artwork:
      previous.artwork !== undefined && artworks.includes(previous.artwork)
        ? previous.artwork
        : was >= artworks.length
          ? artworks.at(-1)
          : artworks[0],
  };
}

/** A thumbnail's id: the slide and the format, so another format is another iframe. */
export const thumbnailId = (artwork: string, format: string): string => `${artwork}|${format}`;

/** The slide a thumbnail's id names: everything before the last `|`. */
export const artworkOfThumbnail = (id: string): string => id.slice(0, id.lastIndexOf('|'));

/**
 * The strip's thumbnails (TYTO-323): one per slide, in the brief's order, each the selected
 * format's frame of it and labelled with its number. A slide with no frame in that format has no
 * thumbnail, and the slides after it keep their own numbers.
 */
export function thumbnailsOf(
  state: Pick<PreviewState, 'frames' | 'artworks' | 'selection'>,
): readonly Thumbnail[] {
  const format = state.selection.format;
  if (format === undefined) return [];
  const seen = new Set<string>();
  return state.artworks.flatMap(({ id: artwork, index }) => {
    if (seen.has(artwork)) return [];
    seen.add(artwork);
    const frame = frameFor(state.frames, { format, artwork });
    return frame === undefined
      ? []
      : [
          {
            id: thumbnailId(artwork, format),
            // A number and not the artwork's id: `slide-1` is the IR's name for it, and a
            // person counting slides in a carousel is counting 1, 2, 3.
            label: String(index + 1),
            html: frame.html,
            width: frame.width,
            height: frame.height,
          },
        ];
  });
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

/** What a frame needs to be put on screen: its size and its document. */
type Picture = Pick<Frame, 'width' | 'height' | 'html'>;

/** The largest whole-frame scale that fits `stage`, never enlarging past 1:1. */
export function fitZoom(frame: Picture, stage: { width: number; height: number }): number {
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
  // `clientHeight` is rounded to a whole pixel, and up as often as down: a stage 574.7px tall
  // answered 575, `fit` filled 575, and the 0.3px the paper overflowed by gave the stage a scroll
  // bar 16px wide (TYTO-287, measured once a split made `fit` go by height). The box's own size,
  // rounded down, where there is one — jsdom lays nothing out and answers zero.
  const box = stage.getBoundingClientRect();
  const down = (client: number, measured: number): number =>
    measured > 0 ? Math.min(client, Math.floor(measured)) : client;

  return {
    width:
      down(stage.clientWidth, box.width) - pixels(style?.paddingLeft) - pixels(style?.paddingRight),
    height:
      down(stage.clientHeight, box.height) -
      pixels(style?.paddingTop) -
      pixels(style?.paddingBottom),
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
  /** The slides as thumbnails, under the stage (TYTO-323); a click on one chooses it. */
  readonly strip: SlideThumbnails;
  /** The bar's button that hides and shows the strip, remembered per tab. */
  readonly stripToggle: HTMLElement;
  /**
   * The bar's two mode buttons, One slide and All slides (TYTO-323), each a `[data-preview-mode]`
   * of `one` or `all`. Optional, as `zoom` is, for a caller that builds the pane by hand.
   */
  readonly modes?: HTMLElement;
  /** The zoom's buttons and level, which have nothing to scale while every slide is shown. */
  readonly zoom?: HTMLElement;
  /** An image's line in the formats' place (TYTO-366): its name, pixel size and file size. */
  readonly info?: HTMLElement;
  /** Why an image is not shown, in the stage (TYTO-366): too large, not an image, or gone. */
  readonly notice?: HTMLElement;
  readonly stage: HTMLElement;
  readonly paper: HTMLElement;
  readonly frame: HTMLIFrameElement;
  readonly empty: HTMLElement;
  /** The empty line's other wording: a brief is written and cannot be drawn (TYTO-268). */
  readonly broken: HTMLElement;
  readonly zoomLevel: HTMLElement;
  /**
   * The "this is older than your text" marker (E9.13).
   *
   * Inside the stage rather than beside the status line, because it has to be legible with
   * the problems panel closed — which is the case the card is about, and the panel is the
   * first thing people close.
   */
  readonly stale: HTMLElement;
}

export interface PreviewState {
  readonly frames: readonly Frame[];
  /** Every artwork the brief wrote, in its own order — see {@link artworksOf}. */
  readonly artworks: readonly Artwork[];
  readonly selection: Selection;
  readonly zoom: Zoom;
  /**
   * Whether these frames are older than the brief being typed.
   *
   * Passed in rather than worked out here: it is a property of the *document* — its frames
   * against its text — and `documents.ts` owns both. This pane draws it.
   */
  readonly stale: boolean;
  /**
   * Whether the pane is empty because the brief **cannot** be drawn, not because there is
   * none yet (TYTO-268). Passed in for {@link stale}'s reason — `isBroken` in `documents.ts`
   * works it out — and absent means no, which is every caller that only ever has frames.
   */
  readonly broken?: boolean;
  /** Whether this preview tab hid its strip (TYTO-323). Absent means shown. */
  readonly stripHidden?: boolean;
  /** One slide on the stage over the strip, or every slide in a grid (TYTO-323). Absent is one. */
  readonly mode?: PreviewMode;
  /** The strip's accessible name, in the window's language. */
  readonly stripLabel?: string;
  /**
   * The toggle's words for each state, in the window's language: what a press does, so "Hide the
   * slide strip" while it shows and "Show the slide strip" while it is hidden (Rafael, 2026-10-23).
   */
  readonly stripToggleLabels?: { readonly hide: string; readonly show: string };
}

/**
 * How a preview tab shows a brief's slides (TYTO-323, ADR 0123): `one` is the stage over the strip,
 * `all` is every slide of the format in a grid.
 */
export type PreviewMode = 'one' | 'all';

/** The attribute a mode button carries: `one` or `all`. */
export const MODE_ATTRIBUTE = 'data-preview-mode';

/** The attribute a format tab carries, which is how a click knows what it selected. */
export const FORMAT_ATTRIBUTE = 'data-format';

/** Rewrites the tab strip, marking the selected one. Returns nothing; the DOM is the state. */
function paintTabs(tabs: HTMLElement, state: PreviewState): void {
  const document_ = tabs.ownerDocument;
  const formats = formatsOf(state.frames);
  const existing = [...tabs.children];

  // The same formats keep their buttons, only the selection moves (TYTO-287). A click on a
  // format in a preview tab focuses its group first, which repaints; buttons rebuilt between
  // the press and the release took the click with them.
  if (
    existing.length === formats.length &&
    existing.every((tab, at) => tab.getAttribute(FORMAT_ATTRIBUTE) === formats[at])
  ) {
    for (const tab of existing) {
      const selected = tab.getAttribute(FORMAT_ATTRIBUTE) === state.selection.format;
      tab.setAttribute('aria-selected', String(selected));
      tab.classList.toggle('preview__tab--on', selected);
    }
    return;
  }

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

/**
 * Whether the preview draws every slide in the grid: the tab asked for it and there is more than
 * one slide to draw. One slide is not a choice, so a brief of one shows it on the stage, and the
 * tab keeps its mode for when the brief grows again.
 */
function showsAll(state: PreviewState, thumbnails: readonly Thumbnail[]): boolean {
  return state.mode === 'all' && artworksOf(state.artworks).length > 1 && thumbnails.length > 0;
}

/**
 * Hands the thumbnails element its slides, as the strip under the stage or as the All slides grid
 * (TYTO-323). **One element for both**, its layout switched, so the two modes share one set of
 * iframes and a keystroke re-navigates one thumbnail, whichever mode is on. The strip hides for a
 * brief with only one artwork or when the tab hid it — one slide is not a choice, and a strip of
 * one is furniture that reads like a control, so its toggle goes with it. The grid ignores the
 * strip's hidden flag, which waits for the tab to come back to One slide.
 */
function paintThumbnails(
  elements: PreviewElements,
  state: PreviewState,
  thumbnails: readonly Thumbnail[],
  all: boolean,
): void {
  const { strip, stripToggle } = elements;
  const single = artworksOf(state.artworks).length <= 1;
  const stripShown = !single && state.stripHidden !== true;
  stripToggle.hidden = single || all;
  // The label says what a press does, so it changes with the state, and there is no
  // `aria-pressed`: "Hide the slide strip, pressed" would announce the action and its opposite at
  // once. A toggle keeps one label and `aria-pressed`, or changes its label and drops it; this is
  // the second. The fill still marks the strip as shown for the eye.
  const label = stripShown ? state.stripToggleLabels?.hide : state.stripToggleLabels?.show;
  stripToggle.title = label ?? '';
  stripToggle.setAttribute('aria-label', label ?? '');
  stripToggle.classList.toggle('preview__strip-toggle--on', stripShown);
  const shown = all || stripShown;
  strip.hidden = !shown;
  strip.label = state.stripLabel ?? '';
  strip.layout = all ? 'grid' : 'strip';
  strip.items = shown ? thumbnails : [];
  const { artwork, format } = state.selection;
  strip.selected =
    artwork === undefined || format === undefined ? undefined : thumbnailId(artwork, format);
}

/**
 * Marks the mode button that is on, and hides both for a brief of one slide, where there is
 * nothing to show all of. The two keep their labels, so each says whether it is on with
 * `aria-pressed`.
 */
function paintModes(elements: PreviewElements, state: PreviewState, all: boolean): void {
  const { modes } = elements;
  if (modes === undefined) return;
  modes.hidden = artworksOf(state.artworks).length <= 1;
  for (const button of modes.querySelectorAll<HTMLElement>(`[${MODE_ATTRIBUTE}]`)) {
    const on = button.getAttribute(MODE_ATTRIBUTE) === (all ? 'all' : 'one');
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('preview__mode--on', on);
  }
}

/**
 * Puts one frame on screen at one scale.
 *
 * The document goes in at its **own** size and the scale is a transform on top, which is the
 * difference between a preview and a different artwork: `width: 1080px` laid out in a 300px
 * box would reflow the text and show a layout nobody is going to export.
 */
function paintFrame(elements: PreviewElements, frame: Picture, zoom: number): void {
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
  showDocument(iframe, frame.html);
}

/**
 * Paints the whole pane from state, and returns the zoom actually used.
 *
 * `fit` has to be resolved here rather than stored, because it depends on the size of the
 * stage — which changes when the window does, with no state change to notice it.
 */
export function paintPreview(elements: PreviewElements, state: PreviewState): number {
  // The same pane shows an image when its tab's subject is one (TYTO-366): undo what that hid.
  elements.tabs.hidden = false;
  if (elements.info !== undefined) elements.info.hidden = true;
  if (elements.notice !== undefined) elements.notice.hidden = true;
  paintTabs(elements.tabs, state);
  const thumbnails = thumbnailsOf(state);
  const all = showsAll(state, thumbnails);
  paintThumbnails(elements, state, thumbnails, all);
  paintModes(elements, state, all);
  if (elements.zoom !== undefined) elements.zoom.hidden = all;
  elements.stage.classList.toggle('preview__stage--marker', all);

  if (all) {
    // The grid has the pane, and the stage is left holding only the stale marker, over the
    // grid, while there is one: E9.13's line has to be legible in every mode. The stage's own
    // frame is not given the new document, which it gets once the tab is back to One slide.
    elements.stage.hidden = !state.stale;
    elements.paper.hidden = true;
    elements.empty.hidden = true;
    elements.broken.hidden = true;
    elements.stale.hidden = !state.stale;
    elements.zoomLevel.textContent = '';
    return 1;
  }
  elements.stage.hidden = false;

  const frame = frameFor(state.frames, state.selection);

  if (frame === undefined) {
    elements.paper.hidden = true;
    // One line or the other, never both: "write a brief" under a brief that is written is
    // the line this card took away (TYTO-268).
    const broken = state.broken === true;
    elements.empty.hidden = broken;
    elements.broken.hidden = !broken;
    // Never on the empty state: there is no artwork to be out of date, and a brief that has
    // never compiled would otherwise open marked.
    elements.stale.hidden = true;
    elements.zoomLevel.textContent = '';
    return 1;
  }

  elements.paper.hidden = false;
  elements.empty.hidden = true;
  elements.broken.hidden = true;
  // A state of the preview rather than a second error message. The problems panel already
  // lists what is wrong and this does not repeat it; what it says is that the picture and
  // the text have stopped agreeing.
  elements.stale.hidden = !state.stale;

  const zoom = state.zoom === 'fit' ? fitZoom(frame, stageBox(elements.stage)) : state.zoom;

  paintFrame(elements, frame, zoom);
  elements.zoomLevel.textContent = `${String(Math.round(zoom * 100))}%`;
  return zoom;
}

/**
 * An image from the explorer, as a preview tab shows it (TYTO-366, ADR 0124). `image` is absent
 * while main is asked and when it answered why not, which `notice` then says.
 */
export interface ImagePreviewState {
  readonly image?: {
    readonly dataUrl: string;
    /** The size it is drawn at: its pixels, or an SVG's viewBox when it gives no size. */
    readonly width: number;
    readonly height: number;
  };
  /** The bar's line, in the formats' place: name, pixel size and file size. */
  readonly info: string;
  /** Why nothing is drawn: too large, not an image, or gone. Absent while it is asked. */
  readonly notice?: string;
  readonly zoom: Zoom;
}

/** What main's answer must look like before it goes into a document: `data:image/…;base64,…`. */
const IMAGE_DATA_URL = /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/]*={0,2}$/u;

/**
 * The document an image is shown in: **one `<img>` and nothing else** (TYTO-366, ADR 0124). An
 * SVG goes in as `data:image/svg+xml` inside an `<img>`, where Chromium draws it as a picture —
 * no script runs and nothing is fetched — and never as markup, which would be a live document.
 * It is the first of three layers; the frame's `sandbox=""` and the window's CSP are the others.
 * A value that is not a base64 `data:image/` URI gives an empty document rather than markup.
 *
 * `color-scheme: light dark`, so the frame's canvas is transparent in both themes and a
 * transparent image shows the paper's checkerboard: a document whose scheme differs from the
 * window's gets an opaque white canvas, seen in the dark theme before this was written.
 */
export function imageDocument(dataUrl: string): string {
  const source = IMAGE_DATA_URL.test(dataUrl) ? dataUrl : '';
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    ':root{color-scheme:light dark}' +
    'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}' +
    'img{display:block;width:100%;height:100%}' +
    `</style></head><body><img alt="" src="${source}"></body></html>`
  );
}

/**
 * A file size as the bar says it: bytes under a kilobyte, whole kilobytes under a megabyte, and
 * megabytes to one decimal, in the window's language — "84 KB", "1,5 MB" in Portuguese.
 */
export function formatBytes(bytes: number, locale: string): string {
  const number = (value: number): string =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${number(bytes / (1024 * 1024))} MB`;
}

/**
 * The bar's line for an image: "logo.png · 1200 × 630 px · 84 KB", and an SVG whose size is its
 * viewBox marked with the word for scalable. With no size yet, the name and the file size.
 */
export function imageInfoLine(parts: {
  readonly name: string;
  readonly bytes: number | undefined;
  readonly size: { readonly width: number; readonly height: number } | undefined;
  readonly scalable: string | undefined;
  readonly locale: string;
}): string {
  const pieces = [parts.name];
  if (parts.size !== undefined) {
    const pixels = `${String(parts.size.width)} × ${String(parts.size.height)} px`;
    pieces.push(parts.scalable === undefined ? pixels : `${pixels} (${parts.scalable})`);
  }
  if (parts.bytes !== undefined) pieces.push(formatBytes(parts.bytes, parts.locale));
  return pieces.join(' · ');
}

/**
 * An SVG's size from its viewBox, when its root element gives no `width` and `height` of its own
 * (TYTO-366): what the preview draws it at and the bar says, marked scalable. `undefined` when the
 * root has a size, or no usable viewBox, and the decoded size stands.
 */
export function svgViewBoxSize(svg: string): { width: number; height: number } | undefined {
  const root = /<svg\b[^>]*>/iu.exec(svg)?.[0];
  if (root === undefined) return undefined;
  const attribute = (name: string): string | undefined =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'iu').exec(root)?.[1];
  if (attribute('width') !== undefined && attribute('height') !== undefined) return undefined;
  const box = attribute('viewBox')
    ?.trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (box?.length !== 4 || !box.every(Number.isFinite)) return undefined;
  const [, , width = 0, height = 0] = box;
  return width > 0 && height > 0
    ? { width: Math.round(width), height: Math.round(height) }
    : undefined;
}

/**
 * Paints an image into a preview pane, and returns the zoom used (TYTO-366, ADR 0124). The brief's
 * furniture hides — the formats, the two modes, the strip and its toggle — and the zoom, Fit and
 * Lock stay. **One path to the screen**: the image's document goes through the same frame, the
 * same `showDocument` and the same `fitZoom` as a brief's art, so Fit never enlarges past 1:1.
 */
export function paintImage(elements: PreviewElements, state: ImagePreviewState): number {
  elements.tabs.hidden = true;
  if (elements.info !== undefined) {
    elements.info.hidden = false;
    elements.info.textContent = state.info;
  }
  if (elements.modes !== undefined) elements.modes.hidden = true;
  elements.stripToggle.hidden = true;
  elements.strip.hidden = true;
  elements.strip.items = [];
  if (elements.zoom !== undefined) elements.zoom.hidden = false;
  elements.stage.classList.remove('preview__stage--marker');
  elements.stage.hidden = false;
  elements.empty.hidden = true;
  elements.broken.hidden = true;
  elements.stale.hidden = true;
  const notice = state.image === undefined ? state.notice : undefined;
  if (elements.notice !== undefined) {
    elements.notice.hidden = notice === undefined;
    elements.notice.textContent = notice ?? '';
  }

  if (state.image === undefined) {
    elements.paper.hidden = true;
    elements.zoomLevel.textContent = '';
    return 1;
  }
  const picture = { ...state.image, html: imageDocument(state.image.dataUrl) };
  elements.paper.hidden = false;
  const zoom = state.zoom === 'fit' ? fitZoom(picture, stageBox(elements.stage)) : state.zoom;
  paintFrame(elements, picture, zoom);
  elements.zoomLevel.textContent = `${String(Math.round(zoom * 100))}%`;
  return zoom;
}

/** How many of `diagnostics` are errors, which is what turns the status bar's count red. */
export const errorCount = (diagnostics: readonly Diagnostic[]): number =>
  diagnostics.filter((item) => item.severity === 'error').length;
