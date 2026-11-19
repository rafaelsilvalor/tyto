import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '@tyto/command-line';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { switchingFolder } from './folder-switch.js';

/**
 * Apply all in the real window (TYTO-758, ADR 0219): a recipe whose header says `apply together`,
 * run from the command bar with Run recipe, draws one Apply under its header line and none on its
 * plan; a click renames the delivery's export on disk. A recipe without the header, the control,
 * draws the plan's own Apply and no Apply all.
 *
 * Only what needs the window is here: where the button is drawn and that the click reaches main.
 * The order, the stop and the planned view are the runner's and the plugin layer's tests. Its own
 * `--user-data-dir` and `TYTO_HOME`, the folder trusted through `tyto trust add` before launch; one
 * launch, inside the 60 s budget (ADR 0105). With `TYTO_RECIPE_TOGETHER_SHOTS` set to a folder it
 * leaves two pictures of the editor at the same wait: the control, then the together recipe.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}
const shots = process.env['TYTO_RECIPE_TOGETHER_SHOTS'];

let scratch: string;
let work: string;
let app: ElectronApplication | undefined;
let page: Page;

const quiet = { out: () => {}, err: () => {} };

/** A PNG header that states `width` by `height`: all the names read of it. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  bytes.writeUInt32BE(0x89_50_4e_47, 0);
  bytes.writeUInt32BE(0x0d_0a_1a_0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const command = (commandId: string): Promise<boolean> =>
  page.evaluate(
    (id) =>
      (
        document.querySelector('tyto-command-bar') as { run?: (id: string) => boolean } | null
      )?.run?.(id) ?? false,
    commandId,
  );

/** The buttons the editor draws: Apply all's, and each plan cell's. */
const drawn = () =>
  page.evaluate(() => ({
    together: [...document.querySelectorAll('#editor [data-action="apply-together"]')].map(
      (button) => button.textContent,
    ),
    perPlan: document.querySelectorAll('#editor .recipe-cell [data-action="apply"]').length,
    plans: [...document.querySelectorAll('#editor .recipe-plan__description')].map(
      (line) => line.textContent,
    ),
  }));

/** Opens a recipe and waits until its tab is in front with its header line on screen. */
const openRecipe = async (path: string, header: string) => {
  await app?.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, path);
  await command('editor.open');
  await page.waitForFunction(
    (line) => document.querySelector('#editor .cm-content')?.textContent?.includes(line) === true,
    header,
    { timeout: 15_000 },
  );
};

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-together-'));
  const home = join(scratch, 'tyto-home');
  work = join(scratch, 'work');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  writeFileSync(
    join(work, '.tyto', 'project.json'),
    JSON.stringify({ delivery: { parent: 'entregas', sizes: { feed: '1080x1350' } } }),
  );
  const delivery = join(work, 'entregas', 'mca-1');
  mkdirSync(join(delivery, 'editaveis'), { recursive: true });
  writeFileSync(
    join(delivery, 'editaveis', 'delivery.json'),
    JSON.stringify({
      version: 1,
      key: 'MCA-1',
      stem: 'mca-1',
      formats: [{ format: 'feed', count: 1 }],
    }),
  );
  writeFileSync(join(delivery, 'feed.png'), png(1080, 1350));
  mkdirSync(join(work, 'recipes'), { recursive: true });
  const steps = ['deliveries', 'rename-exports stem=stem', ''];
  writeFileSync(join(work, 'recipes', 'control.recipe'), ['recipe control', ...steps].join('\n'));
  writeFileSync(
    join(work, 'recipes', 'ship.recipe'),
    ['recipe ship', 'apply together', ...steps].join('\n'),
  );
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
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('Apply all under apply together (TYTO-758, ADR 0219)', () => {
  it("draws the plan's own Apply and no Apply all without the header", async () => {
    await openRecipe(join(work, 'recipes', 'control.recipe'), 'recipe control');
    expect(await command('recipe.run')).toBe(true);
    await expect.poll(async () => (await drawn()).perPlan, { timeout: 15_000 }).toBe(1);
    expect(await drawn()).toEqual({
      together: [],
      perPlan: 1,
      plans: ['entregas/mca-1: feed.png → mca-1-01.png'],
    });
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.locator('#editor').screenshot({ path: join(shots, 'control-per-plan.png') });
    }
  }, 30_000);

  it('draws one Apply all from Run recipe in the command bar, and renames on its click', async () => {
    await openRecipe(join(work, 'recipes', 'ship.recipe'), 'recipe ship');
    expect(await command('recipe.run')).toBe(true);
    await expect
      .poll(async () => (await drawn()).together, { timeout: 15_000 })
      .toEqual(['Apply all plans']);
    expect(await drawn()).toEqual({
      together: ['Apply all plans'],
      perPlan: 0,
      plans: ['entregas/mca-1: feed.png → mca-1-01.png'],
    });
    if (shots !== undefined) {
      await page.locator('#editor').screenshot({ path: join(shots, 'together-apply-all.png') });
    }

    await page.locator('#editor [data-action="apply-together"]').click();
    await expect
      .poll(() => readdirSync(join(work, 'entregas', 'mca-1')).sort(), { timeout: 15_000 })
      .toEqual(['editaveis', 'mca-1-01.png']);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.querySelector('#editor .recipe-plan__summary')?.textContent ?? '',
          ),
        { timeout: 15_000 },
      )
      .toBe('1 applied');
    // Nothing is left to apply, so Apply all is no longer offered.
    expect((await drawn()).together).toEqual([]);
  }, 30_000);
});
