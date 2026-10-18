import { THEME_PACK_THEMES, THEME_PACK_VARIANTS, type ThemeVariant } from '@tyto/theme-pack';

import { translate } from '../../../../apps/desktop/shared/i18n/index.js';
import { DEFAULT_THEME_SETTING } from '../../../../apps/desktop/shared/theme-setting.js';
import tytoDark from '../../../../apps/desktop/src/main/themes/tyto-dark.json';
import tytoLight from '../../../../apps/desktop/src/main/themes/tyto-light.json';
import { type Locale, code, generatedHeader, page, prose, table } from './markdown.js';

export interface ShippedTheme {
  readonly id: string;
  readonly label: string;
  readonly kind: 'light' | 'dark';
  readonly variant?: ThemeVariant;
}

/**
 * The themes a fresh install offers: the `desktop` plugin's two, whose ids are the setting's
 * defaults, then `@tyto/theme-pack`'s in its own order. Imported as data, as main bundles them.
 */
export function shippedThemes(): readonly ShippedTheme[] {
  const builtIn: ShippedTheme[] = [
    { id: DEFAULT_THEME_SETTING.light, label: tytoLight.name, kind: 'light' },
    { id: DEFAULT_THEME_SETTING.dark, label: tytoDark.name, kind: 'dark' },
  ];
  const pack = THEME_PACK_THEMES.map((theme) => {
    const variant = THEME_PACK_VARIANTS[theme.id];
    return {
      id: theme.id,
      label: theme.label,
      kind: theme.kind,
      ...(variant === undefined ? {} : { variant }),
    };
  });
  return [...builtIn, ...pack];
}

const WORDS = {
  en: {
    title: 'Themes',
    intro: (count: number, pick: string) =>
      `The colour themes that come with the app: ${String(count)}. Pick one with **${pick}**, ` +
      'which previews each as you move through the list, or write its id in the `theme` ' +
      'setting — one id, or `{ "mode": "system", "light": <id>, "dark": <id> }` to follow the ' +
      'system. A theme that misses the contrast floors in its original colours ships twice: ' +
      'the original, exactly as its authors made it, and an adjusted one that meets them.',
    name: 'Name',
    id: 'Id',
    kind: 'Kind',
    variant: 'Variant',
    light: 'light',
    dark: 'dark',
    original: 'original colours',
    adjusted: 'adjusted for contrast',
    defaultLight: ' (default light)',
    defaultDark: ' (default dark)',
  },
  'pt-BR': {
    title: 'Temas',
    intro: (count: number, pick: string) =>
      `Os temas de cores que vêm com o app: ${String(count)}. Escolha um com **${pick}**, que ` +
      'mostra cada um enquanto você percorre a lista, ou escreva o id dele na configuração ' +
      '`theme` — um id, ou `{ "mode": "system", "light": <id>, "dark": <id> }` para seguir o ' +
      'sistema. Um tema cujas cores originais não atingem o contraste mínimo vem duas vezes: ' +
      'o original, exatamente como os autores o fizeram, e um ajustado, que atinge.',
    name: 'Nome',
    id: 'Id',
    kind: 'Tipo',
    variant: 'Variante',
    light: 'claro',
    dark: 'escuro',
    original: 'cores originais',
    adjusted: 'ajustado para contraste',
    defaultLight: ' (claro padrão)',
    defaultDark: ' (escuro padrão)',
  },
} as const;

export function renderThemesPage(locale: Locale): string {
  const words = WORDS[locale];
  const themes = shippedThemes();
  const defaultMark = (id: string): string =>
    id === DEFAULT_THEME_SETTING.light
      ? words.defaultLight
      : id === DEFAULT_THEME_SETTING.dark
        ? words.defaultDark
        : '';

  return page([
    generatedHeader('apps/desktop/src/main/themes and packages/theme-pack'),
    `# ${words.title}`,
    words.intro(themes.length, translate(locale, 'command.theme.pick')),
    table(
      [words.name, words.id, words.kind, words.variant],
      themes.map((theme) => [
        prose(`${theme.label}${defaultMark(theme.id)}`),
        code(theme.id),
        words[theme.kind],
        theme.variant === undefined ? '' : words[theme.variant],
      ]),
    ),
  ]);
}
