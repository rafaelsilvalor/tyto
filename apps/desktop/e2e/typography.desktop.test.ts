import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The window's faces, sizes and zoom through the real window (TYTO-272, ADR 0099).
 *
 * - At the defaults every size is the pixel it was: the ramp derives from `--tyto-ui-size` and
 *   lands on 12, 13, 14 and 16, and the strips are 30 and 22.
 * - `uiFontSize` moves the whole ramp and grows the strips past their floors, so no label is
 *   cut; `codeFontSize` moves the editor alone, and the indent guides and the pinned head line
 *   follow at once, with nothing typed or scrolled in between — that is the remeasure.
 * - A face the machine lacks is drawn in the bundled one and said in the problems panel.
 * - `Mod-=`, `Mod--` and `Mod-0` zoom the window and write `zoom` to `settings.json`, in vim
 *   too; a window launched with a `zoom` opens at it.
 *
 * Everything is read off the DOM, the computed styles and the file on disk; scrolling is the
 * wheel's. With `TYTO_TYPOGRAPHY_SHOTS` set to a folder the suite leaves the pictures Rafael
 * approves by: defaults, zoom +1, `uiFontSize` 18 and `codeFontSize` 20, each in Tyto Light and
 * Tyto Dark, and the new `settings.json`'s example.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_TYPOGRAPHY_SHOTS'];

const BODY = Array.from(
  { length: 40 },
  (_, index) => `    ${String(10 + index)}/09 - 14:00 | Farmacologia Geral | Profª. Marcela Rocha`,
);

/** Two levels of indent and a block long enough to scroll inside. */
const BRIEF = [
  '---', //                      0
  'template: agenda-semana', //  1
  'formats: [grid]', //          2
  '---', //                      3
  '::titulo', //                 4
  '  AGENDA DA SEMANA', //       5
  '', //                         6
  '::lamina', //                 7
  '  FARMÁCIA', //               8
  ...BODY, //                    9…48
].join('\n');

let app: ElectronApplication;
let page: Page;
let scratch: string;
let settingsFile: string;

/** Writes `settings.json` on disk, which main applies as any writer's save. */
function saveSettings(settings: Record<string, unknown>): void {
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/** The file on disk without its comments, read as JSON; `{}` when there is none. */
const onDisk = (): Record<string, unknown> => {
  if (!existsSync(settingsFile)) return {};
  const text = readFileSync(settingsFile, 'utf8').replace(/^\s*\/\/.*$/gmu, '');
  return text.trim() === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
};

const computed = (selector: string, property: string): Promise<string> =>
  page.evaluate(
    ([where, name]) =>
      getComputedStyle(document.querySelector(where!)!).getPropertyValue(name!).trim(),
    [selector, property] as const,
  );

const height = (selector: string): Promise<number> =>
  page.evaluate((where) => document.querySelector(where)!.getBoundingClientRect().height, selector);

/** Waits until `selector`'s computed `font-size` is `size`: the answer has landed. */
const sizeApplied = (selector: string, size: string): Promise<unknown> =>
  page.waitForFunction(
    ([where, expected]) => getComputedStyle(document.querySelector(where!)!).fontSize === expected,
    [selector, size] as const,
    { polling: 25, timeout: 15_000 },
  );

/** The zoom level of the window's own page, as Electron holds it. */
const zoomLevel = (): Promise<number> =>
  app.evaluate(({ BrowserWindow }) => {
    const shown = BrowserWindow.getAllWindows().find((each) => !each.webContents.isOffscreen());
    return shown?.webContents.getZoomLevel() ?? Number.NaN;
  });

/**
 * Each indent guide against the character its column starts at, on the line it starts on:
 * `true` when every guide is within a pixel of its column. Measured with a Range, so it is the
 * text as laid out and not the guides' own arithmetic.
 */
const guidesOnTheirColumns = (): Promise<{ guides: number; off: number[] }> =>
  page.evaluate(() => {
    const pane = document.querySelector('#editor .cm-editor')!;
    const lines = [...pane.querySelectorAll<HTMLElement>('.cm-content > .cm-line')];
    const boxes = lines.map((line) => line.getBoundingClientRect());
    const columnLeft = (line: HTMLElement, column: number): number => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let remaining = column;
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const length = node.textContent?.length ?? 0;
        if (remaining < length) {
          const range = document.createRange();
          range.setStart(node, remaining);
          range.setEnd(node, remaining + 1);
          return range.getBoundingClientRect().left;
        }
        remaining -= length;
      }
      return Number.NaN;
    };
    const guides = [...pane.querySelectorAll<HTMLElement>('.cm-indent-guide')];
    const off = guides.flatMap((guide) => {
      const box = guide.getBoundingClientRect();
      const first = boxes.findIndex((line) => Math.abs(line.top - box.top) <= 1);
      if (first < 0) return [Number.NaN];
      const level = Number(guide.dataset['level']);
      const gap = Math.abs(box.left - columnLeft(lines[first]!, (level - 1) * 2));
      return gap <= 1 ? [] : [gap];
    });
    return { guides: guides.length, off };
  });

/** Waits until there are level-2 guides and every guide sits on its column. */
async function guidesAligned(): Promise<void> {
  await expect
    .poll(guidesOnTheirColumns, { timeout: 5_000, interval: 50 })
    .toMatchObject({ off: [] });
  expect((await guidesOnTheirColumns()).guides).toBeGreaterThan(1);
}

/** Wheels the editor until `line` (0-based) is the first line under its top edge. */
async function scrollLineToTop(line: number): Promise<void> {
  const box = await page.locator('#editor .cm-scroller').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const gap = await page.evaluate((wanted) => {
      const scroller = document.querySelector('#editor .cm-scroller')!.getBoundingClientRect();
      const number = [
        ...document.querySelectorAll<HTMLElement>('#editor .cm-lineNumbers .cm-gutterElement'),
      ].find((element) => element.textContent === String(wanted + 1));
      return number === undefined ? null : number.getBoundingClientRect().top - scroller.top;
    }, line);
    if (gap !== null && Math.abs(gap) <= 1) return;
    await page.mouse.wheel(0, gap === null ? 200 : gap);
    await page.waitForTimeout(80);
  }
  throw new Error(`line ${String(line + 1)} never reached the top of the editor`);
}

/** The pinned row's height against a line's, in the editor. */
const stickyAgainstLine = (): Promise<{ row: number; line: number; size: string } | null> =>
  page.evaluate(() => {
    const row = document.querySelector('#editor .cm-sticky-line');
    const line = document.querySelector('#editor .cm-content > .cm-line');
    if (row === null || line === null) return null;
    return {
      row: row.getBoundingClientRect().height,
      line: line.getBoundingClientRect().height,
      size: getComputedStyle(row).fontSize,
    };
  });

/** The problems panel's rows as `code`. */
const problemCodes = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map(
      (row) => row.querySelector('.problems__code')?.textContent ?? '',
    ),
  );

/** Pictures of the whole window in Tyto Light and Tyto Dark, when pictures were asked for. */
async function shoot(name: string, settings: Record<string, unknown>): Promise<void> {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  for (const theme of ['tyto-light', 'tyto-dark']) {
    saveSettings({ ...settings, theme });
    const surface = theme === 'tyto-light' ? 'rgb(250, 250, 250)' : 'rgb(40, 44, 51)';
    await page.waitForFunction(
      (expected) => getComputedStyle(document.body).backgroundColor === expected,
      surface,
      { polling: 25, timeout: 15_000 },
    );
    await page.waitForTimeout(300);
    await capture(join(shots, `${name}-${theme}.png`));
  }
}

/**
 * The window as it is drawn, from Electron's side. Not `page.screenshot`: at a zoom other than
 * 0 Playwright crops the window to its CSS viewport counted in device pixels, so a +1 picture
 * came back as the top-left five sixths of the window.
 */
async function capture(path: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const shown = BrowserWindow.getAllWindows().find((each) => !each.webContents.isOffscreen());
    const image = await shown!.webContents.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(path, Buffer.from(png, 'base64'));
}

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-typography-'));
  settingsFile = join(scratch, 'user-data', 'settings.json');
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(BRIEF);
  await page.waitForSelector('#editor .cm-indent-guide', { state: 'attached', timeout: 15_000 });
  // The preview beside it, so the pictures show its bar of controls at each size too.
  await page.keyboard.press('Control+Shift+V');
  await page.waitForSelector('.preview__bar', { state: 'visible', timeout: 15_000 });
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('at the defaults', () => {
  it('draws every size it drew before the card', async () => {
    saveSettings({ theme: 'tyto-light' });
    expect(await computed('body', 'font-size')).toBe('14px');
    expect(await computed('.title-bar', 'font-size')).toBe('13px');
    expect(await computed('.pane__header', 'font-size')).toBe('12px');
    expect(await computed('#editor .cm-content', 'font-size')).toBe('14px');
    expect(await computed('#editor .cm-content', 'font-family')).toBe('"IBM Plex Mono", monospace');
    expect(await computed('body', 'font-family')).toBe('"Source Sans 3"');
    expect(await height('.pane__strip')).toBeCloseTo(30, 1);
    expect(await height('.pane__header')).toBeCloseTo(22, 1);
    expect(await zoomLevel()).toBe(0);
    await guidesAligned();
    await shoot('defaults', {});
  });
});

describe('uiFontSize', () => {
  it('moves the whole ramp and grows the strips so no label is cut', async () => {
    saveSettings({ uiFontSize: 18 });
    await sizeApplied('body', '18px');
    // 18 × 13/14 and 18 × 12/14, rounded to a pixel.
    expect(await computed('.title-bar', 'font-size')).toBe('17px');
    expect(await computed('.pane__header', 'font-size')).toBe('15px');
    // The editor is the code size's, and did not move.
    expect(await computed('#editor .cm-content', 'font-size')).toBe('14px');
    // 17 × 1.45 + 2 × 4 = 32.65 over the 30 floor; 15 × 1.45 + 2 × 2 = 25.75 over 22.
    expect(await height('.pane__strip')).toBeCloseTo(32.65, 1);
    expect(await height('.pane__header')).toBeCloseTo(25.75, 1);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.tabs__tab, .pane__breadcrumb, .tool__title')]
        .filter((element) => element.offsetParent !== null)
        .filter((element) => element.scrollHeight > element.clientHeight + 1)
        .map((element) => element.className),
    );
    expect(clipped).toEqual([]);
    await shoot('ui-18', { uiFontSize: 18 });
  });
});

describe('codeFontSize', () => {
  it('moves the editor, and the guides follow with nothing typed or scrolled', async () => {
    saveSettings({ codeFontSize: 20 });
    await sizeApplied('#editor .cm-content', '20px');
    expect(await computed('body', 'font-size')).toBe('14px');
    await guidesAligned();
  });

  it('pins the head line at the new line height', async () => {
    await scrollLineToTop(20);
    await expect.poll(stickyAgainstLine, { timeout: 5_000 }).not.toBeNull();
    const measured = (await stickyAgainstLine())!;
    expect(measured.size).toBe('20px');
    expect(Math.abs(measured.row - measured.line)).toBeLessThanOrEqual(1);
    // 20 × CodeMirror's 1.4.
    expect(measured.line).toBeCloseTo(28, 0);
    await shoot('code-20', { codeFontSize: 20 });
  });

  it('goes back to 14 with the guides and the row on their columns again', async () => {
    saveSettings({});
    await sizeApplied('#editor .cm-content', '14px');
    await guidesAligned();
    const measured = await stickyAgainstLine();
    if (measured !== null) expect(Math.abs(measured.row - measured.line)).toBeLessThanOrEqual(1);
  });

  // A face of another width at the same size keeps the line height, which is the case
  // CodeMirror would not re-measure by itself. Consolas is on every Windows machine.
  it.runIf(process.platform === 'win32')(
    'takes another face at the same size and keeps the guides on their columns',
    async () => {
      saveSettings({ codeFontSize: 20 });
      await sizeApplied('#editor .cm-content', '20px');
      await guidesAligned();
      saveSettings({ codeFontSize: 20, codeFontFamily: 'Consolas' });
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('#editor .cm-content')!).fontFamily.startsWith(
            'Consolas',
          ),
        undefined,
        { polling: 25, timeout: 15_000 },
      );
      await guidesAligned();
      expect(await problemCodes()).not.toContain('W_FONT_FAMILY_MISSING');
    },
  );
});

describe('a face the machine does not have', () => {
  it('is drawn in the bundled face and said in the problems panel', async () => {
    saveSettings({ uiFontFamily: 'Tyto No Such Face' });
    await expect.poll(problemCodes, { timeout: 15_000 }).toContain('W_FONT_FAMILY_MISSING');
    expect(await computed('body', 'font-family')).toBe('"Tyto No Such Face", "Source Sans 3"');
    saveSettings({});
    await expect.poll(problemCodes, { timeout: 15_000 }).not.toContain('W_FONT_FAMILY_MISSING');
  });
});

describe('the zoom', () => {
  /** Presses `key` and waits for the zoom it should write, in the window and in the file. */
  async function press(key: string, level: number): Promise<void> {
    await page.keyboard.press(key);
    await expect.poll(zoomLevel, { timeout: 10_000 }).toBe(level);
    await expect.poll(() => onDisk()['zoom'] ?? 0, { timeout: 10_000 }).toBe(level);
  }

  it('steps on Ctrl and =, - and 0, writing each step to settings.json', async () => {
    await page.click('#editor .cm-content');
    await press('Control+=', 1);
    // The page's bar stays 32 of its own pixels and the hairline: the buttons grew with it.
    expect(await height('.title-bar')).toBeCloseTo(33, 0);
    await shoot('zoom-plus-1', { zoom: 1 });
    // The pictures wrote the zoom back as 1 with a theme; the keys go on from there.
    await press('Control+-', 0);
    await press('Control+-', -1);
    await press('Control+0', 0);
  });

  it('answers in vim too', async () => {
    const toggleVim = async (): Promise<void> => {
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.command-bar__input', { state: 'visible' });
      await page.keyboard.type('editor.toggleVim');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
    };
    await toggleVim();
    await page.waitForSelector('tyto-status-bar .status-bar__vim', { timeout: 10_000 });
    await page.click('#editor .cm-content');
    await press('Control+=', 1);
    await press('Control+0', 0);
    await toggleVim();
    await page.waitForSelector('tyto-status-bar .status-bar__vim', {
      state: 'detached',
      timeout: 10_000,
    });
  });
});

describe("the new settings.json's example", () => {
  it('lists the five keys commented out', async () => {
    rmSync(settingsFile, { force: true });
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('settings.open');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await expect
      .poll(() => (existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : ''), {
        timeout: 15_000,
      })
      .toMatch(/\}\n$/u);
    const text = readFileSync(settingsFile, 'utf8');
    for (const line of [
      '// "zoom": 0,',
      '// "uiFontFamily": "Source Sans 3",',
      '// "uiFontSize": 14,',
      '// "codeFontFamily": "IBM Plex Mono",',
      '// "codeFontSize": 14,',
    ]) {
      expect(text).toContain(line);
    }
    if (shots === undefined) return;
    const pane = await page.locator('#editor .cm-scroller').boundingBox();
    await page.mouse.move(pane!.x + pane!.width / 2, pane!.y + pane!.height / 2);
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, 200);
          await page.waitForTimeout(80);
          // On screen, not only rendered: CodeMirror draws a margin of lines past the viewport.
          return page.evaluate(() => {
            const scroller = document
              .querySelector('#editor .cm-scroller')!
              .getBoundingClientRect();
            return [...document.querySelectorAll('#editor .cm-line')].some((line) => {
              const box = line.getBoundingClientRect();
              return (
                (line.textContent ?? '').includes('"codeFontSize": 14') &&
                box.bottom <= scroller.bottom - 40
              );
            });
          });
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    mkdirSync(shots, { recursive: true });
    await capture(join(shots, 'settings-example.png'));
  });
});

describe('a window launched with a zoom', () => {
  it('opens at it', async () => {
    const second = mkdtempSync(join(tmpdir(), 'tyto-typography-zoomed-'));
    mkdirSync(join(second, 'user-data'), { recursive: true });
    writeFileSync(join(second, 'user-data', 'settings.json'), '{\n  "zoom": 2\n}\n', 'utf8');
    const zoomed = await _electron.launch({
      args: ['.', `--user-data-dir=${join(second, 'user-data')}`],
      cwd: join(here, '..'),
      env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(second, 'tyto-home') },
    });
    try {
      const window = await firstWindow(zoomed);
      await window.waitForSelector('#editor .cm-content');
      const level = await zoomed.evaluate(({ BrowserWindow }) => {
        const shown = BrowserWindow.getAllWindows().find((each) => !each.webContents.isOffscreen());
        return shown?.webContents.getZoomLevel();
      });
      expect(level).toBe(2);
    } finally {
      await closeApp(zoomed);
      rmSync(second, { recursive: true, force: true });
    }
  });
});
