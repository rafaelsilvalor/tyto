import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Hot exit, through real launches of one data folder (TYTO-113, ADR 0080).
 *
 * Four launches in order, each one the next one's starting point: the first leaves a saved
 * brief, a brief with unsaved typing, an untitled draft and the settings tab, and quits with
 * nothing asked; the second finds them all, and reloads with `Mod-r` mid-typing; between the
 * second and the third one file is deleted and the other changed on disk, and the third has
 * to say so without imposing the old text. The box is recorded to a file, because the app is
 * gone by the time there is anything to assert (`quit.desktop.test.ts` says why).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let scratch: string;
let saved: string;
let dirty: string;
let marker: string;
let app: ElectronApplication | undefined;
let page: Page;

const UNTITLED = /^(Sem título|Untitled)$/u;

const launch = async (): Promise<void> => {
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  // Every box this launch draws is written down; none is expected.
  await app.evaluate(({ dialog }, file) => {
    dialog.showMessageBox = ((options: { message?: string }): Promise<unknown> => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as { appendFileSync: (to: string, data: string) => void };
      fs.appendFileSync(file, `${options.message ?? ''}\n`);
      return Promise.resolve({ response: 1, checkboxChecked: false });
    }) as never;
  }, marker);
};

/**
 * Waits until the window has read the last session back and drawn it: more than the one tab a
 * window opens on. The count itself is asserted by name afterwards, so a wrong one fails there.
 */
const settled = async (): Promise<void> => {
  await page.waitForFunction(() => document.querySelectorAll('.tabs__tab').length > 1, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
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

const tabNames = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__label')].map((node) => node.textContent ?? ''),
  );

const activeTab = async (): Promise<string> =>
  page.evaluate(() => document.querySelector('.tabs__tab--on .tabs__label')?.textContent ?? '');

const unsavedTabs = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab')]
      .filter((tab) => tab.querySelector('.tabs__dirty') !== null)
      .map((tab) => tab.querySelector('.tabs__label')?.textContent ?? ''),
  );

const editorText = async (): Promise<string> =>
  page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent ?? '');

const messages = async (): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__message')]
      .map((node) => node.textContent ?? '')
      .join(' | '),
  );

const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
};

const openFile = async (path: string): Promise<void> => {
  await app?.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, path);
  await runFromBar('editor.open');
};

/** Types at the end of the tab in front, as a person would. */
const typeAtEnd = async (text: string): Promise<void> => {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
};

const tabAt = async (slot: number): Promise<void> => {
  await page.click(`.tabs__tab:nth-child(${String(slot)}) .tabs__label`);
  await page.waitForTimeout(200);
};

beforeAll(() => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-session-'));
  saved = join(scratch, 'salvo.brief');
  dirty = join(scratch, 'sujo.brief');
  marker = join(scratch, 'boxes.txt');
  writeFileSync(saved, '::titulo Salvo', 'utf8');
  writeFileSync(dirty, '::titulo Sujo', 'utf8');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('hot exit', () => {
  it('quits with unsaved work and asks nothing', async () => {
    await launch();
    await openFile(saved);
    await openFile(dirty);
    await typeAtEnd(' editado');
    await runFromBar('document.new');
    await typeAtEnd('::titulo Rascunho');
    await runFromBar('settings.open');
    // The untitled draft in front, so the active tab is something the record has to carry.
    await tabAt(3);
    expect(await tabNames()).toEqual([
      'salvo.brief',
      'sujo.brief',
      expect.stringMatching(UNTITLED),
      'settings.json',
    ]);
    expect(await unsavedTabs()).toEqual(['sujo.brief', expect.stringMatching(UNTITLED)]);

    // Typed and quit at once, inside the pause the session is otherwise kept after: what
    // reaches the next launch is what the quit itself wrote.
    await typeAtEnd(' final');
    await quit();

    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(scratch, 'userData', 'session.json'))).toBe(true);
    // Nothing was written into the person's files: the drafts are in the app's own folder.
    expect(readFileSync(dirty, 'utf8')).toBe('::titulo Sujo');
  });

  it('reopens the same tabs, in order, with the same one in front and the drafts in them', async () => {
    await launch();
    await settled();

    expect(await tabNames()).toEqual([
      'salvo.brief',
      'sujo.brief',
      expect.stringMatching(UNTITLED),
      'settings.json',
    ]);
    expect(await activeTab()).toMatch(UNTITLED);
    expect(await editorText()).toContain('::titulo Rascunho final');
    expect(await unsavedTabs()).toEqual(['sujo.brief', expect.stringMatching(UNTITLED)]);
    await tabAt(2);
    expect(await editorText()).toContain('::titulo Sujo editado');
  });

  it('brings every tab back after Mod-r, typing done just before it included', async () => {
    await tabAt(3);
    await typeAtEnd(' mais');
    // At once: well inside the pause the session is otherwise kept after.
    await page.keyboard.press('Control+r');
    await page.waitForFunction(() => document.querySelectorAll('.tabs__tab').length <= 1, null, {
      timeout: 30_000,
    });
    await settled();

    expect(await tabNames()).toEqual([
      'salvo.brief',
      'sujo.brief',
      expect.stringMatching(UNTITLED),
      'settings.json',
    ]);
    expect(await activeTab()).toMatch(UNTITLED);
    expect(await editorText()).toContain('::titulo Rascunho final mais');
    await quit();
    expect(existsSync(marker)).toBe(false);
  });

  it('says a file is gone, and never puts a draft over a file that changed', async () => {
    unlinkSync(saved);
    writeFileSync(dirty, '::titulo Mudou lá fora', 'utf8');

    await launch();
    // The saved brief is dropped; the changed one opens with the disk's text, clean, and its
    // draft in a new tab beside it.
    await settled();

    expect(await tabNames()).toEqual([
      'sujo.brief',
      expect.stringMatching(UNTITLED),
      expect.stringMatching(UNTITLED),
      'settings.json',
    ]);
    await tabAt(1);
    expect(await editorText()).toContain('::titulo Mudou lá fora');
    expect(await unsavedTabs()).not.toContain('sujo.brief');
    await tabAt(2);
    expect(await editorText()).toContain('::titulo Sujo editado');
    const said = await messages();
    expect(said).toMatch(/(não está mais onde estava|no longer where it was): salvo\.brief/u);
    expect(said).toMatch(
      /(mudou depois que o texto|changed since your unsaved text).*: sujo\.brief/u,
    );
    expect(readFileSync(dirty, 'utf8')).toBe('::titulo Mudou lá fora');
    await quit();
  });
});
