import { type SettingOption, declaredSetting, outlineOf } from '@tyto/plugin-api';

import { settingContributions } from '../../../../apps/desktop/shared/settings.js';
import { translate } from '../../../../apps/desktop/shared/i18n/index.js';
import desktopManifest from '../../../../apps/desktop/src/main/desktop.tyto-plugin.json';
import { type Locale, code, generatedHeader, page, prose, table } from './markdown.js';

/**
 * The app's own settings, as the settings tab outlines them (`outlineOf`, ADR 0092): the same
 * declarations `settings-store.ts` registers for the built-in `desktop` plugin, so a key added
 * there is a section here once the page is regenerated.
 */
export function builtInSettingOutlines() {
  return outlineOf(
    settingContributions().map((contribution) =>
      declaredSetting(desktopManifest.name, false, contribution),
    ),
  );
}

const WORDS = {
  en: {
    title: 'Settings',
    intro: (count: number, open: string) =>
      `Every key the app declares in \`settings.json\`: ${String(count)}. Open the file with ` +
      `**${open}**; a key you leave out keeps its default, and a value the app cannot read ` +
      'is reported in the Problems panel and the default applies. A plugin adds its own keys as ' +
      '`<plugin id>.<key>`, which are not listed here.',
    note: '',
    type: 'Type',
    default: 'Default',
    values: 'Values',
    entries: 'Values of each entry',
    members: 'Names of each member',
    value: 'Value',
    meaning: 'Meaning',
  },
  'pt-BR': {
    title: 'Configurações',
    intro: (count: number, open: string) =>
      `Todas as chaves que o app declara no \`settings.json\`: ${String(count)}. Abra o arquivo ` +
      `com **${open}**; uma chave que você não escreve fica com o valor padrão, e um valor que o ` +
      'app não consegue ler aparece no painel Problemas e o padrão vale no lugar dele. Um plugin ' +
      'acrescenta as próprias chaves como `<id do plugin>.<chave>`, que não aparecem aqui.',
    note:
      '::: info Descrições em inglês\nAs descrições abaixo estão em inglês: o código guarda ' +
      'cada uma em um só idioma, e esta página as mostra como estão em vez de traduzi-las à ' +
      'parte.\n:::',
    type: 'Tipo',
    default: 'Padrão',
    values: 'Valores',
    entries: 'Valores de cada item',
    members: 'Nomes de cada membro',
    value: 'Valor',
    meaning: 'Significado',
  },
} as const;

const optionValue = (option: SettingOption): string => code(JSON.stringify(option.value));

function optionsTable(
  heading: string,
  options: readonly SettingOption[] | undefined,
  words: (typeof WORDS)[Locale],
): string {
  // A boolean's two values come out of its schema with no sentence; a table of `true` and
  // `false` beside empty cells would say nothing the type does not.
  if (options === undefined || options.every((option) => option.description === '')) return '';
  return `**${heading}**\n\n${table(
    [words.value, words.meaning],
    options.map((option) => [optionValue(option), prose(option.description)]),
  )}`;
}

export function renderSettingsPage(locale: Locale): string {
  const words = WORDS[locale];
  const outlines = builtInSettingOutlines();
  const sections = outlines.map((setting) =>
    [
      `## ${setting.key}`,
      prose(setting.description),
      table([words.type, words.default], [[code(setting.type), code(setting.default)]]),
      optionsTable(words.values, setting.options, words),
      optionsTable(words.entries, setting.entries?.options, words),
      optionsTable(words.members, setting.members?.options, words),
    ]
      .filter((block) => block !== '')
      .join('\n\n'),
  );

  return page([
    generatedHeader('apps/desktop/shared/settings.ts'),
    `# ${words.title}`,
    words.intro(outlines.length, translate(locale, 'command.settings.open')),
    words.note,
    ...sections,
  ]);
}
