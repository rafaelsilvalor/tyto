import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The "/" menu, through the real window (TYTO-276).
 *
 * A "/" at the start of a line in a brief lists the templates; "agen" filters to the agenda and
 * Enter writes its skeleton in place of the "/". A "/" in the middle of a line is a "/". On a
 * brief with content the row says it switches the template, and choosing it does — the "/"
 * going in the same edit, so one Ctrl+Z takes both back. And `editor.insertMenu`, which ships
 * with no key, opens the same list from a binding in this launch's own `keybindings.json`.
 *
 * Every key goes through Playwright's page, which is CDP input to this window and never an OS
 * keystroke that could land in another application. Its own `--user-data-dir` and `TYTO_HOME`
 * (TYTO-139).
 *
 * With `TYTO_SLASH_SHOTS` set to a folder, the suite leaves screenshots there: the list open on
 * an empty brief with "agen" typed and the switch row on a brief with content, in light, and the
 * first again in dark.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const shots = process.env['TYTO_SLASH_SHOTS'];

const KEYBINDINGS = `[
  { "key": "ctrl+alt+y", "command": "editor.insertMenu" }
]
`;

let scratch: string;
let userData: string;
let app: ElectronApplication;
let page: Page;

const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

/** The buffer as lines. Every brief here is a few lines, so the viewport holds all of it. */
const editorText = (): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#editor .cm-line')]
      .map((line) => line.textContent ?? '')
      .join('\n'),
  );

const selectedText = (): Promise<string> =>
  page.evaluate(() => document.getSelection()?.toString() ?? '');

/** The open list's rows as `label / detail`, or `undefined` when no list is open. */
const listRows = (): Promise<string[] | undefined> =>
  page.evaluate(() => {
    const list = document.querySelector('.cm-tooltip-autocomplete');
    if (list === null) return undefined;
    return [...list.querySelectorAll('li[role="option"]')].map((row) =>
      [
        row.querySelector('.cm-completionLabel')?.textContent ?? '',
        row.querySelector('.cm-completionDetail')?.textContent ?? '',
      ].join(' / '),
    );
  });

const sectionHeadings = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.cm-tooltip-autocomplete completion-section')].map(
      (heading) => heading.textContent ?? '',
    ),
  );

/** A new, empty tab in front, through the bar, with the editor focused. */
async function newBrief(): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('document.new');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await expect.poll(editorText, { timeout: 10_000 }).toBe('');
  await page.click('#editor .cm-content');
}

/** Waits for the list, then past CodeMirror's 75 ms in which Enter would not accept. */
async function waitForList(): Promise<string[]> {
  await page.waitForSelector('.cm-tooltip-autocomplete', { state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(150);
  return (await listRows()) ?? [];
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-slash-menu-e2e-'));
  userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'keybindings.json'), KEYBINDINGS, 'utf8');
  // For the screenshots only: light whatever the machine's scheme, so the shots named light are.
  if (shots !== undefined) {
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
  await page.waitForSelector('.tabs__tab');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('#template option')].some(
        (option) => (option as HTMLOptionElement).value === 'agenda-semana',
      ),
    undefined,
    { timeout: 30_000 },
  );
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1200, 760);
  });
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the "/" menu', () => {
  it('writes the agenda skeleton for "/" + "agen" + Enter in an empty brief', async () => {
    await newBrief();
    await page.keyboard.type('/');
    const rows = await waitForList();

    expect(rows).toHaveLength(9);
    expect(rows).toContainEqual(expect.stringMatching(/^agenda-semana \/ (new brief|novo brief)/u));
    expect(await sectionHeadings()).toEqual(['Templates']);

    await page.keyboard.type('agen');
    await expect
      .poll(listRows, { timeout: 5_000 })
      .toEqual([expect.stringMatching(/^agenda-semana \//u)]);
    await page.waitForTimeout(150);
    await shoot('list-agen-light');
    await page.keyboard.press('Enter');

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
  }, 90_000);

  it('types a "/" in the middle of a line, with no list', async () => {
    await newBrief();
    await page.keyboard.type('::titulo a/b');
    await page.waitForTimeout(500);

    expect(await listRows()).toBeUndefined();
    expect(await editorText()).toBe('::titulo a/b');
  }, 60_000);

  it('switches `template:` on a brief with content, and one Ctrl+Z takes it back', async () => {
    await newBrief();
    await page.keyboard.insertText('---\ntemplate: promo-curso\n---\n\n::titulo Olá\n');
    await page.keyboard.type('/');
    const rows = await waitForList();

    expect(rows).toContainEqual(
      expect.stringMatching(
        /^tabela-roxo \/ (switches the template \(current: promo-curso\)|troca o template \(atual: promo-curso\))$/u,
      ),
    );
    expect(rows).toContainEqual(expect.stringMatching(/^promo-curso \/ (current|template atual)/u));
    await shoot('list-switch-light');

    await page.keyboard.type('tabela-r');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');

    await expect.poll(editorText, { timeout: 10_000 }).toContain('template: tabela-roxo');
    expect(await editorText()).toBe('---\ntemplate: tabela-roxo\n---\n\n::titulo Olá\n');

    await page.keyboard.press('Control+z');
    await expect.poll(editorText, { timeout: 10_000 }).toContain('template: promo-curso');
    expect(await editorText()).not.toContain('tabela-roxo');
  }, 60_000);

  it('opens from a keybindings.json entry with no "/" typed, and Escape closes it', async () => {
    await newBrief();
    await page.keyboard.insertText('::titulo Olá');
    await page.keyboard.press('Control+Alt+y');
    const rows = await waitForList();

    expect(rows).toHaveLength(9);
    expect(await editorText()).toBe('::titulo Olá');

    await page.keyboard.press('Escape');
    await expect.poll(listRows, { timeout: 5_000 }).toBeUndefined();
    expect(await editorText()).toBe('::titulo Olá');
  }, 60_000);
});

describe('in dark', () => {
  it('draws the list in the dark theme', async () => {
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
    await newBrief();
    await page.keyboard.type('/agen');
    await waitForList();
    await shoot('list-agen-dark');
    await page.keyboard.press('Escape');
  }, 60_000);
});
