import { fileURLToPath } from 'node:url';

import { renderCliPage } from './cli-page.js';
import { renderCommandsPage } from './commands-page.js';
import type { Locale } from './markdown.js';
import { renderSettingsPage } from './settings-page.js';
import { renderShortcutsPage } from './shortcuts-page.js';
import { renderThemesPage } from './themes-page.js';

/** A generated page of the manual's Reference section, rendered once per edition. */
export interface ReferencePage {
  /** The file name under `reference/`, which is also the page's URL. */
  readonly slug: string;
  readonly render: (locale: Locale) => string;
}

export const REFERENCE_PAGES: readonly ReferencePage[] = [
  { slug: 'settings', render: renderSettingsPage },
  { slug: 'keyboard-shortcuts', render: renderShortcutsPage },
  { slug: 'commands', render: renderCommandsPage },
  { slug: 'command-line', render: renderCliPage },
  { slug: 'themes', render: renderThemesPage },
];

/** Where a page lives in the site: `pages/reference/` in English, under `pages/pt-BR/` else. */
export function referencePagePath(locale: Locale, slug: string): string {
  const edition = locale === 'en' ? '' : `${locale}/`;
  return fileURLToPath(
    new URL(`../../../../apps/docs/pages/${edition}reference/${slug}.md`, import.meta.url),
  );
}
