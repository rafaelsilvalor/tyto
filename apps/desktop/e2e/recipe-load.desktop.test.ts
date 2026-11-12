import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { switchingFolder } from './folder-switch.js';

/**
 * Load recipe in the real window (TYTO-402, ADR 0176 decision 7). A colleague's folder outside
 * the workspace holds a recipe that `run`s another, reads a vocabulary and a data file, and
 * names `../secret.json` beside that folder. Load recipe, with main's dialog stubbed to answer
 * that recipe, copies the three files it may and the recipe, reports the `../` one without
 * reading it, and opens the copy; the same load again copies nothing and names what is there.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, one launch, `--lang=en`. The report is lines above
 * the explorer's tree; with `TYTO_RECIPE_LOAD_SHOTS` set to a folder the suite leaves a picture
 * of it and the control, the same panel at the same wait with the report put away.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}

const WEEKLY = [
  'recipe weekly',
  'run cleanup',
  'rules into=kind using=@./company.vocab.json#/rules/kinds',
  'compose label=@./labels.json#/label',
  'compose secret=@../secret.json#/x',
  '',
].join('\n');

/** A folder for two pictures of the explorer, the report and its control, when set. */
const shots = process.env['TYTO_RECIPE_LOAD_SHOTS'];

let scratch: string;
let work: string;
let shared: string;
let app: ElectronApplication | undefined;
let page: Page;

/** Runs a command through the command bar's own door; `false` when the gate refused it. */
const command = (commandId: string): Promise<boolean> =>
  page.evaluate(
    (id) =>
      (
        document.querySelector('tyto-command-bar') as { run?: (id: string) => boolean } | null
      )?.run?.(id) ?? false,
    commandId,
  );

const tabNames = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

const report = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('tyto-explorer-panel .explorer__report-line')].map(
      (line) => line.textContent ?? '',
    ),
  );

const inWork = (): string[] =>
  readdirSync(work)
    .filter((name) => !name.startsWith('.'))
    .sort();

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-load-'));
  const home = join(scratch, 'tyto-home');
  work = join(scratch, 'work');
  shared = join(scratch, 'shared');
  mkdirSync(work, { recursive: true });
  mkdirSync(shared, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(shared, 'weekly.recipe'), WEEKLY);
  writeFileSync(join(shared, 'cleanup.recipe'), 'recipe cleanup\n');
  writeFileSync(join(shared, 'company.vocab.json'), '{ "rules": { "kinds": [] } }\n');
  writeFileSync(join(shared, 'labels.json'), '{ "label": "{title}" }\n');
  writeFileSync(join(scratch, 'secret.json'), '{ "x": "never copied" }\n');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, work);
  await switchingFolder(page, () => command('workspace.openFolder'));
  // From here on main's dialog answers the colleague's recipe.
  await app.evaluate(
    ({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    },
    join(shared, 'weekly.recipe'),
  );
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('Load recipe (TYTO-402)', () => {
  it('copies the recipe, what it runs and the files it names, reports ../ and opens the copy', async () => {
    expect(inWork()).toEqual([]);
    expect(await command('explorer.loadRecipe')).toBe(true);

    await expect.poll(tabNames, { timeout: 15_000 }).toContain('weekly.recipe');
    expect(inWork()).toEqual([
      'cleanup.recipe',
      'company.vocab.json',
      'labels.json',
      'weekly.recipe',
    ]);
    expect(readFileSync(join(work, 'weekly.recipe'), 'utf8')).toBe(WEEKLY);
    expect(await report()).toEqual([
      'Copied into this folder: weekly.recipe, cleanup.recipe, company.vocab.json, labels.json.',
      "Not copied: “../secret.json” — it is outside the recipe's folder.",
    ]);
    await page
      .locator('tyto-explorer-panel .explorer__row[data-name="cleanup.recipe"]')
      .waitFor({ timeout: 10_000 });
    if (shots !== undefined) {
      // The report as drawn, and the control: the same panel at the same wait without it.
      const panel = page.locator('tyto-explorer-panel');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await panel.screenshot({ path: join(shots, 'load-report.png') });
      await page.locator('tyto-explorer-panel .explorer__report').click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await panel.screenshot({ path: join(shots, 'load-control.png') });
    }
  }, 30_000);

  it('copies nothing the second time and names each file already there', async () => {
    const before = readFileSync(join(work, 'company.vocab.json'), 'utf8');
    writeFileSync(join(shared, 'company.vocab.json'), '{ "rules": { "changed": [] } }\n');
    expect(await command('explorer.loadRecipe')).toBe(true);

    await expect
      .poll(report, { timeout: 15_000 })
      .toEqual([
        'Nothing was copied, because these are already here: weekly.recipe, cleanup.recipe, company.vocab.json, labels.json.',
        "Not copied: “../secret.json” — it is outside the recipe's folder.",
      ]);
    expect(inWork()).toEqual([
      'cleanup.recipe',
      'company.vocab.json',
      'labels.json',
      'weekly.recipe',
    ]);
    expect(readFileSync(join(work, 'company.vocab.json'), 'utf8')).toBe(before);
  }, 30_000);
});
