import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The editor split into groups, through a real window (TYTO-286, ADR 0083).
 *
 * What the card asks for needs running CodeMirror views: two panes on one document copying
 * each other's typing, focus moving between them, and the window around them — the title, the
 * status bar, the problems count — following the group in front. `editor-groups.test.ts` holds
 * the tree's bookkeeping and `packages/editor/src/panes.test.ts` the copying; this is the
 * window doing it.
 *
 * **A pane's text is read from its view, never from `.cm-content`**, which holds only the lines
 * on screen. The view is reached through the node CodeMirror marks its content with — the same
 * lookup `EditorView.findFromDOM` makes — in the page, over the debugger.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let app: ElectronApplication;
let page: Page;
let scratch: string;
let firstPath: string;
let secondPath: string;

const FIRST = ['---', 'template: promo-curso', '---', '::titulo Campanha'].join('\n');
/** Names a template nobody has, so this brief has a problem and the first has none. */
const SECOND = ['---', 'template: nao-existe', '---', '::titulo Outra'].join('\n');

/** Every group's pane text, in tree order, read from the view and not from the viewport. */
const paneTexts = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group] .cm-content')].map((content) => {
      const tile = (content as unknown as { cmTile?: { root?: { view?: unknown } } }).cmTile;
      const view = tile?.root?.view as { state: { doc: { toString(): string } } } | undefined;
      if (view === undefined) throw new Error('a pane with no CodeMirror view behind it');
      return view.state.doc.toString();
    }),
  );

/** Each group's tab labels, in tree order, the one in front starred. */
const strips = async (): Promise<string[][]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group]')].map((group) =>
      [...group.querySelectorAll('.tabs__tab')].map((tab) => {
        const label = tab.querySelector('.tabs__label')?.textContent ?? '';
        return tab.classList.contains('tabs__tab--on') ? `*${label}` : label;
      }),
    ),
  );

/** The tabs with the unsaved dot, by label, across every group. */
const dirtyTabs = async (): Promise<string[]> =>
  page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('.tabs__tab')]
        .filter((tab) => tab.querySelector('.tabs__dirty') !== null)
        .map((tab) => tab.querySelector('.tabs__label')?.textContent ?? ''),
    ),
  ]);

const focusedGroupIndex = async (): Promise<number> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group]')].findIndex((group) =>
      group.classList.contains('editor-group--focused'),
    ),
  );

const title = async (): Promise<string> =>
  page.evaluate(() => document.querySelector('.title-bar__title')?.textContent ?? '');

const statusTemplate = async (): Promise<string> =>
  page.evaluate(
    () => document.querySelector('tyto-status-bar .status-bar__template')?.textContent ?? '',
  );

/** Clicks into a group's pane, the way a person moves focus there. */
const clickPane = async (index: number): Promise<void> => {
  await page.locator('[data-editor-group] .cm-content').nth(index).click();
  await page.waitForTimeout(200);
};

const answerOpenWith = async (path: string): Promise<void> => {
  await app.evaluate(({ dialog }, open) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [open] });
  }, path);
};

/** Runs a command the way a person would: the bar, filtered by id. */
const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'tyto-groups-'));
  firstPath = join(scratch, 'campanha.brief');
  secondPath = join(scratch, 'outra.brief');
  writeFileSync(firstPath, FIRST, 'utf8');
  writeFileSync(secondPath, SECOND, 'utf8');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');

  await answerOpenWith(firstPath);
  await runFromBar('editor.open');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('one group', () => {
  it('is the window as it was: one strip, `#editor` its pane', async () => {
    expect(await strips()).toEqual([['*campanha.brief']]);
    expect(await page.locator('[data-editor-group] #editor').count()).toBe(1);
  });
});

describe('splitting right with a brief open', () => {
  it('makes two groups showing the same brief, the new one focused', async () => {
    await clickPane(0);
    await page.keyboard.press('Control+Backslash');
    await page.waitForSelector('.editor-split--row');

    expect(await strips()).toEqual([['*campanha.brief'], ['*campanha.brief']]);
    expect(await paneTexts()).toEqual([FIRST, FIRST]);
    expect(await focusedGroupIndex()).toBe(1);
  });

  it('shows typing in one group in the other, both ways', async () => {
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' direita');
    await page.waitForTimeout(200);
    expect(await paneTexts()).toEqual([`${FIRST} direita`, `${FIRST} direita`]);
    // The status bar shows the caret of the pane typed in, a follower, and not the record's.
    const position = page.locator('tyto-status-bar .status-bar__position');
    expect(await position.textContent()).toContain(' 4, ');

    await clickPane(0);
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' esquerda');
    await page.waitForTimeout(200);
    expect(await paneTexts()).toEqual([`${FIRST} direita esquerda`, `${FIRST} direita esquerda`]);
    // One document, so one unsaved dot's worth of label, in both strips.
    expect(await dirtyTabs()).toEqual(['campanha.brief']);
  });

  it('undoes from either group in the one history', async () => {
    await clickPane(1);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect(await paneTexts()).toEqual([`${FIRST} direita`, `${FIRST} direita`]);
  });
});

describe('a second brief in the right group', () => {
  it('opens there, beside the first, and leaves the left group alone', async () => {
    await clickPane(1);
    await answerOpenWith(secondPath);
    await runFromBar('editor.open');

    expect(await strips()).toEqual([['*campanha.brief'], ['campanha.brief', '*outra.brief']]);
    expect(await paneTexts()).toEqual([`${FIRST} direita`, SECOND]);
  });

  it('puts the title and the status bar on the focused group, and moves them with focus', async () => {
    expect(await title()).toContain('outra.brief');
    expect(await statusTemplate()).toContain('nao-existe');

    await clickPane(0);
    expect(await title()).toContain('campanha.brief');
    expect(await statusTemplate()).toContain('promo-curso');

    await clickPane(1);
    expect(await title()).toContain('outra.brief');
  });

  it('counts the focused brief’s problems, not the other group’s', async () => {
    const problems = page.locator('tyto-status-bar [data-command="layout.togglePanel:problems"]');
    await clickPane(1);
    await page.waitForTimeout(500);
    const right = ((await problems.textContent()) ?? '').trim();
    await clickPane(0);
    await page.waitForTimeout(300);
    const left = ((await problems.textContent()) ?? '').trim();

    expect(left).toBe('0');
    expect(Number(right)).toBeGreaterThan(0);
  });

  it('files a transaction in a group nobody is looking at under that group’s document', async () => {
    // What a lint answer or a copied change is: a transaction in a pane that is not focused.
    // It must land in the document that pane shows; written into the focused one instead, it
    // would put the left brief's text into the right brief's record, without a word.
    await clickPane(1);
    await page.evaluate(() => {
      const content = document.querySelectorAll('[data-editor-group] .cm-content')[0];
      const tile = (content as unknown as { cmTile?: { root?: { view?: unknown } } }).cmTile;
      const view = tile?.root?.view as
        { dispatch(spec: { changes: { from: number; insert: string } }): void } | undefined;
      view?.dispatch({ changes: { from: 0, insert: '#' } });
    });
    await page.waitForTimeout(200);

    expect(await dirtyTabs()).toEqual(['campanha.brief']);
    expect(await title()).toContain('outra.brief');
  });
});

describe('splitting down', () => {
  it('nests a column under the focused group', async () => {
    await clickPane(0);
    await page.keyboard.press('Control+Shift+Backslash');
    await page.waitForSelector('.editor-split--column');

    expect((await strips()).length).toBe(3);
    expect(await focusedGroupIndex()).toBe(1);
    const texts = await paneTexts();
    expect(texts[0]).toBe(texts[1]);
  });

  it('closes a group with its last tab, and the split collapses', async () => {
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(300);

    expect(await page.locator('.editor-split--column').count()).toBe(0);
    expect((await strips()).length).toBe(2);
  });
});
