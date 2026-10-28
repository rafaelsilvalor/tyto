import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * A `.md` and a `.txt` in a tab of their own, in the real window (TYTO-247, ADR 0132): a click in
 * the explorer opens the file as text, asks main for no `brief:preview` and offers no export; the
 * status bar names the kind and the problems panel says nothing checks it; an edit saved lands in
 * the file; a quit and a second launch bring the tab back as Markdown; and File ▸ Open and Save As
 * show the filters main builds.
 *
 * `brief:preview` is counted in main, by wrapping the handler Electron keeps for the channel: the
 * window cannot be watched from inside, because the bridge it calls is frozen by the context
 * bridge. The native dialogs cannot be clicked, so they are replaced from main, as every suite
 * that opens a file does, and the replacement records what it was asked.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, and a folder of its own. `--lang=en`, so the
 * filters main names are in one language. With `TYTO_TEXT_TABS_SHOTS` set to a folder it leaves
 * pictures of the window in both themes. Two launches of one data folder.
 */

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env['TYTO_TEXT_TABS_SHOTS'];

let scratch: string;
let work: string;
let notes: string;
let app: ElectronApplication | undefined;
let window: Page;

const NOTES = '# Notas\n\nUma linha.\n';

const launch = async (): Promise<void> => {
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
};

const quit = async (): Promise<void> => {
  const running = app;
  if (running === undefined) return;
  const gone = running.waitForEvent('close');
  await running.evaluate(({ app: electronApp }) => {
    electronApp.quit();
  });
  await gone;
  app = undefined;
};

/** Runs a command through the command bar's own door; `false` when the gate refused it. */
const run = (commandId: string): Promise<boolean> =>
  window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);

const row = (name: string) => window.locator(`.explorer__row[data-name="${name}"]`);

const tabNames = (): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

const kindText = (): Promise<string> =>
  window.evaluate(
    () => document.querySelector('tyto-status-bar .status-bar__kind')?.textContent?.trim() ?? '',
  );

const problemsText = (): Promise<string> =>
  window.evaluate(() => document.querySelector('.problems__empty')?.textContent ?? '');

/** Every `brief:preview` main answers from now on is counted in `globalThis.briefPreviews`. */
async function countBriefPreviews(): Promise<void> {
  await app?.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })
      ._invokeHandlers;
    const original = handlers.get('brief:preview') as (...args: unknown[]) => unknown;
    const counter = globalThis as unknown as { briefPreviews: number };
    counter.briefPreviews = 0;
    handlers.set('brief:preview', (...args: unknown[]) => {
      counter.briefPreviews += 1;
      return original(...args);
    });
  });
}

const briefPreviews = async (): Promise<number> =>
  (await app?.evaluate(() => (globalThis as unknown as { briefPreviews: number }).briefPreviews)) ??
  -1;

/** Screenshots in both schemes, when asked for; the window is left light. */
async function shoot(name: string): Promise<void> {
  if (shots === undefined || app === undefined) return;
  mkdirSync(shots, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await app.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source;
    }, scheme);
    // scheme: the screenshot in each theme Rafael approves by looking; main is told too.
    await window.emulateMedia({ colorScheme: scheme });
    await window.waitForTimeout(300);
    await window.screenshot({ path: join(shots, `${name}-${scheme}.png`) });
  }
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'system';
  });
  await window.emulateMedia({ colorScheme: null });
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-text-tabs-e2e-'));
  work = join(scratch, 'promo');
  mkdirSync(work, { recursive: true });
  notes = join(work, 'notas.md');
  writeFileSync(notes, NOTES);
  writeFileSync(join(work, 'leia.txt'), 'Leia antes.\n');
  writeFileSync(join(work, 'capa.brief'), '---\ntemplate: promo-curso\n---\n::titulo Capa\n');

  await launch();
  await app?.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, work);
  if (!(await run('workspace.openFolder'))) throw new Error('workspace.openFolder was refused');
  await row('notas.md').waitFor({ timeout: 15_000 });
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a text file in a tab (TYTO-247)', () => {
  it('opens a .md from the explorer as Markdown, with no brief:preview and no export', async () => {
    await countBriefPreviews();
    // The window refuses an open until it has read the last session, so the click is repeated.
    await expect
      .poll(
        async () => {
          await row('notas.md').click();
          return tabNames();
        },
        { timeout: 15_000 },
      )
      .toContain('notas.md');
    await window.waitForFunction(() =>
      document.querySelector('#editor .cm-content')?.textContent?.includes('Uma linha.'),
    );

    expect(await kindText()).toBe('Markdown');
    expect(await problemsText()).toBe('Text files are not checked.');
    // "Open preview to the side" beside a .md (TYTO-247's second pull request), which opens none
    // by itself; `markdown-preview.desktop.test.ts` reads what it shows.
    expect(await window.locator('[data-action="preview.openToSide"]').count()).toBe(1);
    expect(await window.locator('[data-tab-kind="preview"]').count()).toBe(0);
    // Export and the presets are brief commands, refused by the same gate as on an app file.
    expect(await run('file.export')).toBe(false);
    expect(await window.locator('tyto-export-dialog[open], .export-dialog[open]').count()).toBe(0);

    // Typed into, and the pause the brief compiles on passed twice: still nothing asked.
    await window.click('#editor .cm-content');
    await window.keyboard.press('Control+End');
    await window.keyboard.type('Outra linha.');
    await window.waitForTimeout(1_500);
    expect(await briefPreviews()).toBe(0);
    await shoot('text-tab-markdown');
  }, 120_000);

  it('saves the edit into the file', async () => {
    await window.keyboard.press('Control+s');
    await expect
      .poll(() => readFileSync(notes, 'utf8'), { timeout: 10_000 })
      .toBe(`${NOTES}Outra linha.`);
    expect(await briefPreviews()).toBe(0);
  }, 60_000);

  it('names a .txt Plain text, opened from the explorer', async () => {
    await row('leia.txt').click();
    await expect.poll(tabNames, { timeout: 10_000 }).toContain('leia.txt');
    await expect.poll(kindText).toBe('Plain text');
    expect(await problemsText()).toBe('Text files are not checked.');
    expect(await briefPreviews()).toBe(0);
    expect(await window.locator('[data-action="preview.openToSide"]').count()).toBe(0);
    await shoot('text-tab-plain');
  }, 60_000);

  it('offers briefs, text files and all supported files in File > Open, in that order', async () => {
    await app?.evaluate(({ dialog }) => {
      const asked = globalThis as unknown as { openAsked: unknown };
      dialog.showOpenDialog = ((options: unknown) => {
        asked.openAsked = options;
        return Promise.resolve({ canceled: true, filePaths: [] });
      }) as never;
    });
    expect(await run('editor.open')).toBe(true);
    await expect
      .poll(
        async () =>
          (
            await app?.evaluate(
              () => (globalThis as unknown as { openAsked?: { filters?: unknown } }).openAsked,
            )
          )?.filters,
      )
      .toEqual([
        { name: 'Brief', extensions: ['brief'] },
        { name: 'Text files', extensions: ['txt', 'md'] },
        { name: 'Recipe', extensions: ['recipe'] },
        { name: 'All supported files', extensions: ['brief', 'txt', 'md', 'recipe'] },
      ]);
  }, 60_000);

  it('offers a text tab its own extension in Save As', async () => {
    await app?.evaluate(({ dialog }) => {
      const asked = globalThis as unknown as { saveAsked: unknown };
      dialog.showSaveDialog = ((options: unknown) => {
        asked.saveAsked = options;
        return Promise.resolve({ canceled: true });
      }) as never;
    });
    expect(await run('editor.saveAs')).toBe(true);
    await expect
      .poll(
        async () =>
          (
            await app?.evaluate(
              () => (globalThis as unknown as { saveAsked?: { filters?: unknown } }).saveAsked,
            )
          )?.filters,
      )
      .toEqual([{ name: 'Text files', extensions: ['txt', 'md'] }]);
  }, 60_000);

  it('brings the .md tab back as Markdown after a quit and a second launch', async () => {
    await row('notas.md').click();
    await expect.poll(kindText).toBe('Markdown');
    await window.waitForTimeout(1_500);
    await quit();

    await launch();
    await expect.poll(tabNames, { timeout: 30_000 }).toContain('notas.md');
    await window.locator('.tabs__tab', { hasText: 'notas.md' }).first().click();
    await expect.poll(kindText, { timeout: 10_000 }).toBe('Markdown');
    expect(await problemsText()).toBe('Text files are not checked.');
    await window.waitForFunction(() =>
      document.querySelector('#editor .cm-content')?.textContent?.includes('Outra linha.'),
    );
  }, 180_000);
});
