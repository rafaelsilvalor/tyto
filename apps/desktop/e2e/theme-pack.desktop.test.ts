import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEME_PACK_FILES, THEME_PACK_THEMES } from '@tyto/theme-pack';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Locale, isLocale, translate } from '../shared/i18n/index.js';
import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The theme pack, through the real window (TYTO-300, ADR 0089).
 *
 * `@tyto/theme-pack` is a built-in plugin, so its themes are in the picker of a fresh install
 * with nothing installed. The suite picks a dark original and a light adjusted twin from Ctrl+K
 * and watches `--tyto-surface` take the pack's value — which proves main read the file through
 * the pack's own reader, since a theme it could not read falls back to Tyto Light or Tyto Dark
 * whole — and `--tyto-text-muted` take the theme's own, which is where an original and its
 * adjusted twin differ. The picker's detail line says which of the two each one is.
 *
 * With `TYTO_THEME_PACK_SHOTS` set to a folder, the suite also leaves a screenshot of every
 * theme in the pack, with a brief in the editor, its preview to the side and the problems panel
 * open, at the window's default size, named by the theme's id.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

interface PackTheme {
  readonly id: string;
  readonly label: string;
  /** The picker's detail line, in the locale the window starts in. */
  readonly detail: (locale: Locale) => string;
  readonly surface: string;
  readonly textMuted: string;
  /** `surface` as `getComputedStyle` reports the body. */
  readonly body: string;
}

const bodyColour = (hex: string): string => {
  const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
};

const ALL: readonly PackTheme[] = THEME_PACK_THEMES.map((theme) => {
  const file = THEME_PACK_FILES[theme.path];
  if (file === undefined) throw new Error(`${theme.id} has no file`);
  const surface = file.colors['surface'] ?? '';
  const variant = file.variant;
  return {
    id: theme.id,
    label: theme.label,
    detail: (locale) =>
      [
        translate(locale, `theme.kind.${theme.kind}`),
        ...(variant === undefined ? [] : [translate(locale, `theme.variant.${variant}`)]),
      ].join(' · '),
    surface,
    textMuted: file.colors['text-muted'] ?? '',
    body: bodyColour(surface),
  };
});

const byId = (id: string): PackTheme => {
  const theme = ALL.find((candidate) => candidate.id === id);
  if (theme === undefined) throw new Error(`the pack has no theme '${id}'`);
  return theme;
};

/** A dark original and a light adjusted twin: both kinds, and both sides of a pair. */
const THEMES = [byId('dracula'), byId('solarized-light-adjusted')] as const;

/** A brief with art to preview and one line the problems panel lists. */
const BRIEF = '---\ntemplate: promo-curso\n---\n::titulo Tema novo\n::nao-existe linha\n';

const shots = process.env['TYTO_THEME_PACK_SHOTS'];

let scratch: string;
let app: ElectronApplication;
let page: Page;
let defaultSize: readonly [number, number];
let locale: Locale;

const setContentSize = (width: number, height: number): Promise<void> =>
  app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(w, h);
    },
    [width, height] as const,
  );

const tokenValue = (name: string): Promise<string> =>
  page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    `--tyto-${name}`,
  );

/** Waits for the body to take a colour: a theme answer and a media query land on a frame. */
async function waitForBody(colour: string): Promise<void> {
  await page.waitForFunction(
    (expected) => getComputedStyle(document.body).backgroundColor === expected,
    colour,
    { polling: 25, timeout: 15_000 },
  );
}

/** Ctrl+K, the command, Enter, and the picker's rows once the pack's themes are among them. */
async function openPicker(): Promise<string[]> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('theme.pick');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.command-bar__label')].some(
        (label) => label.textContent === 'Dracula',
      ),
    undefined,
    { timeout: 30_000 },
  );
  return page.evaluate(() =>
    [...document.querySelectorAll('.command-bar__label')].map((label) => label.textContent ?? ''),
  );
}

/** The highlighted row's label and detail, once the filter has settled on `label`. */
async function highlighted(label: string): Promise<{ label: string; detail: string }> {
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.command-bar__option--on .command-bar__label')?.textContent ===
      expected,
    label,
    { timeout: 15_000 },
  );
  return page.evaluate(() => ({
    label:
      document.querySelector('.command-bar__option--on .command-bar__label')?.textContent ?? '',
    detail:
      document.querySelector('.command-bar__option--on .command-bar__detail')?.textContent ?? '',
  }));
}

/**
 * Filters by the theme's id, which matches only itself and, listed after it, its adjusted twin —
 * so the highlighted row is the theme asked for.
 */
async function choose(theme: PackTheme): Promise<void> {
  await openPicker();
  await page.keyboard.type(theme.id);
  await highlighted(theme.label);
  await waitForBody(theme.body);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.command-bar__input', { state: 'hidden' });
  await waitForBody(theme.body);
  await page.waitForFunction(
    ([property, expected]) =>
      getComputedStyle(document.documentElement).getPropertyValue(property).trim() === expected,
    ['--tyto-text-muted', theme.textMuted] as const,
    { polling: 25, timeout: 15_000 },
  );
}

async function runFromBar(id: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

beforeAll(async () => {
  // Its own data folders, never the machine's (TYTO-139).
  scratch = mkdtempSync(join(tmpdir(), 'tyto-theme-pack-e2e-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  const lang = await page.evaluate(() => document.documentElement.lang);
  locale = isLocale(lang) ? lang : 'pt-BR';
  defaultSize = await app.evaluate(({ BrowserWindow }) => {
    const [width, height] = BrowserWindow.getAllWindows()[0]?.getContentSize() ?? [0, 0];
    return [width ?? 0, height ?? 0] as const;
  });
  await setContentSize(900, 600);
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the theme pack', () => {
  it('lists its themes in the picker of an install with no plugins', async () => {
    const labels = await openPicker();
    expect(labels).toEqual(
      expect.arrayContaining(['Tyto Light', 'Tyto Dark', ...ALL.map(({ label }) => label)]),
    );
    await page.keyboard.press('Escape');
    await page.waitForSelector('.command-bar__input', { state: 'hidden' });
  }, 60_000);

  it.each(THEMES)(
    'says beside $label which colours it is',
    async (theme) => {
      await openPicker();
      await page.keyboard.type(theme.id);
      expect(await highlighted(theme.label)).toEqual({
        label: theme.label,
        detail: theme.detail(locale),
      });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.command-bar__input', { state: 'hidden' });
    },
    60_000,
  );

  it.each(THEMES)(
    'applies $label with its own surface and secondary text, not the base theme’s',
    async (theme) => {
      await choose(theme);
      expect(await tokenValue('surface')).toBe(theme.surface);
      expect(await tokenValue('text-muted')).toBe(theme.textMuted);
    },
    60_000,
  );

  it.runIf(shots !== undefined)(
    'leaves a screenshot of every theme with a brief, its preview and the problems',
    async () => {
      const folder = shots ?? '';
      mkdirSync(folder, { recursive: true });
      await page.click('#editor .cm-content');
      await page.keyboard.insertText(BRIEF);
      await runFromBar('preview.openToSide');
      // Open by default; toggled only when a saved layout closed it.
      const open = await page.evaluate(
        () => document.querySelector('[data-panel="problems"]') !== null,
      );
      if (!open) await runFromBar('layout.togglePanel:problems');
      await page.waitForSelector('[data-panel="problems"]');
      await setContentSize(defaultSize[0], defaultSize[1]);
      for (const theme of ALL) {
        await choose(theme);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(folder, `${theme.id}.png`) });
      }
      await setContentSize(900, 600);
    },
    600_000,
  );
});
