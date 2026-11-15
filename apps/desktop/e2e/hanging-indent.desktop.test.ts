import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The hanging indent through the real window (TYTO-707): an indented line the editor wraps
 * starts every continuation row under the first character of its text, a tab counting as
 * `tabSize` columns, and a line at column 0 wraps to column 0 as before. jsdom does no layout,
 * so the decoration's width is `hanging-indent.test.ts`'s and only where the rows land is here.
 *
 * Every number is read from the text as laid out — one Range per character — never from the
 * decoration's own style. A control arm turns the hang off with a stylesheet and requires the
 * same instrument to see the continuation rows back at column 0, so a measure that cannot tell
 * the two apart fails rather than passes.
 *
 * With `TYTO_HANGING_INDENT_SHOTS` set to a folder, the suite leaves a picture of the brief with
 * the hang and one without it, taken at the same wait.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_HANGING_INDENT_SHOTS'];

const LONG =
  'Este é um texto bem comprido que passa da largura da janela e continua alinhado à ' +
  'indentação da sua própria linha, linha após linha, até o fim desta frase que não acaba ' +
  'tão cedo porque precisa ocupar várias linhas na tela mesmo numa janela larga demais.';

/**
 * Line 1 at column 0, line 2 by two spaces, line 3 by a tab (two columns at the default
 * `tabSize`), lines 4 and 5 by four and six spaces.
 */
const BRIEF = [
  '::lamina',
  `texto ${LONG}`,
  `  dois ${LONG}`,
  `\ttab ${LONG}`,
  `    quatro ${LONG}`,
  `      seis ${LONG}`,
].join('\n');

let app: ElectronApplication;
let page: Page;
let scratch: string;

interface Rows {
  /** How many visual rows the line takes. */
  readonly rows: number;
  /** The left edge of the line's first character that is not whitespace. */
  readonly text: number;
  /** The left edge of the first character of each continuation row. */
  readonly continuations: readonly number[];
  /** The left edge of the line's first character, whitespace included: its column 0. */
  readonly first: number;
}

/** Where line `index` (0-based) lays out its rows, character by character. */
const rowsOf = (index: number): Promise<Rows> =>
  page.evaluate((lineIndex) => {
    const line = document.querySelectorAll<HTMLElement>('#editor .cm-content > .cm-line')[
      lineIndex
    ]!;
    const boxes: { left: number; top: number; space: boolean }[] = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (let at = 0; at < text.length; at += 1) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        const rect = range.getClientRects()[0];
        if (rect === undefined) continue;
        boxes.push({ left: rect.left, top: rect.top, space: /\s/.test(text[at]!) });
      }
    }
    const tops: number[] = [];
    const continuations: number[] = [];
    for (const box of boxes) {
      if (tops.some((top) => Math.abs(top - box.top) < 2)) continue;
      tops.push(box.top);
      if (tops.length > 1) continuations.push(box.left);
    }
    const text = boxes.find((box) => !box.space)?.left ?? Number.NaN;
    return { rows: tops.length, text, continuations, first: boxes[0]?.left ?? Number.NaN };
  }, index);

const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  // Off the text, so no hover tooltip from an earlier click is in one picture and not the other.
  await page.mouse.move(0, 0);
  const box = await page.evaluate(() => {
    const pane = document.querySelector('#editor .cm-editor')!.getBoundingClientRect();
    return { x: pane.x, y: pane.y, width: pane.width, height: Math.min(pane.height, 500) };
  });
  await page.screenshot({ path: join(shots, `${name}.png`), clip: box });
};

/** Writes the numbers a passing run must show where CI's log keeps them. */
const report = (label: string, rows: Rows): void => {
  process.stdout.write(
    `[hanging-indent] ${label}: rows=${String(rows.rows)} first=${rows.first.toFixed(1)} ` +
      `text=${rows.text.toFixed(1)} continuations=${rows.continuations.map((left) => left.toFixed(1)).join(',')}\n`,
  );
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(`${built} is missing — run \`TURBO_FORCE=1 pnpm build\` first`);
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-hanging-indent-'));
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
  await page.waitForFunction(
    () => document.querySelectorAll('#editor .cm-hanging-indent').length === 4,
    undefined,
    { polling: 25, timeout: 15_000 },
  );
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the hanging indent', () => {
  it('starts every continuation row of an indented line under its first character', async () => {
    const columnZero = (await rowsOf(1)).first;
    for (const [index, label] of [
      [2, 'two spaces'],
      [3, 'a tab'],
      [4, 'four spaces'],
      [5, 'six spaces'],
    ] as const) {
      const rows = await rowsOf(index);
      report(label, rows);
      expect(rows.rows).toBeGreaterThan(1);
      // Two columns in: the text is not at column 0, so the check below is not trivially met.
      expect(rows.text - columnZero).toBeGreaterThan(8);
      // The first row has not moved: it starts at column 0, as every other line does.
      expect(Math.abs(rows.first - columnZero)).toBeLessThanOrEqual(1);
      expect(rows.continuations.filter((left) => Math.abs(left - rows.text) > 1)).toEqual([]);
    }
  });

  it('keeps the indent guides on their columns through the continuation rows', async () => {
    // The six-space line: three guides, at columns 0, 2 and 4, each the full height of the line.
    const line = 5;
    const rows = await rowsOf(line);
    const character = (rows.text - rows.first) / 6;
    /** The guides whose box covers the whole of the line, every row of it. */
    const covering = (): Promise<{ level: number; left: number }[]> =>
      page.evaluate((lineIndex) => {
        const box = document
          .querySelectorAll<HTMLElement>('#editor .cm-content > .cm-line')
          [lineIndex]!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>('#editor .cm-indent-guide')]
          .map((guide) => ({
            level: Number(guide.dataset['level']),
            box: guide.getBoundingClientRect(),
          }))
          .filter(({ box: guide }) => guide.top <= box.top + 1 && guide.bottom >= box.bottom - 1)
          .map(({ level, box: guide }) => ({ level, left: guide.left }));
      }, line);
    // The guide layer draws on its own measure, after the wrapped lines take their height.
    await expect
      .poll(async () => (await covering()).map((guide) => guide.level).sort(), { timeout: 5_000 })
      .toEqual([1, 2, 3]);
    const guides = await covering();
    process.stdout.write(
      `[hanging-indent] guides on six spaces: ${guides
        .map((guide) => `${String(guide.level)}@${guide.left.toFixed(1)}`)
        .join(',')} character=${character.toFixed(2)}\n`,
    );
    expect(rows.rows).toBeGreaterThan(1);
    expect(guides.map((guide) => guide.level).sort()).toEqual([1, 2, 3]);
    const off = guides.filter(
      (guide) => Math.abs(guide.left - (rows.first + (guide.level - 1) * 2 * character)) > 1,
    );
    expect(off).toEqual([]);
  });

  it('wraps a line at column 0 to column 0, as before', async () => {
    const rows = await rowsOf(1);
    report('column 0', rows);
    expect(rows.rows).toBeGreaterThan(1);
    expect(rows.continuations.filter((left) => Math.abs(left - rows.text) > 1)).toEqual([]);
  });

  it('puts the caret on the character clicked in a continuation row', async () => {
    const target = await page.evaluate(() => {
      const line = document.querySelectorAll<HTMLElement>('#editor .cm-content > .cm-line')[2]!;
      const node = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode()!;
      const first = (() => {
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 1);
        return range.getClientRects()[0]!.top;
      })();
      const text = node.textContent ?? '';
      for (let at = 0; at < text.length; at += 1) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        const rect = range.getClientRects()[0];
        // The third character of the second row: clicked in its middle.
        if (rect !== undefined && rect.top > first + 2) {
          range.setStart(node, at + 2);
          range.setEnd(node, at + 3);
          const box = range.getClientRects()[0]!;
          return { offset: at + 2, x: box.left + box.width / 4, y: box.top + box.height / 2 };
        }
      }
      return null;
    });
    expect(target).not.toBeNull();
    await page.mouse.click(target!.x, target!.y);
    const head = await page.waitForFunction(
      () => {
        const selection = document.getSelection();
        return selection?.focusNode?.parentElement?.closest('.cm-line') === null
          ? null
          : selection?.focusOffset;
      },
      undefined,
      { polling: 25, timeout: 5_000 },
    );
    expect(await head.jsonValue()).toBe(target!.offset);
  });

  it('control: with the hang taken away, the same measure sees the rows back at column 0', async () => {
    // Both pictures here, one either side of the stylesheet: the same window, the same wait.
    await shoot('hanging-indent-on');
    await page.addStyleTag({
      content: '.cm-hanging-indent { padding-left: 6px !important; text-indent: 0 !important; }',
    });
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('#editor .cm-hanging-indent')!).textIndent ===
        '0px',
      undefined,
      { polling: 25, timeout: 5_000 },
    );
    const rows = await rowsOf(2);
    report('control, two spaces', rows);
    expect(rows.continuations.length).toBeGreaterThan(0);
    expect(rows.continuations.every((left) => left < rows.text - 8)).toBe(true);
    await shoot('hanging-indent-off');
  });
});
