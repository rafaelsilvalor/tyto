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
  // Each word appears in one stub page only, so a hit proves the stub was indexed and
  // the hit points at it, in each edition's own index.
  it.each([
    { locale: 'root', word: 'freezes', page: '/troubleshooting/' },
    { locale: 'pt-BR', word: 'trava', page: '/pt-BR/troubleshooting/' },
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
