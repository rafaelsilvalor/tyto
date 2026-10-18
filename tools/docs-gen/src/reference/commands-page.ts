import { COMMAND_BAR_TOGGLE } from '@tyto/editor';

import { type Locale, code, generatedHeader, page, prose, table } from './markdown.js';
import {
  answeredKeybindings,
  commandTitle,
  keyLabel,
  windowCommandIds,
} from './window-commands.js';

const WORDS = {
  en: {
    title: 'Commands',
    intro: (count: number, bar: string) =>
      `Everything the window can be told to do, by title as the command bar shows it: ` +
      `${String(count)}. Open the bar with **${bar}** and type part of a title. The id is what ` +
      '`keybindings.json` names to put a command on a key.',
    later:
      'The window adds more while it runs, which this list cannot show: a toggle for each ' +
      "panel, including a plugin's, and an entry for each recently opened file.",
    title_: 'Title',
    id: 'Id',
    windows: 'Default key (Windows and Linux)',
    mac: 'Default key (macOS)',
  },
  'pt-BR': {
    title: 'Comandos',
    intro: (count: number, bar: string) =>
      `Tudo o que a janela sabe fazer, pelo título que a barra de comandos mostra: ` +
      `${String(count)}. Abra a barra com **${bar}** e digite parte de um título. O id é o ` +
      'que o `keybindings.json` usa para pôr um comando numa tecla.',
    later:
      'A janela acrescenta outros enquanto roda, que esta lista não tem como mostrar: um para ' +
      'abrir e fechar cada painel, inclusive os de plugins, e um para cada arquivo aberto ' +
      'recentemente.',
    title_: 'Título',
    id: 'Id',
    windows: 'Tecla padrão (Windows e Linux)',
    mac: 'Tecla padrão (macOS)',
  },
} as const;

/**
 * A command's default keys, all of them: redo has three, and a reader looking for one does not
 * know which the bar happens to print. Duplicates across contexts collapse, since `Mod-s` is in
 * both input modes and is one key to a person.
 */
function keysOf(id: string): { windows: string; mac: string } {
  const bindings = answeredKeybindings().filter((binding) => binding.command === id);
  const unique = (labels: string[]): string =>
    [...new Set(labels)].map((label) => code(label)).join(', ');
  return {
    windows: unique(bindings.map((binding) => keyLabel(binding, 'win32'))),
    mac: unique(bindings.map((binding) => keyLabel(binding, 'darwin'))),
  };
}

export function renderCommandsPage(locale: Locale): string {
  const words = WORDS[locale];
  const ids = windowCommandIds();
  const bar = keysOf(COMMAND_BAR_TOGGLE);

  return page([
    generatedHeader('apps/desktop/src/renderer/commands.ts'),
    `# ${words.title}`,
    words.intro(ids.length, `${bar.windows} / ${bar.mac}`),
    words.later,
    table(
      [words.title_, words.id, words.windows, words.mac],
      ids.map((id) => {
        const keys = keysOf(id);
        return [prose(commandTitle(id, locale)), code(id), keys.windows, keys.mac];
      }),
    ),
  ]);
}
