import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The status bar's "new problems" dot, through a real window (TYTO-143, ADR 0076).
 *
 * `problems-mark.test.ts` holds the rule as values and `status-bar.test.ts` draws the dot in
 * jsdom. What only a launched app answers is the card's own case: a save that really fails on
 * a real disk while the problems panel is off screen — closed, or inside a hidden area — and
 * the dot that leads to the row explaining it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

const PROBLEMS = 'layout.togglePanel:problems';
const BOTTOM = 'layout.toggleDock:bottom';
const DOT = 'tyto-status-bar .status-bar__new';

let scratch: string;
let app: ElectronApplication;
let page: Page;

/** Runs a command the way the bar's Enter key does, and fails loudly if the bar refuses it. */
async function run(commandId: string): Promise<void> {
  const ran = await page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

const click = async (command: string): Promise<void> => {
  await page.click(`tyto-status-bar [data-command="${command}"]`);
  await page.waitForTimeout(300);
};

const dotLit = (): Promise<boolean> =>
  page.evaluate((selector) => document.querySelector(selector) !== null, DOT);

const problemsShown = (): Promise<boolean> =>
  page.evaluate(() => document.querySelector('[data-panel="problems"]') !== null);

const count = (): Promise<number> =>
  page.evaluate(() =>
    Number(document.querySelector('tyto-status-bar .status-bar__count')?.textContent ?? 0),
  );

/** The codes the problems panel lists; only readable while it is on screen. */
const codes = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__code')].map((node) => node.textContent ?? ''),
  );

/**
 * A save-as into a folder that does not exist: `writeFile` rejects with ENOENT in main, which
 * is the real failure TYTO-124 turns into an `E_SAVE_FAILED` row. The count cannot say when it
 * landed — a second failure replaces the first row — so the picker stub counts its calls and
 * the wait is for the call, then for the rejection to travel back.
 */
async function failSave(): Promise<void> {
  const asked = await app.evaluate(
    ({ dialog }, chosen) => {
      const shared = globalThis as unknown as { tytoSaveAsks?: number };
      shared.tytoSaveAsks ??= 0;
      dialog.showSaveDialog = (() => {
        shared.tytoSaveAsks = (shared.tytoSaveAsks ?? 0) + 1;
        return Promise.resolve({ canceled: false, filePath: chosen });
      }) as never;
      return shared.tytoSaveAsks;
    },
    join(scratch, 'no-such-folder', 'lost.brief'),
  );
  await run('editor.saveAs');
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as unknown as { tytoSaveAsks?: number }).tytoSaveAsks ?? 0),
    )
    .toBeGreaterThan(asked);
  await page.waitForTimeout(500);
}

/** Answers the next folder picker with `directory` and runs the command that opens it. */
async function chooseTemplateFolder(directory: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (() =>
      Promise.resolve({ canceled: false, filePaths: [chosen] })) as never;
  }, directory);
  await run('templates.chooseFolder');
  await page.waitForTimeout(800);
}

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-problems-mark-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('tyto-status-bar .status-bar__button');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(900, 600);
  });
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the new-problems dot', () => {
  it('stays dark for a save failure raised while the panel is on screen', async () => {
    expect(await problemsShown()).toBe(true);
    await failSave();

    expect(await codes()).toContain('E_SAVE_FAILED');
    expect(await dotLit()).toBe(false);
  });

  it('lights for a save failure while the panel is closed, and showing the panel clears it', async () => {
    await click(PROBLEMS);
    expect(await problemsShown()).toBe(false);
    expect(await dotLit()).toBe(false);

    // The same failure a second time: a second answer to a second key press, so it is new.
    await failSave();
    expect(await dotLit()).toBe(true);
    const label = await page.getAttribute(
      `tyto-status-bar [data-command="${PROBLEMS}"]`,
      'aria-label',
    );
    expect(label).toMatch(
      /\((new since you last looked|novos desde a última vez que você olhou)\)$/u,
    );

    await click(PROBLEMS);
    expect(await problemsShown()).toBe(true);
    expect(await dotLit()).toBe(false);
    expect(await codes()).toContain('E_SAVE_FAILED');
  });

  it('lights while the bottom area is hidden, and showing the area clears it', async () => {
    await click(BOTTOM);
    expect(await problemsShown()).toBe(false);

    await failSave();
    expect(await dotLit()).toBe(true);

    await click(BOTTOM);
    expect(await problemsShown()).toBe(true);
    expect(await dotLit()).toBe(false);
  });

  it('does not light for a typo in the brief, which only moves the count', async () => {
    await click(PROBLEMS);
    const typeBrief = async (brief: string): Promise<void> => {
      await page.click('#editor .cm-content');
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(brief);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    };
    await typeBrief('---\ntemplate: promo-curso\n---\n::titulo Direito\n');
    const before = await count();
    process.stdout.write(`[TYTO-143] count with a clean brief: ${String(before)}\n`);

    await typeBrief('---\ntemplate: nao-existe\n---\n::titulo Direito\n');
    await page.waitForFunction(
      (was) =>
        Number(document.querySelector('tyto-status-bar .status-bar__count')?.textContent ?? 0) >
        was,
      before,
    );

    expect(await dotLit()).toBe(false);
  });

  it('keeps a live save failure across a template-folder change, and the empty folder is new once', async () => {
    const empty = join(scratch, 'empty-templates');
    mkdirSync(empty, { recursive: true });

    await chooseTemplateFolder(empty);
    expect(await dotLit()).toBe(true);

    await click(PROBLEMS);
    expect(await dotLit()).toBe(false);
    const listed = await codes();
    expect(listed).toContain('E_SAVE_FAILED');
    expect(listed).toContain('E_TEMPLATE_FOLDER_EMPTY');

    // Read again with the panel closed: the empty-folder row is remade, and it is not news.
    await click(PROBLEMS);
    await chooseTemplateFolder(empty);
    expect(await dotLit()).toBe(false);

    await click(PROBLEMS);
    expect(await codes()).toContain('E_SAVE_FAILED');
  });
});
