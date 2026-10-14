import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * `snippets.json`, in a running app (TYTO-277, ADR 0082).
 *
 * **What the unit suites cannot say.** `snippets.test.ts` inserts a snippet in a bare view and
 * `snippets-file.test.ts` reads the text; nothing there proves the file reaches the window at
 * load, that a save reaches it through the watcher with no restart, that the brief editor's
 * completion and "/" menu offer what it says, that Tab steps through the list the window draws,
 * or that the tab comes back after a relaunch. This walks the route a person takes.
 *
 * Every key goes through Playwright's page, which is CDP input to this window and never an OS
 * keystroke that could land in another application. Its own `--user-data-dir` and `TYTO_HOME`
 * (TYTO-139): the snippets file is the subject, and the machine's own must never be touched.
 *
 * With `TYTO_SNIPPETS_SHOTS` set to a folder, the suite leaves screenshots there: the "aula"
 * suggestion open, the fields after the insert, the "/" list with both sections and the
 * snippets tab with a diagnostic, in light, and the first and the last again in dark.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const shots = process.env['TYTO_SNIPPETS_SHOTS'];

/** The card's snippet, and a second one sharing its first two letters, for Tab in the list. */
const SNIPPETS = `// written before launch
{
  "Aula": {
    "prefix": "aula",
    "body": ["::aula \${1:titulo}", "::prof \${2:nome}"],
    "description": "Uma aula com professor"
  },
  "Audio": { "prefix": "audio", "body": "::audio $1" }
}
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

const launch = async (): Promise<void> => {
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  // Something the script builds, never the markup it shipped with (TYTO-154, TYTO-175).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1200, 760);
  });
};

/** The buffer as lines. Every text here is a few lines, so the viewport holds all of it. */
const editorText = (): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#editor .cm-line')]
      .map((line) => line.textContent ?? '')
      .join('\n'),
  );

const selectedText = (): Promise<string> =>
  page.evaluate(() => document.getSelection()?.toString() ?? '');

/** The open list's labels, or `undefined` when no list is open. */
const listLabels = (): Promise<string[] | undefined> =>
  page.evaluate(() => {
    const list = document.querySelector('.cm-tooltip-autocomplete');
    if (list === null) return undefined;
    return [...list.querySelectorAll('li[role="option"]')].map(
      (row) => row.querySelector('.cm-completionLabel')?.textContent ?? '',
    );
  });

const highlighted = (): Promise<string | undefined> =>
  page.evaluate(
    () =>
      document.querySelector(
        '.cm-tooltip-autocomplete li[aria-selected="true"] .cm-completionLabel',
      )?.textContent ?? undefined,
  );

const sectionHeadings = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.cm-tooltip-autocomplete completion-section')].map(
      (heading) => heading.textContent ?? '',
    ),
  );

/** The problems panel's rows as `code@line:column`. */
const problems = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map(
      (row) =>
        `${row.querySelector('.problems__code')?.textContent ?? ''}@${row.querySelector('.problems__where')?.textContent ?? ''}`,
    ),
  );

const tabNames = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__label')].map((node) => node.textContent ?? ''),
  );

/** Runs a command from the bar, filtered by id. */
async function runFromBar(id: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

/** A new, empty brief in front, with the editor focused. */
async function newBrief(): Promise<void> {
  await runFromBar('document.new');
  await expect.poll(editorText, { timeout: 10_000 }).toBe('');
  await page.click('#editor .cm-content');
}

/** Waits for the list, then past CodeMirror's 75 ms in which a key would not reach it. */
async function waitForList(): Promise<string[]> {
  await page.waitForSelector('.cm-tooltip-autocomplete', { state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(150);
  return (await listLabels()) ?? [];
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-snippets-file-e2e-'));
  userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'snippets.json'), SNIPPETS, 'utf8');
  // For the screenshots only: light whatever the machine's scheme, so the shots named light are.
  if (shots !== undefined) {
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({ theme: { mode: 'light', light: 'tyto-light', dark: 'tyto-dark' } }),
      'utf8',
    );
  }
  await launch();
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the snippets file', () => {
  it('offers "aula", inserts it with "titulo" selected, and Tab selects "nome"', async () => {
    await newBrief();
    await page.keyboard.type('aula');
    expect(await waitForList()).toEqual(['aula']);
    await shoot('aula-suggestion-light');

    await page.keyboard.press('Enter');
    await expect.poll(editorText, { timeout: 10_000 }).toBe('::aula titulo\n::prof nome');
    expect(await selectedText()).toBe('titulo');

    await page.keyboard.press('Tab');
    await expect.poll(selectedText, { timeout: 5_000 }).toBe('nome');
    await shoot('aula-fields-light');
    expect(await editorText()).toBe('::aula titulo\n::prof nome');
  }, 90_000);

  it('steps through an open list with Tab and Shift+Tab, and Enter takes the row', async () => {
    await newBrief();
    await page.keyboard.type('au');
    const labels = await waitForList();
    expect([...labels].sort()).toEqual(['audio', 'aula']);
    const first = await highlighted();
    const second = labels.find((label) => label !== first);

    await page.keyboard.press('Tab');
    await expect.poll(highlighted, { timeout: 5_000 }).toBe(second);
    await page.keyboard.press('Shift+Tab');
    await expect.poll(highlighted, { timeout: 5_000 }).toBe(first);
    await page.keyboard.press('Tab');
    await expect.poll(highlighted, { timeout: 5_000 }).toBe(second);
    expect(await editorText()).toBe('au');

    await page.keyboard.press('Enter');
    await expect
      .poll(editorText, { timeout: 10_000 })
      .toBe(second === 'aula' ? '::aula titulo\n::prof nome' : '::audio ');
  }, 60_000);

  it('lists the snippets in the "/" menu under their own section', async () => {
    await newBrief();
    await page.keyboard.type('/');
    const labels = await waitForList();

    expect(labels).toContain('aula');
    expect(labels).toContain('agenda-semana');
    // Templates first, in the order the window hands the sources over, in either language.
    expect(await sectionHeadings()).toEqual([
      'Templates',
      expect.stringMatching(/^(Snippets|Trechos)$/u),
    ]);
    await shoot('slash-sections-light');

    await page.keyboard.type('aula');
    await expect.poll(listLabels, { timeout: 5_000 }).toEqual(['aula']);
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await expect.poll(editorText, { timeout: 10_000 }).toBe('::aula titulo\n::prof nome');
    expect(await selectedText()).toBe('titulo');
  }, 60_000);

  it('opens as a tab, shows a bad entry at its body, and a save applies with no restart', async () => {
    await runFromBar('snippets.open');
    await expect.poll(tabNames, { timeout: 10_000 }).toContain('snippets.json');
    await expect.poll(editorText, { timeout: 10_000 }).toContain('"Aula"');

    const text = [
      '{',
      '  "Aula": { "prefix": "aula", "body": ["::aula ${1:titulo}", "::prof ${2:nome}"] },',
      '  "Arquivo": { "prefix": "arq", "body": "::titulo $TM_FILENAME" },',
      '  "Tema": { "prefix": "tema", "body": "::tema ${1:claro}" }',
      '}',
      '',
    ].join('\n');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    await expect.poll(problems, { timeout: 15_000 }).toContain('W_SNIPPET_UNSUPPORTED_BODY@3:41');
    // The status bar's kind names the file since the editor panel's heading went (TYTO-288).
    expect(await page.textContent('tyto-status-bar .status-bar__kind')).toMatch(
      /^(Snippets|Trechos)$/u,
    );
    await shoot('snippets-tab-diagnostic-light');

    await page.keyboard.press('Control+s');
    await expect
      .poll(() => readFileSync(join(userData, 'snippets.json'), 'utf8'), { timeout: 10_000 })
      .toBe(text);

    await newBrief();
    await page.keyboard.type('tema');
    await expect.poll(listLabels, { timeout: 15_000 }).toEqual(['tema']);
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await expect.poll(editorText, { timeout: 10_000 }).toBe('::tema claro');

    // The refused entry is not offered, and nothing else is broken by it.
    await newBrief();
    await page.keyboard.type('arq');
    await page.waitForTimeout(600);
    expect(await listLabels()).toBeUndefined();
  }, 90_000);

  it('draws the list and the tab in the dark theme', async () => {
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
    await page.keyboard.type('aula');
    await waitForList();
    await shoot('aula-suggestion-dark');
    await page.keyboard.press('Escape');
    await newBrief();
    await page.keyboard.type('/');
    await waitForList();
    await shoot('slash-sections-dark');
    await page.keyboard.press('Escape');
    await runFromBar('snippets.open');
    await page.waitForTimeout(800);
    await shoot('snippets-tab-diagnostic-dark');
  }, 60_000);

  it('brings the snippets tab back after a relaunch, and the snippets with it', async () => {
    await runFromBar('snippets.open');
    await expect.poll(tabNames, { timeout: 10_000 }).toContain('snippets.json');
    const gone = app.waitForEvent('close');
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });
    await gone;

    await launch();
    await expect.poll(tabNames, { timeout: 30_000 }).toContain('snippets.json');
    await newBrief();
    await page.keyboard.type('tema');
    await expect.poll(listLabels, { timeout: 15_000 }).toEqual(['tema']);
    await page.keyboard.press('Escape');
  }, 120_000);
});
