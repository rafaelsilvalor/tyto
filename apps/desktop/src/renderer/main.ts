import { type EditorHandle, createEditor } from '@tyto/editor';

import { type TytoBridge } from '../../shared/ipc.js';
import { type Locale, DEFAULT_LOCALE, isLocale, translate } from '../../shared/i18n/index.js';
import { planTemplateEdit, templateOf } from './frontmatter.js';
import {
  type Artwork,
  type Diagnostic,
  type Template,
  paintProblems,
  paintTemplatePicker,
  rangeOf,
  rangeOfArtwork,
  revealRange,
} from './panel.js';
import { fillLocalePicker, localeFromPicker, paint } from './shell.js';
import {
  type Frame,
  type PreviewElements,
  type Selection,
  type Zoom,
  FORMAT_ATTRIBUTE,
  createRequestGate,
  errorCount,
  keepSelection,
  paintPreview,
  stepZoom,
} from './preview.js';

/**
 * The renderer's entry point: an editor on the left, the frames it produces on the right.
 *
 * Wiring only. Which frame is showing and at what scale is `preview.ts`, every string is the
 * catalogue's, and compiling is main's — what is left here is the order things happen in and
 * the one decision nothing else can make: **when** to ask.
 */

declare global {
  interface Window {
    /**
     * Optional, and that is not defensive typing.
     *
     * The same renderer is meant to run in a browser tab later (`docs/architecture.md`,
     * path to the cloud), where nothing injects a preload. Typing it as always-present
     * would make the cloud build a type error rather than a code path.
     */
    readonly tyto?: TytoBridge;
  }
}

/**
 * How long a pause in typing has to be before the brief is compiled.
 *
 * The same 200 ms `@tyto/editor` uses for its own linting, deliberately: two different
 * delays would make the markers and the preview disagree about what "now" is, and the author
 * would watch the frame update for text the editor had not yet accepted. Compiling is
 * milliseconds — the delay is about not doing it mid-word, not about cost.
 */
const PREVIEW_DELAY = 200;

const state = {
  locale: DEFAULT_LOCALE as Locale,
  version: '—',
  platform: '—',
  templates: [] as readonly string[],
};

const preview = {
  frames: [] as readonly Frame[],
  artworks: [] as readonly Artwork[],
  selection: { format: undefined, artwork: undefined } as Selection,
  zoom: 'fit' as Zoom,
  errors: 0,
  problems: 0,
};

const panel = {
  diagnostics: [] as readonly Diagnostic[],
  /**
   * Folders that meant to be a template and could not be read as one.
   *
   * Kept apart from `diagnostics` because they have a different lifetime: these are read
   * once at startup and never change, and the brief's are replaced on every answer. They
   * are shown together, at the top, because to somebody reading the panel they are the same
   * question — why is this not rendering.
   */
  installation: [] as readonly Diagnostic[],
  templates: [] as readonly Template[],
  /** The text the diagnostics were computed against, which is what their offsets index. */
  brief: '',
};

/**
 * The editor, held here because three controls now move it.
 *
 * It used to be a local in `load`, which was right while nothing outside the bridge touched
 * it. A diagnostic row scrolls it, the slide picker scrolls it and the template picker
 * edits it, so the handle is state rather than a local now.
 */
let editor: EditorHandle | undefined;

const byId = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const elements = {
  tabs: byId('format-tabs'),
  slide: byId<HTMLSelectElement>('slide'),
  slideLabel: byId('slide-label'),
  stage: byId('preview-stage'),
  paper: byId('preview-paper'),
  frame: byId<HTMLIFrameElement>('preview-frame'),
  empty: byId('preview-empty'),
  zoomLevel: byId('zoom-level'),
  status: byId('preview-status'),
  editor: byId('editor'),
  locale: byId<HTMLSelectElement>('locale'),
  template: byId<HTMLSelectElement>('template'),
  problems: byId('problems-list'),
  problemsCount: byId('problems-count'),
};

/** Every element the preview pane writes into, or `undefined` if the document lacks one. */
function previewElements(): PreviewElements | undefined {
  const { tabs, slide, slideLabel, stage, paper, frame, empty, zoomLevel } = elements;
  if (
    tabs === null ||
    slide === null ||
    slideLabel === null ||
    stage === null ||
    paper === null ||
    frame === null ||
    empty === null ||
    zoomLevel === null
  ) {
    return undefined;
  }
  return { tabs, slide, slideLabel, stage, paper, frame, empty, zoomLevel };
}

const pane = previewElements();
const gate = createRequestGate();

function paintStatus(): void {
  const status = elements.status;
  if (status === null) return;

  // No frames and nothing to say about them is the state before anybody types, which the
  // stage already covers with its own message. A second empty sentence under it would be
  // noise.
  if (preview.problems === 0) {
    status.textContent = preview.frames.length === 0 ? '' : translate(state.locale, 'preview.ok');
    status.classList.remove('preview__status--bad');
    return;
  }

  const label = translate(state.locale, 'preview.problems');
  status.textContent = `${label}: ${String(preview.problems)}`;
  // Only errors colour it. A warning is a document that still renders (ADR 0013), and
  // painting it red would make every unused slot look like a failure.
  status.classList.toggle('preview__status--bad', preview.errors > 0);
}

/** The card's acceptance criterion, in `panel.ts` where a test can drive it. */
function reveal(range: { start: number; end: number }): void {
  if (editor !== undefined) revealRange(editor.view, range);
}

function paintPanel(): void {
  const problems = [...panel.installation, ...panel.diagnostics];

  if (elements.problems !== null) {
    paintProblems(elements.problems, {
      diagnostics: problems,
      brief: panel.brief,
      locale: state.locale,
    });
  }

  if (elements.problemsCount !== null) {
    // The number, with no word in front of it: the panel's own heading already says what is
    // being counted, and a second label beside it would say it twice.
    elements.problemsCount.textContent = problems.length === 0 ? '' : String(problems.length);
  }

  if (elements.template !== null) {
    paintTemplatePicker(elements.template, {
      templates: panel.templates,
      current: templateOf(editor?.getValue() ?? ''),
      locale: state.locale,
    });
  }
}

function repaint(): void {
  paint(document, state);
  if (pane !== undefined) paintPreview(pane, preview);
  paintStatus();
  paintPanel();
}

/** Asks main for the frames of `brief`, and keeps the answer only if it is still the latest. */
async function request(bridge: TytoBridge, brief: string): Promise<void> {
  const requestId = gate.next();
  const answer = await bridge['brief:preview']({ requestId, brief });
  if (!gate.accept(answer.requestId)) return;

  preview.frames = answer.frames;
  preview.artworks = answer.artworks;
  preview.selection = keepSelection(preview.selection, answer.frames, answer.artworks);
  preview.problems = answer.diagnostics.length;
  preview.errors = errorCount(answer.diagnostics);
  panel.diagnostics = answer.diagnostics;
  // The brief **as asked**, not as it stands: the ranges index this text, and pairing them
  // with a buffer two keystrokes further on would show a line number that drifts.
  panel.brief = brief;
  repaint();
}

/** Calls `run` once the caller has stopped calling for `PREVIEW_DELAY`. */
function debounce(run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, PREVIEW_DELAY);
  };
}

function wirePreviewControls(bridgeless: boolean): void {
  if (pane === undefined) return;

  // **Nothing in here asks for a render**, which is the acceptance criterion rather than an
  // optimisation: every frame of every format is already in `preview.frames`, so switching
  // is choosing one of them. The click handler that called the bridge would be the bug.
  pane.tabs.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const format = target.getAttribute(FORMAT_ATTRIBUTE);
    if (format === null) return;
    preview.selection = { ...preview.selection, format };
    repaint();
  });

  pane.slide.addEventListener('change', () => {
    preview.selection = { ...preview.selection, artwork: pane.slide.value };
    repaint();
    // The card asks for both halves: the preview follows the choice, and so does the
    // editor. The range is the `::slide` directive that made this artwork, which only
    // `resolve` knew — a `Scene` carries no source position at all.
    const at = rangeOfArtwork(preview.artworks, pane.slide.value);
    if (at !== undefined) reveal(at);
  });

  byId<HTMLButtonElement>('zoom-fit')?.addEventListener('click', () => {
    preview.zoom = 'fit';
    repaint();
  });

  for (const [id, direction] of [
    ['zoom-in', 1],
    ['zoom-out', -1],
  ] as const) {
    byId<HTMLButtonElement>(id)?.addEventListener('click', () => {
      // A step from whatever is on screen, so the first click after `fit` moves from the
      // size the user is looking at rather than jumping to 100%.
      preview.zoom = stepZoom(paintPreview(pane, preview), direction);
      repaint();
    });
  }

  // `fit` is a function of the stage, and the stage changes with the window without any
  // state changing to notice it.
  window.addEventListener('resize', () => {
    if (preview.zoom === 'fit') repaint();
  });

  if (bridgeless) pane.empty.hidden = false;
}

/** The panel's own two controls: a row that moves the cursor, and a picker that edits. */
function wirePanelControls(): void {
  elements.problems?.addEventListener('click', (event) => {
    const range = rangeOf(event.target);
    if (range !== undefined) reveal(range);
  });

  elements.template?.addEventListener('change', () => {
    const picker = elements.template;
    if (picker === null || editor === undefined || picker.value === '') return;

    // An edit dispatched into the document, not a `setValue`. That is what keeps the cursor
    // where it was, puts the old template back under Ctrl+Z, and — the part that matters
    // most — notifies `onChange`, so the preview refreshes through the same path typing
    // uses. `setValue` deliberately notifies nobody.
    const edit = planTemplateEdit(editor.getValue(), picker.value);
    if (edit === undefined) return;
    editor.view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
    });
  });
}

async function load(): Promise<void> {
  const bridge = window.tyto;

  if (bridge !== undefined) {
    const info = await bridge['app:info']({});
    state.version = info.version;
    state.platform = info.platform;
    state.templates = info.templates;
    if (isLocale(info.locale)) state.locale = info.locale;
  }

  if (elements.locale instanceof HTMLSelectElement) {
    const picker = elements.locale;
    fillLocalePicker(picker, state.locale);
    picker.addEventListener('change', () => {
      state.locale = localeFromPicker(picker, state.locale);
      repaint();
    });
  }

  wirePreviewControls(bridge === undefined);
  wirePanelControls();

  if (bridge !== undefined) {
    // Asked once, because a registry is read at startup and held in main. A picker that
    // re-asked per click would be re-reading manifests that cannot have changed.
    const answer = await bridge['templates:list']({});
    panel.templates = answer.templates;
    // A folder that meant to be a template and is broken is why a template is missing from
    // the picker, and nothing else in the app would ever say so: the preview service replays
    // the registry's warnings and these are not among them.
    panel.installation = answer.failures.flatMap((failure) => failure.diagnostics);
  }

  if (elements.editor !== null) {
    editor = createEditor(elements.editor, { doc: '' });
    if (bridge !== undefined) {
      const handle = editor;
      const ask = debounce(() => void request(bridge, handle.getValue()));
      // Repainted on every keystroke and not only on the answer: the picker shows the
      // template the *brief* names, so typing the line by hand has to move it too.
      editor.onChange(() => {
        paintPanel();
        ask();
      });
      // Once on load as well: a brief restored into the buffer should show, and the first
      // answer is what fills the tab strip.
      void request(bridge, handle.getValue());
    }
  }

  repaint();
}

// Painted once before the round trip as well, so the window is never blank while main
// answers — the strings are already correct for the default locale, and only the version
// and the platform arrive late.
repaint();
void load();
