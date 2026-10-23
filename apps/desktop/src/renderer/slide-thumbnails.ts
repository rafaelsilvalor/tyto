import { LitElement, type PropertyValues, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { frameDocument } from './show-document.js';
import { cellScale } from './template-mode.js';

/**
 * A row of slide thumbnails (TYTO-323, ADR 0123): every slide of one format, scaled, in order,
 * and the selected one marked. It replaced the preview's Slide picker.
 *
 * **Two layouts, one element.** `strip` is the row under the stage in One slide mode; `grid` is
 * All slides mode, every slide wrapped in rows and scaled so they all fit the pane
 * ({@link gridThumbnailHeight}). The preview switches the layout of the same element rather than
 * drawing a second one, so a brief's thumbnails are one set of iframes whatever the mode, and a
 * keystroke re-navigates one of them, not one per mode. In the grid a click *opens* a slide
 * (`open`), which the preview turns into One slide mode on it; the keys still only choose.
 *
 * **A thumbnail is the live HTML document, scaled**, the way the template-mode grid draws its
 * cells: every `brief:preview` answer already carries the document of every slide and format,
 * so a thumbnail costs no request and no work in main. Raster and SVG thumbnails were rejected
 * in the ADR.
 *
 * **Every write goes through `frameDocument`**, so no iframe here is given `srcdoc` outside
 * `showDocument`, which is what keeps TYTO-219's first-of-two-srcdoc race out; and since
 * `showDocument` does nothing for the document already showing, a keystroke on slide 3
 * re-navigates thumbnail 3 alone. **Only a thumbnail on screen is given a document**: an
 * `IntersectionObserver` on the row says which are, so a 20-slide brief starts as many
 * navigations as fit in the row, not 20. One scrolled away keeps what it last showed.
 *
 * It takes a generic list rather than the preview's frames, so a strip of anything that is an
 * HTML document of a known size can reuse it. It holds no selection of its own: `selected` is
 * handed in and `choose` is called, and the window repaints it.
 */

export const SLIDE_THUMBNAILS_TAG = 'tyto-slide-thumbnails';

/** Thumbnails are this tall, whatever the format; the width follows its aspect ratio. */
export const THUMBNAIL_HEIGHT = 96;

/** One thumbnail: a document and the size it is laid out at, before it is scaled. */
export interface Thumbnail {
  /** Stable across answers, so a changed document keeps its iframe. */
  readonly id: string;
  /** What the caption says: the slide's number. */
  readonly label: string;
  readonly html: string;
  readonly width: number;
  readonly height: number;
}

/** How the thumbnails are laid out: a row under the stage, or the whole pane in rows. */
export type ThumbnailLayout = 'strip' | 'grid';

/** A grid thumbnail is never drawn smaller than this; below it the grid scrolls instead. */
export const GRID_MINIMUM_HEIGHT = 64;

/** What a grid cell needs besides its picture: the padding, the gap and the number under it. */
export interface GridChrome {
  /** Between two cells, both ways. */
  readonly gap: number;
  /** What a cell adds to its picture's width and height. */
  readonly cellWidth: number;
  readonly cellHeight: number;
}

/**
 * How tall the grid's thumbnails are drawn so that `count` slides of one format fit `box`
 * (TYTO-323): every column count is tried, and the one that leaves the largest picture wins. Never
 * past the format's own size, and never under {@link GRID_MINIMUM_HEIGHT}, where a 40-slide brief
 * in a small pane scrolls rather than shrinks to stamps.
 */
export function gridThumbnailHeight(
  count: number,
  format: { readonly width: number; readonly height: number },
  box: { readonly width: number; readonly height: number },
  chrome: GridChrome,
): number {
  if (count <= 0 || box.width <= 0 || box.height <= 0 || format.width <= 0) return THUMBNAIL_HEIGHT;
  const aspect = format.width / format.height;
  let best = 0;
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const width = (box.width - chrome.gap * (columns - 1)) / columns - chrome.cellWidth;
    const height = (box.height - chrome.gap * (rows - 1)) / rows - chrome.cellHeight;
    best = Math.max(best, Math.min(height, width / aspect));
  }
  return Math.max(GRID_MINIMUM_HEIGHT, Math.floor(Math.min(best, format.height)));
}

/** The keys that move the selection while the row has focus, and where each one goes. */
function movedTo(key: string, at: number, count: number, columns: number): number | undefined {
  switch (key) {
    case 'ArrowLeft':
      return Math.max(at - 1, 0);
    case 'ArrowRight':
      return Math.min(at + 1, count - 1);
    // A row of the grid. The strip is one row, so there they do nothing.
    case 'ArrowUp':
      return columns >= count ? undefined : Math.max(at - columns, 0);
    case 'ArrowDown':
      return columns >= count ? undefined : Math.min(at + columns, count - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

export class SlideThumbnails extends LitElement {
  static override properties = {
    items: { attribute: false },
    selected: { attribute: false },
    label: { attribute: false },
    layout: { attribute: false },
    gridHeight: { state: true },
  };

  declare items: readonly Thumbnail[];
  declare selected: string | undefined;
  /** The row's accessible name, in the window's language. */
  declare label: string;
  declare layout: ThumbnailLayout;
  /** How tall a grid thumbnail is drawn, measured off the element's box. */
  declare private gridHeight: number;
  /** Called with a thumbnail's id when it is clicked or reached with a key. */
  choose: (id: string) => void = () => undefined;
  /** Called with a thumbnail's id when it is clicked, or Enter is pressed on it, in the grid. */
  open: (id: string) => void = () => undefined;

  /** Which thumbnails are on screen, by id. Everything, where there is no observer (jsdom). */
  private readonly onScreen = new Set<string>();
  private observer: IntersectionObserver | undefined;
  private resizes: ResizeObserver | undefined;
  private readonly observed = new WeakSet<Element>();
  /** A key moved the selection, so the new one takes the focus once it is drawn. */
  private focusSelected = false;

  constructor() {
    super();
    this.items = [];
    this.selected = undefined;
    this.label = '';
    this.layout = 'strip';
    this.gridHeight = THUMBNAIL_HEIGHT;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'listbox');
    this.addEventListener('keydown', this.onKey);
    // The grid is sized to the pane, which a split or a resized window changes with nothing in
    // the state to say so. jsdom has neither observer, and lays nothing out to observe.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizes = new ResizeObserver(() => {
        if (this.layout === 'grid') this.gridHeight = this.measuredGridHeight();
      });
      this.resizes.observe(this);
    }
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset['thumbnail'];
          if (id === undefined) continue;
          if (entry.isIntersecting) this.onScreen.add(id);
          else this.onScreen.delete(id);
        }
        this.requestUpdate();
      },
      { root: this },
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKey);
    this.observer?.disconnect();
    this.observer = undefined;
    this.resizes?.disconnect();
    this.resizes = undefined;
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    const at = this.items.findIndex((item) => item.id === this.selected);
    if (this.layout === 'grid' && (event.key === 'Enter' || event.key === ' ')) {
      const item = this.items[at];
      if (item === undefined) return;
      event.preventDefault();
      this.open(item.id);
      return;
    }
    const next = movedTo(event.key, Math.max(at, 0), this.items.length, this.columns());
    const item = next === undefined ? undefined : this.items[next];
    if (item === undefined) return;
    event.preventDefault();
    this.focusSelected = true;
    if (item.id !== this.selected) this.choose(item.id);
    else this.requestUpdate();
  };

  /** How many thumbnails the first row holds: all of them in the strip. */
  private columns(): number {
    if (this.layout === 'strip') return this.items.length;
    const cells = [...this.querySelectorAll<HTMLElement>('[data-thumbnail]')];
    const top = cells[0]?.offsetTop;
    const columns = cells.filter((cell) => cell.offsetTop === top).length;
    return Math.max(columns, 1);
  }

  private shows(id: string): boolean {
    return this.observer === undefined || this.onScreen.has(id);
  }

  /**
   * The grid's thumbnail height for the room the element has now. The chrome is read off a
   * drawn cell — its padding and its number — and the gap and padding off the element, so the
   * sizes stay `shell.css`'s.
   */
  private measuredGridHeight(): number {
    const format = this.items[0];
    if (format === undefined) return this.gridHeight;
    const style = getComputedStyle(this);
    const pixels = (value: string): number => Number.parseFloat(value) || 0;
    const box = {
      width: this.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight),
      height: this.clientHeight - pixels(style.paddingTop) - pixels(style.paddingBottom),
    };
    const cell = this.querySelector<HTMLElement>('[data-thumbnail]')?.getBoundingClientRect();
    const paper = this.querySelector<HTMLElement>('.thumbnail__paper')?.getBoundingClientRect();
    // The boxes and not `offsetHeight`, which rounds: half a pixel a row was a scroll bar on a
    // 20-slide grid of four rows that fitted on paper.
    const chrome: GridChrome = {
      gap: pixels(style.rowGap),
      cellWidth: cell && paper ? Math.ceil(cell.width - paper.width) + 1 : 0,
      cellHeight: cell && paper ? Math.ceil(cell.height - paper.height) + 1 : 0,
    };
    // A box with no size (jsdom, a pane not laid out yet) keeps what it had.
    if (box.width <= 0 || box.height <= 0) return this.gridHeight;
    return gridThumbnailHeight(this.items.length, format, box, chrome);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    this.classList.toggle('thumbnails--grid', this.layout === 'grid');
    // The class is on before the box is read, so the element is measured as the grid it is
    // about to be: a strip turned grid takes the pane.
    if (this.layout === 'grid' && (changed.has('layout') || changed.has('items'))) {
      this.gridHeight = this.measuredGridHeight();
    }
  }

  protected override render(): unknown {
    this.setAttribute('aria-label', this.label);
    if (this.layout === 'strip') this.setAttribute('aria-orientation', 'horizontal');
    else this.removeAttribute('aria-orientation');
    const height = this.layout === 'grid' ? this.gridHeight : THUMBNAIL_HEIGHT;
    // The selected one is the row's one tab stop (a roving tabindex); with none selected, the
    // first is, so the row can still be reached with Tab.
    const stop = this.items.some((item) => item.id === this.selected)
      ? this.selected
      : this.items[0]?.id;
    return repeat(
      this.items,
      (item) => item.id,
      (item) => {
        const scale = cellScale(item, { width: Number.POSITIVE_INFINITY, height });
        const width = Math.round(item.width * scale);
        const drawn = Math.round(item.height * scale);
        const on = item.id === this.selected;
        return html`<figure
          class="thumbnail ${on ? 'thumbnail--on' : ''}"
          role="option"
          aria-selected=${String(on)}
          tabindex=${item.id === stop ? '0' : '-1'}
          data-thumbnail=${item.id}
          @click=${() => {
            if (this.layout === 'grid') this.open(item.id);
            else this.choose(item.id);
          }}
        >
          <div class="thumbnail__paper" style=${`width:${width}px;height:${drawn}px`}>
            <iframe
              class="thumbnail__frame"
              sandbox=""
              tabindex="-1"
              aria-hidden="true"
              title=${item.label}
              ${frameDocument(this.shows(item.id) ? item.html : undefined)}
              style=${`width:${item.width}px;height:${item.height}px;transform:scale(${scale});transform-origin:top left`}
            ></iframe>
          </div>
          <figcaption class="thumbnail__label">${item.label}</figcaption>
        </figure>`;
      },
    );
  }

  protected override updated(changed: PropertyValues<this>): void {
    const cells = [...this.querySelectorAll<HTMLElement>('[data-thumbnail]')];
    const fresh = cells.filter((cell) => !this.observed.has(cell));
    const selected = cells.find((cell) => cell.dataset['thumbnail'] === this.selected);
    // A selection made anywhere — a key here, a command — brings its thumbnail into the row.
    // jsdom has no `scrollIntoView`.
    if (selected !== undefined && (changed.has('selected') || this.focusSelected)) {
      selected.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    if (selected !== undefined && this.focusSelected) {
      this.focusSelected = false;
      selected.focus({ preventScroll: true });
    }
    if (this.observer === undefined) return;
    for (const cell of fresh) {
      this.observed.add(cell);
      this.observer.observe(cell);
    }
    // A layout or a size changed moves every cell, not only the new ones: the strip turned grid
    // shows slides the row had scrolled away, and they are given their documents now.
    // `gridHeight` is private, so not among `PropertyValues<this>`'s keys.
    const moved = changed.has('layout') || (changed as Map<PropertyKey, unknown>).has('gridHeight');
    this.measure(moved ? cells : fresh);
  }

  /**
   * Whether thumbnails are on screen, measured now rather than at the observer's next report.
   * An observer reports at the next rendering step, and a window that is not being drawn — the
   * end-to-end suite's, a window behind another — takes its time to reach one: the first
   * thumbnail of a 20-slide brief loaded 663 ms after it was inserted, against 4 ms for the
   * stage's frame, until this measure. The observer still owns every change after it: a scroll,
   * a resize, a strip shown again. Both axes, since the grid scrolls down where the strip
   * scrolls sideways.
   */
  private measure(cells: readonly HTMLElement[]): void {
    if (cells.length === 0) return;
    const row = this.getBoundingClientRect();
    let added = false;
    for (const cell of cells) {
      const box = cell.getBoundingClientRect();
      const id = cell.dataset['thumbnail'];
      // jsdom lays nothing out: no size, no answer, and the observer decides.
      if (id === undefined || box.width === 0) continue;
      const visible =
        box.right > row.left &&
        box.left < row.right &&
        box.bottom > row.top &&
        box.top < row.bottom;
      if (visible && !this.onScreen.has(id)) added = true;
      // A thumbnail drawn again after the strip was hidden is measured afresh, not remembered.
      if (visible) this.onScreen.add(id);
      else this.onScreen.delete(id);
    }
    if (added) this.requestUpdate();
  }
}

customElements.define(SLIDE_THUMBNAILS_TAG, SlideThumbnails);

declare global {
  interface HTMLElementTagNameMap {
    [SLIDE_THUMBNAILS_TAG]: SlideThumbnails;
  }
}
