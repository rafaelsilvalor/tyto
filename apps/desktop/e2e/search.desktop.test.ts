import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

import { translate } from '../shared/i18n/index.js';

/**
 * E8.5's acceptance criteria, through a real window.
 *
 * `packages/editor/src/search.test.ts` mounts the panel in jsdom and answers everything
 * about the phrases and the replace. What only a launched app can show is that **this
 * window's editor is the one that got them**: the desktop passes `keymapSetFor(false)` and
 * `searchPhrasesFor(state.locale)` into `createEditor`, and a card that wired either to the
 * wrong place would leave both suites green and `Ctrl+F` doing nothing.
 *
 * The locale half is the same argument. `search-phrases.test.ts` proves the catalogue
 * answers every key; only the window proves the answer reaches CodeMirror's DOM, because the
 * route runs through `applyLocale` in `main.ts` and a repaint this app does not own.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let app: ElectronApplication;
let page: Page;

const panelOpen = (): Promise<boolean> =>
  page.evaluate(() => document.querySelector('#editor .cm-search') !== null);

/** Every word the panel shows, including the two fields' placeholders. */
const panelWords = (): Promise<string> =>
  page.evaluate(() => {
    const panel = document.querySelector('#editor .cm-search');
    if (panel === null) return '';
    const fields = [...panel.querySelectorAll('input')].map(
      (input) => input.getAttribute('placeholder') ?? '',
    );
    return [panel.textContent ?? '', ...fields].join(' ');
  });

const setLocale = async (locale: 'en' | 'pt-BR'): Promise<void> => {
  await page.selectOption('#locale', locale);
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }

  app = await _electron.launch({
    args: ['.'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
});

describe('the find panel', () => {
  it('opens on Ctrl+F with the editor focused, and Escape closes it', async () => {
    await page.click('#editor .cm-content');
    expect(await panelOpen()).toBe(false);

    await page.keyboard.press('Control+f');
    await page.waitForSelector('#editor .cm-search');
    expect(await panelOpen()).toBe(true);

    // With the focus inside the field, which is the case a registry binding cannot cover:
    // `keymapExtension` carries CodeMirror's default `"editor"` scope and the panel's input
    // is not the editor, so `Escape` is left to the package's own panel-scoped keymap.
    await page.click('#editor .cm-search input[name="search"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#editor .cm-search') === null);
    expect(await panelOpen()).toBe(false);
  });

  it('speaks the window language, and changes with it', async () => {
    await setLocale('pt-BR');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+f');
    await page.waitForSelector('#editor .cm-search');

    expect(await panelWords()).toContain(translate('pt-BR', 'search.matchCase'));

    // The panel stays open across the switch on purpose: this is the path `applyLocale`
    // exists for, and a panel that had to be reopened would hide a failure to push.
    await setLocale('en');
    await page.waitForFunction(
      ([word]) => document.querySelector('#editor .cm-search')?.textContent?.includes(word!),
      [translate('en', 'search.matchCase')],
    );

    const words = await panelWords();
    expect(words).toContain(translate('en', 'search.matchCase'));
    expect(words).not.toContain(translate('pt-BR', 'search.matchCase'));

    await page.keyboard.press('Escape');
  });
});

describe('the command bar', () => {
  it('lists find, replace and go to line with the keystroke the editor is running', async () => {
    await setLocale('en');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+k');
    await page.waitForSelector('tyto-command-bar input');

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('tyto-command-bar li')].map(
        (row) => row.textContent?.replaceAll(/\s+/gu, ' ').trim() ?? '',
      ),
    );

    // Read off the bar rather than off the table it was built from, which would pass by
    // construction. The keystroke beside each one is `bindingsOf`'s answer for the set the
    // editor is actually running (`commands.ts`).
    // `Ctrl+f` and not `Ctrl+F`: `bindingsOf` swaps `Mod` for `Ctrl` and `-` for `+` and
    // leaves the key as the binding spells it, so the case here is the case in `keymap.ts`.
    const find = rows.find((row) => row.startsWith(translate('en', 'command.editor.find')));
    expect(find, rows.join(' | ')).toContain('Ctrl+f');

    for (const key of ['command.editor.replaceAll', 'command.editor.gotoLine'] as const) {
      expect(
        rows.some((row) => row.startsWith(translate('en', key))),
        key,
      ).toBe(true);
    }

    // Replace has no binding and the bar says so by showing none — the panel's two buttons
    // and this list are how it is reached. An invented keystroke would be worse than silence.
    const replaceAll = rows.find((row) =>
      row.startsWith(translate('en', 'command.editor.replaceAll')),
    );
    expect(replaceAll).not.toMatch(/Ctrl\+/u);

    await page.keyboard.press('Escape');
  });
});
