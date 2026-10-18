import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SCREENSHOT_THEMES,
  screenshotPath,
  screenshotScenes,
  screenshotLocale,
} from '../src/screenshots';
import { PT_BR } from '../src/sections';

const PAGES = fileURLToPath(new URL('../pages/', import.meta.url));
const PUBLIC = `${PAGES}public`;

/** Every Markdown page, as a forward-slash path under `pages/`, with its edition's `lang`. */
const pages = readdirSync(PAGES, { recursive: true, encoding: 'utf8' })
  .map((path) => path.replaceAll('\\', '/'))
  .filter((path) => path.endsWith('.md'))
  .map((path) => ({ path, lang: path.startsWith(`${PT_BR}/`) ? PT_BR : 'en' }));

describe('screenshot paths', () => {
  it('a pt-BR page reads the pt-BR folder and every other page the English one', () => {
    expect(screenshotLocale(PT_BR)).toBe(PT_BR);
    expect(screenshotLocale('en')).toBe('en');
    expect(screenshotLocale('en-US')).toBe('en');
    expect(screenshotPath(PT_BR, 'window-tour', 'tyto-dark')).toBe(
      '/screenshots/pt-BR/window-tour-tyto-dark.png',
    );
  });

  it('finds every scene a page names, and only in <Screenshot> tags', () => {
    const markdown = [
      '<Screenshot scene="window-tour" alt="The window" :markers="[{ n: 1, x: 2, y: 3 }]" />',
      'The scene="not-a-tag" in prose is not a picture.',
      '<Screenshot alt="Open" scene="command-bar-open" />',
    ].join('\n');
    expect(screenshotScenes(markdown)).toEqual(['window-tour', 'command-bar-open']);
  });
});

/**
 * A scene a page names but the script never took is a broken image in one theme or one
 * language, which nobody notices until they switch to it. The pictures are not built by the
 * site, so this is the only place the two are compared.
 */
describe('every picture a page shows exists, in both themes', () => {
  const uses = pages.flatMap(({ path, lang }) =>
    screenshotScenes(readFileSync(`${PAGES}${path}`, 'utf8')).map((scene) => ({
      path,
      lang,
      scene,
    })),
  );

  it('the pages use at least the tour picture in each edition', () => {
    expect(uses).toContainEqual({
      path: 'get-started/window-tour.md',
      lang: 'en',
      scene: 'window-tour',
    });
    expect(uses).toContainEqual({
      path: `${PT_BR}/get-started/window-tour.md`,
      lang: PT_BR,
      scene: 'window-tour',
    });
  });

  it.each(uses)('$path: $scene', ({ lang, scene }) => {
    for (const theme of SCREENSHOT_THEMES) {
      const file = `${PUBLIC}${screenshotPath(lang, scene, theme)}`;
      expect(existsSync(file), file).toBe(true);
    }
  });
});
