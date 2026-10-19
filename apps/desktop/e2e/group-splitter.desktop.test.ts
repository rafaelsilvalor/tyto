import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The line between two editor groups (TYTO-289, ADR 0083): dragged, kept across a quit and a
 * relaunch, double-clicked back to halves, moved from the keyboard, and stopped at a group's
 * minimum.
 *
 * Two launches of one data folder. The pointer is Playwright's page mouse and the keys its page
 * keyboard — input dispatched into the renderer, never the OS's. Widths are read off the group
 * elements, which is what a person sees, and the stored shares off `session.json`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let scratch: string;
let briefPath: string;
let app: ElectronApplication | undefined;
let page: Page;

const BRIEF = ['---', 'template: promo-curso', '---', '::titulo Campanha'].join('\n');

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
    // A `show: false` window paints about one frame a second, and Playwright waits a frame for
    // every mouse step taken with the button held: 12 s a drag. Unlimited frames make it
    // 0.2 s (the file: 33 s → 9 s on CI). Test side only; the app ships unchanged (ADR 0104).
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`, '--disable-frame-rate-limit'],
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

const SPLITTER = '[data-group-splitter]';

/** The two groups' widths, in tree order, as laid out. */
const widths = async (): Promise<number[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group]')].map(
      (group) => group.getBoundingClientRect().width,
    ),
  );

/** The share of the first group, as the window draws it. */
const firstShare = async (): Promise<number> => {
  const [first = 0, second = 0] = await widths();
  return first / (first + second);
};

const splitterCentre = async (): Promise<{ x: number; y: number }> => {
  const box = await page.locator(SPLITTER).boundingBox();
  if (box === null) throw new Error('the splitter is not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Drags the line to `x` with the page's mouse, in steps, as a hand would. */
const dragTo = async (x: number): Promise<void> => {
  const from = await splitterCentre();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(x, from.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
};

/** The split's box: where the line can go. */
const splitBox = async (): Promise<{ x: number; width: number }> => {
  const box = await page.locator('[data-editor-groups] > .editor-split--row').boundingBox();
  if (box === null) throw new Error('no split on screen');
  return { x: box.x, width: box.width };
};

const aria = async (name: string): Promise<number> =>
  Number(await page.locator(SPLITTER).getAttribute(name));

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-group-splitter-'));
  briefPath = join(scratch, 'campanha.brief');
  writeFileSync(briefPath, BRIEF, 'utf8');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

let draggedWidth = 0;

describe('dragging the line between two groups', () => {
  it('starts at halves, with a vertical separator between them', async () => {
    await launch();
    await openFile(briefPath);
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+Backslash');
    await page.waitForSelector('.editor-split--row');
    await page.waitForTimeout(300);

    expect(await page.locator(SPLITTER).count()).toBe(1);
    expect(await page.locator(SPLITTER).getAttribute('role')).toBe('separator');
    expect(await page.locator(SPLITTER).getAttribute('aria-orientation')).toBe('vertical');
    expect(await firstShare()).toBeCloseTo(0.5, 2);
  });

  it('puts the line where the pointer lets go: about one third', async () => {
    const box = await splitBox();
    await dragTo(box.x + box.width / 3);

    expect(await firstShare()).toBeCloseTo(1 / 3, 1);
    expect(Math.abs((await firstShare()) - 1 / 3)).toBeLessThan(0.01);
    expect(await aria('aria-valuenow')).toBe(33);
    draggedWidth = (await widths())[0] ?? 0;
  });

  it('writes the shares into the session', async () => {
    await quit();
    const session = JSON.parse(readFileSync(join(scratch, 'userData', 'session.json'), 'utf8')) as {
      groups?: { root?: { split?: string; sizes?: number[] } };
    };
    expect(session.groups?.root?.split).toBe('row');
    expect(session.groups?.root?.sizes?.[0]).toBeCloseTo(1 / 3, 1);
  });
});

describe('the relaunch', () => {
  it('comes back with the line where it was, within a pixel', async () => {
    await launch();
    await page
      .waitForFunction(() => document.querySelectorAll('[data-editor-group]').length === 2, null, {
        timeout: 15_000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(300);

    expect(await page.locator('[data-editor-group]').count()).toBe(2);
    expect(Math.abs(((await widths())[0] ?? 0) - draggedWidth)).toBeLessThanOrEqual(1);
  });
});

describe('a double-click on the line', () => {
  it('gives both groups half again', async () => {
    const at = await splitterCentre();
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForTimeout(200);

    const [first = 0, second = 0] = await widths();
    expect(Math.abs(first - second)).toBeLessThanOrEqual(1);
    expect(await aria('aria-valuenow')).toBe(50);
  });
});

describe('the keyboard on the focused line', () => {
  it('moves it a step per arrow along its axis, and not across it', async () => {
    const before = (await widths())[0] ?? 0;
    await page.locator(SPLITTER).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const grown = (await widths())[0] ?? 0;
    expect(Math.abs(grown - before - 48)).toBeLessThanOrEqual(1);
    expect(await aria('aria-valuenow')).toBeGreaterThan(50);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    expect(Math.abs(((await widths())[0] ?? 0) - (grown - 16))).toBeLessThanOrEqual(1);
    // The line still has the focus: a share change moves no element.
    expect(
      await page.evaluate(() => document.activeElement?.hasAttribute('data-group-splitter')),
    ).toBe(true);
  });
});

describe('the minimum size', () => {
  it('stops the line where the group before it has its minimum, and says so', async () => {
    const box = await splitBox();
    await dragTo(box.x + 4);

    expect(Math.abs(((await widths())[0] ?? 0) - 160)).toBeLessThanOrEqual(1);
    // The stored share and not only the drawn width: CSS's own minimum would hold the width at
    // 160 px even over a share of nothing, and the next drag would start from that nothing.
    expect(await aria('aria-valuenow')).toBe(await aria('aria-valuemin'));
    expect(await aria('aria-valuemin')).toBeGreaterThan(5);
  });
});
