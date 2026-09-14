import { forEachDiagnostic, lintGutter } from '@codemirror/lint';

import lista from '../../templates/templates/carrossel-lista/examples/lista.brief?raw';
import promo from '../../templates/templates/promo-curso/examples/promo.brief?raw';

import {
  briefCompletion,
  briefLint,
  createCommandRegistry,
  createEditor,
  createWorkerAnalyzer,
  EDITOR_RENDER,
  EDITOR_SAVE,
  type EditorHandle,
  type ThemeName,
} from '../src/index.js';

/**
 * The demo E8.1, E8.2 and E8.3 are accepted against: the two example briefs the built-in
 * templates ship, opened in a real editor, with the language, the folding, both themes, the
 * lint markers, the manifest-driven completion, the command registry and vim mode live.
 *
 * It is also the smallest possible host, and that is deliberate — it imports `createEditor`
 * and nothing else from CodeMirror, so anything it cannot do here, `apps/desktop` will not
 * be able to do either. `pnpm --filter @tyto/editor demo`.
 *
 * Try it by hand:
 *
 * - type `::` on a blank line for the slot list, break a slot name to see the underline and
 *   its "did you mean" fix, and change `template:` in the frontmatter to watch every list in
 *   the file change with it;
 * - press Ctrl/Cmd+S, then turn vim on and type `:w` — the same counter moves, because both
 *   name the same command id;
 * - toggle the format and press Ctrl/Cmd+Z, or `u` in vim, to see an app-level command come
 *   back out of the same stack the text does.
 */

const EXAMPLES: ReadonlyArray<{ readonly name: string; readonly source: string }> = [
  { name: 'promo-curso', source: promo },
  { name: 'carrossel-lista', source: lista },
];

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`demo: no element matches ${selector}`);
  return element;
};

const parent = required<HTMLElement>('#editor');
const examplePicker = required<HTMLSelectElement>('#example');
const themePicker = required<HTMLSelectElement>('#theme');
const readOnlyToggle = required<HTMLInputElement>('#read-only');
const vimToggle = required<HTMLInputElement>('#vim');
const formatButton = required<HTMLButtonElement>('#toggle-format');
const status = required<HTMLElement>('#status');

for (const [index, example] of EXAMPLES.entries()) {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = example.name;
  examplePicker.append(option);
}

let edits = 0;
let handle: EditorHandle | undefined;

const counters = { saves: 0, renders: 0, format: 'feed' };

function report(): void {
  const lines = handle?.getValue().split('\n').length ?? 0;
  let errors = 0;
  let warnings = 0;
  if (handle) {
    forEachDiagnostic(handle.view.state, (item) => {
      if (item.severity === 'error') errors += 1;
      else if (item.severity === 'warning') warnings += 1;
    });
  }
  status.textContent =
    `${lines} lines · ${edits} edits · ${errors} errors · ${warnings} warnings · ` +
    `${counters.saves} saves · ${counters.renders} renders · format ${counters.format}`;
}

/**
 * One worker for the life of the page, shared by every editor the toggles build.
 *
 * `new Worker(new URL(…), { type: 'module' })` is the incantation a bundler recognises, and
 * it is the host's to write — which is exactly why `@tyto/editor` ships the two halves of
 * the protocol and constructs neither end.
 */
const analyzer = createWorkerAnalyzer(
  new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' }),
);

/**
 * The commands a host owns, which is why the package ships none of them.
 *
 * `editor.save` writes a file in `apps/desktop` and moves a number here; what matters is
 * that both are reached by the same id from the same two places.
 */
const commands = createCommandRegistry();

commands.register({
  id: EDITOR_SAVE,
  label: 'Save',
  run: () => {
    counters.saves += 1;
    report();
  },
});

commands.register({
  id: EDITOR_RENDER,
  label: 'Render',
  run: () => {
    counters.renders += 1;
    report();
  },
});

/**
 * The one command here with an `undo`, because it is the one that changes something the
 * document does not hold. Everything that edits the brief is CodeMirror's history's.
 */
let formatBefore = counters.format;
commands.register({
  id: 'preview.toggleFormat',
  label: 'Toggle format',
  run: () => {
    formatBefore = counters.format;
    counters.format = counters.format === 'feed' ? 'story' : 'feed';
    report();
  },
  undo: () => {
    counters.format = formatBefore;
    report();
  },
});

/**
 * Read-only is decided when the state is built, so the toggle takes the editor down and
 * puts a new one up — which is the destroy/create pair a host does when it opens another
 * file, exercised by the only thing that ever exercises it before `apps/desktop` exists.
 */
const mount = (source: string): void => {
  handle?.destroy();
  handle = createEditor(parent, {
    doc: source,
    theme: themePicker.value as ThemeName,
    readOnly: readOnlyToggle.checked,
    // `lintGutter` is the demo's own choice and not the package's: the underline is what
    // E8.2 owes, and whether a host also wants a column of markers beside the line numbers
    // is a decision `apps/desktop` should get to make for itself.
    extensions: [briefLint(analyzer), briefCompletion(), lintGutter()],
    commands,
    vim: vimToggle.checked,
  });
  handle.onChange(() => {
    edits += 1;
    report();
  });
  report();
};

/**
 * The counts land a debounce after the document does, so the status line is repainted on a
 * timer rather than only on a keystroke. Cheap, and it keeps the demo honest about when the
 * markers actually arrive.
 */
setInterval(report, 250);

const currentExample = (): string => EXAMPLES[Number(examplePicker.value)]?.source ?? '';

examplePicker.addEventListener('change', () => {
  // `setValue` rather than a remount: the editor stays, the document is replaced, and the
  // edit counter does not move — which is the point of `setValue` not firing `onChange`.
  handle?.setValue(currentExample());
  report();
});

themePicker.addEventListener('change', () => {
  handle?.setTheme(themePicker.value as ThemeName);
});

readOnlyToggle.addEventListener('change', () => {
  mount(handle?.getValue() ?? currentExample());
});

/**
 * A compartment swap and not a remount, which is the whole claim: the document, the cursor,
 * the lint markers and the undo stack are all still there on the other side of the toggle.
 */
vimToggle.addEventListener('change', () => {
  handle?.setVimMode(vimToggle.checked);
  report();
});

/**
 * The button and the keyboard reach the command the same way — through its id. There is no
 * second path here for a mouse, which is the point of the registry.
 */
formatButton.addEventListener('click', () => {
  handle?.runCommand('preview.toggleFormat');
});

mount(currentExample());
