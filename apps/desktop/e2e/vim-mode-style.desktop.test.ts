import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEME_PACK_FILES, THEME_PACK_THEMES } from '@tyto/theme-pack';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { badgeText } from '../shared/status-bar-colors.js';
import { VIM_MODE_STYLES, type VimModeStyle } from '../shared/vim-mode-style.js';
import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * `vimModeStyle` through the real window (TYTO-301, ADR 0091): a save switches the style with
 * no restart, NORMAL → INSERT → VISUAL → REPLACE moves the strip's colour under `border` and
 * the whole bar's under `bar` in light and dark, the bar's text is the one chosen for each
 * mode's colour, and with vim off every style is the plain bar. The unit tests hold the text's
 * contrast in every theme; this file holds that the colours land.
 *
 * Settings are written to `settings.json` on disk — main applies any writer's save — so vim's
 * keys never type into the settings text; the new file's content is read from the disk too.
 *
 * With `TYTO_VIM_MODE_STYLE_SHOTS` set to a folder, the suite also leaves pictures of the bar
 * in Tyto Light, Tyto Dark and Dracula for each style in NORMAL and INSERT, a whole window per
 * style in Tyto Light, and the new settings.json.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_VIM_MODE_STYLE_SHOTS'];

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

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const BRIEF = '---\ntemplate: promo-curso\n---\n::titulo Direito\n';
const MODES = [
  ['normal', []],
  ['insert', ['i']],
  ['visual', ['v']],
  ['replace', ['Shift+R']],
] as const;

let app: ElectronApplication;
let page: Page;
let scratch: string;
let settingsFile: string;

interface BarLook {
  readonly mode: string;
  readonly background: string;
  readonly strip: string;
  readonly tabKind: string;
  readonly label: string;
  readonly labelBackground: string;
}

/** What the bar shows: its background, the top strip, an item's text and the mode's label. */
const look = (): Promise<BarLook> =>
  page.evaluate(() => {
    const foot = document.querySelector<HTMLElement>('.shell__foot')!;
    const strip = getComputedStyle(foot, '::before');
    const kind = document.querySelector("tyto-status-bar [data-item='tabKind']");
    const label = document.querySelector('tyto-status-bar .status-bar__vim');
    return {
      mode: foot.dataset['vimMode'] ?? '',
      background: getComputedStyle(foot).backgroundColor,
      strip: strip.content === 'none' ? '' : `${strip.backgroundColor} ${strip.height}`,
      tabKind: kind === null ? '' : getComputedStyle(kind).color,
      label: label === null ? '' : getComputedStyle(label).color,
      labelBackground: label === null ? '' : getComputedStyle(label).backgroundColor,
    };
  });

/** Waits until the window paints `theme`'s surface: its answer has landed. */
const themeApplied = (theme: string): Promise<unknown> =>
  page.waitForFunction(
    (expected) => getComputedStyle(document.body).backgroundColor === expected,
    computed(coloursOf(theme)['surface']!),
    { polling: 25, timeout: 15_000 },
  );

const settingsText = (
  theme: string,
  style: VimModeStyle | undefined,
  colours?: Record<string, string>,
): string =>
  `{\n  "theme": "${theme}"${style === undefined ? '' : `,\n  "vimModeStyle": "${style}"`}${
    colours === undefined ? '' : `,\n  "statusBarColors": ${JSON.stringify(colours)}`
  }\n}\n`;

/** Writes the file and waits until the footer names the style. */
async function apply(
  theme: string,
  style: VimModeStyle | undefined,
  colours?: Record<string, string>,
): Promise<void> {
  writeFileSync(settingsFile, settingsText(theme, style, colours), 'utf8');
  await themeApplied(theme);
  await page.waitForFunction(
    (expected) =>
      document.querySelector<HTMLElement>('.shell__foot')?.dataset['vimStyle'] === expected,
    style ?? 'badge',
    { polling: 25, timeout: 15_000 },
  );
}

/** The bar in `mode`, after the keys that reach it from normal mode. */
async function inMode(mode: string, keys: readonly string[]): Promise<void> {
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await look()).mode, { timeout: 5_000 }).toBe('normal');
  for (const key of keys) await page.keyboard.press(key);
  await expect.poll(async () => (await look()).mode, { timeout: 5_000 }).toBe(mode);
}

/** What `style` should draw in `mode` under `theme`, with `colours` over the theme. */
const expected = (
  style: VimModeStyle,
  theme: string,
  mode: string,
  colours: Record<string, string> = {},
): Omit<BarLook, 'mode'> => {
  const palette = coloursOf(theme);
  const modeColour = colours[`vimMode.${mode}`] ?? palette[`status-bar-vim-${mode}`]!;
  const barText = colours['foreground'] ?? palette['status-bar-text']!;
  const background = colours['background'] ?? palette['status-bar']!;
  if (style === 'bar') {
    // The badge's rule, measured here on its own rather than through the function under test.
    const text = badgeText(modeColour, palette)!.colour;
    return {
      background: computed(modeColour),
      strip: '',
      tabKind: computed(text),
      label: computed(text),
      labelBackground: TRANSPARENT,
    };
  }
  if (style === 'border') {
    return {
      background: computed(background),
      strip: `${computed(modeColour)} 2px`,
      tabKind: computed(barText),
      label: computed(barText),
      labelBackground: TRANSPARENT,
    };
  }
  return {
    background: computed(background),
    strip: '',
    tabKind: computed(barText),
    label: computed(palette[`status-bar-vim-${mode}-text`]!),
    labelBackground: computed(modeColour),
  };
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
  scratch = mkdtempSync(join(tmpdir(), 'tyto-vim-mode-style-'));
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

describe('the vimModeStyle setting', () => {
  it('carries the key commented out, with the three values and what each does', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('settings.open');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tabs__tab')].some((tab) =>
        (tab.textContent ?? '').includes('settings.json'),
      ),
    );
    // From the disk, not from `.cm-content`, which holds only the lines in the viewport.
    await expect.poll(() => existsSync(settingsFile), { timeout: 15_000 }).toBe(true);
    const text = readFileSync(settingsFile, 'utf8');

    expect(text).toContain('// "vimModeStyle": "badge",');
    for (const style of VIM_MODE_STYLES) {
      expect(text).toMatch(new RegExp(`//\\s+"${style.id}"\\s+${style.description.slice(0, 20)}`));
    }
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      // Down to the file's end, where the key follows the colours.
      await page.hover('#editor .cm-content');
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(shots, 'settings-json-new.png') });
    }
    // Back to the brief, where vim's keys go from here on.
    await page.locator('.tabs__tab').filter({ hasNotText: 'settings.json' }).first().click();
  });

  describe('with vim on', () => {
    beforeAll(async () => {
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

    it('switches the style on save, with no restart', async () => {
      await apply('tyto-light', undefined);
      await inMode('normal', []);
      await expect
        .poll(look, { timeout: 15_000 })
        .toMatchObject(expected('badge', 'tyto-light', 'normal'));

      await apply('tyto-light', 'bar');
      await expect
        .poll(look, { timeout: 15_000 })
        .toMatchObject(expected('bar', 'tyto-light', 'normal'));

      await apply('tyto-light', 'border');
      await expect
        .poll(look, { timeout: 15_000 })
        .toMatchObject(expected('border', 'tyto-light', 'normal'));
    });

    for (const style of ['border', 'bar'] as const) {
      for (const theme of ['tyto-light', 'tyto-dark']) {
        it(`moves the ${style}'s colour through the four modes in ${theme}`, async () => {
          await apply(theme, style);
          for (const [mode, keys] of MODES) {
            await inMode(mode, keys);
            await expect
              .poll(look, { timeout: 15_000 })
              .toMatchObject(expected(style, theme, mode));
          }
          await page.keyboard.press('Escape');
        });
      }
    }

    it("wears an override's mode colour over the override's background, with text chosen for it", async () => {
      const colours = { background: '#1e3a5f', 'vimMode.insert': '#ffe066' };
      await apply('tyto-light', 'bar', colours);
      await inMode('insert', ['i']);

      await expect
        .poll(look, { timeout: 15_000 })
        .toMatchObject(expected('bar', 'tyto-light', 'insert', colours));
      await page.keyboard.press('Escape');
    });

    it("keeps a hovered button in the theme's hover colour on a coloured bar", async () => {
      await apply('tyto-light', 'bar');
      await inMode('normal', []);
      await page.hover("tyto-status-bar [data-item='settings']");

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const button = document.querySelector("tyto-status-bar [data-item='settings']")!;
              const style = getComputedStyle(button);
              return `${style.backgroundColor} ${style.color}`;
            }),
          { timeout: 5_000 },
        )
        .toBe(
          `${computed(coloursOf('tyto-light')['hover']!)} ${computed(coloursOf('tyto-light')['text']!)}`,
        );
      await page.mouse.move(0, 0);
    });

    it.runIf(shots !== undefined)(
      'leaves pictures of the bar in three themes, three styles, NORMAL and INSERT',
      async () => {
        for (const theme of ['tyto-light', 'tyto-dark', 'dracula']) {
          for (const style of ['badge', 'border', 'bar'] as const) {
            await apply(theme, style);
            for (const [mode, keys] of MODES.slice(0, 2)) {
              await inMode(mode, keys);
              await expect
                .poll(look, { timeout: 15_000 })
                .toMatchObject(expected(style, theme, mode));
              await shoot(`${theme}-${style}-${mode}`);
              if (theme === 'tyto-light' && mode === 'insert') {
                await page.screenshot({ path: join(shots!, `window-${style}-insert.png`) });
              }
            }
          }
        }
        await page.keyboard.press('Escape');
      },
      180_000,
    );

    // Last, since it turns vim off for the rest of the file.
    it('draws the plain bar in every style once vim is off', async () => {
      await apply('tyto-light', 'bar');
      await inMode('insert', ['i']);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.command-bar__input', { state: 'visible' });
      await page.keyboard.type('editor.toggleVim');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await page.waitForSelector('tyto-status-bar .status-bar__vim', { state: 'detached' });

      for (const style of ['bar', 'border', 'badge'] as const) {
        await apply('tyto-light', style);
        await expect.poll(look, { timeout: 15_000 }).toEqual({
          mode: '',
          background: computed(coloursOf('tyto-light')['status-bar']!),
          strip: '',
          tabKind: computed(coloursOf('tyto-light')['status-bar-text']!),
          label: '',
          labelBackground: '',
        });
      }
    });
  });
});
