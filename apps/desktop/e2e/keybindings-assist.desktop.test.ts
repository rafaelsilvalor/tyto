import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'jsonc-parser';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Suggestions and hover help in the `keybindings.json` tab, in a running app (TYTO-304,
 * ADR 0092).
 *
 * **What the unit suites cannot say**: that the tab opened from the command bar is built with
 * the help, that the window hands it the registry's commands with the command bar's titles, that
 * an entry built only from picks lands in the buffer CodeMirror saves, and that the key it binds
 * then runs. Every value is read back from the file on disk after a save, never from
 * `.cm-content`, which holds only the viewport.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139): the keybindings file is the subject.
 * Modified keys are pressed by code (`KeyE`), for the reason `keybindings.desktop.test.ts` gives.
 *
 * With `TYTO_KEYBINDINGS_ASSIST_SHOTS` set to a folder, the suite also leaves pictures of the
 * command list, the `when` list and the hover on a command, in Tyto Light and Tyto Dark.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_KEYBINDINGS_ASSIST_SHOTS'];

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

/** The file the tab opens with: one entry with an empty line to type on (line index 2). */
const START = '[\n  {\n    \n  }\n]\n';

interface Launched {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly keybindingsFile: string;
}

async function launch(scratch: string, text: string, settings?: string): Promise<Launched> {
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  const keybindingsFile = join(userData, 'keybindings.json');
  writeFileSync(keybindingsFile, text, 'utf8');
  if (settings !== undefined) writeFileSync(join(userData, 'settings.json'), settings, 'utf8');
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  const page = await firstWindow(app);
  // Something the script builds, never the markup it shipped with (TYTO-154).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  return { app, page, keybindingsFile };
}

/** A command run from the bar, as a person runs it. */
async function runCommand(page: Page, id: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
}

async function openKeybindings(page: Page): Promise<void> {
  await runCommand(page, 'keybindings.open');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tabs__tab')].some((tab) =>
      (tab.textContent ?? '').includes('keybindings.json'),
    ),
  );
  await page.waitForFunction(() => document.querySelectorAll('#editor .cm-line').length >= 4);
}

/** The caret at the end of the buffer's line `index` (0-based), by a click and End. */
async function endOfLine(page: Page, index: number): Promise<void> {
  await page.locator('#editor .cm-line').nth(index).click();
  await page.keyboard.press('End');
}

/** The labels of the open completion list. */
const listed = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.cm-tooltip-autocomplete .cm-completionLabel')].map(
      (label) => label.textContent ?? '',
    ),
  );

/** What the open list shows beside its selected entry. */
const info = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('.cm-completionInfo')?.textContent ?? '');

/** What the open list shows beside one label: its detail. */
const detailOf = (page: Page, label: string): Promise<string> =>
  page.evaluate((wanted) => {
    for (const option of document.querySelectorAll('.cm-tooltip-autocomplete li')) {
      if (option.querySelector('.cm-completionLabel')?.textContent === wanted) {
        return option.querySelector('.cm-completionDetail')?.textContent ?? '';
      }
    }
    return '';
  }, label);

/** Waits until the open list is exactly `labels`, or holds them all when `subset` is set. */
async function waitForList(page: Page, labels: readonly string[], subset = false): Promise<void> {
  await expect
    .poll(
      async () => {
        const shown = await listed(page);
        return subset ? labels.every((label) => shown.includes(label)) : shown.join(',');
      },
      { timeout: 15_000 },
    )
    .toBe(subset ? true : labels.join(','));
}

/** Past CodeMirror's 75 ms in which Enter would not accept, then Enter. */
async function accept(page: Page): Promise<void> {
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
}

/** The keybindings file as it is on disk, parsed as the app parses it. */
const onDisk = (file: string): unknown => parse(readFileSync(file, 'utf8')) as unknown;

/** The command bar's title for a command, read off the list the bar was handed. */
const barTitle = (page: Page, id: string): Promise<string | undefined> =>
  page.evaluate((wanted) => {
    const bar = document.querySelector('tyto-command-bar') as unknown as {
      commands: readonly { id: string; label: string }[];
    } | null;
    return bar?.commands.find((entry) => entry.id === wanted)?.label;
  }, id);

/** Moves the pointer over the middle of `word` in the buffer, where the hover asks. */
async function hoverOver(page: Page, word: string): Promise<void> {
  const point = await page.evaluate((target) => {
    const content = document.querySelector('#editor .cm-content');
    if (content === null) return null;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(target);
      if (at < 0) continue;
      const range = document.createRange();
      const middle = at + Math.floor(target.length / 2);
      range.setStart(node, middle);
      range.setEnd(node, middle + 1);
      const box = range.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    return null;
  }, word);
  if (point === null) throw new Error(`'${word}' is not on screen`);
  await page.mouse.move(point.x, point.y);
}

const hoverText = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('.cm-tooltip-hover')?.textContent ?? '');

const lang = (page: Page): Promise<string> => page.evaluate(() => document.documentElement.lang);

/** Presses a key and says whether the locale moved, putting it back if it did. */
async function togglesLocale(page: Page, key: string): Promise<boolean> {
  const before = await lang(page);
  await page.keyboard.press(key);
  await page.waitForTimeout(200);
  const moved = (await lang(page)) !== before;
  if (moved) {
    await page.keyboard.press(key);
    await expect.poll(() => lang(page), { timeout: 15_000 }).toBe(before);
  }
  return moved;
}

const CONTEXTS = ['editor', 'vim.normal', 'vim.insert', 'mode.desktop', 'commandBar', 'panel'];
const ENTRY = { key: 'ctrl+shift+e', command: 'shell.toggleLocale', when: 'editor' };

/** Builds `ENTRY` on the file's empty line, by picks wherever the tab suggests. */
async function buildEntry(page: Page): Promise<void> {
  await endOfLine(page, 2);
  await page.keyboard.type('"');
  await waitForList(page, ['key', 'command', 'when']);
  await page.keyboard.type('key');
  await waitForList(page, ['key']);
  await accept(page);
  await page.keyboard.type(ENTRY.key);
  await page.keyboard.press('End');
  await page.keyboard.type(',');
  await page.keyboard.press('Enter');
  await page.keyboard.type('"');
  // `key` is written, so it is not offered again.
  await waitForList(page, ['command', 'when']);
  await page.keyboard.type('comm');
  await waitForList(page, ['command']);
  await accept(page);
  await page.keyboard.type('shell.toggleLocale');
  await waitForList(page, ['shell.toggleLocale'], true);
  expect((await listed(page))[0]).toBe('shell.toggleLocale');
  await accept(page);
  await page.keyboard.press('End');
  await page.keyboard.type(',');
  await page.keyboard.press('Enter');
  await page.keyboard.type('"wh');
  await waitForList(page, ['when']);
  await accept(page);
  // Asked for by key inside the empty value: the whole closed set.
  await page.keyboard.press('Control+Space');
  await waitForList(page, CONTEXTS);
  // The selected context's sentence, from the table beside the closed list.
  await expect.poll(() => info(page)).toBe('The editor has focus, in either input mode.');
  await page.keyboard.type('editor');
  await waitForList(page, ['editor'], true);
  expect((await listed(page))[0]).toBe('editor');
  await accept(page);
}

describe('the keybindings tab’s suggestions and hover', () => {
  let scratch: string;
  let launched: Launched;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'tyto-keybindings-assist-e2e-'));
    launched = await launch(scratch, START);
    await openKeybindings(launched.page);
  });

  afterAll(async () => {
    await closeApp(launched.app);
    rmSync(scratch, { recursive: true, force: true });
  });

  it('lists command ids with the command bar’s titles', async () => {
    const { page } = launched;
    await endOfLine(page, 2);
    await page.keyboard.type('"command": "shell.toggleLoc');
    await waitForList(page, ['shell.toggleLocale'], true);
    const title = await barTitle(page, 'shell.toggleLocale');
    expect(title).toBeTruthy();
    expect(await detailOf(page, 'shell.toggleLocale')).toBe(title);
    // Put the line back as it was, for the entry built next.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('    ');
  });

  it('builds an entry from picks, saves it, and the key it binds runs', async () => {
    const { page } = launched;
    await buildEntry(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+s');
    await expect.poll(() => onDisk(launched.keybindingsFile), { timeout: 15_000 }).toEqual([ENTRY]);
    await page.locator('#editor .cm-content').click();
    await expect
      .poll(() => togglesLocale(page, 'Control+Shift+KeyE'), { timeout: 15_000 })
      .toBe(true);
  });

  it('explains a command on hover: its title', async () => {
    const { page } = launched;
    const title = await barTitle(page, 'shell.toggleLocale');
    await hoverOver(page, 'shell.toggleLocale');
    await expect.poll(() => hoverText(page), { timeout: 15_000 }).toContain(title ?? '<none>');
    await page.mouse.move(0, 0);
    await expect.poll(() => hoverText(page)).toBe('');
    await hoverOver(page, '"when"');
    await expect.poll(() => hoverText(page), { timeout: 15_000 }).toMatch(/one of six contexts/u);
  });

  it('suggests with vim on, in insert mode', async () => {
    const { page } = launched;
    await page.mouse.move(0, 0);
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(START);
    await runCommand(page, 'editor.toggleVim');
    await page.waitForSelector('tyto-status-bar .status-bar__vim');
    await page.locator('#editor .cm-line').nth(2).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('A');
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector('.shell__foot')?.getAttribute('data-vim-mode')),
      )
      .toBe('insert');
    await page.keyboard.type('"key": "ctrl+shift+l", "when": "vim.ins');
    await waitForList(page, ['vim.insert'], true);
    await accept(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => onDisk(launched.keybindingsFile), { timeout: 15_000 })
      .toEqual([{ key: 'ctrl+shift+l', when: 'vim.insert' }]);
  });
});

describe.runIf(shots !== undefined)('pictures of the help, for the card', () => {
  for (const theme of ['tyto-light', 'tyto-dark']) {
    it(`in ${theme}`, async () => {
      const scratch = mkdtempSync(join(tmpdir(), 'tyto-keybindings-assist-shots-'));
      const { app, page } = await launch(
        scratch,
        '[\n  { "key": "ctrl+shift+e", "command": "shell.toggleLocale" },\n  {\n    \n  }\n]\n',
        `{\n  "theme": "${theme}"\n}\n`,
      );
      try {
        mkdirSync(shots!, { recursive: true });
        await openKeybindings(page);
        await page.waitForTimeout(500);
        await endOfLine(page, 3);
        await page.keyboard.type('"key": "ctrl+shift+n", "command": "doc');
        await waitForList(page, ['document.new'], true);
        await page.screenshot({ path: join(shots!, `${theme}-commands.png`) });
        // The pick closes the string, so the next field starts after it.
        await accept(page);
        await page.keyboard.type(', "when": "');
        await page.keyboard.press('Control+Space');
        await waitForList(page, CONTEXTS);
        await page.screenshot({ path: join(shots!, `${theme}-when.png`) });
        // A whole entry again, so the hover is not shown beside a warning about the line.
        await page.keyboard.type('panel');
        await waitForList(page, ['panel'], true);
        await accept(page);
        await page.keyboard.press('Escape');
        await expect
          .poll(() => page.evaluate(() => document.querySelectorAll('.problems__row').length))
          .toBe(0);
        // A command with a default key, so the picture shows it.
        await hoverOver(page, 'document.new');
        await expect.poll(() => hoverText(page), { timeout: 15_000 }).toMatch(/Ctrl\+n/iu);
        await page.screenshot({ path: join(shots!, `${theme}-hover-command.png`) });
      } finally {
        await closeApp(app);
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  }
});
