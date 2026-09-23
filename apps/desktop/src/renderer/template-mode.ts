import {
  type EditorHandle,
  type TemplateAnalyzer,
  EDITOR_SAVE,
  createCommandRegistry,
  createEditor,
  defaultKeymapSet,
  templateCompletion,
  templateLint,
} from '@tyto/editor';
import {
  type Diagnostic as CoreDiagnostic,
  type TemplateManifest,
  parseManifest,
} from '@tyto/core';
import { LitElement, type TemplateResult, html, nothing } from 'lit';

import { type IpcRequest, type IpcResponse } from '../../shared/ipc.js';
import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import { type RequestGate, createRequestGate } from './preview.js';
import { TEMPLATE_MODE_TAG } from './template-mode-tag.js';

/**
 * The template mode (TYTO-44, E9.5): a template folder open beside every format it draws.
 *
 * **It covers the window rather than living in a dock**, like the export dialog, and for a
 * reason of its own: it is a second kind of work with a second kind of document. Editing a
 * template is two buffers, a sample brief and a grid of formats — a shape none of the three
 * panels has — and the brief tabs underneath are exactly what it must *not* disturb, because
 * the third acceptance criterion is that a brief open in one of them redraws when the template
 * is saved. So the tabs stay where they are, alive, behind it.
 *
 * **Two CodeMirror views of its own, one per file**, and not the window's editor. That one is
 * `fixed` and holds every brief's state (ADR 0024, E9.11); a buffer's language is fixed for the
 * life of an editor, and borrowing it for a `template.html` would mean rebuilding it. Two views
 * also means switching between `manifest.yaml` and `template.html` is showing one and hiding the
 * other: each keeps its own undo history with no hand-off to get wrong.
 *
 * **Markup only.** A folder whose layout is a `template.ts` opens as a sentence saying why it
 * cannot be edited here (ADR 0007), and that sentence is the whole of the view.
 *
 * **Whether it has unsaved work is compared, never remembered** — ADR 0026's rule, applied to
 * two buffers: each is dirty when its text differs from what was last read or written.
 */

export { TEMPLATE_MODE_TAG };

/** How long typing has to pause before the grid is asked for, the same as the brief's preview. */
export const TEMPLATE_PREVIEW_DELAY = 200;

export type OpenedTemplate = NonNullable<IpcResponse<'template:open'>['template']>;
export type TemplateDiagnostic = IpcResponse<'template:preview'>['diagnostics'][number];
export type TemplateFrame = IpcResponse<'template:preview'>['frames'][number];
type MarkupTemplate = Extract<OpenedTemplate, { kind: 'markup' }>;

export type BufferName = 'manifest' | 'markup';

/** What the mode asks of the rest of the app. Functions, so a test needs no bridge. */
export interface TemplateModePorts {
  open(directory: string | null): Promise<OpenedTemplate | null>;
  preview(request: IpcRequest<'template:preview'>): Promise<IpcResponse<'template:preview'>>;
  save(request: IpcRequest<'template:save'>): Promise<IpcResponse<'template:save'>>;
  create(name: string): Promise<IpcResponse<'template:new'>>;
  /** `true` when a person agreed to lose the unsaved buffers. */
  confirmDiscard(): Promise<boolean>;
  /** A save went through: whatever else renders with templates has to be told. */
  saved(answer: IpcResponse<'template:save'>): void;
}

export type SaveNotice = 'saved' | 'unregistered' | 'refused';

const FILE_OF: Readonly<Record<BufferName, string>> = {
  manifest: 'manifest.yaml',
  markup: 'template.html',
};

/**
 * The slots a template with no manifest yet can offer: none. Parsed, not cast — and parsed on
 * first use rather than at import, because nothing this module does may run before the window
 * has registered its quit listener (see `TemplateMode.ensureEditors`).
 */
let noSlots: TemplateManifest | undefined;
const NO_SLOTS = (): TemplateManifest => {
  if (noSlots !== undefined) return noSlots;
  const parsed = parseManifest('name: none\nversion: 0.0.0\nformats: [feed]\nslots: {}\n', '');
  if (!parsed.ok) throw new Error('the empty manifest must parse');
  noSlots = parsed.value;
  return noSlots;
};

/**
 * A diagnostic that crossed the bridge, handed back to the editor as the type it left main as.
 *
 * The contract types `code` as a string on purpose (`shared/ipc.ts`: a renderer that pinned the
 * list would stop compiling every time a code was added), and the editor's markers read the
 * fields both shapes share — severity, message, range. The cast is that sentence and no more.
 */
const asCore = (item: TemplateDiagnostic): CoreDiagnostic => item as unknown as CoreDiagnostic;

/** The artworks a set of frames draws, in order, once each. */
export const artworksIn = (frames: readonly TemplateFrame[]): readonly string[] => [
  ...new Set(frames.map((frame) => frame.artwork)),
];

/**
 * How much a frame is shrunk to fit its cell: never enlarged, because a 1080 feed drawn at
 * 110% is a picture of nothing in particular.
 */
export function cellScale(
  frame: { readonly width: number; readonly height: number },
  cell: { readonly width: number; readonly height: number },
): number {
  if (cell.width <= 0 || cell.height <= 0) return 1;
  return Math.min(1, cell.width / frame.width, cell.height / frame.height);
}

/** The side a cell's frame is fitted into. One number, so a story and a feed read at one scale. */
export const CELL = { width: 300, height: 300 } as const;

/** The notice a save answer earns. */
export function noticeFor(answer: IpcResponse<'template:save'>): SaveNotice {
  if (!answer.saved) return 'refused';
  return answer.registered ? 'saved' : 'unregistered';
}

const NOTICE_KEY: Readonly<Record<SaveNotice, CatalogueKey>> = {
  saved: 'templateMode.saved',
  unregistered: 'templateMode.savedUnregistered',
  refused: 'templateMode.saveRefused',
};

const PROBLEM_KEY: Readonly<Record<'name' | 'exists' | 'write', CatalogueKey>> = {
  name: 'templateMode.new.problem.name',
  exists: 'templateMode.new.problem.exists',
  write: 'templateMode.new.problem.write',
};

export class TemplateMode extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    locale: { attribute: false },
    ports: { attribute: false },
    template: { state: true },
    visible: { state: true },
    example: { state: true },
    artwork: { state: true },
    frames: { state: true },
    diagnostics: { state: true },
    notice: { state: true },
    problem: { state: true },
    revision: { state: true },
  };

  declare open: boolean;
  declare locale: Locale;
  declare ports: TemplateModePorts | undefined;

  /** What is open: a markup template, a code one, a refused folder, or nothing yet. */
  declare template: OpenedTemplate | undefined;
  declare visible: BufferName;
  declare example: number;
  declare artwork: string | undefined;
  declare frames: readonly TemplateFrame[];
  declare diagnostics: readonly TemplateDiagnostic[];
  declare notice: SaveNotice | undefined;
  /** The last New that failed, with what the service said. */
  declare problem: { readonly key: CatalogueKey; readonly detail?: string } | undefined;
  /** Bumped per keystroke, so the unsaved dot repaints without anything else doing so. */
  declare revision: number;

  private editors: Partial<Record<BufferName, EditorHandle>> = {};
  /** The text each buffer had when it was last read from or written to the disk. */
  private savedText: Record<BufferName, string> = { manifest: '', markup: '' };
  private gate: RequestGate = createRequestGate();
  private pending: ReturnType<typeof setTimeout> | undefined;
  private lastManifest: TemplateManifest | undefined;

  constructor() {
    super();
    this.open = false;
    this.locale = DEFAULT_LOCALE;
    this.ports = undefined;
    this.template = undefined;
    this.visible = 'markup';
    this.example = 0;
    this.artwork = undefined;
    this.frames = [];
    this.diagnostics = [];
    this.notice = undefined;
    this.problem = undefined;
    this.revision = 0;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /* ------------------------------------------------------------------ what it holds -- */

  /** The text a buffer holds now, or what it was loaded with before the view exists. */
  textOf(buffer: BufferName): string {
    const editor = this.editors[buffer];
    if (editor !== undefined) return editor.getValue();
    const template = this.template;
    return template?.kind === 'markup' ? template[buffer] : '';
  }

  /** The view behind a tab, for a host or a test that has to type into one. */
  editorOf(buffer: BufferName): EditorHandle | undefined {
    return this.editors[buffer];
  }

  isDirty(buffer: BufferName): boolean {
    return this.template?.kind === 'markup' && this.textOf(buffer) !== this.savedText[buffer];
  }

  /** Either buffer. What the quit question and closing the mode ask. */
  get unsaved(): boolean {
    return this.isDirty('manifest') || this.isDirty('markup');
  }

  private get markup(): MarkupTemplate | undefined {
    return this.template?.kind === 'markup' ? this.template : undefined;
  }

  /* ---------------------------------------------------------------------- the verbs -- */

  /** Opens a folder, or asks main for one with `null`. A dismissed picker changes nothing. */
  async openFolder(directory: string | null): Promise<void> {
    const ports = this.ports;
    if (ports === undefined) return;
    if (this.template !== undefined && this.unsaved && !(await ports.confirmDiscard())) return;

    const opened = await ports.open(directory);
    if (opened === null) return;
    this.load(opened);
    this.open = true;
  }

  /** The scaffold, then the folder it made. */
  async create(name: string): Promise<boolean> {
    const ports = this.ports;
    if (ports === undefined) return false;
    if (this.template !== undefined && this.unsaved && !(await ports.confirmDiscard())) {
      return false;
    }

    const answer = await ports.create(name.trim());
    if (answer.directory === null) {
      this.problem =
        answer.problem === undefined
          ? undefined
          : {
              key: PROBLEM_KEY[answer.problem],
              ...(answer.detail === undefined ? {} : { detail: answer.detail }),
            };
      return false;
    }

    this.problem = undefined;
    const opened = await ports.open(answer.directory);
    if (opened === null) return false;
    this.load(opened);
    this.open = true;
    return true;
  }

  /** `true` when both files were written — which is what the quit question needs to know. */
  async save(): Promise<boolean> {
    const ports = this.ports;
    const template = this.markup;
    if (ports === undefined || template === undefined) return false;

    const manifest = this.textOf('manifest');
    const markup = this.textOf('markup');
    const answer = await ports.save({ directory: template.directory, manifest, markup });
    this.notice = noticeFor(answer);

    if (!answer.saved) {
      // The diagnostic that blocked it, where the problems are listed — the second acceptance
      // criterion. The preview's list already carries it while typing; a save that ran before
      // the preview answered must not be the one moment nothing says why.
      this.diagnostics = [
        ...answer.diagnostics,
        ...this.diagnostics.filter((item) => item.file !== 'manifest'),
      ];
      return false;
    }

    // What was written, not what the buffers hold now: a person can go on typing while the
    // answer is on its way, and those keystrokes are unsaved.
    this.savedText = { manifest, markup };
    this.revision += 1;
    ports.saved(answer);
    return true;
  }

  /** Closes the mode, asking first when a buffer has unsaved text. */
  async close(): Promise<boolean> {
    if (this.unsaved && this.ports !== undefined && !(await this.ports.confirmDiscard())) {
      return false;
    }
    this.open = false;
    return true;
  }

  /* ----------------------------------------------------------------------- internals -- */

  private load(opened: OpenedTemplate): void {
    this.template = opened;
    this.notice = undefined;
    this.frames = [];
    this.diagnostics = [];
    this.artwork = undefined;
    this.example = 0;
    if (opened.kind !== 'markup') return;

    this.ensureEditors();
    this.lastManifest = this.manifestOf(opened.manifest) ?? NO_SLOTS();
    for (const buffer of ['manifest', 'markup'] as const) {
      const editor = this.editors[buffer];
      if (editor !== undefined) editor.restore(editor.blank(opened[buffer]));
      // Read back out of the buffer rather than taken from the file, for ADR 0026's reason:
      // CodeMirror normalises line endings, and a CR LF file compared against its own bytes
      // would open unsaved.
      this.savedText[buffer] = editor === undefined ? opened[buffer] : editor.getValue();
    }
    this.visible = 'markup';
    this.revision += 1;
    this.schedule(0);
  }

  private manifestOf(text: string): TemplateManifest | undefined {
    const parsed = parseManifest(text, FILE_OF.manifest);
    return parsed.ok ? parsed.value : undefined;
  }

  private requestFor(
    brief: string,
    briefPath?: string,
  ): IpcRequest<'template:preview'> | undefined {
    const template = this.markup;
    if (template === undefined) return undefined;
    return {
      requestId: 0,
      directory: template.directory,
      manifest: this.textOf('manifest'),
      markup: this.textOf('markup'),
      brief,
      ...(briefPath === undefined ? {} : { briefPath }),
    };
  }

  /** The grid, asked for after `delay` ms of quiet. */
  private schedule(delay: number = TEMPLATE_PREVIEW_DELAY): void {
    if (this.pending !== undefined) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = undefined;
      void this.refresh();
    }, delay);
  }

  /** Exposed for the tests, which should not wait on a timer to see the grid. */
  async refresh(): Promise<void> {
    const ports = this.ports;
    const template = this.markup;
    if (ports === undefined || template === undefined) return;

    const sample = template.examples[this.example];
    const request = this.requestFor(sample?.text ?? '', sample?.path);
    if (request === undefined) return;

    const requestId = this.gate.next();
    const answer = await ports.preview({ ...request, requestId });
    // Late answers are dropped: typing answers out of order, and the grid shows the newest.
    if (!this.gate.accept(answer.requestId)) return;

    this.frames = answer.frames;
    this.diagnostics =
      sample === undefined
        ? answer.diagnostics.filter((item) => item.file === 'manifest' || item.file === 'markup')
        : answer.diagnostics;
    const artworks = artworksIn(answer.frames);
    if (this.artwork === undefined || !artworks.includes(this.artwork)) this.artwork = artworks[0];
  }

  /**
   * The markup buffer's lint markers, which are main's compile of the unsaved buffers.
   *
   * Main and not `compileTemplate` in this window, because a template's `src="assets/…"` is a
   * file in its folder and this window may not read one (ADR 0010) — linting without them would
   * underline every picture that is perfectly there. The manifest the completion offers slots
   * from is parsed here, which reads no file: it is the text in the other tab.
   */
  private analyzer(): TemplateAnalyzer {
    return {
      analyze: async (source) => {
        const parsed = this.manifestOf(this.textOf('manifest'));
        if (parsed !== undefined) this.lastManifest = parsed;
        const request = this.requestFor('');
        const ports = this.ports;
        if (request === undefined || ports === undefined) {
          return { source, diagnostics: [], manifest: this.lastManifest ?? NO_SLOTS() };
        }
        const answer = await ports.preview({ ...request, markup: source });
        return {
          source,
          diagnostics: answer.diagnostics.filter((item) => item.file === 'markup').map(asCore),
          manifest: this.lastManifest ?? NO_SLOTS(),
        };
      },
    };
  }

  /**
   * The two views, made the first time a template is opened and kept from then on.
   *
   * **Not at the first paint, and that is a measured fix rather than tidiness.** The element is
   * in `index.html`, so its first update runs while the window is still starting — before
   * `load()` in `main.ts` has registered the `app:exit-requested` listener. Two CodeMirror views
   * with a linter made that gap wide enough that a close arriving right after the bridge
   * appeared found no listener: main's push was lost, its acknowledgement deadline ran out and
   * the app stayed open by design (ADR 0031). `packaged.package.test.ts` closes at exactly that
   * moment, and hung 600 s on CI and 3 of 3 times locally. Made on demand, the mode costs a
   * window that never opens it nothing.
   */
  private ensureEditors(): void {
    if (this.editors.manifest !== undefined) return;
    const registry = createCommandRegistry();
    // `Mod-s` in either tab saves the template and never the brief behind it: this registry is
    // the mode's own, so the window's `editor.save` cannot be reached from here.
    registry.register({
      id: EDITOR_SAVE,
      run: () => {
        void this.save();
      },
    });

    for (const buffer of ['manifest', 'markup'] as const) {
      const host = this.querySelector<HTMLElement>(`[data-buffer="${buffer}"]`);
      if (host === null) continue;
      const editor = createEditor(host, {
        doc: '',
        language: buffer === 'markup' ? 'template' : 'plain',
        commands: registry,
        keymap: defaultKeymapSet,
        extensions:
          buffer === 'markup' ? [templateLint(this.analyzer()), templateCompletion()] : [],
      });
      editor.onChange(() => {
        this.notice = undefined;
        this.revision += 1;
        // Both tabs move the grid: a slot added to the manifest is a slot the markup can draw.
        this.schedule();
      });
      this.editors[buffer] = editor;
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.pending !== undefined) clearTimeout(this.pending);
  }

  /** Puts the cursor on what a problem row names, in the tab it belongs to. */
  private reveal(item: TemplateDiagnostic): void {
    if (item.file !== 'manifest' && item.file !== 'markup') return;
    this.visible = item.file;
    const view = this.editors[item.file]?.view;
    if (view === undefined || item.range === undefined) return;
    const end = Math.min(item.range.end, view.state.doc.length);
    const start = Math.min(item.range.start, end);
    view.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: true });
    view.focus();
  }

  /* -------------------------------------------------------------------------- render -- */

  private say(key: CatalogueKey): string {
    return translate(this.locale, key);
  }

  private header(): TemplateResult {
    const template = this.template;
    return html`<header class="template-mode__head">
      <div class="template-mode__title">
        <h2 class="template-mode__heading">${this.say('templateMode.heading')}</h2>
        <span class="template-mode__folder" data-testid="template-folder"
          >${template?.directory ?? ''}</span
        >
      </div>
      <div class="template-mode__actions">
        <button
          type="button"
          class="template-mode__save"
          data-testid="template-save"
          ?disabled=${this.markup === undefined}
          @click=${() => {
            void this.save();
          }}
        >
          ${this.say('templateMode.save')}
        </button>
        <button
          type="button"
          class="template-mode__open"
          @click=${() => {
            void this.openFolder(null);
          }}
        >
          ${this.say('templateMode.openOther')}
        </button>
        <form
          class="template-mode__new"
          @submit=${(event: Event) => {
            event.preventDefault();
            const input = (event.target as HTMLFormElement).querySelector('input');
            const name = input?.value ?? '';
            void this.create(name).then((made) => {
              if (made && input !== null) input.value = '';
            });
          }}
        >
          <input
            class="template-mode__new-name"
            data-testid="template-new-name"
            aria-label=${this.say('templateMode.new.name')}
            placeholder=${this.say('templateMode.new.name')}
          />
          <button type="submit">${this.say('templateMode.new.create')}</button>
        </form>
        <button
          type="button"
          class="template-mode__close"
          data-testid="template-close"
          @click=${() => {
            void this.close();
          }}
        >
          ${this.say('templateMode.close')}
        </button>
      </div>
      ${
        this.problem === undefined
          ? nothing
          : html`<p class="template-mode__problem" role="alert">
              ${this.say(this.problem.key)}${
                this.problem.detail === undefined ? '' : `: ${this.problem.detail}`
              }
            </p>`
      }
    </header>`;
  }

  private tabs(): TemplateResult {
    return html`<div class="template-mode__tabs" role="tablist">
      ${(['manifest', 'markup'] as const).map(
        (buffer) =>
          html`<button
            type="button"
            role="tab"
            class="template-mode__tab"
            data-buffer-tab=${buffer}
            aria-selected=${String(this.visible === buffer)}
            @click=${() => {
              this.visible = buffer;
              this.editors[buffer]?.view.focus();
            }}
          >
            ${FILE_OF[buffer]}${
              this.isDirty(buffer)
                ? html`<span
                    class="template-mode__dirty"
                    title=${this.say('templateMode.unsaved')}
                    aria-label=${this.say('templateMode.unsaved')}
                    >●</span
                  >`
                : nothing
            }
          </button>`,
      )}
    </div>`;
  }

  private sample(template: MarkupTemplate): TemplateResult {
    if (template.examples.length === 0) {
      return html`<p class="template-mode__note">${this.say('templateMode.noExample')}</p>`;
    }
    const artworks = artworksIn(this.frames);
    return html`<div class="template-mode__sample">
      <label class="template-mode__row">
        <span>${this.say('templateMode.example')}</span>
        <select
          data-testid="template-example"
          @change=${(event: Event) => {
            this.example = Number((event.target as HTMLSelectElement).value);
            void this.refresh();
          }}
        >
          ${template.examples.map(
            (example, index) =>
              html`<option value=${String(index)} ?selected=${index === this.example}>
                ${example.name}
              </option>`,
          )}
        </select>
      </label>
      ${
        artworks.length <= 1
          ? nothing
          : html`<label class="template-mode__row">
              <span>${this.say('templateMode.slide')}</span>
              <select
                @change=${(event: Event) => {
                  this.artwork = (event.target as HTMLSelectElement).value;
                }}
              >
                ${artworks.map(
                  (artwork) =>
                    html`<option value=${artwork} ?selected=${artwork === this.artwork}>
                      ${artwork}
                    </option>`,
                )}
              </select>
            </label>`
      }
    </div>`;
  }

  private grid(): TemplateResult {
    const shown = this.frames.filter((frame) => frame.artwork === this.artwork);
    if (shown.length === 0) {
      return html`<p class="template-mode__note" data-testid="template-grid-empty">
        ${this.say('templateMode.empty')}
      </p>`;
    }
    return html`<div class="template-mode__grid" data-testid="template-grid">
      ${shown.map((frame) => {
        const scale = cellScale(frame, CELL);
        const width = Math.round(frame.width * scale);
        const height = Math.round(frame.height * scale);
        return html`<figure class="template-mode__cell" data-format=${frame.format}>
          <div class="template-mode__paper" style=${`width:${width}px;height:${height}px`}>
            <iframe
              class="template-mode__frame"
              sandbox=""
              title=${frame.format}
              .srcdoc=${frame.html}
              style=${`width:${frame.width}px;height:${frame.height}px;transform:scale(${scale});transform-origin:top left`}
            ></iframe>
          </div>
          <figcaption>${frame.format} · ${frame.width}×${frame.height}</figcaption>
        </figure>`;
      })}
    </div>`;
  }

  private problems(): TemplateResult {
    const label = (item: TemplateDiagnostic): string => {
      if (item.file === 'manifest' || item.file === 'markup') return FILE_OF[item.file];
      if (item.file === 'brief') return this.markup?.examples[this.example]?.name ?? 'brief';
      return this.say('templateMode.file.render');
    };
    return html`<section class="template-mode__problems" data-testid="template-problems">
      <h3 class="template-mode__subheading">${this.say('templateMode.problems')}</h3>
      ${
        this.notice === undefined
          ? nothing
          : html`<p
              class="template-mode__notice template-mode__notice--${this.notice}"
              data-testid="template-notice"
              data-notice=${this.notice}
              role="status"
            >
              ${this.say(NOTICE_KEY[this.notice])}
            </p>`
      }
      ${
        this.diagnostics.length === 0
          ? html`<p class="template-mode__note">${this.say('templateMode.clean')}</p>`
          : html`<ul class="template-mode__list">
              ${this.diagnostics.map(
                (item) =>
                  html`<li
                    class="template-mode__problem-row template-mode__problem-row--${item.severity}"
                    data-file=${item.file}
                    data-code=${item.code}
                    @click=${() => {
                      this.reveal(item);
                    }}
                  >
                    <span class="template-mode__file">${label(item)}</span>
                    <code>${item.code}</code>
                    <span>${item.message}</span>
                  </li>`,
              )}
            </ul>`
      }
    </section>`;
  }

  /** The one sentence a folder that cannot be edited here gets, in place of the work area. */
  private refusal(template: Exclude<OpenedTemplate, MarkupTemplate>): TemplateResult {
    const text =
      template.kind === 'code'
        ? this.say('templateMode.code')
        : `${this.say('templateMode.refused')} ${template.missing}.`;
    return html`<p class="template-mode__refusal" data-testid="template-refusal" role="alert">
      ${text}
    </p>`;
  }

  protected override render(): unknown {
    const template = this.template;
    const markup = this.markup;
    // Always rendered, open or not: the two editor hosts must survive a close, or reopening
    // would build CodeMirror again and lose both undo histories.
    return html`<div class="template-mode__panel">
      ${this.header()}
      ${template !== undefined && template.kind !== 'markup' ? this.refusal(template) : nothing}
      <div class="template-mode__work" ?hidden=${markup === undefined}>
        <section class="template-mode__buffers">
          ${this.tabs()}
          <div
            class="template-mode__buffer"
            data-buffer="manifest"
            ?hidden=${this.visible !== 'manifest'}
          ></div>
          <div
            class="template-mode__buffer"
            data-buffer="markup"
            ?hidden=${this.visible !== 'markup'}
          ></div>
        </section>
        <section class="template-mode__preview">
          ${markup === undefined ? nothing : this.sample(markup)} ${this.grid()}
        </section>
      </div>
      ${markup === undefined ? nothing : this.problems()}
    </div>`;
  }
}

if (customElements.get(TEMPLATE_MODE_TAG) === undefined) {
  customElements.define(TEMPLATE_MODE_TAG, TemplateMode);
}

declare global {
  interface HTMLElementTagNameMap {
    [TEMPLATE_MODE_TAG]: TemplateMode;
  }
}
