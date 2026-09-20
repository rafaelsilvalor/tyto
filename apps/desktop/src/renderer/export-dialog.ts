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

/** The file types that lose something when compressed, and the only ones quality reaches. */
export const LOSSY_KINDS: readonly ExportKind[] = ['jpeg', 'webp'];

/** The file types made of pixels, and the only ones scale means anything to. */
export const RASTER_KINDS: readonly ExportKind[] = ['png', 'jpeg', 'webp'];

/**
 * The scales offered, which is the retina export the raster port already promises.
 *
 * Two entries and not a free number: `scale` is capped at 8 by the contract and a text box
 * would invite 7.5, which renders and helps nobody. 1 is today's behaviour and stays first.
 */
export const EXPORT_SCALES = [1, 2] as const;
export type ExportScale = (typeof EXPORT_SCALES)[number];

/** What quality means when nobody has touched it — the number TYTO-43 shipped hard-coded. */
export const DEFAULT_QUALITY = 90;

export interface ExportStartRequest {
  readonly directory: string;
  readonly outputs: readonly {
    readonly kind: ExportKind;
    readonly quality?: number;
    readonly scale?: number;
  }[];
  /**
   * The formats to render, or **absent for every format the template declares** (TYTO-137).
   *
   * Absent is what the channel already means by "all of them" and is what this dialog sent
   * before there was a way to choose, so a person who opens the dialog and clicks Export
   * sends the identical request either way. It is only filled in when somebody has unticked
   * something.
   */
  readonly formats?: readonly string[];
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
    formats: { attribute: false },
    kinds: { state: true },
    chosenFormats: { state: true },
    scale: { state: true },
    quality: { state: true },
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

  /**
   * The formats this brief's template declares, handed in by the caller (TYTO-137).
   *
   * **Empty means "nobody knows", not "none"**, and the two have to look different: a brief
   * whose frontmatter names no template, or names one this window has no manifest for, has
   * no list to offer — so the checklist is not drawn at all and the request goes out without
   * `formats`, which is the behaviour that shipped. The window already holds this: it is
   * `templates:list`'s answer, filtered by the template named in the brief, so the dialog
   * needs no channel of its own.
   */
  declare formats: readonly string[];

  /** Which file types are ticked. SVG alone by default — it is the one that always works. */
  declare kinds: readonly ExportKind[];

  /**
   * Which formats are ticked, or `undefined` before {@link formats} has been handed over.
   *
   * `undefined` and not the empty array, for {@link formats}' reason one level down: the
   * empty array is a person who unticked everything, and that must disable Export rather
   * than quietly render all of them.
   */
  declare chosenFormats: readonly string[] | undefined;

  /** 1 or 2. The pixels, not the design — `scale: 2` is the same frame at twice the size. */
  declare scale: ExportScale;

  /** 1-100, and it reaches `jpeg` and `webp` only. PNG is lossless and refuses it. */
  declare quality: number;

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
    this.formats = [];
    this.kinds = ['svg'];
    this.chosenFormats = undefined;
    this.scale = 1;
    this.quality = DEFAULT_QUALITY;
  }

  /**
   * Ticks every format the moment a list arrives, and again whenever the list changes.
   *
   * **Every one ticked is the card's fourth criterion**: the dialog opened on a brief has to
   * produce what it produced before somebody could choose. Re-ticking on a *change* is the
   * other half — switching to a brief with another template must not carry a selection that
   * names formats the new template does not have.
   */
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has('formats')) return;
    this.chosenFormats = this.formats.length === 0 ? undefined : [...this.formats];
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

  private toggleFormat(format: string): void {
    const chosen = this.chosenFormats ?? [];
    this.chosenFormats = chosen.includes(format)
      ? chosen.filter((candidate) => candidate !== format)
      : [...chosen, format];
  }

  /** Whether any ticked type is made of pixels, which is what scale can act on. */
  private get hasRaster(): boolean {
    return this.kinds.some((kind) => RASTER_KINDS.includes(kind));
  }

  /** Whether any ticked type is compressed, which is what quality can act on. */
  private get hasLossy(): boolean {
    return this.kinds.some((kind) => LOSSY_KINDS.includes(kind));
  }

  /**
   * Ready when there is somewhere to write, something to write there, and a format to write
   * it in.
   *
   * The third clause is new (TYTO-137) and only reachable once there is a list: unticking
   * every format is an export of nothing, the same state as unticking every file type, and
   * it is refused the same way rather than being silently read as "all of them".
   */
  private get canStart(): boolean {
    const someFormat = this.chosenFormats === undefined || this.chosenFormats.length > 0;
    return (
      this.directory !== undefined &&
      this.kinds.length > 0 &&
      someFormat &&
      this.progress?.status !== 'running'
    );
  }

  /**
   * The formats to send, or nothing at all when they are all wanted.
   *
   * **Absent rather than the full list**, which is what makes "open the dialog and click
   * Export" byte-identical to the behaviour before this card: the channel reads an absent
   * `formats` as every format the template declares, and it reads it from the *manifest*
   * rather than from whatever list this window happened to be holding. A window with a stale
   * template list would otherwise quietly narrow the export to what it knew about.
   */
  private get formatsToSend(): readonly string[] | undefined {
    const chosen = this.chosenFormats;
    if (chosen === undefined) return undefined;
    return chosen.length === this.formats.length ? undefined : chosen;
  }

  private onStart(): void {
    if (this.directory === undefined) return;
    const formats = this.formatsToSend;
    this.start({
      directory: this.directory,
      // Ordered by `EXPORT_KINDS` rather than by the order they were ticked, so the same
      // set of checkboxes always produces the same request.
      outputs: EXPORT_KINDS.filter((kind) => this.kinds.includes(kind)).map((kind) => ({
        kind,
        // **Quality never reaches `png`**, which is not a preference: the raster port throws
        // a `TypeError` for it, because PNG is lossless and a caller who believed it had
        // asked for a smaller file deserves to be told it had not. SVG has no pixels to
        // compress either.
        ...(LOSSY_KINDS.includes(kind) ? { quality: this.quality } : {}),
        // **Scale never reaches `svg`** for the matching reason: an SVG is instructions and
        // has no resolution to double. `1` is left off entirely rather than sent, so the
        // untouched form produces the request this dialog produced before it could choose.
        ...(RASTER_KINDS.includes(kind) && this.scale !== 1 ? { scale: this.scale } : {}),
      })),
      ...(formats === undefined ? {} : { formats }),
    });
  }

  /**
   * The formats this export will render, or the note that says it renders all of them.
   *
   * **The note is the honest state and not a placeholder** (TYTO-137). With no template named
   * in the brief — or one this window holds no manifest for — there is no list to tick, and
   * saying "every format the template has" is exactly what the request will do.
   */
  private formatsField(
    say: (key: 'export.formats' | 'export.formats.all') => string,
    running: boolean,
  ): TemplateResult {
    const chosen = this.chosenFormats;
    if (chosen === undefined) return html`<p class="export__note">${say('export.formats.all')}</p>`;

    return html`<fieldset class="export__formats" ?disabled=${running}>
      <legend class="export__label">${say('export.formats')}</legend>
      ${this.formats.map(
        (format) =>
          html`<label class="export__format">
            <input
              type="checkbox"
              value=${format}
              .checked=${chosen.includes(format)}
              @change=${() => {
                this.toggleFormat(format);
              }}
            />
            ${format}
          </label>`,
      )}
    </fieldset>`;
  }

  /**
   * Scale and quality, each shown only while a ticked type can be acted on.
   *
   * **Quality is absent rather than disabled-and-ignored when no lossy type is ticked**, which
   * is the card's third criterion in its literal form: asking for quality on PNG has to be
   * impossible from the form rather than refused afterwards by the raster port's `TypeError`.
   * Scale follows the same rule with SVG, where the reason is not an error but an absurdity —
   * there is no resolution to double in a file made of instructions.
   */
  private rasterFields(
    say: (key: 'export.scale' | 'export.quality') => string,
    running: boolean,
  ): TemplateResult {
    return html`<div class="export__raster">
      ${
        this.hasRaster
          ? html`<label class="export__row">
              <span class="export__label">${say('export.scale')}</span>
              <select
                class="export__scale"
                data-testid="export-scale"
                ?disabled=${running}
                @change=${(event: Event) => {
                  const chosen = Number((event.target as HTMLSelectElement).value);
                  this.scale = chosen === 2 ? 2 : 1;
                }}
              >
                ${EXPORT_SCALES.map(
                  (scale) =>
                    html`<option value=${String(scale)} ?selected=${this.scale === scale}>
                      ${String(scale)}×
                    </option>`,
                )}
              </select>
            </label>`
          : nothing
      }
      ${
        this.hasLossy
          ? html`<label class="export__row">
              <span class="export__label">${say('export.quality')}</span>
              <input
                class="export__quality"
                data-testid="export-quality"
                type="number"
                min="1"
                max="100"
                step="1"
                .value=${String(this.quality)}
                ?disabled=${running}
                @change=${(event: Event) => {
                  const typed = Number((event.target as HTMLInputElement).value);
                  // Clamped here rather than left to the contract to refuse: the channel caps
                  // it at 1-100 and a request that fails validation would report a bug in this
                  // window to somebody who only typed 0 in a box.
                  this.quality = Number.isFinite(typed)
                    ? Math.min(100, Math.max(1, Math.round(typed)))
                    : DEFAULT_QUALITY;
                }}
              />
            </label>`
          : nothing
      }
    </div>`;
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

      ${this.formatsField(say, running)} ${this.rasterFields(say, running)} ${this.status()}

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
