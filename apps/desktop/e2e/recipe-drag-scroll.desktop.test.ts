import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Dragging a recipe's block past the edge of its pane scrolls the pane (TYTO-710), in the real
 * window: a recipe of forty note blocks, far taller than the pane, its first note dragged to
 * the bottom edge and held there until the pane has scrolled to its end, then dropped above
 * the last note, and saved. Its own file and not `recipe-blocks.desktop.test.ts`'s, which is
 * near its 60 s budget (ADR 0105).
 *
 * What it asserts is what jsdom cannot: the pane scrolls under a held pointer, the dragged
 * block's own lines and grip leave CodeMirror's viewport on the way, and the drop still lands
 * where the pointer is. The speed, the stop at the end and the cancels are
 * `notebook-frames.test.ts`'s, the drop place following a wheel's scroll too: a wheel scrolls
 * smoothly, on animation frames, which this hidden window does not run.
 *
 * Notes only, so no plugin and no run. Its own `TYTO_HOME`, `--user-data-dir` and
 * `--lang=en`, one launch.
 */

const here = dirname(fileURLToPath(import.meta.url));

const NOTES = 40;
const RECIPE = [
  'recipe tall',
  '',
  ...Array.from({ length: NOTES }, (_, index) => [`# note ${String(index)}`, '']).flat(),
].join('\n');

let scratch: string;
let recipePath: string;
let app: ElectronApplication | undefined;
let page: Page;

/** Runs a command through the command bar's own door; `false` when the gate refused it. */
const run = (commandId: string): Promise<boolean> =>
  page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);

const tabNames = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

/**
 * Runs CodeMirror's pending measure now: this suite's window is never shown, so an animation
 * frame does not come (`recipe-blocks.desktop.test.ts` says how it was measured), and
 * `coordsAtPos` reads the layout, which runs the measure first.
 */
async function measured(): Promise<void> {
  await page.evaluate(() => {
    const content = document.querySelector('#editor .cm-content') as unknown as {
      cmTile?: { root?: { view?: { coordsAtPos(at: number): unknown } } };
    };
    content.cmTile?.root?.view?.coordsAtPos(0);
  });
}

/** The pane's scroll and its box, in the window's coordinates. */
const pane = (): Promise<{ top: number; bottom: number; scrolled: number; end: number }> =>
  page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('#editor .cm-scroller');
    const box = scroller?.getBoundingClientRect();
    return {
      top: box?.top ?? 0,
      bottom: box?.bottom ?? 0,
      scrolled: scroller?.scrollTop ?? 0,
      end: (scroller?.scrollHeight ?? 0) - (scroller?.clientHeight ?? 0),
    };
  });

/** The centre of the grip that drags frame `index`, or `undefined` when it is not drawn. */
const grip = async (index: number): Promise<{ x: number; y: number } | undefined> => {
  await measured();
  return page.evaluate((wanted) => {
    const found = document.querySelector<HTMLElement>(
      `#editor .cm-notebook-grip[data-notebook-grip="${String(wanted)}"]`,
    );
    const box = found?.getBoundingClientRect();
    return box === undefined
      ? undefined
      : { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, index);
};

/** The top of the line whose text is `text`, or `undefined` when it is not drawn. */
const lineTop = (text: string): Promise<number | undefined> =>
  page.evaluate((wanted) => {
    const line = [...document.querySelectorAll('#editor .cm-line')].find(
      (each) => each.textContent === wanted,
    );
    return line?.getBoundingClientRect().top;
  }, text);

/** The middle of the drop line, or `undefined` with none drawn. */
const dropTop = async (): Promise<number | undefined> => {
  await measured();
  return page.evaluate(() => {
    const line = document.querySelector('#editor .cm-notebook-drop');
    if (line === null) return undefined;
    const box = line.getBoundingClientRect();
    return (box.top + box.bottom) / 2;
  });
};

const text = (): Promise<string> =>
  page.evaluate(() => {
    const content = document.querySelector('#editor .cm-content') as unknown as {
      cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } };
    };
    return content.cmTile?.root?.view?.state.doc.toString() ?? '';
  });

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-drag-scroll-e2e-'));
  const work = join(scratch, 'recipes');
  mkdirSync(work, { recursive: true });
  recipePath = join(work, 'tall.recipe');
  writeFileSync(recipePath, RECIPE);
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, recipePath);
  // The window refuses an open until it has read the last session, so it is asked again. A
  // loop and not `expect.poll`, which belongs to a test.
  const deadline = Date.now() + 15_000;
  for (;;) {
    await run('editor.open');
    if ((await tabNames()).includes('tall.recipe')) break;
    if (Date.now() > deadline) throw new Error('tall.recipe did not open');
    await page.waitForTimeout(250);
  }
  await page.waitForSelector('#editor .cm-notebook-grip');
}, 60_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a block dragged near the edge of its pane (TYTO-710)', () => {
  it('scrolls to the end under a held pointer, and drops the first note above the last', async () => {
    const start = await grip(1);
    if (start === undefined) throw new Error('no grip on the first note');
    const box = await pane();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Inside the bottom band, a few pixels above the pane's edge.
    await page.mouse.move(start.x, box.bottom - 6, { steps: 8 });
    await expect
      .poll(
        async () => {
          const now = await pane();
          return now.end - now.scrolled;
        },
        { timeout: 15_000 },
      )
      .toBeLessThan(1);
    // The dragged block left CodeMirror's viewport on the way: its line and grip are not drawn.
    await measured();
    expect(await lineTop('# note 0')).toBeUndefined();
    expect(await grip(1)).toBeUndefined();

    const last = `# note ${String(NOTES - 1)}`;
    const target = await lineTop(last);
    if (target === undefined) throw new Error(`'${last}' is not drawn at the end of the scroll`);
    await page.mouse.move(start.x, target + 3, { steps: 4 });
    await expect.poll(dropTop, { timeout: 5_000 }).toBeDefined();
    expect(Math.abs(((await dropTop()) ?? 0) - target)).toBeLessThan(4);
    await page.mouse.up();

    const notes = Array.from({ length: NOTES }, (_, index) => `# note ${String(index)}`);
    const moved = [...notes.slice(1, -1), notes[0] ?? '', notes.at(-1) ?? ''];
    const after = ['recipe tall', '', ...moved.flatMap((note) => [note, ''])].join('\n');
    await expect.poll(text, { timeout: 5_000 }).toBe(after);
    await page.keyboard.press('Control+s');
    await expect.poll(() => readFileSync(recipePath, 'utf8'), { timeout: 10_000 }).toBe(after);
  }, 30_000);
});
