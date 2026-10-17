import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEME_PACK_FILES, THEME_PACK_THEMES } from '@tyto/theme-pack';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The editor's indent guides through the real window (TYTO-293, ADR 0088): one element per
 * guide per run of lines, at the column of its level, through a blank line inside a block and
 * not through one between two blocks; the guide of the block holding the cursor in the active
 * colour, following the cursor; and `indentGuides: false` in `settings.json` taking them away
 * on save, with no restart. Everything is read from the DOM — the guides' boxes against the
 * lines' and the characters' — never from `.cm-content`'s text.
 *
 * With `TYTO_INDENT_GUIDE_SHOTS` set to a folder, the suite leaves pictures of the brief in
 * Tyto Light, Tyto Dark and Dracula with the cursor in a nested block, the setting off, and the
 * three candidates for the active colour in Tyto Light and Tyto Dark.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_INDENT_GUIDE_SHOTS'];

/** Two levels, a blank line inside a block (line 10) and blank lines between blocks. */
const BRIEF = [
  '---', //                                                           0
  'template: agenda-semana', //                                       1
  'formats: [grid]', //                                               2
  '---', //                                                           3
  '::titulo', //                                                      4
  '  AGENDA DA SEMANA', //                                            5
  '', //                                                              6
  '::lamina', //                                                      7
  '  FARMÁCIA', //                                                    8
  '    16/09 - 14:00 | Farmacologia Geral | Profª. Marcela Rocha', // 9
  '', //                                                              10
  '    17/09 - 14:00 | Ensaios Farmacopeicos | Profª. Selma Barroso', // 11
  '  SERVIÇO SOCIAL', //                                              12
  '    15/09 - 19:00 | Serviço Social no hospital | Profª. Norma Castilhos', // 13
  '', //                                                              14
  '::lamina', //                                                      15
  '  NUTRIÇÃO', //                                                    16
  '    23/08 - 19:00 | Boas Práticas | Profª. Alice Moreno', //       17
].join('\n');

/** Every guide the text has: level, first line, last line — `guideRuns`, written out by hand. */
const GUIDES = [
  { level: 1, first: 5, last: 5 },
  { level: 1, first: 8, last: 13 },
  { level: 2, first: 9, last: 11 },
  { level: 2, first: 13, last: 13 },
  { level: 1, first: 16, last: 17 },
  { level: 2, first: 17, last: 17 },
];

/** A theme's colours by token, from the file the app applies. */
const coloursOf = (id: string): Readonly<Record<string, string>> => {
  if (id === 'tyto-light' || id === 'tyto-dark') {
    const file = join(here, '..', 'src', 'main', 'themes', `${id}.json`);
    return (JSON.parse(readFileSync(file, 'utf8')) as { colors: Record<string, string> }).colors;
  }
  const theme = THEME_PACK_THEMES.find((candidate) => candidate.id === id);
  const file = theme === undefined ? undefined : THEME_PACK_FILES[theme.path];
  if (file === undefined) throw new Error(`no theme '${id}'`);
  return file.colors;
};

/** `#rrggbb` as `getComputedStyle` reports it. */
const computed = (hex: string): string => {
  const [red, green, blue] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
};

let app: ElectronApplication;
let page: Page;
let scratch: string;
let settingsFile: string;

interface DrawnGuide {
  readonly level: number;
  readonly active: boolean;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly colour: string;
  /** The lines whose boxes the guide covers, top to bottom, by index in the document. */
  readonly first: number;
  readonly last: number;
  /** Where the guide's column starts: the left edge of that column's character on `first`. */
  readonly column: number;
}

/**
 * The guides the brief's pane draws, each matched to the lines it spans by geometry: the
 * first line whose box starts where the guide starts, the last whose box ends where it ends.
 * The column is the character at `(level - 1) * 2` on the guide's first line, measured with a
 * Range, so the comparison is against the text as laid out and not against the guide's own
 * arithmetic.
 */
const drawn = (): Promise<readonly DrawnGuide[]> =>
  page.evaluate(() => {
    const pane = document.querySelector('#editor .cm-editor')!;
    const lines = [...pane.querySelectorAll<HTMLElement>('.cm-content > .cm-line')];
    const boxes = lines.map((line) => line.getBoundingClientRect());
    const near = (one: number, two: number): boolean => Math.abs(one - two) <= 1;
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
    return [...pane.querySelectorAll<HTMLElement>('.cm-indent-guide')].map((guide) => {
      const box = guide.getBoundingClientRect();
      const level = Number(guide.dataset['level']);
      const first = boxes.findIndex((line) => near(line.top, box.top));
      const last = boxes.findIndex((line) => near(line.bottom, box.bottom));
      return {
        level,
        active: guide.classList.contains('cm-indent-guide-active'),
        left: box.left,
        top: box.top,
        bottom: box.bottom,
        colour: getComputedStyle(guide).borderLeftColor,
        first,
        last,
        column: first < 0 ? Number.NaN : columnLeft(lines[first]!, (level - 1) * 2),
      };
    });
  });

/** The guides as level and lines, top to bottom, which is what `GUIDES` writes down. */
const runsOf = (guides: readonly DrawnGuide[]): readonly object[] =>
  [...guides]
    .sort((one, two) => one.first - two.first || one.level - two.level)
    .map(({ level, first, last }) => ({ level, first, last }));

const activeOf = async (): Promise<object | undefined> => {
  const active = (await drawn()).filter((guide) => guide.active);
  if (active.length > 1) throw new Error(`${String(active.length)} active guides`);
  const [guide] = active;
  return guide === undefined ? undefined : { level: guide.level, first: guide.first };
};

/** Which line (0-based) the cursor is on, by the line CodeMirror marks active. */
const cursorLine = (): Promise<number> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#editor .cm-content > .cm-line')].findIndex((line) =>
      line.classList.contains('cm-activeLine'),
    ),
  );

/** Puts the cursor on `line` (0-based) by clicking it, and waits until it is there. */
async function cursorTo(line: number): Promise<void> {
  await page.locator('#editor .cm-content > .cm-line').nth(line).click();
  await expect.poll(cursorLine, { timeout: 5_000 }).toBe(line);
}

/** Waits until the window paints `theme`'s surface: its answer has landed. */
const themeApplied = (theme: string): Promise<unknown> =>
  page.waitForFunction(
    (expected) => getComputedStyle(document.body).backgroundColor === expected,
    computed(coloursOf(theme)['surface']!),
    { polling: 25, timeout: 15_000 },
  );

/** Writes `settings.json` on disk, which main applies as any writer's save. */
async function apply(theme: string, indentGuides?: boolean): Promise<void> {
  const guides = indentGuides === undefined ? '' : `,\n  "indentGuides": ${String(indentGuides)}`;
  writeFileSync(settingsFile, `{\n  "theme": "${theme}"${guides}\n}\n`, 'utf8');
  await themeApplied(theme);
}

const guideCount = async (): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('#editor .cm-indent-guide').length);

/** A picture of the editor's pane, when pictures were asked for. */
const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  const box = await page.evaluate(() => {
    const pane = document.querySelector('#editor .cm-editor')!.getBoundingClientRect();
    return { x: pane.x, y: pane.y, width: Math.min(pane.width, 900), height: pane.height };
  });
  await page.screenshot({ path: join(shots, `${name}.png`), clip: box });
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-indent-guides-'));
  settingsFile = join(scratch, 'user-data', 'settings.json');
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(BRIEF);
  // Any guide at all: which ones, and where, is what the tests below say.
  await page.waitForSelector('#editor .cm-indent-guide', { state: 'attached', timeout: 15_000 });
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the indent guides', () => {
  it('draws one guide per level per block, through a blank line inside it', async () => {
    await apply('tyto-light');
    await cursorTo(0);
    await expect.poll(async () => runsOf(await drawn()), { timeout: 15_000 }).toEqual(GUIDES);
  });

  it("draws each guide at its level's column", async () => {
    const guides = await drawn();
    expect(guides.length).toBe(GUIDES.length);
    const gaps = guides.map((guide) => ({
      level: guide.level,
      first: guide.first,
      near: Math.abs(guide.left - guide.column) <= 1,
    }));
    expect(gaps.filter((gap) => !gap.near)).toEqual([]);
    // And the two levels two characters apart, not on top of each other.
    const outer = guides.find((guide) => guide.level === 1 && guide.first === 8);
    const inner = guides.find((guide) => guide.level === 2 && guide.first === 9);
    expect((inner?.left ?? 0) - (outer?.left ?? 0)).toBeGreaterThan(8);
  });

  it('marks the guide of the block holding the cursor, and follows it', async () => {
    // On the blank line inside the inner block: that block's guide.
    await cursorTo(10);
    await expect.poll(activeOf, { timeout: 5_000 }).toEqual({ level: 2, first: 9 });
    // On a line that opens a block: the guide of the block it opens.
    await cursorTo(12);
    await expect.poll(activeOf, { timeout: 5_000 }).toEqual({ level: 2, first: 13 });
    await cursorTo(7);
    await expect.poll(activeOf, { timeout: 5_000 }).toEqual({ level: 1, first: 8 });
    // At the top level no block holds the cursor.
    await cursorTo(14);
    await expect.poll(activeOf, { timeout: 5_000 }).toBeUndefined();
  });

  for (const theme of ['tyto-light', 'tyto-dark', 'dracula']) {
    it(`paints the guides in ${theme}'s two guide colours`, async () => {
      await apply(theme);
      await cursorTo(10);
      const colours = coloursOf(theme);
      await expect
        .poll(
          async () => {
            const guides = await drawn();
            return {
              active: [...new Set(guides.filter((g) => g.active).map((g) => g.colour))],
              rest: [...new Set(guides.filter((g) => !g.active).map((g) => g.colour))],
            };
          },
          { timeout: 15_000 },
        )
        .toEqual({
          active: [computed(colours['indent-guide-active']!)],
          rest: [computed(colours['indent-guide']!)],
        });
      await shoot(`guides-${theme}`);
    });
  }

  it('takes the guides away when indentGuides is false, and back when it is true', async () => {
    await apply('tyto-light', false);
    await expect.poll(guideCount, { timeout: 15_000 }).toBe(0);
    await shoot('guides-off-tyto-light');
    await apply('tyto-light', true);
    await expect.poll(guideCount, { timeout: 15_000 }).toBe(GUIDES.length);
  });

  it('draws them in a JSON tab too, and the new settings.json lists the option', async () => {
    rmSync(settingsFile, { force: true });
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('settings.open');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tabs__tab')].some((tab) =>
        (tab.textContent ?? '').includes('settings.json'),
      ),
    );
    await expect.poll(() => existsSync(settingsFile), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(settingsFile, 'utf8')).toContain('// "indentGuides": true,');
    await expect.poll(guideCount, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.locator('.tabs__tab').filter({ hasNotText: 'settings.json' }).first().click();
  });
});

/**
 * The comparison sheet for the active colour, Rafael's choice by eye: the token overridden in
 * the page for each candidate, in Tyto Light and Tyto Dark, with the cursor in a nested block.
 * Pictures only, and only when asked for.
 */
describe.runIf(shots !== undefined)('the active colour candidates', () => {
  const CANDIDATES = [
    ['text-disabled', 'var(--tyto-text-disabled)'],
    ['text-muted', 'var(--tyto-text-muted)'],
    ['accent-60', 'color-mix(in srgb, var(--tyto-accent) 60%, var(--tyto-surface))'],
  ] as const;

  for (const theme of ['tyto-light', 'tyto-dark']) {
    it(`leaves one picture per candidate in ${theme}`, async () => {
      await apply(theme);
      await cursorTo(10);
      for (const [name, value] of CANDIDATES) {
        await page.evaluate((colour) => {
          let sheet = document.querySelector<HTMLStyleElement>('style[data-candidate]');
          if (sheet === null) {
            sheet = document.createElement('style');
            sheet.dataset['candidate'] = '';
            document.head.append(sheet);
          }
          sheet.textContent = `.cm-indent-guide-active { border-left-color: ${colour} !important; }`;
        }, value);
        await page.waitForTimeout(100);
        await shoot(`candidate-${theme}-${name}`);
      }
      await page.evaluate(() => document.querySelector('style[data-candidate]')?.remove());
    });
  }
});
