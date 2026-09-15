import { createEditor } from '@tyto/editor';

import { type TytoBridge } from '../../shared/ipc.js';
import { type Locale, DEFAULT_LOCALE, isLocale, translate } from '../../shared/i18n/index.js';
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
  selection: { format: undefined, artwork: undefined } as Selection,
  zoom: 'fit' as Zoom,
  errors: 0,
  problems: 0,
};

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

function repaint(): void {
  paint(document, state);
  if (pane !== undefined) paintPreview(pane, preview);
  paintStatus();
}

/** Asks main for the frames of `brief`, and keeps the answer only if it is still the latest. */
async function request(bridge: TytoBridge, brief: string): Promise<void> {
  const requestId = gate.next();
  const answer = await bridge['brief:preview']({ requestId, brief });
  if (!gate.accept(answer.requestId)) return;

  preview.frames = answer.frames;
  preview.selection = keepSelection(preview.selection, answer.frames);
  preview.problems = answer.diagnostics.length;
  preview.errors = errorCount(answer.diagnostics);
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

  if (elements.editor !== null) {
    const editor = createEditor(elements.editor, { doc: '' });
    if (bridge !== undefined) {
      const ask = debounce(() => void request(bridge, editor.getValue()));
      editor.onChange(ask);
      // Once on load as well: a brief restored into the buffer should show, and the first
      // answer is what fills the tab strip.
      void request(bridge, editor.getValue());
    }
  }

  repaint();
}

// Painted once before the round trip as well, so the window is never blank while main
// answers — the strings are already correct for the default locale, and only the version
// and the platform arrive late.
repaint();
void load();
