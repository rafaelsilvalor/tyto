import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '@tyto/command-line';
import { recipeSkeleton, vocabularySkeleton } from '@tyto/recipe';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { switchingFolder } from './folder-switch.js';

/**
 * A recipe and its vocabulary made from an empty trusted folder, in the real window (TYTO-402,
 * ADR 0176): New recipe writes `recipeSkeleton` and the tab runs it with nothing to report; New
 * vocabulary writes `vocabularySkeleton` into a vocabulary tab, in JSON's colours; a rule whose
 * `when` main's lint refuses is marked at the very character, past an escaped backslash, and in
 * Problems; fixing it clears both.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, the folder trusted through `tyto trust add` before
 * launch, one launch, `--lang=en`. With `TYTO_RECIPE_AUTHORING_SHOTS` set to a folder it leaves
 * two pictures at the same wait: the vocabulary with the problem marked, and the control, the
 * same tab fixed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}
const shots = process.env['TYTO_RECIPE_AUTHORING_SHOTS'];

let scratch: string;
let work: string;
let app: ElectronApplication | undefined;
let page: Page;

const quiet = { out: () => {}, err: () => {} };

/** Runs a command through the command bar's own door; `false` when the gate refused it. */
const command = (commandId: string): Promise<boolean> =>
  page.evaluate(
    (id) =>
      (
        document.querySelector('tyto-command-bar') as { run?: (id: string) => boolean } | null
      )?.run?.(id) ?? false,
    commandId,
  );

const kindText = (): Promise<string> =>
  page.evaluate(
    () => document.querySelector('tyto-status-bar .status-bar__kind')?.textContent?.trim() ?? '',
  );

const tabNames = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

const problemCodes = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__code')].map((node) => node.textContent ?? ''),
  );

/** The characters each error underline covers in the editor in front. */
const marked = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#editor .cm-lintRange-error')].map(
      (range) => range.textContent ?? '',
    ),
  );

/** Types a name into the explorer's field New recipe or New vocabulary opened, and Enter. */
async function newFile(commandId: string, name: string, tab: string): Promise<void> {
  expect(await command(commandId)).toBe(true);
  const field = page.locator('.explorer__field');
  await field.waitFor({ timeout: 10_000 });
  await field.fill(name);
  await field.press('Enter');
  await expect.poll(tabNames, { timeout: 15_000 }).toContain(tab);
}

/** Replaces the whole text of the tab in front, as typing would. */
async function replaceText(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
}

/** A vocabulary whose one rule reads `title matches \\w+ AND = 1` in the file. */
const vocabularyWith = (when: string): string =>
  `${JSON.stringify({ rules: { kinds: [{ when, set: { kind: 'poster' } }] } }, null, 2)}\n`;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-authoring-'));
  const home = join(scratch, 'tyto-home');
  work = join(scratch, 'work');
  mkdirSync(work, { recursive: true });
  mkdirSync(home, { recursive: true });
  const trusted = await run(['trust', 'add', work], {
    version: '0.0.0-e2e',
    cwd: work,
    home,
    console: quiet,
    confirm: () => Promise.resolve(true),
    rasterizer: () => {
      throw new Error('no render here');
    },
  });
  expect(trusted).toBe(0);

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
  await page.waitForSelector('tyto-explorer-panel .explorer__empty, tyto-explorer-panel', {
    timeout: 10_000,
  });
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a recipe and its vocabulary made in the window (TYTO-402)', () => {
  it('makes a recipe from its skeleton, which runs as made with nothing to report', async () => {
    expect(readdirSync(work).filter((name) => !name.startsWith('.'))).toEqual([]);
    await newFile('explorer.newRecipe', 'weekly', 'weekly.recipe');
    await expect.poll(kindText, { timeout: 10_000 }).toBe('Recipe');
    const skeleton = recipeSkeleton('weekly');
    expect(readFileSync(join(work, 'weekly.recipe'), 'utf8')).toBe(
      skeleton.ok ? skeleton.value : 'no skeleton',
    );
    // The run on opening finds nothing to report: the Problems panel says so in its words.
    if (!(await page.evaluate(() => document.querySelector('tyto-problems-panel') !== null))) {
      expect(await command('layout.togglePanel:problems')).toBe(true);
    }
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.querySelector('tyto-problems-panel')?.textContent?.trim() ?? '',
          ),
        { timeout: 15_000 },
      )
      .toContain('Nothing to report about this recipe');
    expect(await problemCodes()).toEqual([]);
  }, 60_000);

  it('makes a vocabulary from its skeleton, in a vocabulary tab in JSON colours', async () => {
    await newFile('explorer.newVocabulary', 'company', 'company.vocab.json');
    await expect.poll(kindText, { timeout: 10_000 }).toBe('Vocabulary');
    expect(readFileSync(join(work, 'company.vocab.json'), 'utf8')).toBe(vocabularySkeleton());
    const colours = await page.evaluate(() => {
      const content = document.querySelector('#editor .cm-content');
      const key = [...(content?.querySelectorAll('.cm-line span') ?? [])].find(
        (span) => span.textContent === '"rules"',
      );
      return {
        key: key === undefined ? '' : getComputedStyle(key).color,
        text: content === null ? '' : getComputedStyle(content).color,
      };
    });
    expect(colours.key).not.toBe('');
    expect(colours.key).not.toBe(colours.text);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.querySelector('tyto-problems-panel')?.textContent?.trim() ?? '',
          ),
        { timeout: 10_000 },
      )
      .toContain('Nothing to report about this vocabulary');
  }, 60_000);

  it('marks a refused rule at its character, past an escaped backslash, and clears it when fixed', async () => {
    await replaceText(vocabularyWith('title matches \\w+ AND = 1'));
    await expect.poll(problemCodes, { timeout: 15_000 }).toEqual(['E_RECIPE_WHERE']);
    await expect.poll(marked, { timeout: 10_000 }).toEqual(['=']);
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(shots, 'vocabulary-marked.png') });
    }

    await replaceText(vocabularyWith('title matches \\w+'));
    await expect.poll(problemCodes, { timeout: 15_000 }).toEqual([]);
    await expect.poll(marked, { timeout: 10_000 }).toEqual([]);
    if (shots !== undefined) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(shots, 'vocabulary-fixed.png') });
    }
  }, 60_000);
});
