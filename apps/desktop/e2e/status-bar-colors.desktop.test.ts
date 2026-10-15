import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEME_PACK_FILES, THEME_PACK_THEMES } from '@tyto/theme-pack';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { STATUS_BAR_COLOUR_KEYS, badgeText } from '../shared/status-bar-colors.js';
import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The `statusBarColors` override through the real window (TYTO-301, ADR 0091): a save
 * repaints the bar with no restart, removing the override gives the theme's colours back, a
 * bad colour is a diagnostic at that value while the theme's colour stays, and the vim badge's
 * colours move. The unit tests hold the rules and the sheet's text; this file holds that the
 * colours land.
 *
 * The first half types into the settings tab, because the diagnostics are the tab's. The vim
 * half writes `settings.json` on disk instead — main applies any writer's save — so the
 * editor's vim keys never type into the settings text.
 *
 * With `TYTO_STATUS_BAR_COLOR_SHOTS` set to a folder, the suite also leaves pictures of the bar
 * in Tyto Light, Tyto Dark and Dracula, with and without an override, and of the new file.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_STATUS_BAR_COLOR_SHOTS'];

/** A theme's colours by token, from the file the app applies. */
const coloursOf = (id: string): Readonly<Record<string, string>> => {
  if (id === 'tyto-light' || id === 'tyto-dark') {
    const file = join(here, '..', 'src', 'main', 'themes', `${id}.json`);
    return (JSON.parse(readFileSync(file, 'utf8')) as { colors: Record<string, string> }).colors;
  }
  const theme = THEME_PACK_THEMES.find((candidate) => candidate.id === id);
  const file = theme === undefined ? undefined : THEME_PACK_FILES[theme.path];
  if (file === undefined) throw new Error(`no theme '${id}'`);
  return file.colors;
};

/** `#rrggbb` as `getComputedStyle` reports it. */
const computed = (hex: string): string => {
  const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
};

/** Where a fragment of the text starts, as the problems panel writes it: `line:column`. */
const whereOf = (text: string, fragment: string): string => {
  const before = text.slice(0, text.indexOf(fragment));
  const lines = before.split('\n');
  return `${String(lines.length)}:${String((lines.at(-1)?.length ?? 0) + 1)}`;
};

const LIGHT = coloursOf('tyto-light');
const BRIEF = '---\ntemplate: promo-curso\n---\n::titulo Direito\n';
const OVERRIDE = {
  background: '#1e3a5f',
  'item.tabKind': '#ffd866',
  'vimMode.normal': '#0b7285',
  'vimMode.insert': '#e8590c',
};

let app: ElectronApplication;
let page: Page;
let scratch: string;
let settingsFile: string;

const bar = (): Promise<{ background: string; tabKind: string }> =>
  page.evaluate(() => {
    const foot = getComputedStyle(document.querySelector('.shell__foot')!);
    const kind = document.querySelector("tyto-status-bar [data-item='tabKind']");
    return {
      background: foot.backgroundColor,
      tabKind: kind === null ? '' : getComputedStyle(kind).color,
    };
  });

const badge = (): Promise<{ mode: string; background: string; color: string }> =>
  page.evaluate(() => {
    const found = document.querySelector('tyto-status-bar .status-bar__vim');
    if (found === null) return { mode: '', background: '', color: '' };
    const style = getComputedStyle(found);
    return {
      mode: found.getAttribute('data-mode') ?? '',
      background: style.backgroundColor,
      color: style.color,
    };
  });

const problems = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map(
      (row) =>
        `${row.querySelector('.problems__code')?.textContent ?? ''}@${row.querySelector('.problems__where')?.textContent ?? ''}`,
    ),
  );

/** Waits until the window paints `theme`'s surface: its answer has landed. */
const themeApplied = (theme: string): Promise<unknown> =>
  page.waitForFunction(
    (expected) => getComputedStyle(document.body).backgroundColor === expected,
    computed(coloursOf(theme)['surface']!),
    { polling: 25, timeout: 15_000 },
  );

async function openSettings(): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('settings.open');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tabs__tab')].some((tab) =>
      (tab.textContent ?? '').includes('settings.json'),
    ),
  );
}

/** Replaces the tab's text, as a person typing over it would, and saves it. */
async function saveSettings(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
}

const settingsText = (colours: Record<string, string> | undefined, theme = 'tyto-light'): string =>
  `{\n  "theme": "${theme}"${
    colours === undefined
      ? ''
      : `,\n  "statusBarColors": {\n${Object.entries(colours)
          .map(([key, value]) => `    "${key}": "${value}"`)
          .join(',\n')}\n  }`
  }\n}\n`;

const showTab = async (settings: boolean): Promise<void> => {
  const tabs = page.locator('.tabs__tab');
  await (
    settings
      ? tabs.filter({ hasText: 'settings.json' })
      : tabs.filter({ hasNotText: 'settings.json' })
  )
    .first()
    .click();
};

/** A picture of the whole bar, when pictures were asked for. */
const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  const box = await page.evaluate(() => {
    const foot = document.querySelector('.shell__foot')!.getBoundingClientRect();
    return { x: foot.x, y: foot.y, width: foot.width, height: foot.height };
  });
  await page.screenshot({ path: join(shots, `${name}.png`), clip: box });
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-status-bar-colors-'));
  settingsFile = join(scratch, 'user-data', 'settings.json');
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector("tyto-status-bar [data-item='tabKind']");
  // A brief in the first tab, so opening settings.json adds a tab instead of replacing it.
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(BRIEF);
  await page.keyboard.press('Escape');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the statusBarColors setting', () => {
  it('carries the key commented out, with every key and an example, in a new settings.json', async () => {
    await openSettings();
    // From the disk, not from `.cm-content`, which holds only the lines in the viewport.
    const text = readFileSync(settingsFile, 'utf8');

    expect(text).toContain('// "statusBarColors": {');
    for (const { key, example } of STATUS_BAR_COLOUR_KEYS) {
      expect(text).toContain(`"${key}": "${example}"`);
    }
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      // Down to the colours, which follow the items' example.
      await page.hover('#editor .cm-content');
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(shots, 'settings-json-new.png') });
    }
  });

  it("paints the theme's bar while the setting says nothing", async () => {
    await saveSettings(settingsText(undefined));
    await themeApplied('tyto-light');

    await expect.poll(bar, { timeout: 15_000 }).toEqual({
      background: computed(LIGHT['status-bar']!),
      tabKind: computed(LIGHT['status-bar-text']!),
    });
  });

  it('repaints the bar and one item on save, with no restart', async () => {
    await saveSettings(settingsText({ background: '#1e3a5f', 'item.tabKind': '#ffd866' }));

    await expect
      .poll(bar, { timeout: 15_000 })
      .toEqual({ background: computed('#1e3a5f'), tabKind: computed('#ffd866') });
  });

  it("points at a bad colour and an unknown key, and keeps the theme's colour there", async () => {
    const text = settingsText({ background: 'red', clock: '#000000', 'item.tabKind': '#ffd866' });
    await saveSettings(text);

    await expect
      .poll(problems, { timeout: 15_000 })
      .toEqual(
        expect.arrayContaining([
          `W_SETTING_INVALID@${whereOf(text, '"red"')}`,
          `W_SETTING_ENTRY_INVALID@${whereOf(text, '"clock"')}`,
        ]),
      );
    // The bad background falls back to the theme's; the item's good colour still applies.
    await expect
      .poll(bar, { timeout: 15_000 })
      .toEqual({ background: computed(LIGHT['status-bar']!), tabKind: computed('#ffd866') });
  });

  it('warns at a vim colour no text of the theme reads on, with the ratio', async () => {
    const text = settingsText({ 'vimMode.insert': '#808080' });
    await saveSettings(text);

    await expect
      .poll(problems, { timeout: 15_000 })
      .toContain(`W_SETTING_LOW_CONTRAST@${whereOf(text, '"#808080"')}`);
  });

  it("gives the theme's colours back when the override is removed", async () => {
    await saveSettings(settingsText({ background: '#1e3a5f', 'item.tabKind': '#ffd866' }));
    await expect.poll(bar, { timeout: 15_000 }).toMatchObject({ background: computed('#1e3a5f') });

    await saveSettings(settingsText(undefined));

    await expect.poll(bar, { timeout: 15_000 }).toEqual({
      background: computed(LIGHT['status-bar']!),
      tabKind: computed(LIGHT['status-bar-text']!),
    });
  });

  describe('with vim on', () => {
    beforeAll(async () => {
      await showTab(false);
      await page.click('#editor .cm-content');
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.command-bar__input', { state: 'visible' });
      await page.keyboard.type('editor.toggleVim');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await page.waitForSelector('tyto-status-bar .status-bar__vim');
      await page.click('#editor .cm-content');
      await page.keyboard.press('Escape');
    });

    /** The badge in `mode`, after the keys that reach it from normal mode. */
    const inMode = async (keys: readonly string[]): Promise<void> => {
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await badge()).mode, { timeout: 5_000 }).toBe('normal');
      for (const key of keys) await page.keyboard.press(key);
    };

    it('colours NORMAL and INSERT with the override, and its text is the theme’s best', async () => {
      writeFileSync(settingsFile, settingsText(OVERRIDE), 'utf8');

      await inMode([]);
      await expect.poll(badge, { timeout: 15_000 }).toEqual({
        mode: 'normal',
        background: computed(OVERRIDE['vimMode.normal']),
        color: computed(badgeText(OVERRIDE['vimMode.normal'], LIGHT)!.colour),
      });
      await inMode(['i']);
      await expect.poll(badge, { timeout: 15_000 }).toEqual({
        mode: 'insert',
        background: computed(OVERRIDE['vimMode.insert']),
        color: computed(badgeText(OVERRIDE['vimMode.insert'], LIGHT)!.colour),
      });
      // A mode the override does not name keeps the theme's colours.
      await inMode(['v']);
      await expect.poll(badge, { timeout: 15_000 }).toEqual({
        mode: 'visual',
        background: computed(LIGHT['status-bar-vim-visual']!),
        color: computed(LIGHT['status-bar-vim-visual-text']!),
      });
    });

    it("gives the badge the theme's colours back when the override is removed", async () => {
      writeFileSync(settingsFile, settingsText(undefined), 'utf8');

      await inMode([]);
      await expect.poll(badge, { timeout: 15_000 }).toEqual({
        mode: 'normal',
        background: computed(LIGHT['status-bar-vim-normal']!),
        color: computed(LIGHT['status-bar-vim-normal-text']!),
      });
    });

    it.runIf(shots !== undefined)(
      'leaves pictures of the bar in three themes, with and without the override',
      async () => {
        for (const theme of ['tyto-light', 'tyto-dark', 'dracula']) {
          writeFileSync(settingsFile, settingsText(undefined, theme), 'utf8');
          await themeApplied(theme);
          await inMode([]);
          await expect
            .poll(async () => (await badge()).background, { timeout: 15_000 })
            .toBe(computed(coloursOf(theme)['status-bar-vim-normal']!));
          await shoot(`${theme}-theme-normal`);

          writeFileSync(settingsFile, settingsText(OVERRIDE, theme), 'utf8');
          await expect
            .poll(async () => (await badge()).background, { timeout: 15_000 })
            .toBe(computed(OVERRIDE['vimMode.normal']));
          await shoot(`${theme}-override-normal`);
          await inMode(['i']);
          await expect
            .poll(async () => (await badge()).background, { timeout: 15_000 })
            .toBe(computed(OVERRIDE['vimMode.insert']));
          await shoot(`${theme}-override-insert`);
        }
      },
      120_000,
    );
  });
});
