import { LitElement, html } from 'lit';

import type { PreviewElements } from './preview.js';

/**
 * A brief's art, as the content of a preview tab (TYTO-287, ADR 0084).
 *
 * The markup the PREVIEW dock panel had, with **no ids**: a window can show two previews at
 * once — a following one and a locked one — so every node is found by a `data-preview-*`
 * attribute inside its own pane ({@link previewElementsOf}). A bar of the brief's formats, its
 * slide, the zoom and the lock over the stage.
 *
 * **The bar is the pane's header row** (TYTO-288, ADR 0085): the same height as every group's
 * and every panel's, one line that never wraps, the formats taking what room is left and the
 * slide, zoom and lock at the end, never shrunk. It stays inside this element because
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
          <label class="preview__slide">
            <span data-preview-slide-label data-i18n="preview.slide.label"></span>
            <select data-preview-slide></select>
          </label>
          <div class="preview__zoom">
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
      </div>`;
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
  const slide = find<HTMLSelectElement>('data-preview-slide');
  const slideLabel = find('data-preview-slide-label');
  const stage = find('data-preview-stage');
  const paper = find('data-preview-paper');
  const frame = find<HTMLIFrameElement>('data-preview-frame');
  const empty = find('data-preview-empty');
  const broken = find('data-preview-broken');
  const stale = find('data-preview-stale');
  const zoomLevel = find('data-preview-zoom-level');
  if (
    tabs === null ||
    slide === null ||
    slideLabel === null ||
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
  return { tabs, slide, slideLabel, stage, paper, frame, empty, broken, stale, zoomLevel };
}
