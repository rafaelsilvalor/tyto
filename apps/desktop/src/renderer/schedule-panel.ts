import { type TemplateResult, html, nothing } from 'lit';

import type { CatalogueKey, Locale } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';
import { DockedPanel } from './panels.js';

/**
 * The Schedules panel (TYTO-385, ADR 0175 decision 6): a tab of the bottom strip (ADR 0163) with
 * one row per recipe main runs on an interval in the open workspace folder — its name, when it
 * last ran, when it runs next, how the last run ended — and Run now and Open.
 *
 * **It holds no bridge and names no path.** It is handed main's `schedule:list` answer by
 * `main.ts`, on open and on every `schedule:changed`, and its two buttons hand back the
 * `scheduleId` main minted (ADR 0086). The file beside a name is for reading only.
 */

export const SCHEDULE_PANEL_TAG = 'tyto-schedule-panel';

export type ScheduleListView = IpcResponse<'schedule:list'>;
export type ScheduleRow = ScheduleListView['schedules'][number];

/** What the panel's buttons do, each a round trip to main by the schedule's id. */
export interface ScheduleActions {
  runNow(scheduleId: string): void;
  open(scheduleId: string): void;
}

const idle: ScheduleActions = {
  runNow: () => undefined,
  open: () => undefined,
};

/** The cadence as the recipe's own header writes it: `every 2h`, `every 90m`. */
export function cadenceOf(minutes: number): string {
  return minutes % 60 === 0 ? `every ${String(minutes / 60)}h` : `every ${String(minutes)}m`;
}

/** An ISO time as the window's language writes an hour and a minute; empty when absent. */
export function clockOf(iso: string | undefined, locale: Locale): string {
  if (iso === undefined) return '';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '';
  return time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * What the outcome cell says, and the state it is drawn in. A recipe needing a parameter says so
 * before anything else, since main never runs it; a run going on says so over the last outcome.
 */
export function outcomeOf(
  row: ScheduleRow,
  say: (key: CatalogueKey) => string,
): { readonly state: string; readonly text: string } {
  if (row.needs.length > 0) {
    return {
      state: 'needs',
      text: say('schedules.outcome.needs').replaceAll('{params}', row.needs.join(', ')),
    };
  }
  if (row.running) return { state: 'running', text: say('schedules.outcome.running') };
  switch (row.outcome) {
    case undefined:
      return { state: 'none', text: say('schedules.outcome.none') };
    case 'ok':
      return { state: 'ok', text: say('schedules.outcome.ok') };
    case 'waiting':
      return { state: 'waiting', text: say('schedules.outcome.waiting') };
    case 'held':
      return { state: 'held', text: say('schedules.outcome.held') };
    case 'problem':
      return {
        state: 'problem',
        text:
          row.code === undefined
            ? say('schedules.outcome.problem')
            : `${say('schedules.outcome.problem')}: ${row.code}`,
      };
  }
}

export class SchedulePanel extends DockedPanel {
  static override properties = {
    ...DockedPanel.properties,
    view: { attribute: false },
    actions: { attribute: false },
  };

  /** The schedules, `'failed'` when the bridge could not answer, or nothing while it is asked. */
  declare view: ScheduleListView | 'failed' | undefined;
  declare actions: ScheduleActions;

  constructor() {
    super();
    this.view = undefined;
    this.actions = idle;
  }

  protected override render(): unknown {
    return html`${this.bar('schedules-heading', 'schedules.heading')}
      <div class="schedules__body">${this.body()}</div>`;
  }

  private body(): unknown {
    const view = this.view;
    if (view === undefined) return nothing;
    if (view === 'failed') {
      return html`<p class="schedules__note schedules__note--bad">
        ${this.say('schedules.unavailable')}
      </p>`;
    }
    if (view.schedules.length === 0) {
      return html`<p class="schedules__note schedules__empty">${this.say('schedules.empty')}</p>`;
    }
    return html`<table class="schedules__table">
      <thead>
        <tr>
          <th scope="col">${this.say('schedules.column.recipe')}</th>
          <th scope="col">${this.say('schedules.column.lastRun')}</th>
          <th scope="col">${this.say('schedules.column.nextRun')}</th>
          <th scope="col">${this.say('schedules.column.outcome')}</th>
          <th scope="col" aria-label=${this.say('schedules.column.actions')}></th>
        </tr>
      </thead>
      <tbody>
        ${view.schedules.map((row) => this.row(row))}
      </tbody>
    </table>`;
  }

  private row(row: ScheduleRow): TemplateResult {
    const outcome = outcomeOf(row, (key) => this.say(key));
    // Main refuses Run now for a recipe needing a parameter or still running; the button says so.
    const canRun = row.needs.length === 0 && !row.running;
    return html`<tr class="schedules__row" data-schedule=${row.scheduleId}>
      <td class="schedules__recipe">
        <span class="schedules__name" title=${row.file}>${row.name}</span>
        <span class="schedules__every">${cadenceOf(row.minutes)}</span>
      </td>
      <td class="schedules__last">${this.time(row.lastRunAt)}</td>
      <td class="schedules__next">${row.needs.length > 0 ? nothing : this.time(row.nextRunAt)}</td>
      <td class="schedules__outcome" data-outcome=${outcome.state}>${outcome.text}</td>
      <td class="schedules__actions">
        <button
          type="button"
          class="schedules__button schedules__run"
          ?disabled=${!canRun}
          @click=${() => {
            this.actions.runNow(row.scheduleId);
          }}
        >
          ${this.say('schedules.runNow')}
        </button>
        <button
          type="button"
          class="schedules__button schedules__open"
          @click=${() => {
            this.actions.open(row.scheduleId);
          }}
        >
          ${this.say('schedules.open')}
        </button>
      </td>
    </tr>`;
  }

  private time(iso: string | undefined): unknown {
    if (iso === undefined) return nothing;
    return html`<time datetime=${iso}>${clockOf(iso, this.locale)}</time>`;
  }
}

customElements.define(SCHEDULE_PANEL_TAG, SchedulePanel);

declare global {
  interface HTMLElementTagNameMap {
    [SCHEDULE_PANEL_TAG]: SchedulePanel;
  }
}
