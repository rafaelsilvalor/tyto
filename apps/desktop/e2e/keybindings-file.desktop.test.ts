import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * `keybindings.json` as a tab, in a running app (TYTO-207, ADR 0074, PR B).
 *
 * **What the unit suites cannot say.** `keybindings-file.test.ts` reads the text and
 * `keybindings-live.test.ts` plays the watcher; nothing there proves the watcher is wired, that
 * the window resolves the saved file into the table its editor and its dispatcher run, or that a
 * diagnostic reaches the problems panel at the entry it is about. This walks the route a person
 * takes: the command bar, the tab, a save, and the key working with no restart.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139): the keybindings file is the subject,
 * and the machine's own must never be the one opened, written or watched. Modified keys are
 * pressed by code (`KeyE`), for the reason `keybindings.desktop.test.ts` gives.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

let scratch: string;
let userData: string;
let app: ElectronApplication;
let page: Page;

/** Replaces the whole buffer in front, as typing over it would. */
async function typeOver(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}

/** Types the file and saves it from its tab, the way a person does. */
async function saveFile(text: string): Promise<void> {
  await typeOver(text);
  await page.keyboard.press('Control+s');
  await waitFor(
    () => Promise.resolve(readFileSync(join(userData, 'keybindings.json'), 'utf8') === text),
    'the save to reach the disk',
  );
}

/** The key the command bar shows beside a command, read off the list it was handed. */
const shownKey = (id: string): Promise<string | undefined> =>
  page.evaluate((wanted) => {
    const bar = document.querySelector('tyto-command-bar') as unknown as {
      commands: readonly { id: string; binding?: string }[];
    } | null;
    return bar?.commands.find((entry) => entry.id === wanted)?.binding;
  }, id);

/** The problems panel's rows as `code@line:column`. */
const problems = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map(
      (row) =>
        `${row.querySelector('.problems__code')?.textContent ?? ''}@${row.querySelector('.problems__where')?.textContent ?? ''}`,
    ),
  );

const lang = (): Promise<string> => page.evaluate(() => document.documentElement.lang);
const tabCount = (): Promise<number> => page.locator('.tabs__tab').count();
const barOpen = (): Promise<boolean> =>
  page.evaluate(() => {
    const input = document.querySelector<HTMLElement>('.command-bar__input');
    return input !== null && input.offsetParent !== null;
  });

async function waitFor(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Presses a key and says whether the locale moved, putting it back if it did. */
async function togglesLocale(key: string): Promise<boolean> {
  const before = await lang();
  await page.keyboard.press(key);
  await page.waitForTimeout(200);
  const moved = (await lang()) !== before;
  if (moved) {
    await page.keyboard.press(key);
    await waitFor(async () => (await lang()) === before, 'the locale to come back');
  }
  return moved;
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

const vimClass = (): Promise<boolean> =>
  page.evaluate(
    () => document.querySelector('#editor .cm-scroller')?.classList.contains('cm-vimMode') === true,
  );

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-keybindings-file-e2e-'));
  userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

const BIND = '[\n  { "key": "ctrl+shift+e", "command": "shell.toggleLocale" }\n]\n';

describe('the keybindings tab', () => {
  it('opens from the command bar, creating the file it opens', async () => {
    await runFromBar('keybindings.open');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tabs__tab')].some((tab) =>
        (tab.textContent ?? '').includes('keybindings.json'),
      ),
    );
    expect(readFileSync(join(userData, 'keybindings.json'), 'utf8')).toContain('Tyto keybindings');
  });

  it('applies a saved binding with no restart, and the bar shows the key', async () => {
    expect(await togglesLocale('Control+Shift+KeyE')).toBe(false);

    await saveFile(BIND);

    await waitFor(
      async () => (await shownKey('shell.toggleLocale'))?.toLowerCase() === 'ctrl+shift+e',
      'the bar to show Ctrl+Shift+E',
    );
    await page.click('#editor .cm-content');
    expect(await togglesLocale('Control+Shift+KeyE')).toBe(true);
  });

  it('frees a default key with -command, and binds one only in vim normal mode', async () => {
    const count = await tabCount();
    expect(await shownKey('document.new')).toBeDefined();

    await saveFile(
      [
        '[',
        '  { "key": "ctrl+shift+e", "command": "shell.toggleLocale" },',
        '  { "key": "ctrl+n", "command": "-document.new" },',
        '  { "key": "alt+l", "command": "shell.toggleLocale", "when": "vim.normal" }',
        ']',
        '',
      ].join('\n'),
    );
    await waitFor(
      async () => (await shownKey('document.new')) === undefined,
      'Ctrl+N to leave document.new',
    );

    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(300);
    expect(await tabCount()).toBe(count);

    // Vim off: the entry's context does not hold.
    expect(await togglesLocale('Alt+KeyL')).toBe(false);

    await runFromBar('editor.toggleVim');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Escape');
    await waitFor(vimClass, 'vim normal mode');
    expect(await togglesLocale('Alt+KeyL')).toBe(true);

    await page.keyboard.press('i');
    await waitFor(async () => !(await vimClass()), 'vim insert mode');
    expect(await togglesLocale('Alt+KeyL')).toBe(false);
    await page.keyboard.press('Escape');
    await runFromBar('editor.toggleVim');
  });

  it('shows an unknown command and a locked key at their lines, and Ctrl+K still opens the bar', async () => {
    await typeOver(
      [
        '[',
        '  { "key": "ctrl+shift+e", "command": "shell.toggleLocale" },',
        '  { "key": "ctrl+shift+u", "command": "no.such.command" },',
        '  { "key": "ctrl+k", "command": "-commandBar.toggle" }',
        ']',
        '',
      ].join('\n'),
    );

    await waitFor(
      async () => {
        const rows = await problems();
        return (
          rows.includes('W_KEYBINDING_UNKNOWN_COMMAND@3:3') &&
          rows.includes('W_KEYBINDING_LOCKED@4:3')
        );
      },
      `the two warnings, the panel shows ${JSON.stringify(await problems())}`,
    );

    await page.keyboard.press('Control+s');
    await page.waitForTimeout(800);
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+k');
    expect(await barOpen()).toBe(true);
    await page.keyboard.press('Escape');
  });

  it('keeps the last good keys when a saved file does not parse', async () => {
    await typeOver('[\n  { "key": "ctrl+shift+e", "command": \n');
    await waitFor(
      async () => (await problems()).some((row) => row.startsWith('E_KEYBINDINGS_SYNTAX@')),
      'the syntax error in the problems panel',
    );
    await page.keyboard.press('Control+s');
    // Longer than the watcher's settle time, several times over.
    await page.waitForTimeout(1_500);

    await page.click('#editor .cm-content');
    expect(await togglesLocale('Control+Shift+KeyE')).toBe(true);
  });
});
