import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * "Go to Block…" through the real window (TYTO-296, ADR 0095): Ctrl+Shift+O lists the brief's
 * blocks — the frontmatter as "cabeçalho"/"header", `::titulo`, `::lamina 1` to `::lamina 3` —
 * "lamina 3" and Enter leave the caret on the third `::lamina`, and Escape puts the caret back.
 * Again in a split with the second group focused, and in vim's normal mode.
 *
 * Where the caret went is asserted in the file: a marker typed there and saved must sit on the
 * `::lamina` line on disk — never `.cm-content`, which holds only the lines in the viewport.
 *
 * With `TYTO_GO_TO_BLOCK_SHOTS` set to a folder, the suite leaves pictures in Tyto Light and
 * Tyto Dark: the list open with every block, and the list filtered to "lamina 3" with the block
 * previewed behind it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_GO_TO_BLOCK_SHOTS'];

/** A lamina of 12 lines with a blank line inside it, which stays inside the block (ADR 0087). */
const lamina = (name: string): string[] => [
  '::lamina',
  `  ${name}`,
  ...Array.from(
    { length: 5 },
    (_, index) => `  1${String(index)}/09 - 14:00 | Aula ${String(index)}`,
  ),
  '',
  `  ${name} II`,
  ...Array.from(
    { length: 4 },
    (_, index) => `  2${String(index)}/09 - 20:00 | Aula ${String(index)}`,
  ),
];

const LINES = [
  '---',
  'template: carrossel-lista',
  '---',
  '::titulo AGENDA DA SEMANA',
  '',
  ...lamina('FARMÁCIA'),
  '',
  ...lamina('NUTRIÇÃO'),
  '',
  ...lamina('CARDIOLOGIA'),
  '',
];
const BRIEF = LINES.join('\n');

/** The 1-based line of the `n`th `::lamina`. */
const laminaLine = (lines: readonly string[], n: number): number => {
  let seen = 0;
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('::lamina')) seen += 1;
    if (seen === n) return index + 1;
  }
  throw new Error(`no ::lamina ${String(n)}`);
};

let app: ElectronApplication;
let page: Page;
let scratch: string;
let settingsFile: string;
let briefA: string;
let briefB: string;

const answerOpenWith = async (path: string): Promise<void> => {
  await app.evaluate(({ dialog }, open) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [open] });
  }, path);
};

const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.command-bar__input', { state: 'detached' });
};

const position = (): Promise<string> =>
  page.evaluate(
    () => document.querySelector('tyto-status-bar .status-bar__position')?.textContent ?? '',
  );

/** The line the status bar says the caret is on. */
const caretLine = async (): Promise<number> => {
  const match = /^(?:Ln|Lin) (\d+),/u.exec(await position());
  return match === null ? Number.NaN : Number(match[1]);
};

/** Whether line `line`'s number is drawn wholly inside the first pane's scroller. */
const lineOnScreen = (line: number): Promise<boolean> =>
  page.evaluate((wanted) => {
    const pane = document.querySelector('#editor .cm-editor')!;
    const box = pane.querySelector('.cm-scroller')!.getBoundingClientRect();
    const number = [...pane.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find(
      (element) => element.textContent === wanted,
    );
    if (number === undefined) return false;
    const at = number.getBoundingClientRect();
    return at.top >= box.top - 1 && at.bottom <= box.bottom + 1;
  }, String(line));

/** The bar's rows as `label / detail`. */
const rows = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.command-bar__option')].map((row) =>
      [
        row.querySelector('.command-bar__label')?.textContent ?? '',
        row.querySelector('.command-bar__detail')?.textContent ?? '',
      ].join(' / '),
    ),
  );

/** Opens the list on the key and waits for the ordinals, which come with the manifest. */
async function openBlocks(): Promise<void> {
  await page.keyboard.press('Control+Shift+O');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await expect
    .poll(rows, { timeout: 15_000 })
    .toContainEqual(expect.stringMatching(/^::lamina 3 \//u));
}

/** Puts the caret on `line` with the keyboard: to the top, then down. */
async function caretTo(line: number): Promise<void> {
  await page.keyboard.press('Control+Home');
  for (let at = 1; at < line; at += 1) await page.keyboard.press('ArrowDown');
  await expect.poll(caretLine, { timeout: 5_000 }).toBe(line);
}

async function opened(name: string): Promise<void> {
  await page.waitForFunction(
    (wanted) =>
      [...document.querySelectorAll('.tabs__tab')].some((tab) =>
        (tab.textContent ?? '').includes(wanted),
      ),
    name,
  );
}

const themeApplied = (dark: boolean): Promise<unknown> =>
  page.waitForFunction(
    (wantDark) => {
      const [red] = /\d+/u.exec(getComputedStyle(document.body).backgroundColor) ?? ['255'];
      return wantDark ? Number(red) < 128 : Number(red) >= 128;
    },
    dark,
    { polling: 50, timeout: 15_000 },
  );

const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-go-to-block-'));
  briefA = join(scratch, 'agenda.brief');
  briefB = join(scratch, 'outra.brief');
  writeFileSync(briefA, BRIEF, 'utf8');
  writeFileSync(briefB, BRIEF, 'utf8');
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  settingsFile = join(userData, 'settings.json');
  writeFileSync(settingsFile, '{\n  "theme": "tyto-light"\n}\n', 'utf8');
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1200, 760);
  });
  await answerOpenWith(briefA);
  await runFromBar('editor.open');
  await opened('agenda.brief');
  await page.click('#editor .cm-content');
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('Go to Block', () => {
  it('lists the blocks in order, with their first words and the header row', async () => {
    await caretTo(2);
    await openBlocks();
    const listed = await rows();
    expect(listed).toEqual([
      expect.stringMatching(/^(cabeçalho|header) \/ template: carrossel-lista$/u),
      '::titulo / AGENDA DA SEMANA',
      '::lamina 1 / FARMÁCIA',
      '::lamina 2 / NUTRIÇÃO',
      '::lamina 3 / CARDIOLOGIA',
    ]);
    // Opened on the block the caret is in, which is already on screen.
    expect(
      await page.evaluate(
        () => document.querySelector('.command-bar__option--on .command-bar__label')?.textContent,
      ),
    ).toMatch(/^(cabeçalho|header)$/u);
    await shoot('list-tyto-light');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.command-bar__input', { state: 'detached' });
  }, 60_000);

  it('puts the caret on ::lamina 3 for "lamina 3" and Enter, as the saved file shows', async () => {
    await openBlocks();
    await page.keyboard.type('lamina 3');
    await expect.poll(rows, { timeout: 5_000 }).toEqual(['::lamina 3 / CARDIOLOGIA']);
    // Previewed while highlighted: the caret is already there behind the bar.
    await expect.poll(caretLine, { timeout: 5_000 }).toBe(laminaLine(LINES, 3));
    // The whole block on screen, head to last line, not just its head at the pane's edge.
    const head = laminaLine(LINES, 3);
    await expect.poll(() => lineOnScreen(head), { timeout: 5_000 }).toBe(true);
    expect(await lineOnScreen(head + 11)).toBe(true);
    await shoot('filtered-tyto-light');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.command-bar__input', { state: 'detached' });
    expect(await caretLine()).toBe(laminaLine(LINES, 3));

    await page.keyboard.press('End');
    await page.keyboard.type(' MARCA-A');
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => readFileSync(briefA, 'utf8').split('\n')[laminaLine(LINES, 3) - 1], {
        timeout: 10_000,
      })
      .toBe('::lamina MARCA-A');
  }, 60_000);

  it('finds "2" by its label and not by an offset', async () => {
    await openBlocks();
    await page.keyboard.type('2');
    await expect.poll(rows, { timeout: 5_000 }).toEqual(['::lamina 2 / NUTRIÇÃO']);
    await page.keyboard.press('Enter');
    await expect.poll(caretLine, { timeout: 5_000 }).toBe(laminaLine(LINES, 2));
  }, 60_000);

  it('puts the caret back where it was on Escape, after previewing another block', async () => {
    await caretTo(10);
    await openBlocks();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(caretLine, { timeout: 5_000 }).not.toBe(10);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.command-bar__input', { state: 'detached' });
    await expect.poll(caretLine, { timeout: 5_000 }).toBe(10);
    // And the editor has the keys again.
    await page.keyboard.press('ArrowDown');
    await expect.poll(caretLine, { timeout: 5_000 }).toBe(11);
  }, 60_000);

  it('acts on the focused group in a split, and leaves the other file alone', async () => {
    const before = readFileSync(briefA, 'utf8');
    await runFromBar('editor.splitRight');
    await expect
      .poll(() => page.locator('[data-editor-group]').count(), { timeout: 10_000 })
      .toBe(2);
    await answerOpenWith(briefB);
    await runFromBar('editor.open');
    await opened('outra.brief');
    await page.locator('[data-editor-group] .cm-content').nth(1).click();

    await openBlocks();
    await page.keyboard.type('lamina 1');
    await expect.poll(rows, { timeout: 5_000 }).toEqual(['::lamina 1 / FARMÁCIA']);
    await page.keyboard.press('Enter');
    await expect.poll(caretLine, { timeout: 5_000 }).toBe(laminaLine(LINES, 1));
    await page.keyboard.press('End');
    await page.keyboard.type(' MARCA-B');
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => readFileSync(briefB, 'utf8').split('\n')[laminaLine(LINES, 1) - 1], {
        timeout: 10_000,
      })
      .toBe('::lamina MARCA-B');
    expect(readFileSync(briefA, 'utf8')).toBe(before);
  }, 90_000);

  it('answers the key in vim normal mode', async () => {
    await runFromBar('editor.toggleVim');
    await page.waitForSelector('tyto-status-bar .status-bar__vim');
    await page.locator('[data-editor-group] .cm-content').nth(1).click();
    await page.keyboard.press('Escape');

    await openBlocks();
    await page.keyboard.type('lamina 2');
    await expect.poll(rows, { timeout: 5_000 }).toEqual(['::lamina 2 / NUTRIÇÃO']);
    await page.keyboard.press('Enter');
    await expect.poll(caretLine, { timeout: 5_000 }).toBe(laminaLine(LINES, 2));
    // `A` appends at the end of the line in insert mode; Escape back; Ctrl+S saves in both modes.
    await page.keyboard.press('Shift+A');
    await page.keyboard.type(' MARCA-V');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => readFileSync(briefB, 'utf8').split('\n')[laminaLine(LINES, 2) - 1], {
        timeout: 10_000,
      })
      .toBe('::lamina MARCA-V');
    await runFromBar('editor.toggleVim');
  }, 90_000);

  it('looks right in Tyto Dark', async () => {
    if (shots === undefined) return;
    writeFileSync(settingsFile, '{\n  "theme": "tyto-dark"\n}\n', 'utf8');
    await themeApplied(true);
    await page.locator('[data-editor-group] .cm-content').nth(0).click();
    await caretTo(2);
    await openBlocks();
    await shoot('list-tyto-dark');
    await page.keyboard.type('lamina 3');
    await expect.poll(rows, { timeout: 5_000 }).toEqual(['::lamina 3 / MARCA-A']);
    await shoot('filtered-tyto-dark');
    await page.keyboard.press('Escape');
  }, 60_000);
});
