import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The title bar the app draws, through the real window (TYTO-244, ADR 0078).
 *
 * On Windows and Linux the system's title bar is hidden and the page draws its own: the app's
 * name and the file in front, with the system's minimise, maximise and close buttons as an
 * overlay over its right end. Three things only a running window can say: that the bar's text
 * follows the active tab, that the old header with the tagline is gone, and that the buttons'
 * colours follow the theme — which main paints with `setTitleBarOverlay`, a call Electron has
 * no getter for. So the suite wraps that call on the window from `app.evaluate`, the seam the
 * quit suite uses, and reads back what main asked for; nothing in the shipped app grows a hook.
 *
 * The application menu stays installed from the same template, for the role accelerators, and
 * the last case holds it to still carrying no Reload and no Close (TYTO-104).
 *
 * With `TYTO_TITLE_BAR_SHOTS` set to a folder, the suite leaves CDP screenshots there at
 * 900x600, light and dark, with a named brief and with the untitled tab. CDP draws the page
 * and not the frame, so the system's buttons are not in them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_TITLE_BAR_SHOTS'];

/** The bar's colour (`surface-raised`) and the buttons' glyphs (`text`) of the built-in themes. */
const LIGHT = { color: '#ebebec', symbolColor: '#242529', css: 'rgb(235, 235, 236)' };
const DARK = { color: '#2f343e', symbolColor: '#dce0e5', css: 'rgb(47, 52, 62)' };

const BRIEF = ['---', 'template: promo-curso', '---', '::titulo Campanha'].join('\n');

let scratch: string;
let app: ElectronApplication;
let page: Page;
let briefPath: string;

/** Runs a command the way a person would: the bar, filtered by id. */
const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
};

const titleText = (): Promise<string | null> =>
  page.evaluate(() => document.querySelector('.title-bar__title')?.textContent ?? null);

const waitForTitle = (wanted: string): Promise<unknown> =>
  page.waitForFunction(
    (expected) => document.querySelector('.title-bar__title')?.textContent === expected,
    wanted,
    { polling: 25, timeout: 15_000 },
  );

/** Every overlay main has asked for since the wrap went in, last one last. */
const overlays = (): Promise<{ color: string; symbolColor: string; height: number }[]> =>
  app.evaluate(
    () => (globalThis as unknown as { tytoOverlays?: never[] }).tytoOverlays ?? ([] as never[]),
  );

const waitForOverlay = async (color: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await overlays()).at(-1)?.color === color) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`no overlay painted ${color}; asked for ${JSON.stringify(await overlays())}`);
};

const barBackground = (): Promise<string> =>
  page.evaluate(() => {
    const bar = document.querySelector('.title-bar');
    return bar === null ? '' : getComputedStyle(bar).backgroundColor;
  });

const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

const setSource = (source: 'light' | 'dark' | 'system'): Promise<void> =>
  app.evaluate(({ nativeTheme }, wanted) => {
    nativeTheme.themeSource = wanted;
  }, source);

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  // Its own data folders, never the machine's (TYTO-139).
  scratch = mkdtempSync(join(tmpdir(), 'tyto-title-bar-e2e-'));
  briefPath = join(scratch, 'campanha.brief');
  writeFileSync(briefPath, BRIEF, 'utf8');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  // Playwright emulates a light scheme unless told otherwise, and an emulated value outranks
  // what Electron answers from `nativeTheme` — the value this suite flips.
  await page.emulateMedia({ colorScheme: null });
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.setSize(900, 600);
    // Wrapped on the instance: main calls `mainWindow.setTitleBarOverlay`, so this sees every
    // call and still passes it on to the real one.
    const store = globalThis as unknown as { tytoOverlays: unknown[] };
    store.tytoOverlays = [];
    if (window !== undefined) {
      const original = window.setTitleBarOverlay.bind(window);
      window.setTitleBarOverlay = (options) => {
        store.tytoOverlays.push({ ...options });
        original(options);
      };
    }
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, briefPath);
  // Light first, whatever the machine is in, so the flip to dark below is a change Electron
  // reports: a `themeSource` that leaves the shown kind as it was emits no `updated`.
  await setSource('light');
  await page.waitForFunction(
    (css) => {
      const bar = document.querySelector('.title-bar');
      return bar !== null && getComputedStyle(bar).backgroundColor === css;
    },
    LIGHT.css,
    { polling: 25, timeout: 15_000 },
  );
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the drawn title bar', () => {
  it('replaces the header: no tagline, no second strip with the name', async () => {
    const found = await page.evaluate(() => ({
      header: document.querySelector('.shell__head') !== null,
      tagline: document.querySelector('[data-i18n="app.tagline"]') !== null,
      bars: document.querySelectorAll('.title-bar').length,
      first: document.querySelector('.shell')?.firstElementChild?.className ?? '',
    }));
    expect(found).toEqual({ header: false, tagline: false, bars: 1, first: 'title-bar' });
  });

  it('says the app alone over the untitled tab', async () => {
    await waitForTitle('Tyto');
    expect(await titleText()).toBe('Tyto');
    await shoot('untitled-light');
  });

  it('names the file in front once a brief is open', async () => {
    await runFromBar('editor.open');
    await waitForTitle('Tyto — campanha.brief');
    await shoot('named-light');
  });

  it('follows the active tab, and says nothing about unsaved work', async () => {
    await runFromBar('document.new');
    await waitForTitle('Tyto');

    await page.locator('.tabs__name', { hasText: 'campanha.brief' }).click();
    await waitForTitle('Tyto — campanha.brief');

    // An edit lights the tab's dot and leaves the bar alone.
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('x');
    await page.waitForSelector('.tabs__dirty');
    expect(await titleText()).toBe('Tyto — campanha.brief');
    await page.keyboard.press('Control+z');
  });

  it('names the settings tab by its file', async () => {
    await runFromBar('settings.open');
    await waitForTitle('Tyto — settings.json');
    await page.locator('.tabs__name', { hasText: 'campanha.brief' }).click();
    await waitForTitle('Tyto — campanha.brief');
  });

  it('is a drag region, and the menu place is not', async () => {
    const regions = await page.evaluate(() => {
      const region = (selector: string): string => {
        const element = document.querySelector(selector);
        if (element === null) return 'missing';
        return getComputedStyle(element).getPropertyValue('-webkit-app-region') || 'unset';
      };
      return { bar: region('.title-bar'), menu: region('.title-bar__menu') };
    });
    expect(regions).toEqual({ bar: 'drag', menu: 'no-drag' });
  });
});

describe("the system's buttons follow the theme", () => {
  it('paints them in the dark theme when the window turns dark, and the bar agrees', async () => {
    await setSource('dark');
    await waitForOverlay(DARK.color);
    expect((await overlays()).at(-1)).toEqual({
      color: DARK.color,
      symbolColor: DARK.symbolColor,
      height: 32,
    });
    await page.waitForFunction(
      (css) => {
        const bar = document.querySelector('.title-bar');
        return bar !== null && getComputedStyle(bar).backgroundColor === css;
      },
      DARK.css,
      { polling: 25, timeout: 15_000 },
    );
    expect(await barBackground()).toBe(DARK.css);
    await shoot('named-dark');
    await runFromBar('document.new');
    await waitForTitle('Tyto');
    await shoot('untitled-dark');
  });

  it('paints them light again when the window turns light', async () => {
    await setSource('light');
    await waitForOverlay(LIGHT.color);
    expect((await overlays()).at(-1)).toEqual({
      color: LIGHT.color,
      symbolColor: LIGHT.symbolColor,
      height: 32,
    });
    await page.waitForFunction(
      (css) => {
        const bar = document.querySelector('.title-bar');
        return bar !== null && getComputedStyle(bar).backgroundColor === css;
      },
      LIGHT.css,
      { polling: 25, timeout: 15_000 },
    );
  });
});

describe('the application menu', () => {
  it('is still installed, and still carries no Reload and no Close', async () => {
    const roles = await app.evaluate(({ Menu }) => {
      const found: string[] = [];
      const walk = (items: Electron.MenuItem[]): void => {
        for (const item of items) {
          if (item.role !== undefined && item.role !== null) found.push(item.role.toLowerCase());
          if (item.submenu) walk(item.submenu.items);
        }
      };
      walk(Menu.getApplicationMenu()?.items ?? []);
      return found;
    });
    expect(roles).toContain('copy');
    expect(roles).toContain('toggledevtools');
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forcereload');
    expect(roles).not.toContain('close');
  });
});
