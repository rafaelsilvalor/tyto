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

/** One tab of a tabbed area's strip (ADR 0163): a panel, its name, and a count when it has one. */
export interface DockTab {
  readonly id: string;
  readonly label: string;
  /** Problems' count, as VS Code's tab shows it; absent or 0 draws none. */
  readonly count?: number;
  /**
   * A built-in panel's heading, kept as the tab's name: its id and its key, which the window's
   * `[data-i18n]` pass writes, as it wrote the title this tab replaces (`#problems-heading`).
   */
  readonly heading?: { readonly id: string; readonly key: CatalogueKey };
}

/**
 * What the panel in front of a tabbed area draws in place of its title (ADR 0163): every open
 * panel of the area as a tab, the one in front selected, and what picking a tab, closing one and
 * hiding the whole area do. The dock sets it; a panel in a side area has none.
 */
export interface DockStrip {
  readonly tabs: readonly DockTab[];
  readonly front: string;
  readonly label: string;
  readonly pick: (panelId: string) => void;
  /** Hides the area, as VS Code's × does; every tab is still there when it comes back. */
  readonly hide: () => void;
}

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
 * What every panel shares: a **tool header** (TYTO-302, ADR 0090, amending ADR 0085 decision 6).
 * A document is a tab; a tool has a header. The queue, Problems and a plugin's panel are tools —
 * none of them reads the document in front — so their strip is not drawn as a tab: the tool's
 * name in small capitals on the panel's own background, as VS Code titles its side bar's views
 * ("EXPLORER"), and the tool's actions at the right end with the close button last. The strip
 * keeps `.pane__strip` and its token height, so the strips' bottoms still meet across the window
 * (ADR 0085); `.pane__strip--tool` is what changes its look. No header row: a tool has no
 * breadcrumb to put in one.
 *
 * A base class rather than three copies, and the one thing it insists on is that the close
 * button is the dock's and not the panel's: a panel that drew its own would be a panel that
 * could get it wrong, and "can this be closed" is a property of the record.
 *
 * `.tool__title` is the hook a dock switcher takes over when one dock holds more than one tool
 * (TYTO-279's Explorer beside the queue): the title becomes the switcher, the actions stay.
 */
export abstract class DockedPanel extends LitElement {
  static override properties = {
    locale: { attribute: false },
    panelId: { attribute: false },
    fixed: { type: Boolean },
    onClose: { attribute: false },
    strip: { attribute: false },
  };

  declare locale: Locale;
  declare panelId: string;
  declare fixed: boolean;
  declare onClose: (panelId: string) => void;
  declare strip: DockStrip | undefined;

  constructor() {
    super();
    this.locale = DEFAULT_LOCALE;
    this.panelId = '';
    this.fixed = false;
    this.onClose = () => undefined;
    this.strip = undefined;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected say(key: CatalogueKey): string {
    return translate(this.locale, key);
  }

  /**
   * The tool header: `title`, a heading with the class `tool__title`, since it is what the panel
   * is called; then the tool's own `actions`, each a button with its words on `title` and
   * `aria-label`; then the close button, which hides the tool.
   */
  protected chrome(title: TemplateResult, actions: unknown = nothing): TemplateResult {
    const strip = this.strip;
    if (strip !== undefined) return this.tabbed(strip, actions);
    return html`<div class="pane__strip pane__strip--tool" data-font-area="paneHeaders">
      ${title}
      <div class="pane__actions tool__actions">
        ${actions}
        ${
          this.fixed
            ? nothing
            : html`<button
                type="button"
                class="tool__action panel__close"
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
    </div>`;
  }

  /**
   * The header in a tabbed area (ADR 0163): the area's tabs where the title was, this panel's
   * actions, then the × that hides the area. ← and → move between the tabs, as a tab list does.
   */
  private tabbed(strip: DockStrip, actions: unknown): TemplateResult {
    const step = (event: KeyboardEvent, index: number): void => {
      const by = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (by === 0) return;
      event.preventDefault();
      const next = strip.tabs[(index + by + strip.tabs.length) % strip.tabs.length];
      if (next !== undefined) strip.pick(next.id);
    };
    return html`<div
      class="pane__strip pane__strip--tool pane__strip--tabs"
      data-font-area="paneHeaders"
    >
      <div class="dock-tabs" role="tablist" aria-label=${strip.label}>
        ${strip.tabs.map(
          (tab, index) =>
            html`<button
              type="button"
              role="tab"
              class="dock-tab"
              data-tab=${tab.id}
              aria-selected=${tab.id === strip.front ? 'true' : 'false'}
              tabindex=${tab.id === strip.front ? '0' : '-1'}
              @click=${() => {
                strip.pick(tab.id);
              }}
              @keydown=${(event: KeyboardEvent) => {
                step(event, index);
              }}
            >
              ${
                tab.heading === undefined
                  ? tab.label
                  : html`<span id=${tab.heading.id} data-i18n=${tab.heading.key}></span>`
              }${
                tab.count === undefined || tab.count === 0
                  ? nothing
                  : html`<span class="dock-tab__count">${tab.count}</span>`
              }
            </button>`,
        )}
      </div>
      <div class="pane__actions tool__actions">
        ${actions}
        <button
          type="button"
          class="tool__action panel__close"
          title=${this.say('panel.hideArea')}
          aria-label=${this.say('panel.hideArea')}
          @click=${() => {
            strip.hide();
          }}
        >
          ×
        </button>
      </div>
    </div>`;
  }

  /** The header for a tool named by the catalogue: the heading keeps its id and key. */
  protected bar(
    headingId: string,
    headingKey: CatalogueKey,
    actions: unknown = nothing,
  ): TemplateResult {
    return this.chrome(
      html`<h2 class="tool__title" id=${headingId} data-i18n=${headingKey}></h2>`,
      actions,
    );
  }
}

/**
 * The editor groups, and nothing above them.
 *
 * The panel used to draw a BRIEF bar with the template picker over every group (E9.3, ADR
 * 0024). Since TYTO-288 each group is a pane with its own strip and header row (ADR 0085), and a
 * bar across all of them would be a line nobody else has: the picker left the window (a template
 * is chosen with "New brief from template…", the "/" menu, completion or the `template:` line),
 * and the word "Brief" is the status bar's tab kind (ADR 0076).
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
 * What the stages said about the brief.
 *
 * No count beside the heading (TYTO-267): the status bar's problems button carries the
 * window's one count (TYTO-248, TYTO-259), and a second copy here showed the same number
 * twice whenever the panel was open.
 */
export class ProblemsPanelFrame extends DockedPanel {
  protected override render(): unknown {
    return html`${this.bar('problems-heading', 'problems.heading')}
      <!--
      Written out and not interpolated: lit-html allows a binding anywhere except in a tag
      name, because the template is parsed once as HTML before any value is seen.
      \`problems-panel.test.ts\` pins the literal against \`PROBLEMS_TAG\`, so the two cannot
      drift without a test saying so.
    -->
      <tyto-problems
        class="problems__list"
        id="problems-list"
        data-font-area="problems"
      ></tyto-problems>`;
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
