import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * The dock, through a real window (E9.10).
 *
 * `dock.test.ts` answers which elements exist and where, in jsdom. Two things survive only a
 * launched app and they are this card's acceptance criteria: that a dock **has a width** a
 * drag can change, which needs layout, and that closing something and quitting leaves it
 * closed, which needs a second process reading a file the first one wrote.
 *
 * Every app here gets the same `--user-data-dir`, so "restart" means what it says.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let scratch: string;
let app: ElectronApplication;
let page: Page;

/** Launches against the shared user-data folder and waits for the dock to have arranged. */
async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const started = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  const window = await started.firstWindow();
  await window.waitForSelector('[data-panel="editor"]');
  return { app: started, page: window };
}

const openPanels = (target: Page): Promise<string[]> =>
  target.evaluate(() =>
    [...document.querySelectorAll('[data-panel]')].map(
      (node) => node.getAttribute('data-panel') ?? '',
    ),
  );

const dockWidth = (target: Page, dock: string): Promise<number> =>
  target.evaluate(
    (name) =>
      Math.round(
        document.querySelector(`[data-dock="${name}"]`)?.getBoundingClientRect().width ?? 0,
      ),
    dock,
  );

/** Runs a command from the bar, filtered by id the way `documents.desktop.test.ts` does. */
async function runFromBar(target: Page, id: string): Promise<void> {
  await target.keyboard.press('Control+k');
  await target.waitForSelector('.command-bar__input', { state: 'visible' });
  await target.keyboard.type(id);
  await target.waitForTimeout(150);
  await target.keyboard.press('Enter');
  await target.waitForTimeout(500);
}

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-dock-'));
  ({ app, page } = await launch());
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the window the record describes', () => {
  it('opens with the three panels ADR 0024 draws, and an empty left dock', async () => {
    expect(await openPanels(page)).toEqual(['editor', 'preview', 'problems']);
    expect(
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-dock="left"]')?.hidden),
    ).toBe(true);
  });

  it('gives the side dock a real width and the centre the remainder', async () => {
    // The half jsdom cannot answer. `560px` is in the record; that it becomes 560 pixels of
    // window is what a layout engine decides.
    expect(await dockWidth(page, 'right')).toBe(560);
    expect(await dockWidth(page, 'centre')).toBeGreaterThan(0);
  });

  it('has the editor mounted inside its panel, not beside it', async () => {
    const inside = await page.evaluate(
      () => document.querySelector('[data-panel="editor"] #editor .cm-content') !== null,
    );
    expect(inside).toBe(true);
  });
});

describe('dragging a splitter', () => {
  it('changes the dock it is the edge of, and leaves the window fitting', async () => {
    const before = await dockWidth(page, 'right');
    const box = await page.evaluate(() => {
      const rect = document.querySelector('[data-splitter="right"]')?.getBoundingClientRect() ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    // Left, which grows the right dock: the edge being dragged faces into the window.
    await page.mouse.move(box.x - 120, box.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    expect(await dockWidth(page, 'right')).toBeGreaterThan(before + 80);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
  });
});

describe('closing a panel', () => {
  it('takes it out of the document when the close button is used', async () => {
    await page.click('[data-panel="problems"] .panel__close');
    await page.waitForTimeout(400);

    expect(await openPanels(page)).toEqual(['editor', 'preview']);
    expect(await page.evaluate(() => document.getElementById('problems-list'))).toBeNull();
  });

  it('is offered back by the command bar, which needs no panel to be open', async () => {
    await runFromBar(page, 'layout.togglePanel:problems');

    expect(await openPanels(page)).toContain('problems');
  });
});

describe('quitting and reopening', () => {
  it('leaves a closed panel closed and a dragged dock where it was', async () => {
    // The card's two acceptance criteria, in one restart. Both numbers were set by this
    // suite in the tests above, through the window rather than by writing the file.
    await page.click('[data-panel="problems"] .panel__close');
    await page.waitForTimeout(400);
    const width = await dockWidth(page, 'right');
    expect(width).toBeGreaterThan(560);

    await closeApp(app);
    ({ app, page } = await launch());

    expect(await openPanels(page)).toEqual(['editor', 'preview']);
    expect(await dockWidth(page, 'right')).toBe(width);
  });
});

describe('restoring the default', () => {
  it('works with every closable panel shut, which is when it is most needed', async () => {
    await page.click('[data-panel="preview"] .panel__close');
    await page.waitForTimeout(400);
    expect(await openPanels(page)).toEqual(['editor']);

    await runFromBar(page, 'layout.restore');

    expect(await openPanels(page)).toEqual(['editor', 'preview', 'problems']);
    expect(await dockWidth(page, 'right')).toBe(560);
  });

  it('is remembered too, so the restore is not undone by the next launch', async () => {
    await closeApp(app);
    ({ app, page } = await launch());

    expect(await openPanels(page)).toEqual(['editor', 'preview', 'problems']);
  });
});
