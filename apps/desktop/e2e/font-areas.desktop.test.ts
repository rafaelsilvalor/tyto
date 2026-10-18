import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FONT_AREAS } from '../shared/typography.js';
import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The areas over the two bases through the real window (TYTO-272 PR B, ADR 0099 amended).
 *
 * - Every area but the explorer has a root carrying `data-font-area`, and at the defaults each
 *   draws the sizes PR A drew.
 * - `fontSizes.tabs` grows the editor groups' strips past their floor and nothing else; an
 *   unset area follows its base when the base moves.
 * - `fontSizes.editor` is the brief's pane alone: a settings tab beside it stays at the code
 *   base, and so does the completion list inside the brief — and the indent guides follow the
 *   new size with nothing typed, which is the remeasure.
 * - A size outside an area's bounds (the title bar's 18) is refused at that area.
 *
 * Read off the computed styles and the file on disk; scrolling is the wheel's. With
 * `TYTO_TYPOGRAPHY_SHOTS` set to a folder the suite leaves the pictures Rafael approves by, in
 * Tyto Light and Tyto Dark: defaults, tabs 18 with the status bar 16, the editor 20 beside a
 * settings tab at 14, the problems panel and the command bar at 18, and the example in a new
 * `settings.json`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_TYPOGRAPHY_SHOTS'];

const BRIEF = [
  '---',
  'template: agenda-semana',
  'formats: [grid]',
  '---',
  '::titulo',
  '  AGENDA DA SEMANA',
  '',
  '::lamina',
  '  FARMÁCIA',
  ...Array.from(
    { length: 12 },
    (_, index) => `    ${String(10 + index)}/09 - 14:00 | Farmacologia | Profª. Marcela Rocha`,
  ),
].join('\n');

let app: ElectronApplication;
let page: Page;
let scratch: string;
let settingsFile: string;

function saveSettings(settings: Record<string, unknown>): void {
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

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
    ([where, expected]) => {
      const element = document.querySelector(where!);
      return element !== null && getComputedStyle(element).fontSize === expected;
    },
    [selector, size] as const,
    { polling: 25, timeout: 15_000 },
  );

/** Runs a command the way a person would: the bar, filtered by id. */
async function runFromBar(id: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

/** The labels inside `selector` whose text is cut at the bottom. */
const clipped = (selector: string): Promise<string[]> =>
  page.evaluate(
    (where) =>
      [...document.querySelectorAll<HTMLElement>(where)]
        .filter((element) => element.offsetParent !== null)
        .filter((element) => element.scrollHeight > element.clientHeight + 1)
        .map((element) => element.className),
    selector,
  );

/**
 * Each indent guide of the brief's pane against the character its column starts at: the gaps
 * over a pixel. Measured with a Range, so it is the text as laid out.
 */
const guideGaps = (): Promise<{ guides: number; off: number[] }> =>
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

/** Waits until there are guides and every one sits on its column. */
async function guidesAligned(): Promise<void> {
  const deadline = Date.now() + 5_000;
  let last = await guideGaps();
  while (!(last.guides > 1 && last.off.length === 0)) {
    if (Date.now() > deadline) throw new Error(`guides off their columns: ${JSON.stringify(last)}`);
    await page.waitForTimeout(50);
    last = await guideGaps();
  }
}

/** The window as Electron draws it (PR A: `page.screenshot` crops at a zoom other than 0). */
async function capture(path: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const shown = BrowserWindow.getAllWindows().find((each) => !each.webContents.isOffscreen());
    // A hidden window composes no new frames, so its picture is whatever it last drew: a
    // light shot came back dark, measured. Shown without focus, and left shown: hidden again,
    // the page stops drawing frames and Playwright's clicks wait for one that never comes.
    if (!shown!.isVisible()) shown!.showInactive();
    shown!.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const image = await shown!.webContents.capturePage();
    return image.toPNG().toString('base64');
  });
  writeFileSync(path, Buffer.from(png, 'base64'));
}

/** Whether the lines holding `first` and `last` are both inside the editor's scroller. */
const onScreen = (first: string, last: string): Promise<boolean> =>
  page.evaluate(
    ([head, tail]) => {
      const scroller = document.querySelector('#editor .cm-scroller')!.getBoundingClientRect();
      const visible = (needle: string): boolean =>
        [...document.querySelectorAll('#editor .cm-line')].some((line) => {
          const box = line.getBoundingClientRect();
          return (
            (line.textContent ?? '').includes(needle) &&
            box.top >= scroller.top &&
            box.bottom <= scroller.bottom
          );
        });
      return visible(head!) && visible(tail!);
    },
    [first, last] as const,
  );

/** Pictures in Tyto Light and Tyto Dark, when pictures were asked for. */
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

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-font-areas-'));
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
  // The preview beside the brief, so the pictures show its bar too; the focus stays in the brief.
  await page.keyboard.press('Control+Shift+V');
  await page.waitForSelector('.preview__bar', { state: 'visible', timeout: 15_000 });
  // The problems panel is open in the default layout; opened if this one has it closed.
  if ((await page.locator('#problems-list').count()) === 0) {
    await runFromBar('layout.togglePanel:problems');
  }
  await page.waitForSelector('#problems-list', { state: 'attached', timeout: 15_000 });
  // And the queue, closed in the default layout, so its area has a root on screen.
  await runFromBar('layout.togglePanel:queue');
  await page.waitForSelector('.queue__body', { state: 'attached', timeout: 15_000 });
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('at the defaults', () => {
  it('puts every area but the explorer on a root in the window', async () => {
    const rooted = await page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll<HTMLElement>('[data-font-area]')].map(
          (element) => element.dataset['fontArea'],
        ),
      ),
    ]);
    // `json` joins when a JSON tab is in front, and the list is CodeMirror's tooltip.
    const expected = FONT_AREAS.map((area) => area.id).filter(
      (id) => !['explorer', 'json', 'completion'].includes(id),
    );
    expect(expected.filter((id) => !rooted.includes(id))).toEqual([]);
  });

  it('draws the sizes PR A drew', async () => {
    saveSettings({ theme: 'tyto-light' });
    expect(await computed('.title-bar', 'font-size')).toBe('13px');
    expect(await computed('.tabs__tab', 'font-size')).toBe('14px');
    expect(await computed('.shell__foot', 'font-size')).toBe('13px');
    expect(await computed('.pane__header', 'font-size')).toBe('12px');
    expect(await computed('#editor .cm-content', 'font-size')).toBe('14px');
    expect(await height('.pane__strip')).toBeCloseTo(30, 1);
    expect(await height('.pane__header')).toBeCloseTo(22, 1);
    await shoot('areas-defaults', {});
  });
});

describe('fontSizes over the UI base', () => {
  it('grows the tabs and the status bar alone, and the strip so no tab is cut', async () => {
    saveSettings({ fontSizes: { tabs: 18, statusBar: 16 } });
    // A tab's label is the strip's base size; the bar's text is 16 × 13/14, rounded.
    await sizeApplied('.tabs__tab', '18px');
    expect(await computed('.shell__foot', 'font-size')).toBe('15px');
    // 17 × 1.45 + 2 × 4 = 32.65 over the 30 floor, on the group's strip alone.
    expect(await height('tyto-editor-group .pane__strip')).toBeCloseTo(32.65, 1);
    expect(await height('.pane__strip--tool')).toBeCloseTo(30, 1);
    expect(await clipped('.tabs__tab, .tabs__label, .tabs__close')).toEqual([]);
    // Everything else is where it was.
    expect(await computed('.title-bar', 'font-size')).toBe('13px');
    expect(await computed('.pane__header', 'font-size')).toBe('12px');
    expect(await computed('tyto-problems', 'font-size')).toBe('14px');
    await shoot('areas-tabs-18-status-16', { fontSizes: { tabs: 18, statusBar: 16 } });
  });

  it('moves the unset areas with the base, and leaves the set one where it is', async () => {
    saveSettings({ uiFontSize: 20, fontSizes: { tabs: 18 } });
    // 20 × 13/14 = 18.57 → 19 for the bar's and the title's text; the tabs stay at 18.
    await sizeApplied('.shell__foot', '19px');
    expect(await computed('.title-bar', 'font-size')).toBe('19px');
    expect(await computed('tyto-problems', 'font-size')).toBe('20px');
    expect(await computed('.tabs__tab', 'font-size')).toBe('18px');
  });

  it('refuses a title bar over 18, which stays on its base', async () => {
    saveSettings({ fontSizes: { titleBar: 19, statusBar: 16 } });
    await sizeApplied('.shell__foot', '15px');
    expect(await computed('.title-bar', 'font-size')).toBe('13px');
    saveSettings({ fontSizes: { titleBar: 18 } });
    // 18 × 13/14 = 16.71 → 17 inside the 32 px bar.
    await sizeApplied('.title-bar', '17px');
    expect(await clipped('.title-bar__title')).toEqual([]);
  });
});

describe('fontSizes over the code base', () => {
  it('sizes the brief and keeps a settings tab beside it at the code base', async () => {
    saveSettings({});
    await sizeApplied('.title-bar', '13px');
    await page.click('#editor .cm-content');
    await runFromBar('settings.open');
    await page.waitForSelector("[data-font-area='json'] .cm-content", { timeout: 15_000 });
    // Into the next group, which is the preview's: the brief in front of the first again.
    await runFromBar('editor.moveTabToNextGroup');
    await page.waitForSelector("#editor[data-font-area='editor']", { timeout: 15_000 });
    saveSettings({ fontSizes: { editor: 20 } });
    await sizeApplied('#editor .cm-content', '20px');
    expect(await computed("[data-font-area='json'] .cm-content", 'font-size')).toBe('14px');
    await guidesAligned();
    await shoot('areas-editor-20-json-14', { fontSizes: { editor: 20 } });
  });

  it('keeps the completion list inside the brief at the code base', async () => {
    saveSettings({ fontSizes: { editor: 20 } });
    await sizeApplied('#editor .cm-content', '20px');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+End');
    // A line of its own at column 0, where `::` offers the template's slots.
    await page.keyboard.insertText('\n\n');
    await page.keyboard.type('::');
    await page.locator('.cm-tooltip-autocomplete li').first().waitFor({ timeout: 15_000 });
    expect(await computed('.cm-tooltip-autocomplete', 'font-size')).toBe('14px');
    saveSettings({ fontSizes: { editor: 20, completion: 18 } });
    await sizeApplied('.cm-tooltip-autocomplete', '18px');
    await page.keyboard.press('Escape');
    for (let erase = 0; erase < 4; erase += 1) await page.keyboard.press('Backspace');
  });

  it('measures the text again when the pane changes area with its tab', async () => {
    // The settings tab back into the brief's group: one pane, json at 14 then the brief at 20.
    saveSettings({ fontSizes: { editor: 20 } });
    await sizeApplied('#editor .cm-content', '20px');
    await page.click("[data-font-area='json'] .cm-content");
    await runFromBar('editor.moveTabToNextGroup');
    await page.waitForSelector("#editor[data-font-area='json']", { timeout: 15_000 });
    await sizeApplied('#editor .cm-content', '14px');
    await page.keyboard.press('Control+w');
    await page.waitForSelector("#editor[data-font-area='editor']", { timeout: 15_000 });
    await sizeApplied('#editor .cm-content', '20px');
    await guidesAligned();
  });

  // A face of another width at the same size keeps the line height, which is the case
  // CodeMirror does not measure again by itself (ADR 0099 decision 6): the brief's guides would
  // stay on the JSON face's columns. Consolas is on every Windows machine.
  it.runIf(process.platform === 'win32')(
    'measures the text again when the pane changes face with its tab',
    async () => {
      const face = (): Promise<string> => computed('#editor .cm-content', 'font-family');
      saveSettings({ fontFamilies: { json: 'Consolas' } });
      await sizeApplied('#editor .cm-content', '14px');
      await guidesAligned();
      await page.click('#editor .cm-content');
      await runFromBar('settings.open');
      await page.waitForSelector("#editor[data-font-area='json']", { timeout: 15_000 });
      await expect.poll(face, { timeout: 15_000 }).toMatch(/^Consolas/u);
      await page.keyboard.press('Control+w');
      await page.waitForSelector("#editor[data-font-area='editor']", { timeout: 15_000 });
      await expect.poll(face, { timeout: 15_000 }).toMatch(/^"IBM Plex Mono"/u);
      await guidesAligned();
    },
  );

  // The same case through the setting: the editor area alone takes another face at the same
  // size, and the window has to tell CodeMirror to measure, as it does for the bases.
  it.runIf(process.platform === 'win32')(
    'takes an editor face at the same size and keeps the guides on their columns',
    async () => {
      const face = (): Promise<string> => computed('#editor .cm-content', 'font-family');
      saveSettings({});
      await expect.poll(face, { timeout: 15_000 }).toMatch(/^"IBM Plex Mono"/u);
      await guidesAligned();
      saveSettings({ fontFamilies: { editor: 'Consolas' } });
      await expect.poll(face, { timeout: 15_000 }).toMatch(/^Consolas/u);
      await guidesAligned();
      saveSettings({});
      await expect.poll(face, { timeout: 15_000 }).toMatch(/^"IBM Plex Mono"/u);
      await guidesAligned();
    },
  );
});

describe('the problems panel and the command bar', () => {
  it('take their own sizes', async () => {
    // A face nobody has, on the explorer, which has no root: it changes nothing on screen and
    // gives the panel a row to show at 18.
    const settings = {
      fontSizes: { problems: 18, commandBar: 18 },
      fontFamilies: { explorer: 'Tyto No Such Face' },
    };
    saveSettings(settings);
    await sizeApplied('tyto-problems', '18px');
    await page.waitForSelector('.problems__row', { timeout: 15_000 });
    // The row's text is the panel's 18 × 13/14, rounded.
    expect(await computed('.problems__row', 'font-size')).toBe('17px');
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('zoom');
    await page.waitForSelector('.command-bar__option', { timeout: 15_000 });
    await sizeApplied('tyto-command-bar', '18px');
    expect(await computed('.tabs__tab', 'font-size')).toBe('14px');
    await shoot('areas-problems-commandbar-18', settings);
    await page.keyboard.press('Escape');
  });
});

describe('fontFamilies', () => {
  it('gives an area its face and says a face the machine lacks', async () => {
    saveSettings({ fontFamilies: { statusBar: 'Tyto No Such Face' } });
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('.shell__foot')!).fontFamily.includes('No Such'),
      undefined,
      { polling: 25, timeout: 15_000 },
    );
    expect(await computed('.title-bar', 'font-family')).toBe('"Source Sans 3"');
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.querySelectorAll('.problems__row')].map((row) => row.textContent ?? ''),
          ),
        { timeout: 15_000 },
      )
      .toContainEqual(expect.stringContaining('fontFamilies.statusBar'));
    saveSettings({});
  });
});

describe("the new settings.json's example", () => {
  it('lists both objects with every area, commented out', async () => {
    rmSync(settingsFile, { force: true });
    // The problems panel closed, so the tab is tall enough to show both objects at once.
    await runFromBar('layout.togglePanel:problems');
    await page.waitForSelector('#problems-list', { state: 'detached', timeout: 15_000 });
    await page.click('#editor .cm-content');
    await runFromBar('settings.open');
    await expect
      .poll(() => (existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : ''), {
        timeout: 15_000,
      })
      .toMatch(/\}\n$/u);
    const text = readFileSync(settingsFile, 'utf8');
    expect(text).toContain('// "fontSizes": {');
    expect(text).toContain('// "fontFamilies": {');
    for (const area of FONT_AREAS) expect(text).toContain(`//   "${area.id}": `);
    if (shots === undefined) return;
    // Wheel the tab until each object is on screen whole, head to last area, and picture it.
    const pane = await page.locator('#editor .cm-scroller').boundingBox();
    await page.mouse.move(pane!.x + pane!.width / 2, pane!.y + pane!.height / 2);
    mkdirSync(shots, { recursive: true });
    for (const [head, last, name] of [
      ['"fontSizes": {', '"explorer": 14', 'sizes'],
      ['"fontFamilies": {', '"explorer": "Source Sans 3"', 'families'],
    ] as const) {
      await expect
        .poll(
          async () => {
            const shown = await onScreen(head, last);
            if (!shown) {
              await page.mouse.wheel(0, 60);
              await page.waitForTimeout(80);
            }
            return shown;
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      await capture(join(shots, `areas-settings-example-${name}.png`));
    }
  });
});
