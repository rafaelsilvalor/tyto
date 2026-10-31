import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { switchingFolder } from './folder-switch.js';

/**
 * Each workspace folder keeps its tabs (TYTO-513, ADR 0165), in the real window: folder A with
 * two briefs open, one of them edited and not saved; a switch to folder B through File ▸ Open
 * Folder shows none of them; and a switch back through the title bar's recent list brings both
 * back, the unsaved text included.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`. The picker is answered from main, never by the
 * window: no channel takes a path.
 */

const here = dirname(fileURLToPath(import.meta.url));

let scratch: string;
let monday: string;
let tuesday: string;
let app: ElectronApplication | undefined;
let window: Page;

const brief = (title: string): string =>
  ['---', 'template: promo-curso', 'formats: [grid-1x1]', '---', '::titulo', `  ${title}`].join(
    '\n',
  );

/** Answers main's next pickers: a folder for a folder picker, a file for a file picker. */
async function answerPickers(paths: { file?: string; directory?: string }): Promise<void> {
  await app?.evaluate(
    ({ dialog }, chosen) => {
      dialog.showOpenDialog = (options?: unknown) => {
        const properties = (options as { properties?: string[] } | undefined)?.properties ?? [];
        const wanted = properties.includes('openDirectory') ? chosen.directory : chosen.file;
        return Promise.resolve(
          wanted === null
            ? { canceled: true, filePaths: [] }
            : { canceled: false, filePaths: [wanted] },
        );
      };
    },
    { file: paths.file ?? null, directory: paths.directory ?? null },
  );
}

async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

/** The names on the tab strip, in order. */
const tabNames = (): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map(
      (tab) => tab.textContent?.trim() ?? '',
    ),
  );

async function openFolder(folder: string): Promise<void> {
  await answerPickers({ directory: folder });
  await switchingFolder(window, () => run('workspace.openFolder'));
}

async function openBrief(path: string, name: string): Promise<void> {
  await answerPickers({ file: path });
  await run('editor.open');
  await expect.poll(tabNames, { timeout: 15_000 }).toContain(name);
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-folder-tabs-e2e-'));
  monday = join(scratch, 'segunda');
  tuesday = join(scratch, 'terca');
  for (const folder of [monday, tuesday]) {
    mkdirSync(join(folder, '.tyto'), { recursive: true });
    writeFileSync(join(folder, '.tyto', 'project.json'), '{}\n');
  }
  writeFileSync(join(monday, 'um.brief'), brief('Um'));
  writeFileSync(join(monday, 'dois.brief'), brief('Dois'));

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
  await window.waitForFunction(() => document.documentElement.dataset.session === 'restored');
}, 300_000);

afterAll(async () => {
  if (app !== undefined) await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the tabs of each workspace folder (TYTO-513, ADR 0165)', () => {
  it('brings A’s two briefs back, a draft included, after a switch to B and back', async () => {
    await openFolder(monday);
    await openBrief(join(monday, 'um.brief'), 'um.brief');
    await openBrief(join(monday, 'dois.brief'), 'dois.brief');
    // Unsaved text in the tab in front: the switch must keep it, as Zed does.
    await window.locator('#editor .cm-content').click();
    await window.keyboard.press('Control+End');
    await window.keyboard.type('\n::rodape\n  Rascunho de segunda');
    await expect.poll(tabNames).toEqual(expect.arrayContaining(['um.brief', 'dois.brief']));

    await openFolder(tuesday);
    const onTuesday = await tabNames();
    expect(onTuesday).not.toContain('um.brief');
    expect(onTuesday).not.toContain('dois.brief');

    // Back through the title bar's recent list (TYTO-487), by keys alone.
    await switchingFolder(window, async () => {
      await window.locator('.title-bar__project').click();
      await window.locator('.recent-folders__search').waitFor({ state: 'visible' });
      await window.keyboard.type('segunda');
      await window.keyboard.press('Enter');
    });
    await expect
      .poll(() => window.locator('.title-bar__project').textContent(), { timeout: 10_000 })
      .toBe('segunda');
    const back = await tabNames();
    expect(back).toEqual(expect.arrayContaining(['um.brief', 'dois.brief']));
    await window.locator('.tabs__tab[data-tab-kind="editor"]', { hasText: 'dois.brief' }).click();
    await expect
      .poll(() => window.locator('#editor .cm-content').textContent(), { timeout: 10_000 })
      .toContain('Rascunho de segunda');
  }, 60_000);
});
