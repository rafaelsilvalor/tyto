import { defineConfig, type DefaultTheme } from 'vitepress';

import { PT_BR, SECTIONS } from '../src/sections';
import { DESKTOP_VERSION } from '../src/version';

type Locale = 'en' | typeof PT_BR;

const prefix = (locale: Locale): string => (locale === 'en' ? '/' : `/${PT_BR}/`);

const sidebar = (locale: Locale): DefaultTheme.SidebarItem[] =>
  SECTIONS.map((section) => ({
    text: section.title[locale],
    link: `${prefix(locale)}${section.slug}/`,
  }));

/** The header's version item. A link because VitePress draws a nav item, not free text. */
const versionItem = (locale: Locale): DefaultTheme.NavItem => ({
  text: `v${DESKTOP_VERSION}`,
  link: `${prefix(locale)}release-notes/`,
});

export default defineConfig({
  title: 'Tyto',
  srcDir: 'pages',
  // `dist/` is the build output turbo.json declares for every package, so the site is
  // cached and restored like the rest of the workspace.
  outDir: 'dist',
  // Under `node_modules` so ESLint, Prettier and git already ignore it, with no line in
  // any root config naming this package.
  cacheDir: 'node_modules/.cache/vitepress',
  cleanUrls: true,
  lastUpdated: false,
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      description: 'The Tyto user manual.',
      themeConfig: { nav: [versionItem('en')], sidebar: sidebar('en') },
    },
    [PT_BR]: {
      label: 'Português (Brasil)',
      lang: PT_BR,
      link: `/${PT_BR}/`,
      description: 'O manual do Tyto.',
      themeConfig: {
        nav: [versionItem(PT_BR)],
        sidebar: sidebar(PT_BR),
        outline: { label: 'Nesta página' },
        docFooter: { prev: 'Anterior', next: 'Próxima' },
        langMenuLabel: 'Idioma',
        returnToTopLabel: 'Voltar ao topo',
        sidebarMenuLabel: 'Menu',
        darkModeSwitchLabel: 'Aparência',
      },
    },
  },
  themeConfig: {
    search: {
      provider: 'local',
      options: {
        locales: {
          [PT_BR]: {
            translations: {
              button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
              modal: {
                noResultsText: 'Nenhum resultado para',
                resetButtonTitle: 'Limpar a busca',
                footer: {
                  selectText: 'abrir',
                  navigateText: 'navegar',
                  closeText: 'fechar',
                },
              },
            },
          },
        },
      },
    },
  },
});
