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
 * a problem row and a preview, and each with the command bar open — and, since TYTO-258, six more:
 * each theme's search panel, completion list and lint tooltip. The card's gate is a person
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
const LIGHT = {
  surface: 'rgb(250, 250, 250)',
  selection: 'rgb(205, 214, 248)',
  raised: 'rgb(235, 235, 236)',
  accent: 'rgb(92, 120, 226)',
  text: 'rgb(36, 37, 41)',
  error: 'rgb(196, 71, 58)',
  hairline: 'rgb(220, 220, 221)',
};
const DARK = {
  surface: 'rgb(40, 44, 51)',
  selection: 'rgb(78, 100, 126)',
  raised: 'rgb(47, 52, 62)',
  accent: 'rgb(116, 173, 232)',
  text: 'rgb(220, 224, 229)',
  error: 'rgb(216, 123, 128)',
  hairline: 'rgb(54, 60, 70)',
};

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

/**
 * TYTO-258: CodeMirror's own search panel, completion list and lint tooltip, read off the
 * computed style. Every rule mirrors CodeMirror's selector and wins only by mount order, so a
 * screenshot that looks right is not enough — a lost tie would leave CodeMirror's colour in one
 * scheme and not the other.
 */
const computed = async (
  selector: string,
  properties: readonly string[],
): Promise<Record<string, string>> =>
  page.evaluate(
    ([target, names]) => {
      const element = document.querySelector(target!);
      if (element === null) return { missing: target! };
      const style = getComputedStyle(element);
      return Object.fromEntries(names!.map((name) => [name, style.getPropertyValue(name)]));
    },
    [selector, properties] as const,
  );

describe("the editor's own panels, tooltips and diagnostics read the tokens (TYTO-258)", () => {
  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)(
    'paints the %s search panel and its matches from the tokens',
    async (scheme, expected) => {
      await setSystem(scheme);
      await waitForSurface(expected.surface);
      await page.click('#editor .cm-content');
      await page.keyboard.press('Control+f');
      await page.waitForSelector('#editor .cm-panel.cm-search', { timeout: 10_000 });
      // Typed, not filled: the panel commits its query on keyup, and `fill` fires none.
      await page.click('#editor .cm-search input[name="search"]');
      await page.keyboard.press('Control+a');
      await page.keyboard.type('lei');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#editor .cm-searchMatch-selected', { timeout: 10_000 });

      expect(await computed('#editor .cm-panels', ['background-color', 'color'])).toEqual({
        'background-color': expected.raised,
        color: expected.text,
      });
      expect(
        await computed('#editor .cm-search .cm-button', ['background-image', 'background-color']),
      ).toEqual({ 'background-image': 'none', 'background-color': expected.surface });
      expect(
        await computed('#editor .cm-search .cm-textfield', ['background-color', 'color']),
      ).toEqual({ 'background-color': expected.surface, color: expected.text });
      // Outlined, never filled: the selection under the current match stays visible.
      expect(
        await computed('#editor .cm-searchMatch-selected', ['background-color', 'outline-color']),
      ).toEqual({ 'background-color': 'rgba(0, 0, 0, 0)', 'outline-color': expected.accent });
      await shoot(`${scheme}-search`);

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#editor .cm-search') === null);
    },
    30_000,
  );

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)(
    'paints the %s completion list quiet, the selected item in the selection colour',
    async (scheme, expected) => {
      await setSystem(scheme);
      await waitForSurface(expected.surface);
      await page.click('#editor .cm-content');
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      // `titulo` and `tom` both start with `t`, so the list holds a selected item and another.
      await page.keyboard.type('::t');
      await page.waitForSelector('#editor .cm-tooltip-autocomplete li[aria-selected]', {
        timeout: 10_000,
      });

      expect(
        await computed('#editor .cm-tooltip-autocomplete', [
          'background-color',
          'border-top-color',
        ]),
      ).toEqual({ 'background-color': expected.raised, 'border-top-color': expected.hairline });
      expect(
        await computed('#editor .cm-tooltip-autocomplete ul li[aria-selected]', [
          'background-color',
          'color',
        ]),
      ).toEqual({ 'background-color': expected.selection, color: expected.text });
      // Bold in the text colour on the selected item and on the others alike (Rafael, on the
      // screenshots: the accent on the selection read at 2.58:1 in dark).
      const matched = await page.evaluate(() =>
        [...document.querySelectorAll('#editor .cm-completionMatchedText')].map((element) => {
          const style = getComputedStyle(element);
          return {
            color: style.color,
            weight: style.fontWeight,
            line: style.textDecorationLine,
            selected: element.closest('li')?.hasAttribute('aria-selected') ?? false,
          };
        }),
      );
      expect(new Set(matched.map((piece) => piece.selected))).toEqual(new Set([true, false]));
      for (const piece of matched) {
        expect(piece).toEqual({
          color: expected.text,
          weight: '700',
          line: 'none',
          selected: piece.selected,
        });
      }
      await shoot(`${scheme}-completion`);

      // Leave the brief as it was: close the list, take the typed line back out.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Shift+Home');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
    },
    30_000,
  );

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)(
    'paints the %s lint tooltip and underline in the error token',
    async (scheme, expected) => {
      await setSystem(scheme);
      await waitForSurface(expected.surface);
      await page.waitForSelector('#editor .cm-lintRange-error', { timeout: 10_000 });

      // CodeMirror's underline is an image with its colour written in; this one is a wavy
      // text decoration in the token's colour.
      expect(
        await computed('#editor .cm-lintRange-error', [
          'background-image',
          'text-decoration-line',
          'text-decoration-color',
        ]),
      ).toEqual({
        'background-image': 'none',
        'text-decoration-line': 'underline',
        'text-decoration-color': expected.error,
      });

      await page.hover('#editor .cm-lintRange-error');
      await page.waitForSelector('#editor .cm-tooltip-hover .cm-diagnostic-error', {
        timeout: 10_000,
      });
      expect(
        await computed('#editor .cm-tooltip-hover', ['background-color', 'color', 'box-shadow']),
      ).toEqual({
        'background-color': expected.raised,
        color: expected.text,
        'box-shadow': 'none',
      });
      expect(await computed('#editor .cm-diagnostic-error', ['border-left-color'])).toEqual({
        'border-left-color': expected.error,
      });
      await shoot(`${scheme}-lint`);

      await page.mouse.move(0, 0);
      await page.waitForFunction(
        () => document.querySelector('#editor .cm-tooltip-hover') === null,
      );
    },
    30_000,
  );
});
