import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Brief-only commands with an app file in front (TYTO-283).
 *
 * **Measured before the gate existed**: with `settings.json` in front, the command bar listed
 * Export, a key bound to it opened the dialog, and running it wrote `editaveis/settings.json.brief`
 * and a `result.json` of syntax errors into the chosen folder. The unit suites hold the predicate
 * and the gate on the registry; only a launched app shows that every door — the bar, a key run by
 * the window's dispatcher, a key run by the editor's keymap, the File menu and the status bar —
 * asks it.
 *
 * **Export ships with no key**, so this launch binds two in its own `keybindings.json`: a global
 * one, which the window's dispatcher runs, and a `mode.desktop` one, which CodeMirror runs through
 * the registry facet. Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const GLOBAL_KEY = 'Control+e';
const EDITOR_KEY = 'Control+Alt+e';

const KEYBINDINGS = `[
  { "key": "ctrl+e", "command": "file.export" },
  { "key": "ctrl+alt+e", "command": "file.export", "when": "mode.desktop" }
]
`;

let scratch: string;
let app: ElectronApplication;
let page: Page;

async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const dialogOpen = (): Promise<boolean> =>
  page.evaluate(
    () =>
      document.querySelector<HTMLElement & { open: boolean }>('tyto-export-dialog')?.open === true,
  );

const closeDialog = async (): Promise<void> => {
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement & { open: boolean }>('tyto-export-dialog');
    if (dialog !== null) dialog.open = false;
  });
};

/** The ids the command bar would list, read off the element the window hands them to. */
const offered = (): Promise<string[]> =>
  page.evaluate(() =>
    (
      document.querySelector<HTMLElement & { commands: { id: string }[] }>('tyto-command-bar')
        ?.commands ?? []
    ).map((command) => command.id),
  );

/** The rows the bar shows for what a person typed, as text. */
async function barRowsFor(text: string): Promise<string[]> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(text);
  // The list filters as the input changes; one frame is enough, two is slack.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('tyto-command-bar [role="option"]')].map(
      (row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    ),
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('.command-bar__input', { state: 'hidden' });
  return rows;
}

/**
 * Presses `key` and says whether the export dialog came up. The negative answer waits as long
 * as the brief tab's positive one is given below, so "nothing opened" is not "too early to tell".
 */
async function opensDialog(key: string): Promise<boolean> {
  await page.click('#editor .cm-content');
  await page.keyboard.press(key);
  try {
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement & { open: boolean }>('tyto-export-dialog')?.open ===
        true,
      undefined,
      { timeout: 1_500 },
    );
    return true;
  } catch {
    return false;
  }
}

const exportItemEnabled = (): Promise<boolean | undefined> =>
  app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('file.export')?.enabled);

const statusExportDisabled = (): Promise<boolean | undefined> =>
  page.evaluate(
    () =>
      document.querySelector<HTMLButtonElement>('tyto-status-bar [data-command="file.export"]')
        ?.disabled,
  );

/** The first tab, the brief's: settings.json opened beside it. By place, not by a translated name. */
async function bringBriefForward(): Promise<void> {
  await page.locator('.tabs__tab').first().locator('.tabs__label').click();
  await page.waitForFunction(
    () => document.querySelector('#editor-heading')?.getAttribute('data-i18n') === 'editor.heading',
  );
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-brief-commands-'));
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'keybindings.json'), KEYBINDINGS, 'utf8');
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');

  // A brief in the first tab, so the second half has something export can act on.
  await page.click('#editor .cm-content');
  await page.keyboard.insertText('---\ntemplate: promo-curso\n---\n::titulo Um título\n');

  // settings.json in front, the way a person opens it.
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('settings.open');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tabs__tab')].some((tab) =>
      (tab.textContent ?? '').includes('settings.json'),
    ),
  );
});

afterEach(async () => {
  await closeDialog();
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('with settings.json in front', () => {
  it('offers no brief-only command in the command bar', async () => {
    const ids = await offered();

    expect(ids).toContain('settings.open');
    for (const id of [
      'file.export',
      'preview.zoomIn',
      'preview.zoomOut',
      'preview.zoomFit',
      'preview.nextFormat',
      'preview.previousFormat',
      'preview.nextSlide',
      'preview.previousSlide',
    ]) {
      expect(ids, id).not.toContain(id);
    }
    expect((await barRowsFor('export')).join(' | ')).not.toMatch(/Export|Exportar/);
  });

  // One key per test, and the dialog shut after each: a key that wrongly opened it would
  // otherwise leave the modal up and hide what the next key does.
  it("opens nothing on the key the window's dispatcher runs", async () => {
    expect(await opensDialog(GLOBAL_KEY)).toBe(false);
  });

  it("opens nothing on the key the editor's keymap runs", async () => {
    expect(await opensDialog(EDITOR_KEY)).toBe(false);
  });

  it('greys Export in the File menu and in the status bar', async () => {
    await waitFor(
      async () => (await exportItemEnabled()) === false,
      'File > Export greyed with settings.json in front',
    );
    expect(await statusExportDisabled()).toBe(true);
  });
});

describe('with a brief in front', () => {
  beforeAll(async () => {
    await bringBriefForward();
  });

  it('offers export in the command bar again', async () => {
    expect(await offered()).toContain('file.export');
    expect((await barRowsFor('export')).join(' | ')).toMatch(/Export|Exportar/);
  });

  it("opens the export dialog on both of export's keys", async () => {
    expect(await opensDialog(GLOBAL_KEY)).toBe(true);
    await closeDialog();
    expect(await dialogOpen()).toBe(false);
    expect(await opensDialog(EDITOR_KEY)).toBe(true);
    await closeDialog();
  });

  it('enables Export in the File menu and in the status bar', async () => {
    await waitFor(
      async () => (await exportItemEnabled()) === true,
      'File > Export enabled with a brief in front',
    );
    expect(await statusExportDisabled()).toBe(false);
  });
});
