import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The editor groups across a quit and a relaunch, and the commands that rearrange them
 * (TYTO-286 PR B, ADR 0080 and 0083).
 *
 * Two launches of one data folder. The first opens a brief, splits right, puts the cursor
 * somewhere else in each of the two panes on it, splits the right group down and opens a second
 * brief there, then quits. The second has to come back with the same tree, the same tabs in each
 * group and the same one focused, each pane's cursor where that pane left it — one document in
 * two groups looks at two places — and then moves a tab and closes a group.
 *
 * **A pane's cursor and text are read from its view, never from `.cm-content`**, which holds
 * only the lines on screen; the view is reached as `groups.desktop.test.ts` reaches it. Keys go
 * through Playwright's page, never the OS.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let scratch: string;
let firstPath: string;
let secondPath: string;
let app: ElectronApplication | undefined;
let page: Page;

const FIRST = ['---', 'template: promo-curso', '---', '::titulo Campanha'].join('\n');
const SECOND = ['---', 'template: promo-curso', '---', '::titulo Outra'].join('\n');

/** Quits as a person does: the session is written on the way out and nothing is asked. */
const quit = async (): Promise<void> => {
  const running = app;
  if (running === undefined) return;
  const gone = running.waitForEvent('close');
  await running.evaluate(({ app: electronApp }) => {
    electronApp.quit();
  });
  await gone;
  app = undefined;
};

const launch = async (): Promise<void> => {
  await quit();
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
};

const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
};

const openFile = async (path: string): Promise<void> => {
  await app?.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, path);
  await runFromBar('editor.open');
};

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

/** Each group's pane, in tree order: its text and where its cursor is, read from the view. */
const panes = async (): Promise<{ text: string; head: number }[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group] .cm-content')].map((content) => {
      const tile = (content as unknown as { cmTile?: { root?: { view?: unknown } } }).cmTile;
      const view = tile?.root?.view as
        | { state: { doc: { toString(): string }; selection: { main: { head: number } } } }
        | undefined;
      if (view === undefined) throw new Error('a pane with no CodeMirror view behind it');
      return { text: view.state.doc.toString(), head: view.state.selection.main.head };
    }),
  );

const focusedGroupIndex = async (): Promise<number> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group]')].findIndex((group) =>
      group.classList.contains('editor-group--focused'),
    ),
  );

/** The tree's shape as the window laid it out: `row(…)`, `column(…)`, a group as `g`. */
const shape = async (): Promise<string> =>
  page.evaluate(() => {
    const walk = (node: Element): string => {
      if (node.hasAttribute('data-editor-group')) return 'g';
      const direction = node.classList.contains('editor-split--row') ? 'row' : 'column';
      // The lines between groups (TYTO-289) are not part of the tree.
      const children = [...node.children].filter(
        (child) => !child.hasAttribute('data-group-splitter'),
      );
      return `${direction}(${children.map(walk).join(',')})`;
    };
    const root = document.querySelector('[data-editor-groups]')?.firstElementChild;
    return root === null || root === undefined ? '' : walk(root);
  });

const title = async (): Promise<string> =>
  page.evaluate(() => document.querySelector('.title-bar__title')?.textContent ?? '');

const clickPane = async (index: number): Promise<void> => {
  await page.locator('[data-editor-group] .cm-content').nth(index).click();
  await page.waitForTimeout(200);
};

/** Waits until the window has as many groups as the session left, or lets the assertion say. */
const groupsCome = async (count: number): Promise<void> => {
  await page
    .waitForFunction(
      (wanted) => document.querySelectorAll('[data-editor-group]').length === wanted,
      count,
      { timeout: 15_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(300);
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-groups-session-'));
  firstPath = join(scratch, 'campanha.brief');
  secondPath = join(scratch, 'outra.brief');
  writeFileSync(firstPath, FIRST, 'utf8');
  writeFileSync(secondPath, SECOND, 'utf8');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

/** Where each pane's cursor was put in the first launch, in tree order. */
const LEFT_HEAD = '---\n'.length;
const TOP_RIGHT_HEAD = FIRST.length;
const BOTTOM_RIGHT_HEAD = SECOND.length;
const ARRANGED = [['*campanha.brief'], ['*campanha.brief'], ['campanha.brief', '*outra.brief']];

describe('the first launch', () => {
  it('splits right, then down, with a cursor of its own in each pane', async () => {
    await launch();
    await openFile(firstPath);

    // Left: the start of line 2.
    await clickPane(0);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    // Right: the same brief, its cursor at the end.
    await page.keyboard.press('Control+Backslash');
    await page.waitForSelector('.editor-split--row');
    await page.keyboard.press('Control+End');
    // Down from the right, and the second brief there, its cursor at the end too.
    await page.keyboard.press('Control+Shift+Backslash');
    await page.waitForSelector('.editor-split--column');
    await openFile(secondPath);
    await clickPane(2);
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(300);

    expect(await shape()).toBe('row(g,column(g,g))');
    expect(await strips()).toEqual(ARRANGED);
    expect(await focusedGroupIndex()).toBe(2);
    expect((await panes()).map((pane) => pane.head)).toEqual([
      LEFT_HEAD,
      TOP_RIGHT_HEAD,
      BOTTOM_RIGHT_HEAD,
    ]);
  });

  it('keeps the groups, and points `active` at the focused group’s brief', async () => {
    await quit();
    const session = JSON.parse(readFileSync(join(scratch, 'userData', 'session.json'), 'utf8')) as {
      tabs: { path?: string }[];
      active: number;
      groups?: unknown;
    };

    expect(session.groups).toBeDefined();
    // An older build drops `groups` and restores `active`: it must be the brief in front of the
    // focused group, not the first group's.
    expect(session.tabs[session.active]?.path).toBe(secondPath);
  });
});

describe('the relaunch', () => {
  it('comes back with the same tree, tabs per group and focused group', async () => {
    await launch();
    await groupsCome(3);

    expect(await shape()).toBe('row(g,column(g,g))');
    expect(await strips()).toEqual(ARRANGED);
    expect(await focusedGroupIndex()).toBe(2);
    expect(await title()).toContain('outra.brief');
  });

  it('puts each pane’s cursor back where that pane left it', async () => {
    const restored = await panes();
    expect(restored.map((pane) => pane.text)).toEqual([FIRST, FIRST, SECOND]);
    expect(restored.map((pane) => pane.head)).toEqual([
      LEFT_HEAD,
      TOP_RIGHT_HEAD,
      BOTTOM_RIGHT_HEAD,
    ]);
  });

  it('moves the tab in front to the next group, wrapping to the first', async () => {
    await clickPane(2);
    await runFromBar('editor.moveTabToNextGroup');

    expect(await strips()).toEqual([
      ['campanha.brief', '*outra.brief'],
      ['*campanha.brief'],
      ['*campanha.brief'],
    ]);
    expect(await focusedGroupIndex()).toBe(0);
    expect(await title()).toContain('outra.brief');
  });

  it('closes the focused group with its tabs, and the split it leaves collapses', async () => {
    await runFromBar('editor.closeGroup');

    expect(await shape()).toBe('column(g,g)');
    expect(await strips()).toEqual([['*campanha.brief'], ['*campanha.brief']]);
    expect(await focusedGroupIndex()).toBe(0);
    expect(await title()).toContain('campanha.brief');
  });
});
