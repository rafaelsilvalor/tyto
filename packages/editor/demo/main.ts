import { forEachDiagnostic, lintGutter } from '@codemirror/lint';

import lista from '../../templates/templates/carrossel-lista/examples/lista.brief?raw';
import carrosselTemplate from '../../templates/templates/carrossel-lista/template.html?raw';
import promo from '../../templates/templates/promo-curso/examples/promo.brief?raw';
import promoTemplate from '../../templates/templates/promo-curso/template.html?raw';

import { MANIFEST_BY_NAME } from './manifests.js';

import {
  briefCompletion,
  briefLint,
  createCommandRegistry,
  createEditor,
  createTemplateAnalyzer,
  createWorkerAnalyzer,
  EDITOR_RENDER,
  EDITOR_SAVE,
  type EditorHandle,
  type LanguageName,
  templateCompletion,
  templateLint,
  type ThemeName,
} from '../src/index.js';

/**
 * The demo E8.1 through E8.4 are accepted against: the two example briefs *and* the two
 * `template.html` files the built-in templates ship, opened in a real editor, with both
 * languages, the folding, both themes, the lint markers, the completion, the command
 * registry and vim mode live.
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
 *   back out of the same stack the text does;
 * - open a `template.html`, type `<` for the tag list, and write `background: red` into a
 *   class rule to see `E_UNSUPPORTED_CSS` name `fill` as what to write instead;
 * - in the same file, type `slot="` inside a `<text>` for the slots that template declares,
 *   and note that the same `<` inside those quotes offers nothing — completion is reading
 *   the syntax tree, so a character in a string is a character in a string.
 */

interface Example {
  readonly name: string;
  readonly source: string;
  readonly language: LanguageName;
  /** Which manifest a `template.html` is checked against. Briefs name their own. */
  readonly manifest?: string;
}

const EXAMPLES: readonly Example[] = [
  { name: 'promo-curso.brief', source: promo, language: 'brief' },
  { name: 'carrossel-lista.brief', source: lista, language: 'brief' },
  {
    name: 'promo-curso/template.html',
    source: promoTemplate,
    language: 'template',
    manifest: 'promo-curso',
  },
  {
    name: 'carrossel-lista/template.html',
    source: carrosselTemplate,
    language: 'template',
    manifest: 'carrossel-lista',
  },
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
 * A template is linted against its own manifest and nothing else — it is the file in the
 * folder next to it. Missing it is a broken demo, not a brief an author can fix, so it
 * throws rather than linting against a guess.
 */
const manifestFor = (example: Example) => {
  const found = example.manifest === undefined ? undefined : MANIFEST_BY_NAME[example.manifest];
  if (found === undefined) throw new Error(`demo: no manifest named ${example.manifest ?? '—'}`);
  return found;
};

/**
 * Read-only is decided when the state is built, so the toggle takes the editor down and
 * puts a new one up — which is the destroy/create pair a host does when it opens another
 * file, exercised by the only thing that ever exercises it before `apps/desktop` exists.
 */
const mount = (example: Example, source = example.source): void => {
  handle?.destroy();

  /**
   * A template is linted against its own manifest and a brief against whichever one its
   * frontmatter names — which is why the brief analyzer holds the whole list and this one
   * is built per file.
   */
  const language =
    example.language === 'template'
      ? [
          templateLint(createTemplateAnalyzer({ manifest: manifestFor(example) })),
          templateCompletion(),
        ]
      : [briefLint(analyzer), briefCompletion()];

  handle = createEditor(parent, {
    doc: source,
    theme: themePicker.value as ThemeName,
    readOnly: readOnlyToggle.checked,
    language: example.language,
    // `lintGutter` is the demo's own choice and not the package's: the underline is what
    // E8.2 owes, and whether a host also wants a column of markers beside the line numbers
    // is a decision `apps/desktop` should get to make for itself.
    extensions: [...language, lintGutter()],
    commands,
    vim: vimToggle.checked,
  });
  openLanguage = example.language;
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

const FALLBACK: Example = { name: 'empty', source: '', language: 'brief' };

const currentExample = (): Example => EXAMPLES[Number(examplePicker.value)] ?? FALLBACK;

let openLanguage: LanguageName = 'brief';

examplePicker.addEventListener('change', () => {
  const example = currentExample();
  if (example.language === openLanguage) {
    // `setValue` rather than a remount while the language is the same: the editor stays,
    // the document is replaced, and the edit counter does not move — which is the point of
    // `setValue` not firing `onChange`.
    handle?.setValue(example.source);
    report();
    return;
  }
  // The language is fixed when the state is built, so the other kind of file is a new
  // editor — which is exactly what `apps/desktop` will do when it opens one.
  mount(example);
});

themePicker.addEventListener('change', () => {
  handle?.setTheme(themePicker.value as ThemeName);
});

readOnlyToggle.addEventListener('change', () => {
  mount(currentExample(), handle?.getValue());
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
