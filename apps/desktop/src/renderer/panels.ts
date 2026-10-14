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
 * The window's own panels, as elements the dock can create by name (E9.10). The preview was
 * the third until it became a tab (TYTO-287, `preview-pane.ts`).
 *
 * **Every id and class inside these is the one `index.html` used to declare**, deliberately
 * and to the character. The `[data-i18n]` walk finds the headings, `shell.css` styles all of it and the end-to-end suite queries it —
 * none of that changes because a panel moved into a dock. What changed is who owns the
 * markup: a `<section>` in a file, or a tag a record names.
 *
 * They are Lit elements with no reactive state of their own beyond the locale and the close
 * button. That is not a component model going to waste — it is the smallest step that makes
 * a panel *addressable*, which is the whole of what ADR 0024 said the window needed.
 */

export const EDITOR_PANEL_TAG = 'tyto-editor-panel';
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
 * What every panel shares: the pane shape (TYTO-288, ADR 0085) — a one-tab strip with the
 * panel's name and its close button, and under it a header row with whatever controls it has.
 *
 * A base class rather than three copies, and it insists on two things. The close button is the
 * dock's and not the panel's: a panel that drew its own would be a panel that could get it
 * wrong, and "can this be closed" is a property of the record. And **the header row is always
 * drawn**, empty or not: it is what puts every pane's content at the same height as the editor
 * groups' and the previews', whose strips and header rows are the same two lines.
 *
 * The tab is not a `.tabs__tab`: those are a group's tabs, which the window counts and selects,
 * and a panel's name is neither. It is drawn in the same shape from the same tokens.
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

  /**
   * The strip and the header row, with `name` as the tab's text and `controls` in the row.
   * The name is a heading, since it is what the panel is called; the close button sits where a
   * group's tab has its own.
   */
  protected chrome(name: TemplateResult, controls: unknown): TemplateResult {
    return html`<div class="pane__strip">
        <div class="pane__tab">
          <span class="pane__name">${name}</span>
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
        </div>
      </div>
      <div class="pane__header">
        <div class="pane__actions">${controls}</div>
      </div>`;
  }

  /** The pane shape for a panel named by the catalogue: the heading keeps its id and key. */
  protected bar(headingId: string, headingKey: CatalogueKey, controls: unknown): TemplateResult {
    return this.chrome(
      html`<h2 class="pane__title" id=${headingId} data-i18n=${headingKey}></h2>`,
      controls,
    );
  }
}

/**
 * The editor groups, and nothing above them.
 *
 * The panel used to draw a BRIEF bar with the template picker over every group (E9.3, ADR
 * 0024). Since TYTO-288 each group is a pane with its own strip and header row (ADR 0085), and a
 * bar across all of them would be a third line nobody else has: the picker moved into the
 * focused group's header row ({@link createTemplatePicker}) until TYTO-273 replaces it, and the
 * word "Brief" is the status bar's tab kind (ADR 0076).
 *
 * The editor groups go in `[data-editor-groups]` (TYTO-286, ADR 0083): `main.ts` lays the
 * `<tyto-editor-group>` elements out there, each with its own tabs and a CodeMirror pane, and
 * the first group's pane is still `#editor`. Lit renders that node once and never touches what
 * is put inside it, and this panel is `fixed` in the default layout so the element is never
 * removed either — between the two, no pane is unmounted out from under a person's text.
 */
export class EditorPanel extends DockedPanel {
  protected override render(): unknown {
    return html`<div class="editor-groups" data-editor-groups></div>`;
  }
}

/**
 * The template picker: one `<select id="template">` with its label, made once and moved into
 * the focused group's header row (TYTO-288). One node rather than one per group, so its id stays
 * unique, its listener is wired once and the suites that choose a template keep finding it.
 *
 * Choosing a template rewrites a line of the brief, so it is an edit and lives with the text,
 * unchanged from E9.3; the preview updating is the consequence. TYTO-273's breadcrumb replaces
 * it.
 */
export function createTemplatePicker(owner: Document): HTMLLabelElement {
  const label = owner.createElement('label');
  label.className = 'work__template';
  const text = owner.createElement('span');
  text.setAttribute('data-i18n', 'template.label');
  const select = owner.createElement('select');
  select.id = 'template';
  label.append(text, select);
  return label;
}

/**
 * What the stages said about the brief.
 *
 * No count beside the heading (TYTO-267): the status bar's problems button carries the
 * window's one count (TYTO-248, TYTO-259), and a second copy here showed the same number
 * twice whenever the panel was open.
 */
export class ProblemsPanelFrame extends DockedPanel {
  protected override render(): unknown {
    return html`${this.bar('problems-heading', 'problems.heading', nothing)}
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
customElements.define(PROBLEMS_PANEL_TAG, ProblemsPanelFrame);

declare global {
  interface HTMLElementTagNameMap {
    [EDITOR_PANEL_TAG]: EditorPanel;
    [PROBLEMS_PANEL_TAG]: ProblemsPanelFrame;
  }
}
