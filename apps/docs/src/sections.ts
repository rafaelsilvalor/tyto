/**
 * The manual's page tree, in reading order. One list feeds both locales' sidebars, so a
 * section cannot exist in one edition's navigation and not the other's; the parity test
 * then holds the pages themselves to the same rule (ADR 0101).
 */
export interface Section {
  /** The folder under `pages/` and under `pages/pt-BR/`. */
  readonly slug: string;
  readonly title: { readonly en: string; readonly 'pt-BR': string };
}

export const SECTIONS: readonly Section[] = [
  { slug: 'get-started', title: { en: 'Get started', 'pt-BR': 'Primeiros passos' } },
  { slug: 'briefs', title: { en: 'Briefs', 'pt-BR': 'Briefs' } },
  { slug: 'templates', title: { en: 'Templates', 'pt-BR': 'Templates' } },
  { slug: 'editor', title: { en: 'The editor', 'pt-BR': 'O editor' } },
  { slug: 'export', title: { en: 'Export', 'pt-BR': 'Exportar' } },
  { slug: 'command-line', title: { en: 'Command line', 'pt-BR': 'Linha de comando' } },
  { slug: 'customize', title: { en: 'Customize', 'pt-BR': 'Personalizar' } },
  { slug: 'reference', title: { en: 'Reference', 'pt-BR': 'Referência' } },
  { slug: 'extend', title: { en: 'Extend', 'pt-BR': 'Estender' } },
  {
    slug: 'troubleshooting',
    title: { en: 'Troubleshooting', 'pt-BR': 'Solução de problemas' },
  },
  { slug: 'release-notes', title: { en: 'Release notes', 'pt-BR': 'Notas de versão' } },
];

/**
 * Pages that exist only in English, as paths under `pages/`. These are the author guides
 * kept in the repository's `docs/` folder and pulled in by `<!--@include:-->`: they are
 * written for people who write code, the audience the English-only rule is for, and a
 * translation would be a second copy to keep in step with every change to the first. The
 * pt-BR Extend page says so and links to them.
 */
export const ENGLISH_ONLY_PAGES: readonly string[] = [
  'extend/template-authoring.md',
  'extend/plugin-authoring.md',
  'extend/plugin-api.md',
];

export const PT_BR = 'pt-BR';
