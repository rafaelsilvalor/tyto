import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * TYTO-96's acceptance, through the real window: the face is the bundled one, the window and
 * the editor change together when the system changes between light and dark, with no restart,
 * and a selection in the editor is the token's colour in both.
 *
 * `e2e/renderer-tokens.test.ts` proves the names; only a browser resolves a `var()`, so the
 * colours are read here with `getComputedStyle`. The system is switched from main with
 * `nativeTheme.themeSource`, which is what Electron answers `prefers-color-scheme` from — the
 * same path a person's operating system takes, and nothing the shipped app carries.
 *
 * With `TYTO_THEME_SHOTS` set to a folder, the suite also leaves four CDP screenshots there
 * at the smallest window the app allows (900x600): each theme with a selection in the editor,
 * a problem row and a preview, and each with the command bar open. The card's gate is a person
 * looking at those; off in CI, where nobody would.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

const BRIEF = [
  '---',
  'template: carrossel-lista',
  'formats: [grid-1x1]',
  '---',
  '// A comment, so the screenshots show every syntax colour the brief has.',
  '::titulo',
  '  Como estudar para a prova',
  '',
  '::lamina {destaque, tom: escuro}',
  '  Leia a lei seca **antes** da doutrina',
  '',
  '::nao-existe x',
].join('\n');

/** The token values, as `getComputedStyle` reports them. */
const LIGHT = { surface: 'rgb(250, 250, 250)', selection: 'rgb(205, 214, 248)' };
const DARK = { surface: 'rgb(40, 44, 51)', selection: 'rgb(78, 100, 126)' };

let app: ElectronApplication;
let scratch: string;
let page: Page;
const shots = process.env['TYTO_THEME_SHOTS'];

const setSystem = async (scheme: 'light' | 'dark'): Promise<void> => {
  await app.evaluate(({ nativeTheme }, source) => {
    nativeTheme.themeSource = source;
  }, scheme);
};

const colours = async (): Promise<{ body: string; editor: string; gutter: string }> =>
  page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    editor: getComputedStyle(document.querySelector('#editor .cm-editor')!).backgroundColor,
    gutter: getComputedStyle(document.querySelector('#editor .cm-gutters')!).backgroundColor,
  }));

/** Waits for the body to take a colour, because a media query change lands on a frame. */
const waitForSurface = async (colour: string): Promise<void> => {
  await page.waitForFunction(
    (expected) => getComputedStyle(document.body).backgroundColor === expected,
    colour,
    { polling: 25, timeout: 10_000 },
  );
};

const selectionColour = async (): Promise<string> =>
  page.evaluate(() => {
    const piece = document.querySelector('#editor .cm-selectionBackground');
    return piece === null ? 'none' : getComputedStyle(piece).backgroundColor;
  });

/** Focuses the editor and selects the second line, so the selection layer has a piece. */
const selectInEditor = async (): Promise<void> => {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+End');
  await page.waitForSelector('#editor .cm-selectionBackground');
};

const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  // Its own data folders, never the machine's (TYTO-139).
  scratch = mkdtempSync(join(tmpdir(), 'tyto-theme-e2e-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  // Playwright emulates `prefers-color-scheme: light` on every page it drives unless told not
  // to, and an emulated value outranks the system's — so `themeSource` alone moved nothing.
  // `null` hands the query back to Electron, which is what a person's window answers from.
  await page.emulateMedia({ colorScheme: null });
  // The smallest window the app allows, which is where a dense layout runs out of room first.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 600);
  });
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(BRIEF);
  await page.waitForSelector('button.problems__row', { timeout: 30_000 });
  await page.waitForSelector('.preview__paper iframe', { timeout: 30_000 });
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the face', () => {
  it('is the bundled Source Sans 3, loaded from the app and never the system UI face', async () => {
    const face = await page.evaluate(async () => {
      await document.fonts.ready;
      const loaded = [...document.fonts]
        .filter((font) => font.family.replace(/"/g, '') === 'Source Sans 3')
        .filter((font) => font.status === 'loaded')
        .map((font) => font.weight)
        .sort();
      return { family: getComputedStyle(document.body).fontFamily, loaded };
    });
    expect(face.family).toBe('"Source Sans 3"');
    expect(face.loaded).toEqual(['400', '700']);
  });
});

describe('the colours arrive as the built-in themes (TYTO-208, ADR 0077)', () => {
  it('writes both built-in themes over the token file, every themed colour of each', async () => {
    await page.waitForSelector('style#tyto-theme', { state: 'attached', timeout: 10_000 });
    const sheet = await page.evaluate(
      () => document.getElementById('tyto-theme')?.textContent ?? '',
    );
    // Thirty colours per mode, light at the root and dark under the system's dark mode.
    expect(sheet.match(/--tyto-[a-z0-9-]+:/g)).toHaveLength(60);
    expect(sheet).toContain('--tyto-surface: #fafafa;');
    expect(sheet).toContain('@media (prefers-color-scheme: dark)');
    expect(sheet).toContain('--tyto-surface: #282c33;');
  });
});

describe('light and dark follow the system, live', () => {
  it.each([
    ['light', LIGHT],
    ['dark', DARK],
    ['light', LIGHT],
  ] as const)(
    'paints the window and the editor %s with no restart',
    async (scheme, expected) => {
      await setSystem(scheme);
      await waitForSurface(expected.surface);

      const painted = await colours();
      expect(painted.body).toBe(expected.surface);
      // The editor reads the same token: one source, so the two cannot disagree.
      expect(painted.editor).toBe(expected.surface);
      expect(painted.gutter).toBe(expected.surface);
    },
    30_000,
  );

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)(
    'draws a focused %s selection in the token colour, not CodeMirror’s own',
    async (scheme, expected) => {
      await setSystem(scheme);
      await waitForSurface(expected.surface);
      await selectInEditor();

      // CodeMirror's base rule used to win on specificity whenever the editor had focus
      // (comment 1291677); this is the colour a person sees all day.
      expect(await selectionColour()).toBe(expected.selection);
      await shoot(`${scheme}-editor`);

      await page.keyboard.press('Control+k');
      await page.waitForSelector('.command-bar__input', { state: 'visible' });
      await page.keyboard.type('preview');
      await page.waitForTimeout(150);
      await shoot(`${scheme}-command-bar`);
      await page.keyboard.press('Escape');
    },
    30_000,
  );
});
