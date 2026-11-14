import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Edit step on a line that chains steps with `|` (TYTO-711, ADR 0196 note of 2026-11-14): the
 * form it opens is the step's under the cursor, not the line's first, and on a one-step line,
 * the control, the line's step as before. Which step a cursor offset picks, the bar and the
 * blanks included, is `recipe-notebook.test.ts`'s; this asserts what needs the real window, the
 * caret in the editor reaching the command and the form the dialog opens.
 *
 * The steps are generic verbs, so no plugin is installed and nothing runs. Its own `TYTO_HOME`,
 * `--user-data-dir` and `--lang=en`, one launch, no workspace folder. With
 * `TYTO_RECIPE_CHAINED_SHOTS` set to a folder it leaves two pictures at the same wait: the form
 * Edit step opened from the chained line's second step, and the control, the form opened from
 * the one-step line.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}
const shots = process.env['TYTO_RECIPE_CHAINED_SHOTS'];

const RECIPE = [
  'recipe chained',
  '',
  'where status = done | select title',
  '',
  'sort title',
  '',
].join('\n');

let scratch: string;
let app: ElectronApplication | undefined;
let page: Page;

/** Runs a command through the command bar's own door; `false` when the gate refused it. */
const run = (commandId: string): Promise<boolean> =>
  page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);

const tabNames = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

/** Puts the caret at `offset` in the editor's text, through its view, and focuses it. */
async function caretAt(offset: number): Promise<void> {
  await page.evaluate((at) => {
    const content = document.querySelector('#editor .cm-content') as unknown as {
      cmTile?: {
        root?: { view?: { dispatch(spec: object): void; focus(): void } };
      };
    };
    const view = content.cmTile?.root?.view;
    view?.dispatch({ selection: { anchor: at } });
    view?.focus();
  }, offset);
}

/** Edit step with the caret at `offset`: the verb of the form it opens, then the form closed. */
async function editStepAt(offset: number, shot?: string): Promise<string | null> {
  await caretAt(offset);
  expect(await run('recipe.editStep')).toBe(true);
  const form = page.locator('tyto-recipe-step .recipe-step-form');
  await form.waitFor({ timeout: 10_000 });
  const verb = await form.getAttribute('data-verb');
  if (shots !== undefined && shot !== undefined) {
    mkdirSync(shots, { recursive: true });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shots, shot) });
  }
  await page.click('tyto-recipe-step .recipe-step__cancel');
  await page.waitForSelector('tyto-recipe-step .recipe-step__panel', { state: 'detached' });
  return verb;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-chained-e2e-'));
  const home = join(scratch, 'tyto-home');
  const work = join(scratch, 'recipes');
  mkdirSync(home, { recursive: true });
  mkdirSync(work, { recursive: true });
  const recipePath = join(work, 'chained.recipe');
  writeFileSync(recipePath, RECIPE);
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, recipePath);
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('Edit step on a line that chains steps (TYTO-711)', () => {
  it("opens the form of the step under the caret, and a one-step line's own", async () => {
    // The window refuses an open until it has read the last session, so it is asked again.
    await expect
      .poll(
        async () => {
          await run('editor.open');
          return tabNames();
        },
        { timeout: 15_000 },
      )
      .toContain('chained.recipe');
    await page.waitForSelector('#editor .cm-line');

    const select = RECIPE.indexOf('select title');
    expect(await editStepAt(select + 3, 'chained-second-step.png')).toBe('select');
    expect(await editStepAt(RECIPE.indexOf('status'))).toBe('where');
    // The control: a one-step line opens its step's form, as before chaining.
    expect(await editStepAt(RECIPE.indexOf('sort title') + 3, 'one-step-control.png')).toBe('sort');
  }, 40_000);
});
