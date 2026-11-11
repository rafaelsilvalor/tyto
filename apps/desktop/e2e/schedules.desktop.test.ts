import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
 * The Schedules panel in the real window (TYTO-385, ADR 0175 decision 6): a trusted folder with
 * an `every 5m` recipe that fails is listed in the bottom strip's Schedules tab with a next run;
 * Run now runs it, and the row says the run's problem and its code; Open opens it in a tab, its
 * `every` coloured as a header word.
 *
 * The recipe's first step is a `where` with nothing to read, which fails, as in
 * `recipe-tab.desktop.test.ts`: no source plugin is needed for a run that has a problem. The
 * cadence is `recipe-schedule.test.ts`'s, with fake timers; nothing here waits five minutes. The
 * OS notification is not asserted: main's `Notification.show` is replaced so a local run does
 * not put one on the desktop, and when one is raised is the scheduler's unit test.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139), the folder trusted through `tyto trust
 * add` before launch. `--lang=en`. With `TYTO_SCHEDULES_SHOTS` set to a folder it leaves two
 * pictures of the window at the same wait: the strip with the Schedules tab and, as the control,
 * with Problems in front.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}
const shots = process.env['TYTO_SCHEDULES_SHOTS'];

const RECIPE = ['recipe watch', 'every 5m', 'where status = done', 'select key', ''].join('\n');

let scratch: string;
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

/** The panel's one row, as a person reads it. */
const watchRow = () =>
  page.evaluate(() => {
    const row = document.querySelector('tyto-schedule-panel .schedules__row');
    if (row === null) return undefined;
    return {
      name: row.querySelector('.schedules__name')?.textContent?.trim() ?? '',
      next: row.querySelector('.schedules__next time')?.getAttribute('datetime') ?? '',
      last: row.querySelector('.schedules__last time')?.getAttribute('datetime') ?? '',
      outcome: row.querySelector('.schedules__outcome')?.getAttribute('data-outcome') ?? '',
      text: row.querySelector('.schedules__outcome')?.textContent?.trim() ?? '',
    };
  });

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-schedules-'));
  const home = join(scratch, 'tyto-home');
  const work = join(scratch, 'work');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  writeFileSync(join(work, '.tyto', 'project.json'), '{}\n');
  writeFileSync(join(work, 'watch.recipe'), RECIPE);
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
  await app.evaluate(({ dialog, Notification }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    Notification.prototype.show = () => undefined;
  }, work);
  await switchingFolder(page, () => command('workspace.openFolder'));
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the Schedules panel (TYTO-385)', () => {
  it('lists the folder’s every-5m recipe with a next run, as a tab of the bottom strip', async () => {
    expect(await command('layout.togglePanel:schedules')).toBe(true);
    await page.waitForSelector('tyto-schedule-panel .schedules__row', { timeout: 15_000 });
    const listed = await watchRow();
    expect(listed).toMatchObject({ name: 'watch', last: '', outcome: 'none' });
    // One interval after main found it (ADR 0175's note): about five minutes from now.
    const inMinutes = (Date.parse(listed?.next ?? '') - Date.now()) / 60_000;
    expect(inMinutes).toBeGreaterThan(3);
    expect(inMinutes).toBeLessThanOrEqual(5);
    const tab = await page.evaluate(() =>
      document.querySelector('.dock-tab[aria-selected="true"]')?.textContent?.trim(),
    );
    expect(tab).toBe('Schedules');

    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, 'schedules-tab.png') });
    }
  }, 30_000);

  it('runs it now, and the row says its problem and the code', async () => {
    await page.locator('tyto-schedule-panel .schedules__run').click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('tyto-schedule-panel .schedules__outcome')
          ?.getAttribute('data-outcome') === 'problem',
      null,
      { timeout: 15_000 },
    );
    const after = await watchRow();
    expect(after?.last).not.toBe('');
    expect(after?.text).toMatch(/^problem: E_RECIPE/u);

    if (shots !== undefined) {
      await page.screenshot({ path: join(shots, 'schedules-after-run.png') });
      // The control at the same wait: the same strip with Problems in front.
      await command('layout.togglePanel:problems');
      await page.waitForSelector('tyto-problems-panel');
      await page.screenshot({ path: join(shots, 'control-problems.png') });
      await command('layout.togglePanel:schedules');
      await page.waitForSelector('tyto-schedule-panel .schedules__row');
    }
  }, 30_000);

  it('opens the recipe in a tab, its every coloured as a header word', async () => {
    await page.locator('tyto-schedule-panel .schedules__open').click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.tabs__tab .tabs__label')].some(
          (tab) => tab.textContent === 'watch.recipe',
        ),
      null,
      { timeout: 15_000 },
    );
    const colours = await page.evaluate(() => {
      const content = document.querySelector('#editor .cm-content');
      const spans = [...(content?.querySelectorAll('.cm-line span') ?? [])];
      const colourOf = (word: string): string => {
        const found = spans.find((span) => span.textContent === word);
        return found === undefined ? '' : getComputedStyle(found).color;
      };
      return { every: colourOf('every'), recipe: colourOf('recipe') };
    });
    expect(colours.every).not.toBe('');
    expect(colours.every).toBe(colours.recipe);
  }, 30_000);
});
