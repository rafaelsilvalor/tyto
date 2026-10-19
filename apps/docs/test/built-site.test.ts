import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import MiniSearch from 'minisearch';
import { describe, expect, it } from 'vitest';

/**
 * These suites read `dist/`, which `turbo.json` guarantees is this package's own build of
 * the current sources: `test` depends on `build`. Run outside turbo, they read whatever
 * the last `pnpm build` left.
 */
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const CHUNKS = `${DIST}assets/chunks/`;

/** The serialized MiniSearch index VitePress writes for one locale (`root` is English). */
const loadIndex = async (locale: 'root' | 'pt-BR'): Promise<MiniSearch> => {
  const prefix = `@localSearchIndex${locale}.`;
  const file = readdirSync(CHUNKS).find((name) => name.startsWith(prefix));
  if (file === undefined) throw new Error(`no ${prefix}*.js under ${CHUNKS}; was the site built?`);
  const module = (await import(pathToFileURL(`${CHUNKS}${file}`).href)) as { default: string };
  // The same fields and stored fields VitePress's local search builds the index with.
  return MiniSearch.loadJSON(module.default, {
    fields: ['title', 'titles', 'text'],
    storeFields: ['title', 'titles'],
  });
};

describe('local search', () => {
  // Each word appears in one page only, so a hit proves the page was indexed and the hit
  // points at it, in each edition's own index. The troubleshooting pages were stubs when this
  // was written; TYTO-317 wrote them, and the words moved to their "report a problem" section.
  it.each([
    { locale: 'root', word: 'issue', page: '/troubleshooting/' },
    { locale: 'pt-BR', word: 'relatar', page: '/pt-BR/troubleshooting/' },
  ] as const)(
    'finds "$word" in the $locale index, on $page only',
    async ({ locale, word, page }) => {
      const results = (await loadIndex(locale)).search(word);
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) expect(String(result.id)).toMatch(new RegExp(`^${page}`));
    },
  );
});

describe('the header version', () => {
  const desktop = JSON.parse(
    readFileSync(new URL('../../desktop/package.json', import.meta.url), 'utf8'),
  ) as { version: string };

  it.each(['index.html', 'pt-BR/index.html'])('%s shows the desktop app version', (page) => {
    expect(readFileSync(`${DIST}${page}`, 'utf8')).toContain(`v${desktop.version}`);
  });
});

describe('the tour picture', () => {
  // Server-rendered: the page carries both themes' pictures before any script runs, and
  // CSS on `html.dark` picks one. A page with only one would show a broken or wrong-theme
  // window to half its readers.
  it.each([
    { page: 'get-started/window-tour.html', locale: 'en' },
    { page: 'pt-BR/get-started/window-tour.html', locale: 'pt-BR' },
  ])('$page carries the light and the dark $locale picture', ({ page, locale }) => {
    const html = readFileSync(`${DIST}${page}`, 'utf8');
    expect(html).toContain(`src="/screenshots/${locale}/window-tour-tyto-light.png"`);
    expect(html).toContain(`src="/screenshots/${locale}/window-tour-tyto-dark.png"`);
  });
});
