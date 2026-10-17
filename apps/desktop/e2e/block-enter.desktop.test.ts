import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Enter in a brief through the real window (TYTO-305, ADR 0087's note of 2026-10-16): Rafael's
 * lamina typed with Tab on the first indented line and Enter after every other one, then Enter
 * three times and a directive. What is asserted is the file on disk after Ctrl+S — never
 * `.cm-content`, which holds only the lines in the viewport.
 *
 * With `TYTO_BLOCK_ENTER_SHOTS` set to a folder, the suite leaves pictures of the window while
 * the lamina is typed, in Tyto Light, and one in Tyto Dark at the end.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_BLOCK_ENTER_SHOTS'];

const FRONTMATTER = '---\ntemplate: agenda-semana\n---\n';

/** Rafael's second example, as the file must hold it. */
const LAMINA = [
  '::lamina',
  '      ORTOPEDISTA',
  '      10-09 - 20h | Cuidado dos pés 1. | Profª. Mara Rebeiro',
  '      10-09 - 21h | Cuidado dos pés 2. | Profª. Mara Rebeiro',
  '',
  '      ORTOPEDISTA',
  '      11-09 - 20h | Cuidado com a coluna 1. | Profª. Mara Rebeiro',
];

let app: ElectronApplication;
let page: Page;
let scratch: string;
let briefPath: string;
let settingsFile: string;

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
  await page.waitForTimeout(700);
};

/**
 * Types `text` and leaves no completion list open behind it, so the Enter that follows is the
 * brief's Enter and not a completion being accepted (TYTO-277), which is a different test.
 */
const typeLine = async (text: string): Promise<void> => {
  await page.keyboard.type(text);
  await page.waitForTimeout(150);
  if ((await page.locator('.cm-tooltip-autocomplete').count()) > 0) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.cm-tooltip-autocomplete', { state: 'detached' });
  }
};

/** The caret's line and column, 1-based line, from CodeMirror's state. */
const caret = (): Promise<{ line: number; column: number }> =>
  page.evaluate(() => {
    const content = document.querySelector('#editor .cm-content') as unknown as {
      cmTile?: { root?: { view?: unknown } };
    };
    const view = content.cmTile?.root?.view as
      | {
          state: {
            selection: { main: { head: number } };
            doc: { lineAt(at: number): { number: number; from: number } };
          };
        }
      | undefined;
    if (view === undefined) throw new Error('no CodeMirror view behind the editor');
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    return { line: line.number, column: head - line.from };
  });

const themeApplied = (surface: string): Promise<unknown> =>
  page.waitForFunction(
    (expected) => getComputedStyle(document.body).backgroundColor !== expected,
    surface,
    { polling: 25, timeout: 15_000 },
  );

const surfaceColour = (): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

let shotCount = 0;
/** A picture of the window, when pictures were asked for; the caret held still for it. */
const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  shotCount += 1;
  await page.screenshot({ path: join(shots, `${String(shotCount)}-${name}.png`) });
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-block-enter-'));
  briefPath = join(scratch, 'agenda.brief');
  settingsFile = join(scratch, 'user-data', 'settings.json');
  writeFileSync(briefPath, FRONTMATTER, 'utf8');
  // Tyto Light stated, not left to the system's colour scheme.
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, '{\n  "theme": "tyto-light"\n}\n', 'utf8');
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  await answerOpenWith(briefPath);
  await runFromBar('editor.open');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tabs__tab')].some((tab) =>
      (tab.textContent ?? '').includes('agenda.brief'),
    ),
  );
  if (shots !== undefined) {
    // The caret blinks; a picture taken in the off half would not show it.
    await page.addStyleTag({ content: '.cm-cursorLayer { animation: none !important; }' });
  }
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('Enter in a brief', () => {
  it('types a lamina with Enter only, a blank line between its groups, and saves it', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+End');
    expect(await caret()).toEqual({ line: 4, column: 0 });

    const [head, first, ...rest] = LAMINA;
    await typeLine(head!);
    await page.keyboard.press('Enter');
    // The one Tab: three indent units of two spaces, the indent of Rafael's text.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await typeLine(first!.trimStart());
    await shoot('first-line-tyto-light');
    for (const line of rest) {
      await page.keyboard.press('Enter');
      if (line === '') {
        await shoot('blank-line-tyto-light');
        continue;
      }
      // Enter only: the caret is already at the block's indent.
      expect((await caret()).column).toBe(6);
      await typeLine(line.trimStart());
      if (line.includes('ORTOPEDISTA')) await shoot('second-group-tyto-light');
    }
    await shoot('lamina-typed-tyto-light');

    await page.keyboard.press('Control+s');
    await expect
      .poll(() => readFileSync(briefPath, 'utf8'), { timeout: 15_000 })
      .toBe(`${FRONTMATTER}${LAMINA.join('\n')}`);
  });

  it('goes back to column 0 on a second blank line, where the next directive starts', async () => {
    await page.keyboard.press('Enter');
    expect((await caret()).column).toBe(6);
    await page.keyboard.press('Enter');
    expect((await caret()).column).toBe(6);
    await shoot('second-blank-before-tyto-light');
    await page.keyboard.press('Enter');
    expect(await caret()).toEqual({ line: 4 + LAMINA.length + 1, column: 0 });
    await shoot('column-0-tyto-light');
    // There is no indent left to take away, so one more Enter is a plain new line: Enter is
    // never a key that does nothing.
    await page.keyboard.press('Enter');
    expect(await caret()).toEqual({ line: 4 + LAMINA.length + 2, column: 0 });
    await typeLine('::titulo AGENDA');

    await page.keyboard.press('Control+s');
    await expect
      .poll(() => readFileSync(briefPath, 'utf8'), { timeout: 15_000 })
      .toBe(`${FRONTMATTER}${LAMINA.join('\n')}\n\n\n::titulo AGENDA`);
  });

  it.runIf(shots !== undefined)('leaves a picture in Tyto Dark', async () => {
    const light = await surfaceColour();
    writeFileSync(settingsFile, '{\n  "theme": "tyto-dark"\n}\n', 'utf8');
    await themeApplied(light);
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+End');
    await shoot('lamina-tyto-dark');
  });
});
