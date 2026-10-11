import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Choosing a colour theme, through the real window (TYTO-208, ADR 0077).
 *
 * An installed plugin, `sepia`, ships a light theme from `__fixtures__/plugins/sepia` that sets
 * nine colours and leaves the rest to Tyto Light. The suite picks it from Ctrl+K and watches
 * `--tyto-surface` follow the highlighted row; Escape puts the previous theme back; Enter writes
 * the `theme` setting and a restart keeps it. `mode` overrides the system for the window and the
 * editor alike, and a theme file that does not parse is a row in the problems panel while the
 * window falls back to the base theme and keeps working.
 *
 * Playwright emulates a light colour scheme unless told otherwise, and an emulated value
 * outranks the one Electron answers from `nativeTheme.themeSource` — the value the `mode` sets.
 * So the media emulation is handed back to Electron on every launch.
 *
 * With `TYTO_THEME_SHOTS` set to a folder, the suite leaves five CDP screenshots there at
 * 900x600: the picker open, the test theme applied, `mode: "light"` and `mode: "dark"`, and
 * the fallback from a malformed theme.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const fixture = join(here, '__fixtures__', 'plugins', 'sepia');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

/** `--tyto-surface` as `getComputedStyle` reports the body's background. */
const SEPIA = 'rgb(244, 236, 216)';
const LIGHT = 'rgb(250, 250, 250)';
const DARK = 'rgb(40, 44, 51)';

/** The plugin's entry: it registers the theme and nothing else. Data, so no code applies it. */
const ENTRY = `export function activate(host) {
  host.registerTheme({ id: 'sepia', label: 'Sepia', kind: 'light', path: 'themes/sepia.json' });
}
`;

const shots = process.env['TYTO_THEME_SHOTS'];

let scratch: string;
let home: string;
let userData: string;
let app: ElectronApplication;
let page: Page;

function installSepia(): void {
  const folder = join(home, 'plugins', 'sepia');
  cpSync(fixture, folder, { recursive: true });
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(join(folder, 'dist', 'index.js'), ENTRY);
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'sepia', type: 'module' }));
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({ plugins: { sepia: { enabled: true, permissions: [], source: '.' } } }),
  );
}

async function launch(): Promise<void> {
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.emulateMedia({ colorScheme: null });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 600);
  });
}

const surface = (): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** Waits for the body to take a colour: a theme answer and a media query land on a frame. */
async function waitForSurface(colour: string): Promise<void> {
  await page.waitForFunction(
    (expected) => getComputedStyle(document.body).backgroundColor === expected,
    colour,
    { polling: 25, timeout: 15_000 },
  );
}

/** Ctrl+K, the command, Enter, and the picker's rows once the installed theme is among them. */
async function openPicker(): Promise<string[]> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('theme.pick');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.command-bar__label')].some(
        (label) => label.textContent === 'Sepia',
      ),
    undefined,
    { timeout: 30_000 },
  );
  return page.evaluate(() =>
    [...document.querySelectorAll('.command-bar__option')].map((row) =>
      [...row.querySelectorAll('span')].map((part) => part.textContent ?? '').join(' / '),
    ),
  );
}

const settingsFile = (): string => join(userData, 'settings.json');

const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

beforeAll(async () => {
  // Its own data folders, never the machine's (TYTO-139).
  scratch = mkdtempSync(join(tmpdir(), 'tyto-theme-pick-e2e-'));
  home = join(scratch, 'tyto-home');
  userData = join(scratch, 'user-data');
  installSepia();
  await launch();
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('Preferences: Color Theme', () => {
  it('lists every theme with its kind, the installed plugin’s among them', async () => {
    // `label / kind`, the kind in the window's language, which is the system's.
    const rows = new Map((await openPicker()).map((row) => row.split(' / ') as [string, string]));
    expect([...rows.keys()]).toEqual(expect.arrayContaining(['Tyto Light', 'Tyto Dark', 'Sepia']));
    expect(rows.get('Sepia')).toBe(rows.get('Tyto Light'));
    expect(rows.get('Tyto Dark')).not.toBe(rows.get('Tyto Light'));
    await shoot('picker-open');
    await page.keyboard.press('Escape');
  }, 60_000);

  it('previews the highlighted theme live, and Escape puts the previous one back', async () => {
    const before = await surface();
    await openPicker();
    await page.keyboard.type('sepia');
    await waitForSurface(SEPIA);
    await page.keyboard.press('Escape');
    await waitForSurface(before);
    // A preview is never written.
    expect(existsSync(settingsFile()) ? readFileSync(settingsFile(), 'utf8') : '').not.toContain(
      'sepia',
    );
  }, 60_000);

  it('writes the choice on Enter, and the theme survives a restart', async () => {
    await openPicker();
    await page.keyboard.type('sepia');
    await waitForSurface(SEPIA);
    await page.keyboard.press('Enter');
    await expect
      .poll(() => readFileSync(settingsFile(), 'utf8'), { timeout: 10_000 })
      .toContain('"sepia"');
    await waitForSurface(SEPIA);
    await shoot('sepia-applied');

    await closeApp(app);
    await launch();
    await waitForSurface(SEPIA);
    expect(await surface()).toBe(SEPIA);
  }, 120_000);
});

describe('the mode overrides the system', () => {
  const editorLook = (): Promise<{ background: string; classes: string }> =>
    page.evaluate(() => {
      const editor = document.querySelector('#editor .cm-editor')!;
      return {
        background: getComputedStyle(editor).backgroundColor,
        // CodeMirror marks its light and dark base themes with a class of each.
        classes: [...editor.classList].sort().join(' '),
      };
    });

  it('paints the window and the editor dark with mode dark, and light with mode light', async () => {
    const slots = { light: 'tyto-light', dark: 'tyto-dark' };
    writeFileSync(settingsFile(), JSON.stringify({ theme: { mode: 'light', ...slots } }), 'utf8');
    await waitForSurface(LIGHT);
    const light = await editorLook();
    expect(light.background).toBe(LIGHT);
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
    await shoot('mode-light');

    writeFileSync(settingsFile(), JSON.stringify({ theme: { mode: 'dark', ...slots } }), 'utf8');
    await waitForSurface(DARK);
    const dark = await editorLook();
    expect(dark.background).toBe(DARK);
    // The editor's own dark flag, which CSS cannot reach, followed too: it moves on the media
    // query's change event, which may land a frame after the colours.
    await expect
      .poll(async () => (await editorLook()).classes, { timeout: 5_000 })
      .not.toBe(light.classes);
    // And so do the native dialogs, scrollbars and menus: Electron is told, not only the page.
    expect(
      await app.evaluate(({ nativeTheme }) => [
        nativeTheme.themeSource,
        nativeTheme.shouldUseDarkColors,
      ]),
    ).toEqual(['dark', true]);
    await shoot('mode-dark');
  }, 60_000);
});

describe('a theme file that does not parse', () => {
  it('is a row in the problems panel, and the window falls back and keeps working', async () => {
    writeFileSync(join(home, 'plugins', 'sepia', 'themes', 'sepia.json'), '{ "name": "Sepia", ');
    writeFileSync(settingsFile(), JSON.stringify({ theme: 'sepia' }), 'utf8');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.problems__code')].some(
          (code) => code.textContent === 'E_THEME_INVALID',
        ),
      undefined,
      { timeout: 15_000 },
    );
    // Tyto Light whole, the base of the theme's kind.
    await waitForSurface(LIGHT);
    await shoot('malformed-falls-back');

    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('ainda funciona');
    await expect
      .poll(() => page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent))
      .toContain('ainda funciona');
  }, 60_000);
});
