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
 * Suggestions and hover help in the `settings.json` tab, in a running app (TYTO-304, ADR 0092).
 *
 * **What the unit suites cannot say**: that `settings:outline` reaches the window, that the tab
 * opened from the command bar is built with the help, that a pick lands in the buffer CodeMirror
 * saves, and that it works with vim on. Every value is read back from the file on disk after a
 * save, never from `.cm-content`, which holds only the viewport.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139): the settings file is the subject.
 *
 * With `TYTO_SETTINGS_ASSIST_SHOTS` set to a folder, the suite also leaves pictures of the key
 * list, the `vimModeStyle` list and the hover on `statusBarColors`, in Tyto Light and Tyto Dark.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_SETTINGS_ASSIST_SHOTS'];

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

/** The file the tab opens with: one object setting to hover, and an empty line to type on. */
const START = '{\n  "statusBarColors": {},\n  \n}\n';

interface Launched {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly settingsFile: string;
}

async function launch(scratch: string, text: string): Promise<Launched> {
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  const settingsFile = join(userData, 'settings.json');
  writeFileSync(settingsFile, text, 'utf8');
  const app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  const page = await firstWindow(app);
  // Something the script builds, never the markup it shipped with (TYTO-154).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  return { app, page, settingsFile };
}

/** A command run from the bar, as a person runs it. */
async function runCommand(page: Page, id: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
}

async function openSettings(page: Page): Promise<void> {
  await runCommand(page, 'settings.open');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tabs__tab')].some((tab) =>
      (tab.textContent ?? '').includes('settings.json'),
    ),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#editor .cm-line')].some((line) =>
      (line.textContent ?? '').includes('statusBarColors'),
    ),
  );
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

/** What the open list shows beside its selected entry. */
const info = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('.cm-completionInfo')?.textContent ?? '');

/** Past CodeMirror's 75 ms in which Enter would not accept, then Enter. */
async function accept(page: Page): Promise<void> {
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
}

/** The settings file as it is on disk, parsed as the app parses it. */
const onDisk = (file: string): Record<string, unknown> =>
  (parse(readFileSync(file, 'utf8')) ?? {}) as Record<string, unknown>;

async function waitForDisk(file: string, key: string, value: unknown): Promise<void> {
  await expect.poll(() => onDisk(file)[key], { timeout: 15_000 }).toEqual(value);
}

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

/** The problems panel's codes. */
const problemCodes = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__row .problems__code')].map(
      (code) => code.textContent ?? '',
    ),
  );

const KEYS = [
  'templatesFolder',
  'queueFolder',
  'queueAutoRun',
  'queueKinds',
  'theme',
  'iconStrokeWidth',
  'statusBarItems',
  'vimModeStyle',
  'indentGuides',
  'stickyScroll',
];

describe('the settings tab’s suggestions and hover', () => {
  let scratch: string;
  let launched: Launched;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'tyto-settings-assist-e2e-'));
    launched = await launch(scratch, START);
    await openSettings(launched.page);
  });

  afterAll(async () => {
    await closeApp(launched.app);
    rmSync(scratch, { recursive: true, force: true });
  });

  it('lists every setting not yet written on a quote, with its description', async () => {
    const { page } = launched;
    await endOfLine(page, 2);
    await page.keyboard.type('"');
    await waitForList(page, KEYS, true);
    // `statusBarColors` is already in the file, so it is not offered again.
    expect(await listed(page)).not.toContain('statusBarColors');
    await page.keyboard.type('vimMode');
    await waitForList(page, ['vimModeStyle']);
    await expect.poll(() => info(page)).toMatch(/How the status bar shows vim's mode/u);
  });

  it("writes the key with its default, then lists vimModeStyle's three values", async () => {
    const { page } = launched;
    await accept(page);
    // The default is selected, so a quote typed over it starts the value afresh.
    await page.keyboard.type('"');
    await waitForList(page, ['badge', 'border', 'bar']);
    await page.keyboard.type('bar');
    await waitForList(page, ['bar']);
    await expect.poll(() => info(page)).toMatch(/whole bar/u);
    await accept(page);
    await page.keyboard.press('Control+s');
    await waitForDisk(launched.settingsFile, 'vimModeStyle', 'bar');
    expect(onDisk(launched.settingsFile)['statusBarColors']).toEqual({});
  });

  it('explains statusBarColors on hover: its description, its default and its keys', async () => {
    const { page } = launched;
    await page.keyboard.press('Escape');
    await hoverOver(page, 'statusBarColors');
    await expect.poll(() => hoverText(page), { timeout: 15_000 }).toMatch(/win over the theme/u);
    const text = await hoverText(page);
    expect(text).toContain('Default: {}');
    // Each key once, with its own sentence, and the description's prose list left out.
    expect(text.split('vimMode.normal')).toHaveLength(2);
    expect(text).toContain("background — The bar's background.");
    // Shorter than the editor, so it never covers the whole window.
    const heights = await page.evaluate(() => ({
      tooltip: document.querySelector('.cm-tooltip-hover')?.getBoundingClientRect().height ?? 0,
      editor: document.querySelector('#editor')?.getBoundingClientRect().height ?? 0,
    }));
    expect(heights.tooltip).toBeGreaterThan(0);
    expect(heights.tooltip).toBeLessThan(heights.editor);
  });

  it('still lists a bad value in the problems panel', async () => {
    const { page } = launched;
    await page.mouse.move(0, 0);
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('{\n  "vimModeStyle": "nope",\n  \n}\n');
    await expect.poll(() => problemCodes(page), { timeout: 15_000 }).toContain('W_SETTING_INVALID');
  });

  it('suggests and completes with vim on, in insert mode', async () => {
    const { page } = launched;
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('{\n  "vimModeStyle": "bar",\n  \n}\n');
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
    await page.keyboard.type('"queueAuto');
    await waitForList(page, ['queueAutoRun']);
    await accept(page);
    // `false`, the default, is selected; a `t` over it asks for the boolean's values.
    await page.keyboard.type('t');
    await waitForList(page, ['true']);
    await accept(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+s');
    await waitForDisk(launched.settingsFile, 'queueAutoRun', true);
    expect(onDisk(launched.settingsFile)['vimModeStyle']).toBe('bar');
  });
});

describe.runIf(shots !== undefined)('pictures of the help, for the card', () => {
  for (const theme of ['tyto-light', 'tyto-dark']) {
    it(`in ${theme}`, async () => {
      const scratch = mkdtempSync(join(tmpdir(), 'tyto-settings-assist-shots-'));
      const { app, page } = await launch(
        scratch,
        `{\n  "theme": "${theme}",\n  "statusBarItems": ["leftArea"],\n  "statusBarColors": {},\n  \n}\n`,
      );
      try {
        mkdirSync(shots!, { recursive: true });
        await openSettings(page);
        await page.waitForTimeout(500);
        await endOfLine(page, 4);
        await page.keyboard.type('"');
        await waitForList(page, ['vimModeStyle'], true);
        await page.screenshot({ path: join(shots!, `${theme}-keys.png`) });
        await page.keyboard.type('vimMode');
        await waitForList(page, ['vimModeStyle']);
        await accept(page);
        await page.keyboard.type('"');
        await waitForList(page, ['badge', 'border', 'bar']);
        await page.screenshot({ path: join(shots!, `${theme}-vim-mode-style.png`) });
        await page.keyboard.press('Escape');
        await hoverOver(page, 'statusBarColors');
        await expect.poll(() => hoverText(page), { timeout: 15_000 }).toMatch(/win over/u);
        await page.screenshot({ path: join(shots!, `${theme}-hover-status-bar-colors.png`) });
        if (theme === 'tyto-light') {
          await page.mouse.move(0, 0);
          await expect.poll(() => hoverText(page)).toBe('');
          await hoverOver(page, 'statusBarItems');
          await expect.poll(() => hoverText(page), { timeout: 15_000 }).toMatch(/leftArea —/u);
          await page.screenshot({ path: join(shots!, `${theme}-hover-status-bar-items.png`) });
        }
      } finally {
        await closeApp(app);
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  }
});
