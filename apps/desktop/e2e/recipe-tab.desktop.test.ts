import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * A `.recipe` in a tab of its own, in the real window (TYTO-377, ADR 0132's dated note): File ▸
 * Open opens it as a recipe, in the recipe colours, with the verbs offered at the start of a
 * line; a pause in typing runs it in main, and each cell gets its line under it and its problem a
 * row in Problems; a quit and a second launch bring the tab back as a recipe, run again.
 *
 * There is no source plugin here, so no cell answers a table: the first step is a `where` with
 * nothing to read, which fails, and the one after it is skipped. That is the whole of what this
 * proves — that the lines are drawn under the right cells in the real layout, which jsdom cannot
 * show. A table under every cell, against a fixture source, is the notebook's acceptance suite.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, and a folder of its own; no workspace folder, so the
 * recipe runs as one outside any workspace does (ADR 0148 decision 5). `--lang=en`. With
 * `TYTO_RECIPE_TAB_SHOTS` set to a folder it leaves a picture of the window. Two launches of one
 * data folder.
 */

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env['TYTO_RECIPE_TAB_SHOTS'];

let scratch: string;
let recipePath: string;
let app: ElectronApplication | undefined;
let window: Page;

const RECIPE = ['recipe weekly', 'where status = done', 'select key', ''].join('\n');

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

const tabNames = (): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

const kindText = (): Promise<string> =>
  window.evaluate(
    () => document.querySelector('tyto-status-bar .status-bar__kind')?.textContent?.trim() ?? '',
  );

/** Each cell's line, with the text of the recipe line drawn just above it. */
const cellLines = (): Promise<{ above: string; text: string }[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('#editor .recipe-cell-status')].map((line) => ({
      above: line.previousElementSibling?.textContent ?? '',
      text: line.textContent ?? '',
    })),
  );

const problemCodes = (): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.problems__code')].map((node) => node.textContent ?? ''),
  );

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-tab-e2e-'));
  const work = join(scratch, 'recipes');
  mkdirSync(work, { recursive: true });
  recipePath = join(work, 'weekly.recipe');
  writeFileSync(recipePath, RECIPE);
  await launch();
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a recipe in a tab (TYTO-377)', () => {
  it('opens a .recipe from File > Open as a recipe, in its colours', async () => {
    await app?.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, recipePath);
    // The window refuses an open until it has read the last session, so it is asked again.
    await expect
      .poll(
        async () => {
          await run('editor.open');
          return tabNames();
        },
        { timeout: 15_000 },
      )
      .toContain('weekly.recipe');
    await expect.poll(kindText, { timeout: 10_000 }).toBe('Recipe');

    // The header keyword is coloured apart from the text around it.
    const colours = await window.evaluate(() => {
      const content = document.querySelector('#editor .cm-content');
      const keyword = [...(content?.querySelectorAll('.cm-line span') ?? [])].find(
        (span) => span.textContent === 'recipe',
      );
      return {
        keyword: keyword === undefined ? '' : getComputedStyle(keyword).color,
        text: content === null ? '' : getComputedStyle(content).color,
      };
    });
    expect(colours.keyword).not.toBe('');
    expect(colours.keyword).not.toBe(colours.text);
  }, 120_000);

  it('draws a line under each cell and a Problems row, after a pause', async () => {
    await expect.poll(cellLines, { timeout: 15_000 }).toEqual([
      { above: 'where status = done', text: 'Failed: see Problems' },
      { above: 'select key', text: 'Skipped: a cell above failed' },
    ]);
    await expect.poll(problemCodes, { timeout: 10_000 }).not.toEqual([]);
    expect((await problemCodes()).every((code) => code.startsWith('E_RECIPE'))).toBe(true);

    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await window.screenshot({ path: join(shots, 'recipe-tab.png') });
    }
  }, 60_000);

  it('offers the verbs at the start of a line', async () => {
    await window.click('#editor .cm-content');
    await window.keyboard.press('Control+End');
    await window.keyboard.type('sor');
    await window.waitForSelector('.cm-tooltip-autocomplete', { timeout: 10_000 });
    const offered = await window.evaluate(() =>
      [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(
        (item) => item.textContent ?? '',
      ),
    );
    expect(offered.some((label) => label.startsWith('sort'))).toBe(true);
    await window.keyboard.press('Escape');
    // The line typed is a cell too: after the pause it is skipped like the one above it.
    await expect
      .poll(async () => (await cellLines()).map((line) => line.above), { timeout: 15_000 })
      .toEqual(['where status = done', 'select key', 'sor']);
  }, 60_000);

  it('brings the tab back as a recipe after a quit and a second launch, and runs it', async () => {
    await window.keyboard.press('Control+s');
    await window.waitForTimeout(1_500);
    await quit();

    await launch();
    await expect.poll(tabNames, { timeout: 30_000 }).toContain('weekly.recipe');
    await window.locator('.tabs__tab', { hasText: 'weekly.recipe' }).first().click();
    await expect.poll(kindText, { timeout: 10_000 }).toBe('Recipe');
    await expect
      .poll(async () => (await cellLines()).map((line) => line.text), { timeout: 15_000 })
      .toEqual([
        'Failed: see Problems',
        'Skipped: a cell above failed',
        'Skipped: a cell above failed',
      ]);
  }, 180_000);
});
