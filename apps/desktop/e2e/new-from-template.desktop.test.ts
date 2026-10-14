import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { openPreviewBeside } from './preview-pane.js';

/**
 * "New brief from template…", through the real window (TYTO-275).
 *
 * Ctrl+K lists the templates with the folder each came from; choosing `agenda-semana` opens a
 * new tab holding its skeleton with the first field selected. Typing fills it, Tab moves to the
 * next field, and the brief that results compiles with no error. Then the second door: choosing
 * a template in the "/" menu on an empty brief writes the same skeleton (the header's picker,
 * which was that door, left the window with TYTO-288).
 *
 * Every key goes through Playwright's page, which is CDP input to this window and never an OS
 * keystroke that could land in another application.
 *
 * With `TYTO_SKELETON_SHOTS` set to a folder, the suite leaves screenshots there: the picker,
 * the new tab with its first field selected and the filled brief, in light, and the picker and
 * the skeleton again in dark.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const shots = process.env['TYTO_SKELETON_SHOTS'];

let scratch: string;
let userData: string;
let app: ElectronApplication;
let page: Page;

const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

/** The buffer as lines. The skeleton is a few lines, so the viewport holds all of it. */
const editorText = (): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#editor .cm-line')]
      .map((line) => line.textContent ?? '')
      .join('\n'),
  );

const selectedText = (): Promise<string> =>
  page.evaluate(() => document.getSelection()?.toString() ?? '');

const tabCount = (): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('.tabs__tab').length);

/** Ctrl+K, the command, and the picker's rows as `label / detail` once the templates are in. */
async function openPicker(): Promise<string[]> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('document.newFromTemplate');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.command-bar__label')].some(
        (label) => label.textContent === 'agenda-semana',
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

/** The preview's own answer about `brief`, through the preload, as the renderer asks it. */
function errorsOf(brief: string): Promise<string[]> {
  return page.evaluate(async (text) => {
    const bridge = (
      window as unknown as {
        tyto: Record<
          string,
          (request: unknown) => Promise<{ diagnostics: { code: string; severity: string }[] }>
        >;
      }
    ).tyto;
    const answer = await bridge['brief:preview']!({ requestId: 1, documentId: 'e2e', brief: text });
    return answer.diagnostics.filter((item) => item.severity === 'error').map((item) => item.code);
  }, brief);
}

beforeAll(async () => {
  // Its own data folders, never the machine's (TYTO-139).
  scratch = mkdtempSync(join(tmpdir(), 'tyto-new-from-template-e2e-'));
  userData = join(scratch, 'user-data');
  // For the screenshots only: light whatever the machine's scheme, so the shots named light are.
  if (shots !== undefined) {
    mkdirSync(userData, { recursive: true });
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({ theme: { mode: 'light', light: 'tyto-light', dark: 'tyto-dark' } }),
      'utf8',
    );
  }
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  // Something the script builds, never the markup it shipped with (TYTO-154, TYTO-175).
  await page.waitForSelector('#editor .cm-content');
  await openPreviewBeside(page);
  await page.waitForSelector('.tabs__tab');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1200, 760);
  });
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('New brief from template…', () => {
  it('lists every built-in template with the folder it came from', async () => {
    const rows = await openPicker();
    const agenda = rows.find((row) => row.startsWith('agenda-semana / '));

    expect(rows).toHaveLength(9);
    // The built-in pack's name, in the window's language, before the description.
    expect(agenda).toMatch(/^agenda-semana \/ (built-in|embutido) · The week's agenda/u);
    await shoot('picker-light');
    await page.keyboard.press('Escape');
  }, 60_000);

  it('opens the skeleton in a new tab, and Tab walks its fields to a brief that compiles', async () => {
    const before = await tabCount();
    await openPicker();
    await page.keyboard.type('agenda-semana');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');

    await expect.poll(tabCount, { timeout: 10_000 }).toBe(before + 1);
    await expect.poll(editorText, { timeout: 10_000 }).toContain('::titulo titulo');
    expect(await editorText()).toBe(
      [
        '---',
        'template: agenda-semana',
        'formats: [grid]',
        '---',
        '',
        '::titulo titulo',
        '',
        '::lamina',
        '  lamina',
        '',
        '',
      ].join('\n'),
    );
    expect(await selectedText()).toBe('titulo');
    await shoot('skeleton-light');

    await page.keyboard.type('AGENDA DA SEMANA');
    await page.keyboard.press('Tab');
    expect(await selectedText()).toBe('lamina');
    await shoot('field-selected-light');
    await page.keyboard.type('FARMÁCIA');

    const text = await editorText();
    expect(text).toContain('::titulo AGENDA DA SEMANA\n\n::lamina\n  FARMÁCIA\n');
    expect(await errorsOf(text)).toEqual([]);
    // And the window's own preview drew it.
    await page.waitForFunction(
      () =>
        document.querySelector('tyto-preview-pane:not([hidden]) [data-preview-stage] iframe') !==
        null,
      undefined,
      { timeout: 15_000 },
    );
    await shoot('filled-light');
  }, 90_000);

  it('writes the skeleton when a template is chosen in the "/" menu on an empty brief', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('document.new');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await expect.poll(editorText, { timeout: 10_000 }).toBe('');

    await page.click('#editor .cm-content');
    await page.keyboard.type('/');
    await page.waitForSelector('.cm-tooltip-autocomplete', { state: 'visible', timeout: 15_000 });
    await page.keyboard.type('tabela-r');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');

    await expect.poll(editorText, { timeout: 10_000 }).toContain('template: tabela-roxo');
    expect(await editorText()).toContain('::titulo titulo\n\n::tabela tabela');
    expect(await selectedText()).toBe('titulo');
  }, 60_000);
});

describe('in dark', () => {
  it('draws the picker and the skeleton in the dark theme', async () => {
    if (shots === undefined) return;
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({ theme: { mode: 'dark', light: 'tyto-light', dark: 'tyto-dark' } }),
      'utf8',
    );
    await expect
      .poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors), {
        timeout: 15_000,
      })
      .toBe(true);
    await page.waitForTimeout(500);
    await openPicker();
    await shoot('picker-dark');
    await page.keyboard.type('agenda-semana');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await expect.poll(selectedText, { timeout: 10_000 }).toBe('titulo');
    await shoot('skeleton-dark');
  }, 60_000);
});
