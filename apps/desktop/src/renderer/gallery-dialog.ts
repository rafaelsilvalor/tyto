import { LitElement, type TemplateResult, html, nothing } from 'lit';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import type { GalleryAction, GalleryEntryView, GalleryView } from '../../shared/ipc.js';
import {
  GALLERY_FILTERS,
  type GalleryFilter,
  cardAction,
  filterCounts,
  matchesFilter,
} from './gallery-view.js';

/**
 * The gallery screen (TYTO-504, ADR 0162): the maintained list of templates and plugins, one
 * card per entry, and the two clicks that change the machine's plugin files.
 *
 * **It has no bridge of its own**, as the plugins screen has none: whoever opens it hands it
 * the list and an `onAct` that asks main, and main runs `@tyto/io`'s install or update — the
 * operations `tyto gallery` runs — then syncs. The screen draws each answer: the gallery read
 * again, and one line under the card that was clicked.
 *
 * **A newer version is shown and waits** (ADR 0151 decision 3). The card says which tag the
 * files pin and what the curator says the new one changes; nothing moves until Update.
 */

export const GALLERY_DIALOG_TAG = 'tyto-gallery-dialog';

export type GalleryVerb = 'install' | 'update';

/** Asks main to install or update entry `id`. Rejects when the bridge could not answer. */
export type GalleryActionRequest = (verb: GalleryVerb, id: string) => Promise<GalleryAction>;

const FILTER_KEYS: Record<GalleryFilter, CatalogueKey> = {
  all: 'gallery.filter.all',
  templates: 'gallery.filter.templates',
  plugins: 'gallery.filter.plugins',
  installed: 'gallery.filter.installed',
  updates: 'gallery.filter.updates',
};

/** What the last click on a card said, kept under that card until the screen closes. */
interface CardResult {
  readonly failed: boolean;
  readonly lines: readonly string[];
}

/** `{name}` in a catalogue string, filled. */
function fill(text: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce(
    (filled, [name, value]) => filled.replaceAll(`{${name}}`, value),
    text,
  );
}

/** The lines a finished click shows under its card. */
export function resultLines(
  say: (key: CatalogueKey) => string,
  entry: Pick<GalleryEntryView, 'id' | 'latest'>,
  action: GalleryAction,
): CardResult {
  const version = { version: entry.latest };
  const byHand = action.byHand.map((place) => fill(say('gallery.byHand'), place));
  switch (action.outcome) {
    case 'written':
      return { failed: false, lines: [say('gallery.done.written')] };
    case 'already installed':
      return { failed: false, lines: [say('gallery.done.already')] };
    case 'current':
      return { failed: false, lines: [fill(say('gallery.done.current'), version)] };
    case 'moved':
      return { failed: false, lines: [...byHand, fill(say('gallery.done.moved'), version)] };
    case 'refused': {
      const lines = [...byHand, action.problem ?? ''];
      // The window has no `--force` (TYTO-504): it names the terminal's.
      if (action.problem?.startsWith('E_GALLERY_ENTRY_EDITED') === true) {
        lines.push(fill(say('gallery.force'), { id: entry.id }));
      }
      return { failed: true, lines };
    }
  }
}

export class GalleryDialog extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    locale: { attribute: false },
    view: { attribute: false },
    onAct: { attribute: false },
    filter: { state: true },
    working: { state: true },
    results: { state: true },
  };

  declare open: boolean;
  declare locale: Locale;
  /** The gallery, `'failed'` when the bridge could not answer, or nothing while it is asked. */
  declare view: GalleryView | 'failed' | undefined;
  /** Where Install and Update go. No button is offered while it is absent. */
  declare onAct: GalleryActionRequest | undefined;
  declare filter: GalleryFilter;
  /** The entry a click is running for: one at a time, as main runs them. */
  declare working: { readonly id: string; readonly verb: GalleryVerb } | undefined;
  declare results: ReadonlyMap<string, CardResult>;

  constructor() {
    super();
    this.open = false;
    this.locale = DEFAULT_LOCALE;
    this.view = undefined;
    this.onAct = undefined;
    this.filter = 'all';
    this.working = undefined;
    this.results = new Map();
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  close(): void {
    this.open = false;
    this.results = new Map();
  }

  /** Runs one click: the card says it is working, then shows what main answered. */
  async act(verb: GalleryVerb, entry: GalleryEntryView): Promise<void> {
    const request = this.onAct;
    if (request === undefined || this.working !== undefined) return;
    const say = (key: CatalogueKey): string => translate(this.locale, key);
    this.working = { id: entry.id, verb };
    let result: CardResult;
    try {
      const action = await request(verb, entry.id);
      this.view = action.view;
      result = resultLines(say, entry, action);
    } catch {
      result = { failed: true, lines: [say('gallery.unavailable')] };
    } finally {
      this.working = undefined;
    }
    this.results = new Map([...this.results, [entry.id, result]]);
  }

  private button(
    say: (key: CatalogueKey) => string,
    entry: GalleryEntryView,
    verb: GalleryVerb,
    label: string,
  ): TemplateResult {
    const busy = this.working?.id === entry.id;
    return html`<button
      class="gallery__act"
      type="button"
      data-verb=${verb}
      ?disabled=${this.working !== undefined || this.onAct === undefined}
      @click=${() => {
        void this.act(verb, entry);
      }}
    >
      ${busy ? say(verb === 'install' ? 'gallery.installing' : 'gallery.updating') : label}
    </button>`;
  }

  private state(say: (key: CatalogueKey) => string, entry: GalleryEntryView): unknown {
    const action = cardAction(entry);
    const refs = { refs: entry.pinned.join(', '), version: entry.latest };
    switch (action.kind) {
      case 'incompatible':
        return html`<p class="gallery__incompatible">
          ${fill(say('gallery.incompatible'), { engine: action.engine })}
        </p>`;
      case 'install':
        return this.button(say, entry, 'install', say('gallery.install'));
      case 'installed':
        return html`<p class="gallery__installed">${fill(say('gallery.installed'), refs)}</p>`;
      case 'update':
        return html`<p class="gallery__pinned">${fill(say('gallery.pinned'), refs)}</p>
          ${
            entry.changes === undefined
              ? nothing
              : html`<p class="gallery__changes">
                  ${fill(say('gallery.changes'), refs)} ${entry.changes}
                </p>`
          }
          ${this.button(say, entry, 'update', fill(say('gallery.update'), refs))}`;
    }
  }

  private card(say: (key: CatalogueKey) => string, entry: GalleryEntryView): TemplateResult {
    const result = this.results.get(entry.id);
    return html`<li
      class="gallery__card"
      data-entry=${entry.id}
      data-kind=${entry.kind}
      data-state=${entry.compatible ? entry.state : 'incompatible'}
    >
      ${
        entry.preview === undefined
          ? html`<div class="gallery__preview gallery__preview--none" aria-hidden="true"></div>`
          : html`<img class="gallery__preview" src=${entry.preview} alt="" />`
      }
      <div class="gallery__body">
        <h3 class="gallery__name">${entry.name}</h3>
        <p class="gallery__meta">
          ${say(entry.kind === 'template' ? 'gallery.kind.template' : 'gallery.kind.plugin')} ·
          <code>${entry.id}</code> · ${entry.latest}
        </p>
        <p class="gallery__description">${entry.description}</p>
        ${
          entry.configurations.length === 0
            ? nothing
            : html`<p class="gallery__configurations">
                ${fill(say('gallery.configurations'), {
                  names: entry.configurations.join(', '),
                })}
              </p>`
        }
        ${
          entry.state !== 'not installed' && !entry.synced
            ? html`<p class="gallery__unsynced">${say('gallery.notSynced')}</p>`
            : nothing
        }
        ${this.state(say, entry)}
        ${
          result === undefined
            ? nothing
            : html`<div
                class="gallery__result"
                data-failed=${result.failed ? 'true' : 'false'}
                role=${result.failed ? 'alert' : 'status'}
              >
                ${result.lines.map((line) => html`<p>${line}</p>`)}
              </div>`
        }
      </div>
    </li>`;
  }

  private filters(
    say: (key: CatalogueKey) => string,
    entries: readonly GalleryEntryView[],
  ): TemplateResult {
    const counts = filterCounts(entries);
    return html`<div class="gallery__filters" role="group" aria-label=${say('gallery.filters')}>
      ${GALLERY_FILTERS.map(
        (filter) =>
          html`<button
            class="gallery__filter"
            type="button"
            data-filter=${filter}
            aria-pressed=${this.filter === filter ? 'true' : 'false'}
            @click=${() => {
              this.filter = filter;
            }}
          >
            ${say(FILTER_KEYS[filter])} (${counts[filter]})
          </button>`,
      )}
    </div>`;
  }

  private body(say: (key: CatalogueKey) => string): unknown {
    const view = this.view;
    if (view === undefined) return html`<p class="gallery__loading">${say('gallery.loading')}</p>`;
    if (view === 'failed')
      return html`<p class="gallery__failure">${say('gallery.unavailable')}</p>`;

    const shown = (view.entries ?? []).filter((entry) => matchesFilter(entry, this.filter));
    return html`<p class="gallery__index">${say('gallery.index')} <code>${view.index}</code></p>
      ${
        view.cached === undefined
          ? nothing
          : html`<p class="gallery__cached" role="note">
              ${fill(say('gallery.cached'), { when: new Date(view.cached).toLocaleString() })}
            </p>`
      }
      ${
        view.problems.length === 0
          ? nothing
          : html`<ul class="gallery__problems">
              ${view.problems.map((problem) => html`<li>${problem}</li>`)}
            </ul>`
      }
      ${
        view.entries === undefined
          ? nothing
          : html`${this.filters(say, view.entries)}
            ${
              shown.length === 0
                ? html`<p class="gallery__empty">${say('gallery.empty')}</p>`
                : html`<ul class="gallery__cards">
                    ${shown.map((entry) => this.card(say, entry))}
                  </ul>`
            }`
      }`;
  }

  protected override render(): unknown {
    if (!this.open) return nothing;
    const say = (key: CatalogueKey): string => translate(this.locale, key);

    return html`<div
      class="gallery__panel"
      role="dialog"
      aria-modal="true"
      aria-label=${say('gallery.heading')}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === 'Escape') this.close();
      }}
    >
      <h2 class="gallery__title">${say('gallery.heading')}</h2>
      ${this.body(say)}
      <div class="gallery__actions">
        <button
          class="gallery__close"
          type="button"
          @click=${() => {
            this.close();
          }}
        >
          ${say('gallery.close')}
        </button>
      </div>
    </div>`;
  }
}

customElements.define(GALLERY_DIALOG_TAG, GalleryDialog);
