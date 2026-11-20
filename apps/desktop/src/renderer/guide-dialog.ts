import { LitElement, type TemplateResult, html, nothing } from 'lit';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import {
  type GuideList,
  type GuideRow,
  type GuideWriteResult,
  defaultChecked,
  writeOutcomeKey,
} from './guide-view.js';

/**
 * The external-art guide dialog (TYTO-741, ADR 0222): one row per guide the brief in front has,
 * with a checkbox, the slots it names no file for with the line that would, and the citations
 * that get no guide and why.
 *
 * **It has no bridge of its own**, as the gallery has none: whoever opens it hands it a host that
 * lists (from the buffer, so a line just inserted lists its guide at once), inserts a line into
 * the brief, and writes (asking to save first when the brief has unsaved edits, decision 5).
 * Main writes with `tyto guide` and answers how each guide reached the person.
 */

export const GUIDE_DIALOG_TAG = 'tyto-guide-dialog';

export interface GuideDialogHost {
  /** The guides of the brief as its buffer stands. Rejects when the bridge could not answer. */
  list(): Promise<GuideList>;
  /** Puts `line` into the brief as one undoable change; `false` when no editor holds it. */
  insert(line: string): boolean;
  /** Writes the guides named, saving the brief first when a person agrees. */
  write(names: readonly string[]): Promise<GuideWriteResult>;
}

function fill(text: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce(
    (filled, [name, value]) => filled.replaceAll(`{${name}}`, value),
    text,
  );
}

export class GuideDialog extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    locale: { attribute: false },
    host: { attribute: false },
    view: { state: true },
    checked: { state: true },
    working: { state: true },
    result: { state: true },
  };

  declare open: boolean;
  declare locale: Locale;
  declare host: GuideDialogHost | undefined;
  /** The list, `'failed'` when the bridge could not answer, or nothing while it is asked. */
  declare view: GuideList | 'failed' | undefined;
  declare checked: ReadonlySet<string>;
  declare working: boolean;
  declare result: GuideWriteResult | undefined;

  constructor() {
    super();
    this.open = false;
    this.locale = DEFAULT_LOCALE;
    this.host = undefined;
    this.view = undefined;
    this.checked = new Set();
    this.working = false;
    this.result = undefined;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Opens over the brief `host` speaks for, and lists its guides. */
  show(host: GuideDialogHost): Promise<void> {
    this.host = host;
    this.view = undefined;
    this.result = undefined;
    this.checked = new Set();
    this.open = true;
    return this.refresh(true);
  }

  close(): void {
    this.open = false;
    this.host = undefined;
  }

  /**
   * Lists again. The first list checks the missing guides; a later one keeps what a person
   * checked or unchecked and checks only the guides it did not show before, when missing.
   */
  async refresh(first = false): Promise<void> {
    const host = this.host;
    if (host === undefined) return;
    const before = this.view !== undefined && this.view !== 'failed' && this.view.ok;
    const shown = new Set(before ? this.rows().map((row) => row.name) : []);
    let view: GuideList | 'failed';
    try {
      view = await host.list();
    } catch {
      view = 'failed';
    }
    if (host !== this.host) return;
    this.view = view;
    if (view === 'failed' || !view.ok) return;
    const missing = defaultChecked(view.guides);
    this.checked = first
      ? missing
      : new Set([
          ...[...this.checked].filter((name) => view.guides.some((row) => row.name === name)),
          ...[...missing].filter((name) => !shown.has(name)),
        ]);
  }

  private rows(): readonly GuideRow[] {
    const view = this.view;
    return view === undefined || view === 'failed' || !view.ok ? [] : view.guides;
  }

  /** Inserts the line that cites a file for an uncited slot, then lists again. */
  async insert(line: string): Promise<void> {
    if (this.host?.insert(line) !== true) return;
    await this.refresh();
  }

  async write(): Promise<void> {
    const host = this.host;
    const names = this.rows()
      .map((row) => row.name)
      .filter((name) => this.checked.has(name));
    if (host === undefined || names.length === 0 || this.working) return;
    this.working = true;
    this.result = undefined;
    try {
      this.result = await host.write(names);
    } catch {
      this.result = { outcome: 'failed', report: '' };
    } finally {
      this.working = false;
    }
    // Written guides exist now: the checks start again from the missing ones.
    if (this.result.outcome === 'written') await this.refresh(true);
  }

  private toggle(name: string, on: boolean): void {
    const next = new Set(this.checked);
    if (on) next.add(name);
    else next.delete(name);
    this.checked = next;
  }

  private row(say: (key: CatalogueKey) => string, row: GuideRow, formats: number): TemplateResult {
    const state = row.newer ? 'newer' : row.exists ? 'exists' : 'missing';
    const stateKey: CatalogueKey = `guide.state.${state}`;
    return html`<tr data-guide=${row.name} data-state=${state}>
      <td>
        <input
          type="checkbox"
          class="guide__check"
          aria-label=${row.name}
          .checked=${this.checked.has(row.name)}
          ?disabled=${this.working}
          @change=${(event: Event) => {
            this.toggle(row.name, (event.target as HTMLInputElement).checked);
          }}
        />
      </td>
      <td>
        ${row.slot}${formats > 1 ? html` <span class="guide__format">${row.format}</span>` : nothing}
      </td>
      <td><code>${row.guide}</code> <span class="guide__state">${say(stateKey)}</span></td>
      <td><code>${row.art}</code></td>
    </tr>`;
  }

  private list(say: (key: CatalogueKey) => string, view: Extract<GuideList, { ok: true }>) {
    return html`<p class="guide__template">
        ${fill(say('guide.template'), {
          template: view.template,
          formats: view.formats.join(', '),
        })}
      </p>
      ${
        view.guides.length === 0
          ? html`<p class="guide__none">${say('guide.none')}</p>`
          : html`<table class="guide__table">
              <thead>
                <tr>
                  <th scope="col">${say('guide.column.write')}</th>
                  <th scope="col">${say('guide.column.slot')}</th>
                  <th scope="col">${say('guide.column.guide')}</th>
                  <th scope="col">${say('guide.column.art')}</th>
                </tr>
              </thead>
              <tbody>
                ${view.guides.map((row) => this.row(say, row, view.formats.length))}
              </tbody>
            </table>`
      }
      ${
        view.uncited.length === 0
          ? nothing
          : html`<section class="guide__uncited">
              <h3>${say('guide.uncited.heading')}</h3>
              <ul>
                ${view.uncited.map(
                  (entry) =>
                    html`<li data-slot=${entry.slot}>
                      <code>${entry.line}</code>
                      <button
                        type="button"
                        class="guide__insert"
                        ?disabled=${this.working}
                        @click=${() => {
                          void this.insert(entry.line);
                        }}
                      >
                        ${say('guide.uncited.insert')}
                      </button>
                    </li>`,
                )}
              </ul>
            </section>`
      }
      ${
        view.unguided.length === 0
          ? nothing
          : html`<section class="guide__unguided">
              <h3>${say('guide.unguided.heading')}</h3>
              <ul>
                ${view.unguided.map(
                  (entry) =>
                    html`<li>
                      ${fill(say('guide.unguided.line'), { line: String(entry.line) })}:
                      <code>${entry.cited}</code> (${entry.slot}) — ${entry.reason}
                    </li>`,
                )}
              </ul>
            </section>`
      }`;
  }

  private body(say: (key: CatalogueKey) => string): unknown {
    const view = this.view;
    if (view === undefined) return html`<p class="guide__loading">${say('guide.loading')}</p>`;
    if (view === 'failed') return html`<p class="guide__failure">${say('guide.unavailable')}</p>`;
    if (view.ok) return this.list(say, view);
    const key: CatalogueKey =
      view.reason === 'no-file'
        ? 'guide.noFile'
        : view.reason === 'no-external-art'
          ? 'guide.noExternalArt'
          : 'guide.notResolved';
    return html`<div class="guide__refusal" data-reason=${view.reason} role="note">
      <p>${say(key)}</p>
      ${view.diagnostics.map((item) => html`<p><code>${item.code}</code> ${item.message}</p>`)}
    </div>`;
  }

  private outcome(say: (key: CatalogueKey) => string): unknown {
    const result = this.result;
    if (result === undefined) return nothing;
    const failed = result.outcome !== 'written';
    const report =
      result.outcome === 'written' || result.outcome === 'failed' ? result.report.trim() : '';
    return html`<div
      class="guide__result"
      data-outcome=${result.outcome}
      data-failed=${failed ? 'true' : 'false'}
      role=${failed ? 'alert' : 'status'}
    >
      ${
        result.outcome === 'written'
          ? html`<p>${say('guide.result.written')}</p>
              <ul class="guide__written">
                ${result.written.map((path) => html`<li><code>${path}</code></li>`)}
              </ul>`
          : nothing
      }
      <p class="guide__opened" data-open=${result.outcome === 'written' ? result.open : ''}>
        ${say(writeOutcomeKey(result))}
      </p>
      ${report === '' ? nothing : html`<pre class="guide__report">${report}</pre>`}
    </div>`;
  }

  protected override render(): unknown {
    if (!this.open) return nothing;
    const say = (key: CatalogueKey): string => translate(this.locale, key);
    const view = this.view;
    const writable =
      view !== undefined &&
      view !== 'failed' &&
      view.ok &&
      view.guides.some((row) => this.checked.has(row.name));

    return html`<div
      class="guide__panel"
      role="dialog"
      aria-modal="true"
      aria-label=${say('guide.heading')}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === 'Escape') this.close();
      }}
    >
      <h2 class="guide__title">${say('guide.heading')}</h2>
      ${this.body(say)} ${this.outcome(say)}
      <div class="guide__actions">
        <button
          class="guide__write"
          type="button"
          ?disabled=${!writable || this.working}
          @click=${() => {
            void this.write();
          }}
        >
          ${say(this.working ? 'guide.writing' : 'guide.write')}
        </button>
        <button
          class="guide__close"
          type="button"
          @click=${() => {
            this.close();
          }}
        >
          ${say('guide.close')}
        </button>
      </div>
    </div>`;
  }
}

customElements.define(GUIDE_DIALOG_TAG, GuideDialog);
