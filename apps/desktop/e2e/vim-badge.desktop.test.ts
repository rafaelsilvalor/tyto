import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEME_PACK_FILES, THEME_PACK_THEMES } from '@tyto/theme-pack';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Vim's mode badge, through the real window (TYTO-301, ADR 0089 decision 8).
 *
 * `status-bar.test.ts` holds which `data-mode` each of vim's words gets, and
 * `renderer-tokens.test.ts` which tokens each `data-mode` rule names. What only a browser can
 * say is the colour that lands: this suite turns vim on, walks the badge through every mode the
 * library reports with the keys a person presses, and reads the badge's computed background
 * and text against the theme file's tokens — in Tyto Light, Tyto Dark and one theme of the pack.
 * Each theme is fixed by the `theme` setting, written before the launch, so the scheme is the
 * one main sets and not Playwright's emulation (TYTO-284).
 *
 * With `TYTO_VIM_BADGE_SHOTS` set to a folder, the suite also leaves a picture of the status
 * bar's left end in every mode, per theme, named `<theme>-<step>.png`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_VIM_BADGE_SHOTS'];

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

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

/**
 * The keys, from normal mode, and what the badge then says and wears. Each step starts with
 * Escape, as a person leaving a mode does, so a step that fails leaves the next one in normal
 * rather than typing its keys into the mode it was left in.
 */
const STEPS = [
  { name: 'normal', keys: [], text: 'NORMAL', mode: 'normal' },
  { name: 'insert', keys: ['i'], text: 'INSERT', mode: 'insert' },
  { name: 'visual', keys: ['v'], text: 'VISUAL', mode: 'visual' },
  { name: 'visual-line', keys: ['Shift+V'], text: 'VISUAL LINE', mode: 'visual' },
  { name: 'visual-block', keys: ['Control+v'], text: 'VISUAL BLOCK', mode: 'visual' },
  { name: 'replace', keys: ['Shift+R'], text: 'REPLACE', mode: 'replace' },
] as const;

const BRIEF = '---\ntemplate: promo-curso\n---\n::titulo Direito\n';

describe.each(['tyto-light', 'tyto-dark', 'catppuccin-mocha'])('in %s', (themeId) => {
  const colours = coloursOf(themeId);
  let scratch: string;
  let app: ElectronApplication;
  let page: Page;

  const badge = (): Promise<{ text: string; mode: string; background: string; color: string }> =>
    page.evaluate(() => {
      const found = document.querySelector('tyto-status-bar .status-bar__vim');
      if (found === null) return { text: '', mode: '', background: '', color: '' };
      const style = getComputedStyle(found);
      return {
        text: found.textContent?.trim() ?? '',
        mode: found.getAttribute('data-mode') ?? '',
        background: style.backgroundColor,
        color: style.color,
      };
    });

  const bar = (): Promise<{ background: string; color: string }> =>
    page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('.shell__foot')!);
      return { background: style.backgroundColor, color: style.color };
    });

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'tyto-vim-badge-'));
    const userData = join(scratch, 'user-data');
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, 'settings.json'), `{\n  "theme": "${themeId}"\n}\n`);
    app = await _electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      cwd: join(here, '..'),
      env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
    });
    page = await firstWindow(app);
    await page.waitForSelector('#editor .cm-content');
    await page.waitForSelector('tyto-status-bar .status-bar__button');
    // The theme is applied once main answers, which lands after the first paint.
    await page.waitForFunction(
      (expected) => getComputedStyle(document.body).backgroundColor === expected,
      computed(colours['surface']!),
      { polling: 25, timeout: 15_000 },
    );

    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(BRIEF);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('editor.toggleVim');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForSelector('tyto-status-bar .status-bar__vim');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Escape');
  });

  afterAll(async () => {
    await closeApp(app);
    rmSync(scratch, { recursive: true, force: true });
  });

  it('paints the bar in its own pair, which is the chrome’s as before', async () => {
    expect(await bar()).toEqual({
      background: computed(colours['status-bar']!),
      color: computed(colours['status-bar-text']!),
    });
    expect(colours['status-bar']).toBe(colours['surface-raised']);
    expect(colours['status-bar-text']).toBe(colours['text-muted']);
  });

  it.each(STEPS)('wears the $mode colours in $text', async (step) => {
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await badge()).mode, { timeout: 5_000 }).toBe('normal');
    for (const key of step.keys) await page.keyboard.press(key);
    await expect.poll(badge, { timeout: 5_000 }).toEqual({
      text: step.text,
      mode: step.mode,
      background: computed(colours[`status-bar-vim-${step.mode}`]!),
      color: computed(colours[`status-bar-vim-${step.mode}-text`]!),
    });
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      const box = await page.evaluate(() => {
        const foot = document.querySelector('.shell__foot')!.getBoundingClientRect();
        return { x: foot.x, y: foot.y, width: Math.min(foot.width, 360), height: foot.height };
      });
      await page.screenshot({ path: join(shots, `${themeId}-${step.name}.png`), clip: box });
    }
  });
});
