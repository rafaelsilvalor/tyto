import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Locator, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Dragging a tab (TYTO-288, ADR 0083 amended): along its strip to reorder it, onto another
 * group's strip to move it there, and the two commands that move it one place from the keys.
 *
 * The pointer is Playwright's page mouse, pressed, moved in steps and released as a hand would,
 * and the keys its page keyboard — input dispatched into the renderer, never the OS's. Files
 * open through the main process's dialog, answered from here. The last case quits and launches
 * again on the same data folder, so the order a drag left is the order the session kept.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let scratch: string;
let app: ElectronApplication | undefined;
let page: Page;

const brief = (title: string): string =>
  ['---', 'template: promo-curso', '---', `::titulo ${title}`].join('\n');

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

const openFile = async (name: string): Promise<void> => {
  const path = join(scratch, `${name}.brief`);
  await app?.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, path);
  await runFromBar('editor.open');
};

/**
 * Each group's tabs in tree order, the one in front starred, a preview as `P:` and a locked one
 * marked: the file names without the extension, whatever the strip shows of it.
 */
const strips = async (): Promise<string[][]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group]')].map((group) =>
      [...group.querySelectorAll<HTMLElement>('.tabs__tab')].map((tab) => {
        const raw = tab.querySelector('.tabs__label')?.textContent ?? '';
        const name = /(alpha|beta|gamma|delta)/u.exec(raw)?.[1] ?? raw;
        const kind = tab.dataset['tabKind'] === 'preview' ? 'P:' : '';
        const locked = tab.querySelector('.tabs__lock') === null ? '' : '[locked]';
        return `${tab.classList.contains('tabs__tab--on') ? '*' : ''}${kind}${name}${locked}`;
      }),
    ),
  );

const groupAt = (index: number): Locator => page.locator('[data-editor-group]').nth(index);

/** A file's own tab in a group; its preview's tab says the name too. */
const tabIn = (group: number, name: string): Locator =>
  groupAt(group).locator('.tabs__tab[data-tab-kind="editor"]').filter({ hasText: name });

const centre = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Presses on `from`, moves to `to` in steps, and leaves the button down. */
const pressAndMove = async (from: Locator, to: { x: number; y: number }): Promise<void> => {
  const start = await centre(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
};

const drag = async (from: Locator, to: { x: number; y: number }): Promise<void> => {
  await pressAndMove(from, to);
  await page.mouse.up();
  await page.waitForTimeout(300);
};

/** Just inside the right end of a tab, past its middle: the gap after it. */
const after = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not on screen');
  return { x: box.x + box.width - 3, y: box.y + box.height / 2 };
};

/** Just inside the left end of a tab, before its middle: the gap before it. */
const before = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not on screen');
  return { x: box.x + 3, y: box.y + box.height / 2 };
};

/** Whether anything of a drag is still drawn: the dimmed tab, the line or a tinted strip. */
const dragLeftovers = async (): Promise<number> =>
  page.evaluate(
    () =>
      document.querySelectorAll('.tabs__tab--dragging, .tabs__strip--drop').length +
      document.querySelectorAll('.tabs__drop-line:not([hidden])').length,
  );

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-tab-drag-'));
  for (const name of ['alpha', 'beta', 'gamma', 'delta']) {
    writeFileSync(join(scratch, `${name}.brief`), brief(name), 'utf8');
  }
  await launch();
  for (const name of ['alpha', 'beta', 'gamma']) await openFile(name);
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('dragging a tab along its strip', () => {
  it('starts with the three files in the order they were opened', async () => {
    expect(await strips()).toEqual([['alpha', 'beta', '*gamma']]);
  });

  it('puts the tab in the gap it is let go in, and in front', async () => {
    await drag(tabIn(0, 'alpha'), await after(tabIn(0, 'gamma')));
    expect(await strips()).toEqual([['beta', 'gamma', '*alpha']]);
    await drag(tabIn(0, 'gamma'), await before(tabIn(0, 'beta')));
    expect(await strips()).toEqual([['*gamma', 'beta', 'alpha']]);
    expect(await dragLeftovers()).toBe(0);
  });

  it('still selects on a plain click', async () => {
    await tabIn(0, 'beta').locator('.tabs__name').click();
    await page.waitForTimeout(300);
    expect(await strips()).toEqual([['gamma', '*beta', 'alpha']]);
  });

  it('still closes on a press of × that wobbles less than the threshold', async () => {
    await openFile('delta');
    expect(await strips()).toEqual([['gamma', 'beta', 'alpha', '*delta']]);
    const close = await centre(tabIn(0, 'delta').locator('.tabs__close'));
    await page.mouse.move(close.x, close.y);
    await page.mouse.down();
    // Two pixels, as a hand on a trackpad moves while it clicks.
    await page.mouse.move(close.x + 2, close.y, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect((await strips())[0]).not.toContain('delta');
    await tabIn(0, 'beta').locator('.tabs__name').click();
    await page.waitForTimeout(300);
    expect(await strips()).toEqual([['gamma', '*beta', 'alpha']]);
  });

  it('is cancelled by Escape, with nothing moved and nothing left drawn', async () => {
    await pressAndMove(tabIn(0, 'gamma'), await after(tabIn(0, 'alpha')));
    expect(await page.locator('.tabs__drop-line:not([hidden])').count()).toBe(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await strips()).toEqual([['gamma', '*beta', 'alpha']]);
    expect(await dragLeftovers()).toBe(0);
  });

  it('is cancelled by a drop on the editor rather than on a strip', async () => {
    await drag(tabIn(0, 'gamma'), await centre(page.locator('#editor .cm-content')));
    expect(await strips()).toEqual([['gamma', '*beta', 'alpha']]);
    expect(await dragLeftovers()).toBe(0);
  });
});

describe('dragging a tab onto another group', () => {
  it('moves it into the other strip, in front there and focused', async () => {
    await tabIn(0, 'alpha').locator('.tabs__name').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+Backslash');
    await page.waitForSelector('.editor-split--row');
    await page.waitForTimeout(300);
    expect(await strips()).toEqual([['gamma', 'beta', '*alpha'], ['*alpha']]);

    await pressAndMove(tabIn(0, 'gamma'), await after(tabIn(1, 'alpha')));
    // The other group's strip is tinted while the pointer is over it.
    expect(await groupAt(1).locator('.tabs__strip--drop').count()).toBe(1);
    await page.mouse.up();
    await page.waitForTimeout(300);

    expect(await strips()).toEqual([
      ['beta', '*alpha'],
      ['alpha', '*gamma'],
    ]);
    expect(await groupAt(1).getAttribute('class')).toContain('editor-group--focused');
    expect(await dragLeftovers()).toBe(0);
  });

  it('brings forward the tab the other group already has of the same file', async () => {
    await drag(tabIn(1, 'alpha'), await before(tabIn(0, 'beta')));
    expect(await strips()).toEqual([['beta', '*alpha'], ['*gamma']]);
  });

  it('collapses a group whose last tab was dragged out', async () => {
    await drag(tabIn(1, 'gamma'), await before(tabIn(0, 'beta')));
    expect(await page.locator('[data-editor-group]').count()).toBe(1);
    expect(await strips()).toEqual([['*gamma', 'beta', 'alpha']]);
  });
});

describe('dragging a locked preview', () => {
  it('moves it with its kind, its name and its lock', async () => {
    await page.keyboard.press('Control+Shift+V');
    await page.waitForSelector('[data-tab-kind="preview"]');
    await page.waitForTimeout(500);
    await runFromBar('preview.toggleLock');
    expect(await strips()).toEqual([['*gamma', 'beta', 'alpha'], ['*P:gamma[locked]']]);

    await drag(groupAt(1).locator('[data-tab-kind="preview"]'), await after(tabIn(0, 'alpha')));
    expect(await page.locator('[data-editor-group]').count()).toBe(1);
    expect(await strips()).toEqual([['gamma', 'beta', 'alpha', '*P:gamma[locked]']]);
  });
});

describe('moving the tab in front from the keys', () => {
  it('goes one place left with Ctrl+Shift+PageUp and right with the command', async () => {
    await tabIn(0, 'beta').locator('.tabs__name').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+Shift+PageUp');
    await page.waitForTimeout(300);
    expect(await strips()).toEqual([['*beta', 'gamma', 'alpha', 'P:gamma[locked]']]);
    await page.keyboard.press('Control+Shift+PageUp');
    await page.waitForTimeout(300);
    expect(await strips()).toEqual([['*beta', 'gamma', 'alpha', 'P:gamma[locked]']]);

    await runFromBar('editor.moveTabRight');
    expect(await strips()).toEqual([['gamma', '*beta', 'alpha', 'P:gamma[locked]']]);
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+Shift+PageDown');
    await page.waitForTimeout(300);
    expect(await strips()).toEqual([['gamma', 'alpha', '*beta', 'P:gamma[locked]']]);
  });
});

describe('the relaunch', () => {
  it('comes back with the order and the groups the drags left', async () => {
    await page.keyboard.press('Control+Backslash');
    await page.waitForSelector('.editor-split--row');
    await page.waitForTimeout(300);
    await drag(tabIn(0, 'gamma'), await after(tabIn(1, 'beta')));
    const left = await strips();
    expect(left).toEqual([
      ['alpha', '*beta', 'P:gamma[locked]'],
      ['beta', '*gamma'],
    ]);

    // A second for the session to be written after the last change, then a quit that writes it.
    await page.waitForTimeout(1500);
    await launch();
    await page
      .waitForFunction(() => document.querySelectorAll('[data-editor-group]').length === 2, null, {
        timeout: 15_000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(500);
    expect(await strips()).toEqual(left);
  });
});
