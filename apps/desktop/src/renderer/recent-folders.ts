import { LitElement, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';
import { fold } from './command-bar.js';

/**
 * The recent folders popover (TYTO-487), opened from the title bar's folder button or the
 * `workspace.openRecent` command: Zed's "Open Recent Project" — a search box, the folders
 * opened before filtered as you type, and "Open Local Folder…" at the foot.
 *
 * **It is handed main's rows and gives back an id.** A row's `pathLabel` is shown and matched
 * against, never sent (ADR 0086); choosing a row hands its id to whoever owns the bridge, and
 * main opens the folder through File ▸ Open Folder's own door (ADR 0111, ADR 0113). The open
 * folder is listed and marked, and choosing it only closes the popover.
 */

export const RECENT_FOLDERS_TAG = 'tyto-recent-folders';

export type RecentFolderRow = IpcResponse<'workspace:recent'>['folders'][number];

/** The rows whose name or label holds `query`, accents folded and case ignored, in order. */
export function filterRecentFolders(
  rows: readonly RecentFolderRow[],
  query: string,
): readonly RecentFolderRow[] {
  const needle = fold(query.trim());
  if (needle === '') return rows;
  return rows.filter(
    (row) => fold(row.name).includes(needle) || fold(row.pathLabel).includes(needle),
  );
}

export class RecentFolders extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    locale: { attribute: false },
    folders: { attribute: false },
    query: { state: true },
    selected: { state: true },
  };

  declare open: boolean;
  declare locale: Locale;
  declare folders: readonly RecentFolderRow[];
  declare query: string;
  declare selected: number;
  /** A row other than the open folder was chosen: its id, for main. */
  onChoose: ((id: string) => void) | undefined;
  /** "Open Local Folder…": the picker, as File ▸ Open Folder. */
  onOpenLocal: (() => void) | undefined;
  /** The popover closed, by any route: focus goes back to whoever had it. */
  onClose: (() => void) | undefined;
  /**
   * What opened it, the title bar's button: a press there is not "outside", or it would close
   * the popover and the click that follows would open it again.
   */
  anchor: Element | undefined;

  constructor() {
    super();
    this.open = false;
    this.locale = DEFAULT_LOCALE;
    this.folders = [];
    this.query = '';
    this.selected = 0;
    this.onChoose = undefined;
    this.onOpenLocal = undefined;
    this.onClose = undefined;
    this.anchor = undefined;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Opens on an empty query with the first row highlighted, or the newest after the open one. */
  show(): void {
    this.query = '';
    this.selected = this.folders[0]?.current === true && this.folders.length > 1 ? 1 : 0;
    this.open = true;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.onClose?.();
  }

  /** What the list shows now. */
  get shown(): readonly RecentFolderRow[] {
    return filterRecentFolders(this.folders, this.query);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // A press anywhere outside the panel closes it, as a menu does. Capture, so a click on the
    // editor closes the popover before the editor takes focus.
    document.addEventListener('mousedown', this.outside, true);
  }

  override disconnectedCallback(): void {
    document.removeEventListener('mousedown', this.outside, true);
    super.disconnectedCallback();
  }

  private readonly outside = (event: MouseEvent): void => {
    if (!this.open || !(event.target instanceof Node)) return;
    const panel = this.querySelector('.recent-folders__panel');
    if (panel?.contains(event.target) === true || this.anchor?.contains(event.target) === true) {
      return;
    }
    this.close();
  };

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('open') && this.open) {
      this.querySelector<HTMLInputElement>('.recent-folders__search')?.focus();
    }
  }

  private choose(row: RecentFolderRow | undefined): void {
    if (row === undefined) return;
    this.close();
    // The open folder is listed so a person sees where they are; choosing it changes nothing.
    if (!row.current) this.onChoose?.(row.id);
  }

  private openLocal(): void {
    this.close();
    this.onOpenLocal?.();
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    const count = this.shown.length;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.selected = (this.selected + step + count) % count;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.choose(this.shown[this.selected]);
    }
  };

  protected override render(): unknown {
    if (!this.open) return nothing;
    const say = (key: CatalogueKey): string => translate(this.locale, key);
    const shown = this.shown;
    const selected = Math.min(this.selected, Math.max(shown.length - 1, 0));

    return html`<div
      class="recent-folders__panel"
      role="dialog"
      aria-label=${say('recentFolders.label')}
      @keydown=${this.keydown}
    >
      <input
        class="recent-folders__search"
        type="text"
        spellcheck="false"
        aria-label=${say('recentFolders.search')}
        placeholder=${say('recentFolders.search')}
        .value=${this.query}
        @input=${(event: Event) => {
          this.query = (event.target as HTMLInputElement).value;
          this.selected = 0;
        }}
      />
      <div class="recent-folders__heading">${say('recentFolders.heading')}</div>
      ${
        shown.length === 0
          ? html`<p class="recent-folders__empty">
              ${say(this.folders.length === 0 ? 'recentFolders.empty' : 'recentFolders.noMatch')}
            </p>`
          : html`<ul class="recent-folders__list" role="listbox">
              ${repeat(
                shown,
                (row) => row.id,
                (row, index) =>
                  html`<li
                    class="recent-folders__row ${index === selected ? 'recent-folders__row--on' : ''}"
                    role="option"
                    aria-selected=${index === selected ? 'true' : 'false'}
                    data-id=${row.id}
                    title=${row.pathLabel}
                    @mousemove=${() => {
                      this.selected = index;
                    }}
                    @click=${() => {
                      this.choose(row);
                    }}
                  >
                    <span class="recent-folders__name">${row.name}</span>
                    ${
                      row.current
                        ? html`<span class="recent-folders__current"
                            >${say('recentFolders.current')}</span
                          >`
                        : nothing
                    }
                    <span class="recent-folders__path">${row.pathLabel}</span>
                  </li>`,
              )}
            </ul>`
      }
      <button
        class="recent-folders__open-local"
        type="button"
        @click=${() => {
          this.openLocal();
        }}
      >
        ${say('recentFolders.openLocal')}
      </button>
    </div>`;
  }
}

customElements.define(RECENT_FOLDERS_TAG, RecentFolders);
