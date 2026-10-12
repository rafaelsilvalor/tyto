import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Hot exit for the template mode, through real launches of one data folder (TYTO-266, ADR 0080).
 *
 * Three launches in order, each the next one's starting point: the first opens a template
 * folder in the mode, types into `template.html` without saving and quits with nothing asked;
 * the second finds the mode open on that folder with the draft in the markup view, unsaved;
 * between the second and the third the file changes on disk, and the third shows the disk's
 * text and keeps the draft in a tab beside it. Every box a launch draws is written to a file,
 * because the app is gone by the time there is anything to assert (`session.desktop.test.ts`).
 *
 * The folder is a scratch copy of the built-in `promo-curso`, so nothing writes to the pack.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

const pack = join(
  dirname(createRequire(import.meta.url).resolve('@tyto/templates/package.json')),
  'templates',
);

let scratch: string;
let folder: string;
let marker: string;
let original: string;
let app: ElectronApplication | undefined;
let page: Page;

const DRAFT = '<!-- rascunho do TYTO-266 -->';
const UNTITLED = /^(Sem título|Untitled)$/u;

/** Where a look at the restored mode is kept, for the person reviewing the change. */
const screenshot = process.env['TYTO_TEMPLATE_SESSION_SCREENSHOT'];

const launch = async (): Promise<void> => {
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  // Every box this launch draws is written down; none is expected. Main is ESM, so `fs` comes
  // from `process.getBuiltinModule` and not `require`.
  await app.evaluate(({ dialog }, file) => {
    dialog.showMessageBox = ((options: { message?: string }): Promise<unknown> => {
      const fs = process.getBuiltinModule('node:fs');
      fs.appendFileSync(file, `${options.message ?? ''}\n`);
      return Promise.resolve({ response: 1, checkboxChecked: false });
    }) as never;
  }, marker);
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

/** Answers the next folder picker with `directory`, the way a person choosing it would. */
const pickNext = async (directory: string): Promise<void> => {
  await app?.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (() =>
      Promise.resolve({ canceled: false, filePaths: [chosen] })) as never;
  }, directory);
};

/** A menu pick, sent the way `menu.ts` sends one. */
const runCommand = async (id: string): Promise<void> => {
  await app?.evaluate(({ BrowserWindow }, command) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('command:run', { id: command });
  }, id);
};

/** What a buffer of the mode holds now, read from the element and not the screen. */
const bufferText = (buffer: 'manifest' | 'markup'): Promise<string> =>
  page.evaluate(
    (name) =>
      (
        document.querySelector('tyto-template-mode') as unknown as {
          textOf(buffer: string): string;
        }
      ).textOf(name),
    buffer,
  );

const dirtyMarks = (buffer: 'manifest' | 'markup'): Promise<number> =>
  page.locator(`[data-buffer-tab="${buffer}"] .template-mode__dirty`).count();

const modeOpen = async (): Promise<void> => {
  await page.waitForSelector('tyto-template-mode[open]', { timeout: 30_000 });
};

const tabNames = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__label')].map((node) => node.textContent ?? ''),
  );

const messages = async (): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__message')]
      .map((node) => node.textContent ?? '')
      .join(' | '),
  );

beforeAll(() => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-template-session-'));
  folder = join(scratch, 'mine', 'promo-curso');
  cpSync(join(pack, 'promo-curso'), folder, { recursive: true });
  marker = join(scratch, 'boxes.txt');
  original = readFileSync(join(folder, 'template.html'), 'utf8');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('hot exit in the template mode', () => {
  it('quits with an unsaved template buffer and asks nothing', async () => {
    await launch();
    await pickNext(folder);
    await runCommand('template.edit');
    await modeOpen();

    await page.click('[data-buffer="markup"] .cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(DRAFT);
    expect(await dirtyMarks('markup')).toBe(1);

    // At once, inside the pause the session is otherwise kept after: what reaches the next
    // launch is what the quit itself wrote.
    await quit();

    expect(existsSync(marker) ? readFileSync(marker, 'utf8') : '').toBe('');
    expect(readFileSync(join(scratch, 'userData', 'session.json'), 'utf8')).toContain(DRAFT);
    // The draft is in the app's own folder, never in the template's.
    expect(readFileSync(join(folder, 'template.html'), 'utf8')).toBe(original);
  });

  it('reopens the mode on that folder with the draft in the markup view, unsaved', async () => {
    await launch();
    await modeOpen();

    expect(await page.textContent('[data-testid="template-folder"]')).toBe(folder);
    await expect.poll(() => bufferText('markup')).toContain(DRAFT);
    expect(await dirtyMarks('markup')).toBe(1);
    expect(await dirtyMarks('manifest')).toBe(0);
    // The grid drew from the restored buffers, the same as typing them would have.
    await page.waitForSelector('.template-mode__cell', { timeout: 15_000 });
    if (screenshot !== undefined) await page.screenshot({ path: screenshot });

    await quit();
    expect(existsSync(marker) ? readFileSync(marker, 'utf8') : '').toBe('');
    expect(readFileSync(join(folder, 'template.html'), 'utf8')).toBe(original);
  });

  it('never puts the draft over a template file that changed: it opens beside it', async () => {
    const changed = `${original}<!-- mudou lá fora -->\n`;
    writeFileSync(join(folder, 'template.html'), changed, 'utf8');

    await launch();
    await modeOpen();

    await expect.poll(() => bufferText('markup')).toContain('mudou lá fora');
    expect(await bufferText('markup')).not.toContain(DRAFT);
    expect(await dirtyMarks('markup')).toBe(0);
    expect(await tabNames()).toContainEqual(expect.stringMatching(UNTITLED));
    await expect
      .poll(messages)
      .toMatch(/(mudou enquanto o Tyto|changed while Tyto).*: promo-curso\/template\.html/u);
    expect(readFileSync(join(folder, 'template.html'), 'utf8')).toBe(changed);
    await quit();
  });
});
