import {
  KEYBINDING_CONTEXTS,
  KEYBINDING_CONTEXT_DESCRIPTIONS,
  type Keybinding,
} from '@tyto/editor';

import { translate } from '../../../../apps/desktop/shared/i18n/index.js';
import { type Locale, code, generatedHeader, page, prose, table } from './markdown.js';
import { answeredKeybindings, commandTitle, keyLabel } from './window-commands.js';

const WORDS = {
  en: {
    title: 'Keyboard shortcuts',
    intro: (count: number, open: string) =>
      `The keys the app binds before you change anything: ${String(count)}. Each one runs a ` +
      'command, and works only where its context holds. Change them in `keybindings.json`, ' +
      `which **${open}** opens; a plugin can add its own.`,
    note: '',
    contexts: 'Contexts',
    context: 'Context',
    means: 'When it holds',
    global: 'Everywhere',
    globalMeans: 'A key with no context works wherever focus is.',
    windows: 'Windows and Linux',
    mac: 'macOS',
    command: 'Command',
    id: 'Id',
  },
  'pt-BR': {
    title: 'Atalhos de teclado',
    intro: (count: number, open: string) =>
      `As teclas que o app liga antes de você mudar qualquer coisa: ${String(count)}. Cada uma ` +
      'roda um comando, e só funciona onde o contexto dela vale. Mude-as no ' +
      `\`keybindings.json\`, que **${open}** abre; um plugin pode acrescentar as dele.`,
    note:
      '::: info Contextos em inglês\nA explicação de cada contexto está em inglês: o código ' +
      'guarda essas frases em um só idioma, e esta página as mostra como estão.\n:::',
    contexts: 'Contextos',
    context: 'Contexto',
    means: 'Quando vale',
    global: 'Em qualquer lugar',
    globalMeans: 'Uma tecla sem contexto funciona onde quer que esteja o foco.',
    windows: 'Windows e Linux',
    mac: 'macOS',
    command: 'Comando',
    id: 'Id',
  },
} as const;

function bindingRows(bindings: readonly Keybinding[], locale: Locale): string[][] {
  return bindings.map((binding) => [
    code(keyLabel(binding, 'win32')),
    code(keyLabel(binding, 'darwin')),
    prose(commandTitle(binding.command, locale)),
    code(binding.command),
  ]);
}

export function renderShortcutsPage(locale: Locale): string {
  const words = WORDS[locale];
  const bindings = answeredKeybindings();
  const header = [words.windows, words.mac, words.command, words.id];

  const global = bindings.filter((binding) => binding.when === undefined);
  const sections = [
    global.length === 0
      ? ''
      : `## ${words.global}\n\n${words.globalMeans}\n\n${table(header, bindingRows(global, locale))}`,
    ...KEYBINDING_CONTEXTS.map((context) => {
      const inContext = bindings.filter((binding) => binding.when === context);
      if (inContext.length === 0) return '';
      return [
        `## ${context}`,
        prose(KEYBINDING_CONTEXT_DESCRIPTIONS[context]),
        table(header, bindingRows(inContext, locale)),
      ].join('\n\n');
    }),
  ];

  return page([
    generatedHeader('apps/desktop/src/renderer/commands.ts and packages/editor/src/keymap.ts'),
    `# ${words.title}`,
    words.intro(bindings.length, translate(locale, 'command.keybindings.open')),
    words.note,
    `## ${words.contexts}`,
    table(
      [words.context, words.means],
      KEYBINDING_CONTEXTS.map((context) => [
        code(context),
        prose(KEYBINDING_CONTEXT_DESCRIPTIONS[context]),
      ]),
    ),
    ...sections,
  ]);
}
