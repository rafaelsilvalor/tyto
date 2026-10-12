import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The cursor and the scroll of a tab, across a quit and a relaunch (TYTO-265, ADR 0080).
 *
 * Three launches of one data folder. The first puts the cursor on line 40 of a long brief,
 * wheels the pane down and quits; the second has to show the same line and column in the
 * status bar, with the same line at the top of the pane and line 40 still in it; between the
 * second and the third the file is cut to twenty lines, and the cursor has to land on the end of
 * the shorter text rather than past it.
 *
 * **Scrolled with the wheel, as a person scrolls.** Setting `scrollTop` from a script moves the
 * pane by a fraction of a pixel that the wheel never leaves, and a comparison of the two is a
 * comparison of instruments. Positions are compared in lines, and the pixel only to within a
 * screen of the pane's own height.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let scratch: string;
let long: string;
let app: ElectronApplication | undefined;
let page: Page;

const LINES = 200;
const lineText = (number: number): string => `::texto Linha ${String(number).padStart(3, '0')}`;

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
  // A test that failed before its own quit left its app up, on this same data folder.
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

const position = async (): Promise<string> =>
  page.evaluate(
    () => document.querySelector('tyto-status-bar .status-bar__position')?.textContent ?? '',
  );

/**
 * The number of the line at the top of the pane: the first rendered line whose bottom is below
 * the scroller's top edge. Read off the rendered lines on purpose, since this is a question
 * about what is on screen; the text of the document is not read here.
 */
const topLine = async (): Promise<number> =>
  page.evaluate(() => {
    const scroller = document.querySelector('#editor .cm-scroller');
    if (scroller === null) return -1;
    const edge = scroller.getBoundingClientRect().top + 1;
    const first = [...document.querySelectorAll('#editor .cm-line')].find(
      (line) => line.getBoundingClientRect().bottom > edge,
    );
    const match = /Linha (\d+)/u.exec(first?.textContent ?? '');
    return match === null ? -1 : Number(match[1]);
  });

/** The cursor's line as the pane draws it, and whether all of it is inside the pane. */
const cursorLine = async (): Promise<{ text: string; visible: boolean }> =>
  page.evaluate(() => {
    const scroller = document.querySelector('#editor .cm-scroller');
    const line = document.querySelector('#editor .cm-activeLine');
    if (scroller === null || line === null) return { text: '', visible: false };
    const pane = scroller.getBoundingClientRect();
    const box = line.getBoundingClientRect();
    return {
      text: line.textContent ?? '',
      visible: box.top >= pane.top && box.bottom <= pane.top + scroller.clientHeight,
    };
  });

const scroller = async (): Promise<{ top: number; height: number }> =>
  page.evaluate(() => {
    const element = document.querySelector('#editor .cm-scroller');
    return { top: element?.scrollTop ?? -1, height: element?.clientHeight ?? -1 };
  });

const wheelOverEditor = async (deltaY: number): Promise<void> => {
  const box = await page.locator('#editor .cm-scroller').boundingBox();
  if (box === null) throw new Error('the editor has no box to scroll');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
};

/** Waits for the restored tab: the long brief in front, and the cursor where it is expected. */
const restoredTo = async (expected: RegExp): Promise<void> => {
  await page
    .waitForFunction(
      (source) =>
        new RegExp(source, 'u').test(
          document.querySelector('tyto-status-bar .status-bar__position')?.textContent ?? '',
        ),
      expected.source,
      { timeout: 15_000 },
    )
    // Swallowed: the assertion on `position()` below is what reports a cursor left at Ln 1.
    .catch(() => undefined);
};

/** What the first launch left, for the second to compare against. */
let before: { top: number; scrollTop: number };

beforeAll(() => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-session-place-'));
  long = join(scratch, 'longo.brief');
  const lines = Array.from({ length: LINES }, (_, index) => lineText(index + 1));
  writeFileSync(long, lines.join('\n'), 'utf8');
});

afterAll(async () => {
  // A test that failed before its own quit leaves the app up: quit it the way the tests do,
  // which waits for the process to go, and only then answer any box on the way out.
  await quit().catch(() => undefined);
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe('the cursor and the scroll across a relaunch', () => {
  it('leaves the cursor on line 40 of a long brief, wheeled down, and quits', async () => {
    await launch();
    await openFile(long);
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+Home');
    for (let step = 1; step < 40; step += 1) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    for (let step = 1; step < 5; step += 1) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() =>
      /^(Ln|Lin) 40, Col 5$/u.test(
        document.querySelector('tyto-status-bar .status-bar__position')?.textContent ?? '',
      ),
    );

    // A third of a screen down from where the caret left the pane: the cursor's line stays in
    // view, and the top is a line the caret alone would never have put there.
    const start = await scroller();
    await wheelOverEditor(Math.round(start.height / 3));
    await page.waitForFunction(
      (from) => (document.querySelector('#editor .cm-scroller')?.scrollTop ?? 0) > from + 20,
      start.top,
    );
    // CodeMirror measures after a scroll; the top line is read once it has stopped moving.
    await page.waitForFunction(
      () => {
        // The previous poll's answer, on the page because the function is sent there as text.
        const held = globalThis as { lastScrollTop?: number };
        const now = document.querySelector('#editor .cm-scroller')?.scrollTop ?? -1;
        const settled = now === held.lastScrollTop;
        held.lastScrollTop = now;
        return settled;
      },
      undefined,
      { polling: 100 },
    );

    before = { top: await topLine(), scrollTop: (await scroller()).top };
    expect(before.top).toBeGreaterThan(1);
    expect(await cursorLine()).toEqual({ text: lineText(40), visible: true });

    await quit();
  });

  it('reopens with the same line and column, the same line at the top, and line 40 in view', async () => {
    await launch();
    await page.waitForFunction(
      () => document.querySelector('.tabs__tab--on .tabs__label')?.textContent === 'longo.brief',
      undefined,
      { timeout: 30_000 },
    );
    await restoredTo(/^(Ln|Lin) 40, Col 5$/u);
    expect(await position()).toMatch(/^(Ln|Lin) 40, Col 5$/u);

    // The scroll lands on a measure pass after the tab is shown: waited for, never slept on.
    const wanted = before.top;
    await page
      .waitForFunction(
        (line) => {
          const pane = document.querySelector('#editor .cm-scroller');
          if (pane === null) return false;
          const edge = pane.getBoundingClientRect().top + 1;
          const first = [...document.querySelectorAll('#editor .cm-line')].find(
            (element) => element.getBoundingClientRect().bottom > edge,
          );
          return (first?.textContent ?? '').endsWith(String(line).padStart(3, '0'));
        },
        wanted,
        { timeout: 10_000 },
      )
      .catch(() => undefined);

    // The same line at the top, to within the one line a stored position can round down by.
    expect(Math.abs((await topLine()) - before.top)).toBeLessThanOrEqual(1);
    const now = await scroller();
    expect(Math.abs(now.top - before.scrollTop)).toBeLessThan(now.height);
    expect(await cursorLine()).toEqual({ text: lineText(40), visible: true });

    await quit();
  });

  it('clamps the cursor to the end of a file that got shorter on disk', async () => {
    const lines = Array.from({ length: 20 }, (_, index) => lineText(index + 1));
    writeFileSync(long, lines.join('\n'), 'utf8');

    await launch();
    await page.waitForFunction(
      () => document.querySelector('.tabs__tab--on .tabs__label')?.textContent === 'longo.brief',
      undefined,
      { timeout: 30_000 },
    );
    // Line 40 is gone: the cursor goes to the end of what is there, `::texto Linha 020`.
    const end = new RegExp(`^(Ln|Lin) 20, Col ${String(lineText(20).length + 1)}$`, 'u');
    await restoredTo(end);
    expect(await position()).toMatch(end);
    expect(await cursorLine()).toEqual({ text: lineText(20), visible: true });

    await quit();
  });
});
