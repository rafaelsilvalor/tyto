import { forEachDiagnostic, lintGutter } from '@codemirror/lint';

import lista from '../../templates/templates/carrossel-lista/examples/lista.brief?raw';
import promo from '../../templates/templates/promo-curso/examples/promo.brief?raw';

import {
  briefCompletion,
  briefLint,
  createEditor,
  createWorkerAnalyzer,
  type EditorHandle,
  type ThemeName,
} from '../src/index.js';

/**
 * The demo E8.1 and E8.2 are accepted against: the two example briefs the built-in
 * templates ship, opened in a real editor, with the language, the folding, both themes,
 * the lint markers and the manifest-driven completion live.
 *
 * It is also the smallest possible host, and that is deliberate — it imports `createEditor`
 * and nothing else from CodeMirror, so anything it cannot do here, `apps/desktop` will not
 * be able to do either. `pnpm --filter @tyto/editor demo`.
 *
 * Try it by hand: type `::` on a blank line for the slot list, break a slot name to see the
 * underline and its "did you mean" fix, and change `template:` in the frontmatter to watch
 * every list in the file change with it.
 */

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
const status = required<HTMLElement>('#status');

for (const [index, example] of EXAMPLES.entries()) {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = example.name;
  examplePicker.append(option);
}

let edits = 0;
let handle: EditorHandle | undefined;

const report = (): void => {
  const lines = handle?.getValue().split('\n').length ?? 0;
  let errors = 0;
  let warnings = 0;
  if (handle) {
    forEachDiagnostic(handle.view.state, (item) => {
      if (item.severity === 'error') errors += 1;
      else if (item.severity === 'warning') warnings += 1;
    });
  }
  status.textContent = `${lines} lines · ${edits} edits · ${errors} errors · ${warnings} warnings`;
};

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

mount(currentExample());
