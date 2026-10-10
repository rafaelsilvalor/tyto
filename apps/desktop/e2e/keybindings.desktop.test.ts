import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The one keybinding table, through a real window (TYTO-207, ADR 0074).
 *
 * PR A moves every key onto one table and changes none, so this presses each one in each
 * input mode and asserts what it did on `origin/main`. Only a launched app has the real event
 * order between `@replit/codemirror-vim` and CodeMirror's keymaps, and only it sees the window
 * dispatcher registered twice (TYTO-101). The plugin is `editor.keymap`'s first consumer:
 * `alt+j` toggles the locale (`<html lang>`) with `when: vim.normal`. Own `TYTO_HOME` and
 * `--user-data-dir` (TYTO-139).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

function writeHome(home: string): void {
  const folder = join(home, 'plugins', 'teclas');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'teclas',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['editor.keymap'],
      permissions: [],
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'teclas', type: 'module' }));
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerKeymap({ id: 'idioma', bindings: { 'alt+j': 'shell.toggleLocale' }, when: 'vim.normal' });
}
`,
  );
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({ plugins: { teclas: { enabled: true, permissions: [], source: '.' } } }),
  );
}

let scratch: string;
let app: ElectronApplication;
let page: Page;

/** Counts the native dialogs main is asked for, and cancels each one. */
async function countDialogs(): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const counts = { open: 0, save: 0 };
    (globalThis as { __dialogs?: typeof counts }).__dialogs = counts;
    dialog.showOpenDialog = () => {
      counts.open += 1;
      return Promise.resolve({ canceled: true, filePaths: [] });
    };
    dialog.showSaveDialog = () => {
      counts.save += 1;
      return Promise.resolve({ canceled: true, filePath: '' });
    };
  });
}

const dialogs = (): Promise<{ open: number; save: number }> =>
  app.evaluate(() => (globalThis as { __dialogs?: { open: number; save: number } }).__dialogs!);

/**
 * Presses a key in the editor and says whether anything took it (`preventDefault`).
 *
 * The modifiers' own keydowns arrive first and nothing takes them, so the listener waits for
 * the key that is not one.
 */
async function pressInEditor(key: string): Promise<boolean> {
  await page.evaluate(() => {
    delete (window as { __taken?: boolean }).__taken;
    const listener = (event: KeyboardEvent): void => {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
      (window as { __taken?: boolean }).__taken = event.defaultPrevented;
      window.removeEventListener('keydown', listener);
    };
    window.addEventListener('keydown', listener);
  });
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
  return page.evaluate(() => (window as { __taken?: boolean }).__taken === true);
}

const text = (): Promise<string> =>
  page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent ?? '');
const tabCount = (): Promise<number> => page.locator('.tabs__tab').count();
const activeTab = (): Promise<number> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab')].findIndex((tab) =>
      tab.classList.contains('tabs__tab--on'),
    ),
  );
const barOpen = (): Promise<boolean> =>
  page.evaluate(() => {
    const input = document.querySelector<HTMLElement>('.command-bar__input');
    return input !== null && input.offsetParent !== null;
  });
const lang = (): Promise<string> => page.evaluate(() => document.documentElement.lang);

async function focusEditor(): Promise<void> {
  await page.click('#editor .cm-content');
}

/** Runs a command from the bar, filtered by id. */
async function runFromBar(id: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

/**
 * Vim's normal mode, read off the class the engine puts on the scroller (`cm-vimMode`), which
 * it takes off in insert mode — so a test waits for the mode instead of guessing it.
 */
const inVimNormal = (): Promise<boolean> =>
  page.evaluate(
    () => document.querySelector('#editor .cm-scroller')?.classList.contains('cm-vimMode') === true,
  );

async function vimNormal(): Promise<void> {
  await focusEditor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() =>
    document.querySelector('#editor .cm-scroller')?.classList.contains('cm-vimMode'),
  );
}

async function vimInsert(): Promise<void> {
  await vimNormal();
  await page.keyboard.press('i');
  await page.waitForFunction(
    () => !document.querySelector('#editor .cm-scroller')?.classList.contains('cm-vimMode'),
  );
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-keybindings-e2e-'));
  const home = join(scratch, 'tyto-home');
  writeHome(home);
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  await countDialogs();
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('every key the window answered before, with vim off', () => {
  it('undoes and redoes through all three bindings', async () => {
    await focusEditor();
    const before = await text();
    await page.keyboard.type('abc');
    expect(await text()).toBe(`${before}abc`);

    await page.keyboard.press('Control+z');
    expect(await text()).toBe(before);
    await page.keyboard.press('Control+y');
    expect(await text()).toBe(`${before}abc`);
    await page.keyboard.press('Control+z');
    // `KeyZ` and not `z`: with Shift a keyboard sends `Z`, and Playwright sends what it is
    // given — `Control+Shift+z` arrives as `z` with Shift, which CodeMirror reads as `Ctrl-z`.
    await page.keyboard.press('Control+Shift+KeyZ');
    expect(await text()).toBe(`${before}abc`);
  });

  it('opens find, finds next and previous, and goes to a line', async () => {
    await focusEditor();
    await page.keyboard.press('Control+f');
    await page.waitForSelector('#editor .cm-search');
    await page.keyboard.press('Escape');
    await focusEditor();

    // With no query, find next and previous open the panel and move focus into it, so the
    // editor is focused again before each one.
    for (const key of ['Control+g', 'Control+Shift+KeyG']) {
      await focusEditor();
      expect(await pressInEditor(key), key).toBe(true);
      await page.keyboard.press('Escape');
    }
    await focusEditor();
    await page.keyboard.press('Control+Alt+g');
    await page.waitForSelector('#editor .cm-goto-line');
    await page.click('#editor .cm-goto-line .cm-dialog-close');
  });

  it('asks main for the open and save dialogs, and leaves render unbound as it was', async () => {
    await focusEditor();
    const start = await dialogs();

    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+Shift+KeyS');
    await page.keyboard.press('Control+o');
    await page.waitForTimeout(300);

    expect(await dialogs()).toEqual({ open: start.open + 1, save: start.save + 2 });
    // `editor.render` is bound and the desktop registers no such command, so the key falls
    // through to CodeMirror's own `insertBlankLine` — the behaviour since E8.3, kept.
    await focusEditor();
    const lines = await page.locator('#editor .cm-line').count();
    await page.keyboard.press('Control+Enter');
    expect(await page.locator('#editor .cm-line').count()).toBe(lines + 1);
    await page.keyboard.press('Control+z');
  });

  it('makes, steps through, jumps to and closes tabs', async () => {
    await focusEditor();
    const count = await tabCount();
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(200);
    expect(await tabCount()).toBe(count + 1);
    expect(await activeTab()).toBe(count);

    await page.keyboard.press('Control+PageUp');
    expect(await activeTab()).toBe(count - 1);
    await page.keyboard.press('Control+PageDown');
    expect(await activeTab()).toBe(count);
    await page.keyboard.press('Control+1');
    expect(await activeTab()).toBe(0);

    await page.keyboard.press(`Control+${String(count + 1)}`);
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(200);
    expect(await tabCount()).toBe(count);
  });

  it('toggles the command bar with Ctrl+K, in the editor and out of it', async () => {
    await focusEditor();
    await page.keyboard.press('Control+k');
    expect(await barOpen()).toBe(true);
    await page.keyboard.press('Control+k');
    expect(await barOpen()).toBe(false);

    await page.click('.tabs__strip');
    await page.keyboard.press('Control+k');
    expect(await barOpen()).toBe(true);
    await page.keyboard.press('Escape');
  });

  it('leaves the plugin key alone, because it asked for vim normal mode', async () => {
    await focusEditor();
    const before = await lang();
    await page.keyboard.press('Alt+j');
    await page.waitForTimeout(150);
    expect(await lang()).toBe(before);
  });
});

describe('the keys vim keeps, in normal and in insert mode', () => {
  it('runs the plugin binding in normal mode once the plugins have answered', async () => {
    await runFromBar('editor.toggleVim');
    await vimNormal();

    // The plugins start after the window opens, so the binding arrives a moment later;
    // nothing in the DOM marks it except the binding working (see `panel-plugin`).
    const before = await lang();
    const started = Date.now();
    for (;;) {
      await page.keyboard.press('Alt+j');
      await page.waitForTimeout(150);
      if ((await lang()) !== before) break;
      if (Date.now() - started > 30_000) throw new Error('alt+j never reached the locale switch');
      await page.waitForTimeout(250);
    }
    // And back, so the rest of the suite reads the same window.
    await page.keyboard.press('Alt+j');
    expect(await lang()).toBe(before);
  }, 60_000);

  it('saves and opens the bar in normal mode, and leaves the desktop keys to vim', async () => {
    await vimNormal();
    const start = await dialogs();
    const count = await tabCount();

    await page.keyboard.press('Control+s');
    await page.waitForTimeout(300);
    expect((await dialogs()).save).toBe(start.save + 1);

    await page.keyboard.press('Control+n');
    await page.waitForTimeout(200);
    expect(await tabCount()).toBe(count);

    await page.keyboard.press('Control+k');
    expect(await barOpen()).toBe(true);
    await page.keyboard.press('Control+k');
    expect(await barOpen()).toBe(false);
  });

  it('saves and opens the bar in insert mode, where the plugin key does nothing', async () => {
    await vimInsert();
    const start = await dialogs();
    const before = await lang();

    await page.keyboard.press('Alt+j');
    await page.waitForTimeout(150);
    expect(await lang()).toBe(before);

    await page.keyboard.press('Control+s');
    await page.waitForTimeout(300);
    expect((await dialogs()).save).toBe(start.save + 1);

    expect(await inVimNormal()).toBe(false);
    await page.keyboard.press('Control+k');
    expect(await barOpen()).toBe(true);
    await page.keyboard.press('Control+k');
    expect(await barOpen()).toBe(false);
  });

  it('keeps the engine its own keys: u undoes what insert mode typed', async () => {
    await vimNormal();
    const before = await text();
    await vimInsert();
    await page.keyboard.type('xyz');
    await vimNormal();
    expect(await text()).toContain('xyz');

    await page.keyboard.press('u');
    await page.waitForTimeout(150);
    expect(await text()).toBe(before);

    await runFromBar('editor.toggleVim');
  });
});

describe('the dispatcher, after a rearrange (TYTO-101)', () => {
  it('opens the bar with one Ctrl+K after a panel was closed, and closes it with one more', async () => {
    await page.click('[data-panel="problems"] .panel__close');
    await page.waitForTimeout(400);
    await focusEditor();

    await page.keyboard.press('Control+k');
    expect(await barOpen()).toBe(true);
    await page.keyboard.press('Control+k');
    expect(await barOpen()).toBe(false);
  });
});
