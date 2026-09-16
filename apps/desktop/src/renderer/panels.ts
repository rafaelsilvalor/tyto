import { LitElement, type TemplateResult, html, nothing } from 'lit';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
// Imported for the side effect: the element has to be defined before a panel renders one.
import './problems-panel.js';

/**
 * The three panels the window has, as elements the dock can create by name (E9.10).
 *
 * **Every id and class inside these is the one `index.html` used to declare**, deliberately
 * and to the character. `preview.ts` writes into `#preview-stage`, the `[data-i18n]` walk
 * finds the headings, `shell.css` styles all of it and the end-to-end suite queries it —
 * none of that changes because a panel moved into a dock. What changed is who owns the
 * markup: a `<section>` in a file, or a tag a record names.
 *
 * They are Lit elements with no reactive state of their own beyond the locale and the close
 * button. That is not a component model going to waste — it is the smallest step that makes
 * a panel *addressable*, which is the whole of what ADR 0024 said the window needed.
 */

export const EDITOR_PANEL_TAG = 'tyto-editor-panel';
export const PREVIEW_PANEL_TAG = 'tyto-preview-panel';
export const PROBLEMS_PANEL_TAG = 'tyto-problems-panel';

/** What the dock sets on every panel it creates. */
export interface PanelChrome {
  readonly locale: Locale;
  /** The id in the layout record, which the close button reports back. */
  readonly panelId: string;
  /** A panel that may not be closed shows no close button (`shared/layout.ts`). */
  readonly fixed: boolean;
  readonly onClose: (panelId: string) => void;
}

/**
 * What every panel shares: a bar with a title, whatever controls it has, and a close button.
 *
 * A base class rather than three copies, and the one thing it insists on is that the close
 * button is the dock's and not the panel's. A panel that drew its own would be a panel that
 * could get it wrong, and "can this be closed" is a property of the record.
 */
export abstract class DockedPanel extends LitElement {
  static override properties = {
    locale: { attribute: false },
    panelId: { attribute: false },
    fixed: { type: Boolean },
    onClose: { attribute: false },
  };

  declare locale: Locale;
  declare panelId: string;
  declare fixed: boolean;
  declare onClose: (panelId: string) => void;

  constructor() {
    super();
    this.locale = DEFAULT_LOCALE;
    this.panelId = '';
    this.fixed = false;
    this.onClose = () => undefined;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected say(key: CatalogueKey): string {
    return translate(this.locale, key);
  }

  /** The bar every panel has: a heading, the panel's own controls, and the close button. */
  protected bar(headingId: string, headingKey: CatalogueKey, controls: unknown): TemplateResult {
    return html`<div class="work__bar">
      <h2 class="work__title" id=${headingId} data-i18n=${headingKey}></h2>
      ${controls}
      ${
        this.fixed
          ? nothing
          : html`<button
              type="button"
              class="panel__close"
              title=${this.say('panel.close')}
              aria-label=${this.say('panel.close')}
              @click=${() => {
                this.onClose(this.panelId);
              }}
            >
              ×
            </button>`
      }
    </div>`;
  }
}

/**
 * The editor and the template picker over it.
 *
 * The picker stays here rather than moving to the preview, unchanged from E9.3: choosing a
 * template rewrites a line of the brief, so it is an edit, and the preview updating is the
 * consequence.
 *
 * `#editor` is the node CodeMirror mounts into and it must survive every re-render. Lit
 * keeps a node it did not have to change, and this panel is `fixed` in the default layout
 * so the element is never removed either — between the two, the editor is never unmounted
 * out from under a person's text.
 */
export class EditorPanel extends DockedPanel {
  protected override render(): unknown {
    return html`${this.bar(
        'editor-heading',
        'editor.heading',
        html`<label class="work__template">
          <span data-i18n="template.label"></span>
          <select id="template"></select>
        </label>`,
      )}
      <div class="editor" id="editor"></div>`;
  }
}

/** The frames the brief produced, at one scale, with the tabs and the zoom over them. */
export class PreviewPanel extends DockedPanel {
  protected override render(): unknown {
    return html`${this.bar(
        'preview-heading',
        'preview.heading',
        html`<div class="preview__tabs" id="format-tabs" role="tablist"></div>
          <label class="preview__slide">
            <span id="slide-label" data-i18n="preview.slide.label"></span>
            <select id="slide"></select>
          </label>
          <div class="preview__zoom">
            <button type="button" id="zoom-out" data-i18n-title="preview.zoom.out">−</button>
            <output id="zoom-level"></output>
            <button type="button" id="zoom-in" data-i18n-title="preview.zoom.in">+</button>
            <button type="button" id="zoom-fit" data-i18n="preview.zoom.fit"></button>
          </div>`,
      )}
      <div class="preview__stage" id="preview-stage">
        <div class="preview__paper" id="preview-paper" hidden>
          <!--
          \`sandbox\` with no tokens: unique origin, no scripts, no forms, no navigation. A
          preview document is a picture. The exporter emits no script and this is what makes
          that a property of the window rather than a habit of the exporter.
        -->
          <iframe id="preview-frame" sandbox="" title="Tyto"></iframe>
        </div>
        <p class="preview__empty" id="preview-empty" data-i18n="preview.empty"></p>
      </div>
      <p class="preview__status" id="preview-status"></p>`;
  }
}

/** What the stages said about the brief, and the count beside the heading. */
export class ProblemsPanelFrame extends DockedPanel {
  protected override render(): unknown {
    return html`${this.bar(
        'problems-heading',
        'problems.heading',
        html`<output class="problems__count" id="problems-count"></output>`,
      )}
      <!--
      Written out and not interpolated: lit-html allows a binding anywhere except in a tag
      name, because the template is parsed once as HTML before any value is seen.
      \`problems-panel.test.ts\` pins the literal against \`PROBLEMS_TAG\`, so the two cannot
      drift without a test saying so.
    -->
      <tyto-problems class="problems__list" id="problems-list"></tyto-problems>`;
  }
}

customElements.define(EDITOR_PANEL_TAG, EditorPanel);
customElements.define(PREVIEW_PANEL_TAG, PreviewPanel);
customElements.define(PROBLEMS_PANEL_TAG, ProblemsPanelFrame);

declare global {
  interface HTMLElementTagNameMap {
    [EDITOR_PANEL_TAG]: EditorPanel;
    [PREVIEW_PANEL_TAG]: PreviewPanel;
    [PROBLEMS_PANEL_TAG]: ProblemsPanelFrame;
  }
}
