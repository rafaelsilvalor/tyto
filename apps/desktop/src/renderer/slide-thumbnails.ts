import { LitElement, type PropertyValues, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { frameDocument } from './show-document.js';
import { cellScale } from './template-mode.js';

/**
 * A row of slide thumbnails (TYTO-323, ADR 0123): every slide of one format, scaled, in order,
 * and the selected one marked. It replaced the preview's Slide picker, and the All slides grid of
 * the card's second pull request is meant to draw the same element.
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

/** The keys that move the selection while the row has focus, and where each one goes. */
function movedTo(key: string, at: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowLeft':
      return Math.max(at - 1, 0);
    case 'ArrowRight':
      return Math.min(at + 1, count - 1);
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
  };

  declare items: readonly Thumbnail[];
  declare selected: string | undefined;
  /** The row's accessible name, in the window's language. */
  declare label: string;
  /** Called with a thumbnail's id when it is clicked or reached with a key. */
  choose: (id: string) => void = () => undefined;

  /** Which thumbnails are on screen, by id. Everything, where there is no observer (jsdom). */
  private readonly onScreen = new Set<string>();
  private observer: IntersectionObserver | undefined;
  private readonly observed = new WeakSet<Element>();
  /** A key moved the selection, so the new one takes the focus once it is drawn. */
  private focusSelected = false;

  constructor() {
    super();
    this.items = [];
    this.selected = undefined;
    this.label = '';
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'listbox');
    this.setAttribute('aria-orientation', 'horizontal');
    this.addEventListener('keydown', this.onKey);
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
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    const at = this.items.findIndex((item) => item.id === this.selected);
    const next = movedTo(event.key, Math.max(at, 0), this.items.length);
    const item = next === undefined ? undefined : this.items[next];
    if (item === undefined) return;
    event.preventDefault();
    this.focusSelected = true;
    if (item.id !== this.selected) this.choose(item.id);
    else this.requestUpdate();
  };

  private shows(id: string): boolean {
    return this.observer === undefined || this.onScreen.has(id);
  }

  protected override render(): unknown {
    this.setAttribute('aria-label', this.label);
    // The selected one is the row's one tab stop (a roving tabindex); with none selected, the
    // first is, so the row can still be reached with Tab.
    const stop = this.items.some((item) => item.id === this.selected)
      ? this.selected
      : this.items[0]?.id;
    return repeat(
      this.items,
      (item) => item.id,
      (item) => {
        const scale = cellScale(item, {
          width: Number.POSITIVE_INFINITY,
          height: THUMBNAIL_HEIGHT,
        });
        const width = Math.round(item.width * scale);
        const height = Math.round(item.height * scale);
        const on = item.id === this.selected;
        return html`<figure
          class="thumbnail ${on ? 'thumbnail--on' : ''}"
          role="option"
          aria-selected=${String(on)}
          tabindex=${item.id === stop ? '0' : '-1'}
          data-thumbnail=${item.id}
          @click=${() => {
            this.choose(item.id);
          }}
        >
          <div class="thumbnail__paper" style=${`width:${width}px;height:${height}px`}>
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
    this.measureFresh(fresh);
  }

  /**
   * Whether new thumbnails are on screen, measured now rather than at the observer's first
   * report. An observer reports at the next rendering step, and a window that is not being drawn
   * — the end-to-end suite's, a window behind another — takes its time to reach one: the first
   * thumbnail of a 20-slide brief loaded 663 ms after it was inserted, against 4 ms for the
   * stage's frame, until this measure. The observer still owns every change after it: a scroll,
   * a resize, a strip shown again.
   */
  private measureFresh(fresh: readonly HTMLElement[]): void {
    if (fresh.length === 0) return;
    const row = this.getBoundingClientRect();
    let added = false;
    for (const cell of fresh) {
      const box = cell.getBoundingClientRect();
      const id = cell.dataset['thumbnail'];
      // jsdom lays nothing out: no size, no answer, and the observer decides.
      if (id === undefined || box.width === 0) continue;
      const visible = box.right > row.left && box.left < row.right;
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
