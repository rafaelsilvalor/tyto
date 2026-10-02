import { type TemplateResult, html, nothing } from 'lit';

import type { CatalogueKey } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';
import { DockedPanel } from './panels.js';

/**
 * The local queue panel (TYTO-45): the tasks in the queue folder, how each one stands, and
 * the four things a person does to one.
 *
 * **It holds no bridge and reads no disk.** Like the plugins screen it is handed the answer to
 * `queue:list` by whoever owns the bridge (`main.ts`, on open and on every `queue:changed`),
 * and every button is a callback. What a task *is* — its folder, its brief, its `out/` — is
 * main's; the panel knows an id and a status.
 *
 * **A dock panel and not a dialog**, because the use is watching it: with auto-run on, the
 * queue renders while a person edits, and a modal would hide exactly what it reports.
 */

export const QUEUE_PANEL_TAG = 'tyto-queue-panel';

export type QueueView = IpcResponse<'queue:list'>;
type QueueTask = QueueView['tasks'][number];

/** What the panel's buttons do, all of it a round trip to main. */
export interface QueueActions {
  chooseFolder(): void;
  clearFolder(): void;
  setAutoRun(on: boolean): void;
  setKinds(kinds: readonly string[]): void;
  run(taskId: string): void;
  openBrief(taskId: string): void;
  openOutput(taskId: string): void;
}

const STATUS_KEYS: Record<QueueTask['status'], CatalogueKey> = {
  pending: 'queue.status.pending',
  rendering: 'queue.status.rendering',
  done: 'queue.status.done',
  error: 'queue.status.error',
};

const idle: QueueActions = {
  chooseFolder: () => undefined,
  clearFolder: () => undefined,
  setAutoRun: () => undefined,
  setKinds: () => undefined,
  run: () => undefined,
  openBrief: () => undefined,
  openOutput: () => undefined,
};

export class QueuePanel extends DockedPanel {
  static override properties = {
    ...DockedPanel.properties,
    view: { attribute: false },
    actions: { attribute: false },
    available: { attribute: false },
  };

  /** The queue, `'failed'` when the bridge could not answer, or nothing while it is asked. */
  declare view: QueueView | 'failed' | undefined;
  declare actions: QueueActions;
  /**
   * Every kind a run can produce, from `export:kinds`, so an installed exporter's kind is
   * offered beside Tyto's (ADR 0044). PNG alone until the answer lands.
   */
  declare available: readonly string[];

  constructor() {
    super();
    this.view = undefined;
    this.actions = idle;
    this.available = ['png'];
  }

  protected override render(): unknown {
    return html`${this.bar('queue-heading', 'queue.heading', nothing)}
      <div class="queue__body">${this.body()}</div>`;
  }

  private body(): unknown {
    const view = this.view;
    if (view === undefined) return nothing;
    if (view === 'failed') {
      return html`<p class="queue__note queue__note--bad">${this.say('queue.unavailable')}</p>`;
    }
    if (view.folder === null) {
      return html`<p class="queue__note">${this.say('queue.folder.none')}</p>
        <div class="queue__controls">${this.chooseButton()}</div>`;
    }

    return html`<div class="queue__folder">
        <span class="queue__label">${this.say('queue.inbox')}</span>
        <code class="queue__path" title=${view.inbox ?? ''}>${view.inbox}</code>
      </div>
      <div class="queue__controls">
        ${this.chooseButton()}
        <button
          type="button"
          class="queue__button queue__clear"
          @click=${() => {
            this.actions.clearFolder();
          }}
        >
          ${this.say('queue.folder.clear')}
        </button>
        <label class="queue__auto">
          <input
            type="checkbox"
            class="queue__auto-run"
            .checked=${view.autoRun}
            @change=${(event: Event) => {
              this.actions.setAutoRun((event.target as HTMLInputElement).checked);
            }}
          />
          ${this.say('queue.autoRun')}
        </label>
      </div>
      ${this.kindsRow(view.kinds)}
      ${
        view.tasks.length === 0
          ? html`<p class="queue__note queue__empty">${this.say('queue.empty')}</p>`
          : html`<ul class="queue__tasks">
              ${view.tasks.map((task) => this.row(task))}
            </ul>`
      }`;
  }

  /**
   * One checkbox per kind (TYTO-188, ADR 0061). A chosen kind no exporter produces any more
   * is still listed, so a person can see it and untick it; the task's warning says the same.
   * **The last ticked box is disabled**: a folder that produced nothing would be one that
   * stopped working without saying so.
   */
  private kindsRow(chosen: readonly string[]): TemplateResult {
    const offered = [...new Set([...this.available, ...chosen])];
    const toggle = (kind: string, on: boolean): void => {
      const next = on ? [...chosen, kind] : chosen.filter((item) => item !== kind);
      // In the order offered, so the saved choice reads the way the row does.
      this.actions.setKinds(offered.filter((item) => next.includes(item)));
    };
    return html`<div
      class="queue__controls queue__kinds"
      role="group"
      aria-label=${this.say('queue.kinds')}
    >
      <span class="queue__label">${this.say('queue.kinds')}</span>
      ${offered.map((kind) => {
        const on = chosen.includes(kind);
        return html`<label class="queue__auto">
          <input
            type="checkbox"
            class="queue__kind"
            data-kind=${kind}
            .checked=${on}
            ?disabled=${on && chosen.length === 1}
            @change=${(event: Event) => {
              toggle(kind, (event.target as HTMLInputElement).checked);
            }}
          />
          ${kind.toUpperCase()}
        </label>`;
      })}
    </div>`;
  }

  private chooseButton(): TemplateResult {
    return html`<button
      type="button"
      class="queue__button queue__choose"
      @click=${() => {
        this.actions.chooseFolder();
      }}
    >
      ${this.say('queue.folder.choose')}
    </button>`;
  }

  private row(task: QueueTask): TemplateResult {
    // Run for a task that has not been tried, Retry for one that failed, nothing while it
    // renders or once it is done: a finished task has moved to `done/` and running it again
    // is a job for whoever drops it back in.
    const runKey: CatalogueKey | undefined =
      task.status === 'pending' ? 'queue.run' : task.status === 'error' ? 'queue.retry' : undefined;
    // The brief is worth opening while it can still be fixed and run.
    const canOpenBrief = task.status === 'pending' || task.status === 'error';

    return html`<li class="queue__task" data-task=${task.id} data-status=${task.status}>
      <div class="queue__head">
        <span class="queue__dot queue__dot--${task.status}"></span>
        <span class="queue__id" title=${task.id}>${task.id}</span>
        <span class="queue__status">${this.say(STATUS_KEYS[task.status])}</span>
      </div>
      ${task.failure === undefined ? nothing : html`<p class="queue__failure">${task.failure}</p>`}
      ${
        task.diagnostics.length === 0
          ? nothing
          : html`<ul class="queue__diagnostics">
              ${task.diagnostics.map(
                (item) =>
                  html`<li class="queue__diagnostic queue__diagnostic--${item.severity}">
                    <span class="queue__code">${item.code}</span>
                    <span class="queue__message" title=${item.message}>${item.message}</span>
                  </li>`,
              )}
            </ul>`
      }
      <div class="queue__actions">
        ${
          runKey === undefined
            ? nothing
            : html`<button
                type="button"
                class="queue__button queue__run"
                @click=${() => {
                  this.actions.run(task.id);
                }}
              >
                ${this.say(runKey)}
              </button>`
        }
        ${
          canOpenBrief
            ? html`<button
                type="button"
                class="queue__button queue__open-brief"
                @click=${() => {
                  this.actions.openBrief(task.id);
                }}
              >
                ${this.say('queue.openBrief')}
              </button>`
            : nothing
        }
        ${
          task.hasOutput
            ? html`<button
                type="button"
                class="queue__button queue__open-output"
                @click=${() => {
                  this.actions.openOutput(task.id);
                }}
              >
                ${this.say('queue.openOutput')}
              </button>`
            : nothing
        }
      </div>
    </li>`;
  }
}

customElements.define(QUEUE_PANEL_TAG, QueuePanel);

declare global {
  interface HTMLElementTagNameMap {
    [QUEUE_PANEL_TAG]: QueuePanel;
  }
}
