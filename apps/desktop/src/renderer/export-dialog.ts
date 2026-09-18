import { LitElement, type TemplateResult, html, nothing } from 'lit';

import { type Locale, DEFAULT_LOCALE, translate } from '../../shared/i18n/index.js';

/**
 * The export dialog: where the files go, what shapes they take, and how far along it is
 * (E9.4, TYTO-43).
 *
 * **It runs nothing.** Like `CommandBar`, it is given callbacks and a state and does neither
 * the choosing of the folder nor the exporting — both of those are main's, reached through
 * the bridge by whoever mounted this. What lives here is the form and the arithmetic of a
 * progress bar, which is what a test can drive without an Electron.
 *
 * **Progress arrives by polling and the dialog is what polls.** The one-way message a push
 * would need exists since TYTO-123 (ADR 0029) and this channel deliberately does not use it:
 * progress is state to read, not a question to answer. `src/main/export.ts` has the full
 * reasoning. The practical shape is here: a timer that asks while the run is `running` and
 * stops the moment it is not.
 */

export const EXPORT_DIALOG_TAG = 'tyto-export-dialog';

/** The file types a person can tick. `svg` is the one that needs no rasterizer. */
export const EXPORT_KINDS = ['png', 'jpeg', 'webp', 'svg'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export interface ExportProgressView {
  readonly status: 'running' | 'finished' | 'cancelled';
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly directory: string;
  readonly diagnostics: readonly { readonly severity: string; readonly message: string }[];
  /**
   * `| undefined` and not just `?`, because this shape comes off the wire.
   *
   * Zod's `.optional()` produces `string | undefined` and `exactOptionalPropertyTypes`
   * treats that as different from an absent key — so a view type that only said `?` could
   * not be handed the very thing the channel answers with.
   */
  readonly failure?: string | undefined;
}

export interface ExportStartRequest {
  readonly directory: string;
  readonly outputs: readonly { readonly kind: ExportKind; readonly quality?: number }[];
}

/**
 * How much of the run is done, as a fraction, and `undefined` while nothing is known.
 *
 * `undefined` rather than `0` on purpose: before the job has planned, the honest state is
 * *we do not know yet*, and a bar sitting at zero says something different — it says the
 * work has started and produced nothing. The caller draws an indeterminate bar for the
 * first and a real one for the second.
 */
export function completion(progress: ExportProgressView | undefined): number | undefined {
  if (progress === undefined || progress.total === 0) return undefined;
  // Clamped, because `done` counts frames that failed as well as frames that were written
  // and a job that reports more than it planned would otherwise draw past the end.
  return Math.min(1, progress.done / progress.total);
}

export class ExportDialog extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    locale: { attribute: false },
    directory: { attribute: false },
    progress: { attribute: false },
    chooseDirectory: { attribute: false },
    start: { attribute: false },
    cancel: { attribute: false },
    reveal: { attribute: false },
    close: { attribute: false },
    kinds: { state: true },
  };

  declare open: boolean;
  declare locale: Locale;
  /** The folder chosen so far, held by the caller so it survives the dialog being closed. */
  declare directory: string | undefined;
  /** The run's state, or `undefined` when nothing has been started from here yet. */
  declare progress: ExportProgressView | undefined;

  declare chooseDirectory: () => void;
  declare start: (request: ExportStartRequest) => void;
  declare cancel: () => void;
  declare reveal: (directory: string) => void;
  declare close: () => void;

  /** Which file types are ticked. SVG alone by default — it is the one that always works. */
  declare kinds: readonly ExportKind[];

  constructor() {
    super();
    this.open = false;
    this.locale = DEFAULT_LOCALE;
    this.directory = undefined;
    this.progress = undefined;
    this.chooseDirectory = () => undefined;
    this.start = () => undefined;
    this.cancel = () => undefined;
    this.reveal = () => undefined;
    this.close = () => undefined;
    this.kinds = ['svg'];
  }

  /** Light DOM, so `shell.css` reaches inside — the arrangement ADR 0024 settled. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private toggleKind(kind: ExportKind): void {
    this.kinds = this.kinds.includes(kind)
      ? this.kinds.filter((candidate) => candidate !== kind)
      : [...this.kinds, kind];
  }

  /** Ready when there is somewhere to write and something to write there. */
  private get canStart(): boolean {
    return (
      this.directory !== undefined && this.kinds.length > 0 && this.progress?.status !== 'running'
    );
  }

  private onStart(): void {
    if (this.directory === undefined) return;
    this.start({
      directory: this.directory,
      // Ordered by `EXPORT_KINDS` rather than by the order they were ticked, so the same
      // set of checkboxes always produces the same request.
      outputs: EXPORT_KINDS.filter((kind) => this.kinds.includes(kind)).map((kind) =>
        kind === 'png' || kind === 'svg' ? { kind } : { kind, quality: 90 },
      ),
    });
  }

  private destination(
    say: (
      key: 'export.destination' | 'export.destination.choose' | 'export.destination.none',
    ) => string,
  ): TemplateResult {
    return html`<div class="export__row">
      <span class="export__label">${say('export.destination')}</span>
      <span class="export__value" data-testid="export-directory"
        >${this.directory ?? say('export.destination.none')}</span
      >
      <button
        class="export__choose"
        type="button"
        @click=${() => {
          this.chooseDirectory();
        }}
      >
        ${say('export.destination.choose')}
      </button>
    </div>`;
  }

  private status(): TemplateResult | typeof nothing {
    const progress = this.progress;
    if (progress === undefined) return nothing;

    const say = translate.bind(null, this.locale);
    const fraction = completion(progress);
    const errors = progress.diagnostics.filter((item) => item.severity === 'error');

    const heading =
      progress.failure !== undefined
        ? say('export.failed')
        : progress.status === 'running'
          ? say('export.progress')
          : progress.status === 'cancelled'
            ? say('export.cancelled')
            : errors.length > 0
              ? say('export.problems')
              : say('export.done');

    return html`<div
      class="export__status"
      data-testid="export-status"
      data-state=${progress.status}
    >
      <p class="export__heading">${heading}</p>
      <p class="export__count" data-testid="export-count">
        ${String(progress.done)} / ${progress.total === 0 ? '?' : String(progress.total)}
      </p>
      <div
        class="export__bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${fraction === undefined ? nothing : String(Math.round(fraction * 100))}
      >
        <div
          class="export__bar-fill"
          style=${`width: ${fraction === undefined ? 0 : Math.round(fraction * 100)}%`}
        ></div>
      </div>
      ${
        progress.failure === undefined
          ? nothing
          : html`<p class="export__failure">${progress.failure}</p>`
      }
      ${
        errors.length === 0
          ? nothing
          : html`<ul class="export__problems">
              ${errors.map((item) => html`<li>${item.message}</li>`)}
            </ul>`
      }
    </div>`;
  }

  protected override render(): unknown {
    if (!this.open) return nothing;

    const say = translate.bind(null, this.locale);
    const running = this.progress?.status === 'running';
    const finished = this.progress !== undefined && !running;

    return html`<div
      class="export__panel"
      role="dialog"
      aria-modal="true"
      aria-label=${say('export.heading')}
      @keydown=${(event: KeyboardEvent) => {
        // Escape closes, and only when nothing is in flight: a run abandoned by a keystroke
        // would keep writing files with nobody watching. Cancel is a button on purpose.
        if (event.key === 'Escape' && !running) this.close();
      }}
    >
      <h2 class="export__title">${say('export.heading')}</h2>
      ${this.destination(say)}

      <fieldset class="export__types" ?disabled=${running}>
        <legend class="export__label">${say('export.fileTypes')}</legend>
        ${EXPORT_KINDS.map(
          (kind) =>
            html`<label class="export__type">
              <input
                type="checkbox"
                value=${kind}
                .checked=${this.kinds.includes(kind)}
                @change=${() => {
                  this.toggleKind(kind);
                }}
              />
              ${kind.toUpperCase()}
            </label>`,
        )}
      </fieldset>

      <p class="export__note">${say('export.formats.all')}</p>

      ${this.status()}

      <div class="export__actions">
        ${
          running
            ? html`<button
                class="export__cancel"
                type="button"
                @click=${() => {
                  this.cancel();
                }}
              >
                ${say('export.cancel')}
              </button>`
            : html`<button
                class="export__start"
                type="button"
                ?disabled=${!this.canStart}
                @click=${() => {
                  this.onStart();
                }}
              >
                ${say('export.start')}
              </button>`
        }
        ${
          finished && this.progress !== undefined
            ? html`<button
                class="export__reveal"
                type="button"
                @click=${() => {
                  this.reveal(this.progress!.directory);
                }}
              >
                ${say('export.openFolder')}
              </button>`
            : nothing
        }
        <button
          class="export__close"
          type="button"
          ?disabled=${running}
          @click=${() => {
            this.close();
          }}
        >
          ${say('export.close')}
        </button>
      </div>
    </div>`;
  }
}

customElements.define(EXPORT_DIALOG_TAG, ExportDialog);
