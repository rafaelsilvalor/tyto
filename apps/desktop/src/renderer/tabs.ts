import { LitElement, type TemplateResult, html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';

import { type Locale, DEFAULT_LOCALE, translate } from '../../shared/i18n/index.js';
import { icon } from './icons.js';

/**
 * One editor group's tabs, over that group's pane (E9.11; TYTO-286, ADR 0083).
 *
 * It used to be one strip across the top of the window, outside the docks, where ADR 0024
 * drew it. The tabs were only ever the editor's, and since the editor splits into groups each
 * group draws its own strip: `<tyto-editor-group>` renders one of these above its pane.
 *
 * It holds no state. Which tabs a group has and which one is in front is `editor-groups.ts`,
 * and `main.ts` hands the answer down as a property; a click reports back through a callback.
 * An entry's id is the **tab's**, not the document's: one document can be a tab in two groups.
 */

export const TABS_TAG = 'tyto-tabs';

/** One tab, as the window describes one. The strip knows nothing else about a document. */
export interface TabEntry {
  readonly id: string;
  /** The file's name, or the catalogue's word for a brief that has never been saved. */
  readonly label: string;
  /**
   * The folder the file is in, shown on hover as the tab's `title` (TYTO-288, ADR 0086) — for a
   * preview, its brief's. Absent for a document in no file, whose tab then has no tooltip: the
   * name is already on the tab, and repeating it would say nothing.
   */
  readonly folder?: string;
  readonly dirty: boolean;
  /** TYTO-287: a preview tab, marked so a person and a suite can tell it from its brief's. */
  readonly preview?: boolean;
  /** TYTO-287: a preview locked on its brief, drawn with a lock after its name. */
  readonly locked?: boolean;
}

export class DocumentTabs extends LitElement {
  static override properties = {
    tabs: { attribute: false },
    activeId: { attribute: false },
    locale: { attribute: false },
    select: { attribute: false },
    close: { attribute: false },
  };

  declare tabs: readonly TabEntry[];
  declare activeId: string;
  declare locale: Locale;
  declare select: (id: string) => void;
  /** Asks to close. Whether it *does* close is `main.ts`'s — a dirty tab gets a question. */
  declare close: (id: string) => void;

  constructor() {
    super();
    this.tabs = [];
    this.activeId = '';
    this.locale = DEFAULT_LOCALE;
    this.select = () => undefined;
    this.close = () => undefined;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private tab(entry: TabEntry): TemplateResult {
    const on = entry.id === this.activeId;
    const unsaved = translate(this.locale, 'document.unsaved');

    // A div around two buttons rather than a button with a button in it, which is invalid
    // HTML and which browsers resolve by dropping one of them.
    return html`<div
      class="tabs__tab ${on ? 'tabs__tab--on' : ''}"
      data-tab-kind=${entry.preview === true ? 'preview' : 'editor'}
      @auxclick=${(event: MouseEvent) => {
        // The middle button, which is how every editor and every browser closes a tab.
        // `auxclick` and not `mousedown`, so a middle-click that started somewhere else
        // does not close whatever it happens to end over.
        if (event.button !== 1) return;
        event.preventDefault();
        this.close(entry.id);
      }}
    >
      <button
        type="button"
        role="tab"
        class="tabs__name"
        aria-selected=${on ? 'true' : 'false'}
        title=${ifDefined(entry.folder)}
        @click=${() => {
          this.select(entry.id);
        }}
      >
        <span class="tabs__label">${entry.label}</span>
        ${
          entry.locked === true
            ? html`<span
                class="tabs__lock"
                title=${translate(this.locale, 'preview.locked')}
                aria-label=${translate(this.locale, 'preview.locked')}
                >${icon('lock')}</span
              >`
            : ''
        }
        <!--
          The dot carries the shape and the label carries the meaning, the same split the
          problems panel makes about severity: a mark nobody has learned says nothing, and a
          screen reader reads the title rather than the glyph.
        -->
        ${
          entry.dirty
            ? html`<span class="tabs__dirty" aria-label=${unsaved} title=${unsaved}>•</span>`
            : ''
        }
      </button>
      <button
        type="button"
        class="tabs__close"
        title=${translate(this.locale, 'document.close')}
        aria-label=${translate(this.locale, 'document.close')}
        @click=${() => {
          this.close(entry.id);
        }}
      >
        ×
      </button>
    </div>`;
  }

  protected override render(): unknown {
    // Keyed by the document's id and not by position, so switching tabs and closing one
    // move the nodes that exist rather than rewriting the strip — which is what keeps the
    // close button under the pointer when the tab to its left goes away.
    return html`<div class="tabs__strip" role="tablist">
      ${repeat(
        this.tabs,
        (entry) => entry.id,
        (entry) => this.tab(entry),
      )}
    </div>`;
  }
}

customElements.define(TABS_TAG, DocumentTabs);

declare global {
  interface HTMLElementTagNameMap {
    [TABS_TAG]: DocumentTabs;
  }
}
