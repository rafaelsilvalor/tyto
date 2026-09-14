import lista from '../../templates/templates/carrossel-lista/examples/lista.brief?raw';
import promo from '../../templates/templates/promo-curso/examples/promo.brief?raw';

import { createEditor, type EditorHandle, type ThemeName } from '../src/index.js';

/**
 * The demo E8.1 is accepted against: the two example briefs the built-in templates ship,
 * opened in a real editor, with the language, the folding and both themes live.
 *
 * It is also the smallest possible host, and that is deliberate — it imports `createEditor`
 * and nothing else from CodeMirror, so anything it cannot do here, `apps/desktop` will not
 * be able to do either. `pnpm --filter @tyto/editor demo`.
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
  status.textContent = `${lines} lines · ${edits} edits`;
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
  });
  handle.onChange(() => {
    edits += 1;
    report();
  });
  report();
};

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
