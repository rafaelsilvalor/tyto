import { LitElement, html } from 'lit';

import { icon } from './icons.js';
import type { PreviewElements } from './preview.js';
import type { SlideThumbnails } from './slide-thumbnails.js';
import './slide-thumbnails.js';

/**
 * A brief's art, as the content of a preview tab (TYTO-287, ADR 0084).
 *
 * The markup the PREVIEW dock panel had, with **no ids**: a window can show two previews at
 * once — a following one and a locked one — so every node is found by a `data-preview-*`
 * attribute inside its own pane ({@link previewElementsOf}). A bar of the brief's formats, the
 * two modes (One slide, All slides), the strip's toggle, the zoom and the lock over the stage,
 * and under the stage a strip of the slides as thumbnails, which is how a slide is chosen since
 * TYTO-323 (ADR 0123). In All slides mode the same thumbnails element is the grid, and takes the
 * stage's room.
 *
 * **The bar is the pane's header row** (TYTO-288, ADR 0085): the same height as every group's
 * and every panel's, one line that never wraps, the formats taking what room is left and the
 * toggle, zoom and lock at the end, never shrunk. It stays inside this element because
 * `paintPreview` finds its nodes inside the pane; the group hides its own header row while a
 * preview is in front, so the two are never stacked.
 *
 * Rendered once, like the panels were: Lit leaves the nodes alone afterwards, and `preview.ts`
 * paints into them as it painted into the panel's. It holds no state — which brief it shows and
 * whether it is locked are `editor-groups.ts`'s, painted by `main.ts`.
 */

export const PREVIEW_PANE_TAG = 'tyto-preview-pane';

export class PreviewPane extends LitElement {
  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected override render(): unknown {
    // Focusable, so a click anywhere in it focuses its group (ADR 0084 changes ADR 0083's
    // decision 6): a preview is a tab like any other now, and the person is looking at it.
    this.tabIndex = -1;
    return html`<div class="preview__bar pane__header" data-font-area="paneHeaders">
        <div class="preview__tabs" data-preview-formats role="tablist"></div>
        <div class="pane__actions">
          <div class="preview__modes" data-preview-modes role="group" hidden>
            <button
              type="button"
              class="preview__mode"
              data-preview-mode="one"
              data-i18n="preview.mode.one"
              aria-pressed="true"
            ></button>
            <button
              type="button"
              class="preview__mode"
              data-preview-mode="all"
              data-i18n="preview.mode.all"
              aria-pressed="false"
            ></button>
          </div>
          <button type="button" class="preview__strip-toggle" data-preview-strip-toggle>
            ${icon('strip')}
          </button>
          <div class="preview__zoom" data-preview-zoom-group>
            <button type="button" data-preview-zoom="out" data-i18n-title="preview.zoom.out">
              −
            </button>
            <output class="preview__level" data-preview-zoom-level></output>
            <button type="button" data-preview-zoom="in" data-i18n-title="preview.zoom.in">
              +
            </button>
            <button type="button" data-preview-zoom="fit" data-i18n="preview.zoom.fit"></button>
          </div>
          <button
            type="button"
            class="preview__lock"
            data-preview-lock
            data-i18n="preview.lock"
            aria-pressed="false"
          ></button>
        </div>
      </div>
      <div class="preview__stage" data-preview-stage>
        <div class="preview__paper" data-preview-paper hidden>
          <!--
          \`sandbox\` with no tokens: unique origin, no scripts, no forms, no navigation. A
          preview document is a picture. The exporter emits no script and this is what makes
          that a property of the window rather than a habit of the exporter.
        -->
          <iframe data-preview-frame sandbox="" title="Tyto"></iframe>
        </div>
        <p class="preview__empty" data-preview-empty data-i18n="preview.empty"></p>
        <!-- TYTO-268: in the empty line's place when the brief is written and cannot be drawn. -->
        <p class="preview__empty" data-preview-broken data-i18n="preview.broken" hidden></p>
        <p class="preview__stale" data-preview-stale data-i18n="preview.stale" hidden></p>
      </div>
      <tyto-slide-thumbnails
        class="preview__strip"
        data-preview-strip
        hidden
      ></tyto-slide-thumbnails>`;
  }
}

customElements.define(PREVIEW_PANE_TAG, PreviewPane);

declare global {
  interface HTMLElementTagNameMap {
    [PREVIEW_PANE_TAG]: PreviewPane;
  }
}

/** The nodes `paintPreview` writes into, inside one pane; `undefined` before its first render. */
export function previewElementsOf(pane: ParentNode): PreviewElements | undefined {
  const find = <T extends HTMLElement = HTMLElement>(attribute: string): T | null =>
    pane.querySelector<T>(`[${attribute}]`);
  const tabs = find('data-preview-formats');
  const strip = pane.querySelector('[data-preview-strip]') as SlideThumbnails | null;
  const stripToggle = find('data-preview-strip-toggle');
  const stage = find('data-preview-stage');
  const paper = find('data-preview-paper');
  const frame = find<HTMLIFrameElement>('data-preview-frame');
  const empty = find('data-preview-empty');
  const broken = find('data-preview-broken');
  const stale = find('data-preview-stale');
  const zoomLevel = find('data-preview-zoom-level');
  if (
    tabs === null ||
    strip === null ||
    stripToggle === null ||
    stage === null ||
    paper === null ||
    frame === null ||
    empty === null ||
    broken === null ||
    stale === null ||
    zoomLevel === null
  ) {
    return undefined;
  }
  const modes = find('data-preview-modes') ?? undefined;
  const zoom = find('data-preview-zoom-group') ?? undefined;
  return {
    tabs,
    strip,
    stripToggle,
    stage,
    paper,
    frame,
    empty,
    broken,
    stale,
    zoomLevel,
    ...(modes === undefined ? {} : { modes }),
    ...(zoom === undefined ? {} : { zoom }),
  };
}
