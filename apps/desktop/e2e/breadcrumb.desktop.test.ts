import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The breadcrumb in an editor group's header row, through the real window (TYTO-273, ADR 0098):
 * the block the caret is in — `header › template` in the frontmatter, `::titulo`, `::lamina 2` —
 * and nothing between blocks, after a block's last text line or on a comment. Each group shows
 * its own caret in a split, a follower's too; a settings tab and a preview in front show nothing.
 *
 * What is asserted is the breadcrumb's own element and the status bar's line, never
 * `.cm-content`, which holds only the lines in the viewport.
 *
 * With `TYTO_BREADCRUMB_SHOTS` set to a folder, the suite leaves pictures in Tyto Light and Tyto
 * Dark of the caret on `template:`, in the second `::lamina`, on a blank line inside it, between
 * two blocks, and in a split with a different caret in each group.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_BREADCRUMB_SHOTS'];

/** A lamina of 12 lines whose 8th is blank, which stays inside the block (ADR 0087). */
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
  '// uma nota',
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
const laminaLine = (n: number): number => {
  let seen = 0;
  for (const [index, line] of LINES.entries()) {
    if (line.startsWith('::lamina')) seen += 1;
    if (seen === n) return index + 1;
  }
  throw new Error(`no ::lamina ${String(n)}`);
};

const HEADER = /^(cabeçalho|header)$/u;
const ON_TEMPLATE = /^(cabeçalho|header) › template$/u;

let app: ElectronApplication;
let page: Page;
let scratch: string;
let settingsFile: string;
let brief: string;

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

/** The breadcrumb of the `index`th group, as its element holds it. */
const crumb = (index = 0): Promise<string> =>
  page.evaluate(
    (at) =>
      document.querySelectorAll('tyto-editor-group')[at]?.querySelector('[data-breadcrumb]')
        ?.textContent ?? '<no group>',
    index,
  );

/** The line the status bar says the focused pane's caret is on. */
const caretLine = async (): Promise<number> => {
  const position = await page.evaluate(
    () => document.querySelector('tyto-status-bar .status-bar__position')?.textContent ?? '',
  );
  const match = /^(?:Ln|Lin) (\d+),/u.exec(position);
  return match === null ? Number.NaN : Number(match[1]);
};

/** Puts the focused pane's caret on `line` with the keyboard: to the top, then down. */
async function caretTo(line: number): Promise<void> {
  await page.keyboard.press('Control+Home');
  for (let at = 1; at < line; at += 1) await page.keyboard.press('ArrowDown');
  await expect.poll(caretLine, { timeout: 5_000 }).toBe(line);
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

/** The four single-group pictures, in the theme the window has now. */
async function shootSingle(theme: string): Promise<void> {
  if (shots === undefined) return;
  await caretTo(2);
  await expect.poll(() => crumb(0), { timeout: 5_000 }).toMatch(ON_TEMPLATE);
  await shoot(`a-frontmatter-template-${theme}`);
  await caretTo(laminaLine(2) + 1);
  await expect.poll(() => crumb(0), { timeout: 5_000 }).toBe('::lamina 2');
  await shoot(`b-lamina-2-${theme}`);
  await caretTo(laminaLine(2) + 7);
  await expect.poll(() => crumb(0), { timeout: 5_000 }).toBe('::lamina 2');
  await shoot(`c-blank-inside-lamina-2-${theme}`);
  await caretTo(laminaLine(2) - 1);
  await expect.poll(() => crumb(0), { timeout: 5_000 }).toBe('');
  await shoot(`d-between-blocks-${theme}`);
}

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-breadcrumb-'));
  brief = join(scratch, 'agenda.brief');
  writeFileSync(brief, BRIEF, 'utf8');
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
  await answerOpenWith(brief);
  await runFromBar('editor.open');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tabs__tab')].some((tab) =>
      (tab.textContent ?? '').includes('agenda.brief'),
    ),
  );
  await page.click('#editor .cm-content');
}, 300_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the breadcrumb of one group', () => {
  it('names the second ::lamina, once the manifest has numbered it', async () => {
    await caretTo(laminaLine(2) + 1);
    await expect.poll(() => crumb(0), { timeout: 15_000 }).toBe('::lamina 2');
  }, 60_000);

  it('keeps the block on a blank line inside it, and empties after its last text', async () => {
    await caretTo(laminaLine(2) + 7);
    await expect.poll(() => crumb(0), { timeout: 5_000 }).toBe('::lamina 2');
    // The blank line after the second lamina's last text line, before the third `::lamina`.
    await caretTo(laminaLine(3) - 1);
    await expect.poll(() => crumb(0), { timeout: 5_000 }).toBe('');
  }, 60_000);

  it('names a slot that does not repeat with no number, and is empty on a comment', async () => {
    await caretTo(4);
    await expect.poll(() => crumb(0), { timeout: 5_000 }).toBe('::titulo');
    await caretTo(5);
    await expect.poll(() => crumb(0), { timeout: 5_000 }).toBe('');
  }, 60_000);

  it('names the frontmatter and the key the caret is on, in the window’s language', async () => {
    await caretTo(2);
    await expect.poll(() => crumb(0), { timeout: 5_000 }).toMatch(ON_TEMPLATE);
    const before = await crumb(0);
    await runFromBar('shell.toggleLocale');
    await expect.poll(() => crumb(0), { timeout: 5_000 }).not.toBe(before);
    expect(await crumb(0)).toMatch(ON_TEMPLATE);
    await runFromBar('shell.toggleLocale');
    await expect.poll(() => crumb(0), { timeout: 5_000 }).toBe(before);
    // The opening fence has no key on or above it: the frontmatter alone.
    await page.click('#editor .cm-content');
    await caretTo(1);
    await expect.poll(() => crumb(0), { timeout: 5_000 }).toMatch(HEADER);
  }, 60_000);

  it('looks right in Tyto Light and Tyto Dark', async () => {
    if (shots === undefined) return;
    await shootSingle('tyto-light');
    writeFileSync(settingsFile, '{\n  "theme": "tyto-dark"\n}\n', 'utf8');
    await themeApplied(true);
    await page.click('#editor .cm-content');
    await shootSingle('tyto-dark');
    writeFileSync(settingsFile, '{\n  "theme": "tyto-light"\n}\n', 'utf8');
    await themeApplied(false);
    await page.click('#editor .cm-content');
  }, 120_000);
});

describe('the breadcrumbs of a split', () => {
  const secondGroupBriefTab = () =>
    page.locator('tyto-editor-group').nth(1).locator('.tabs__tab', { hasText: 'agenda.brief' });

  it('shows each group its own caret, a follower’s too', async () => {
    await caretTo(laminaLine(2) + 1);
    await expect.poll(() => crumb(0), { timeout: 5_000 }).toBe('::lamina 2');
    await runFromBar('editor.splitRight');
    await expect
      .poll(() => page.locator('[data-editor-group]').count(), { timeout: 10_000 })
      .toBe(2);
    await page.locator('[data-editor-group] .cm-content').nth(1).click();
    await caretTo(2);
    await expect.poll(() => crumb(1), { timeout: 5_000 }).toMatch(ON_TEMPLATE);
    expect(await crumb(0)).toBe('::lamina 2');

    // The same file in the second group: its own caret, numbered as the first group's is.
    await caretTo(laminaLine(3) + 1);
    await expect.poll(() => crumb(1), { timeout: 5_000 }).toBe('::lamina 3');
    expect(await crumb(0)).toBe('::lamina 2');
    // And after a repaint of every group — a language change — each still reads its own pane.
    await runFromBar('shell.toggleLocale');
    await runFromBar('shell.toggleLocale');
    await page.waitForTimeout(300);
    expect([await crumb(0), await crumb(1)]).toEqual(['::lamina 2', '::lamina 3']);
    await shoot('e-split-tyto-light');
    if (shots !== undefined) {
      writeFileSync(settingsFile, '{\n  "theme": "tyto-dark"\n}\n', 'utf8');
      await themeApplied(true);
      await shoot('e-split-tyto-dark');
      writeFileSync(settingsFile, '{\n  "theme": "tyto-light"\n}\n', 'utf8');
      await themeApplied(false);
    }
  }, 90_000);

  it('shows nothing for a settings tab in front, and comes back with the brief', async () => {
    // Focused by its tab, not by a click in the text, which would move its caret.
    await secondGroupBriefTab().click();
    await runFromBar('settings.open');
    await expect.poll(() => crumb(1), { timeout: 10_000 }).toBe('');
    expect(await crumb(0)).toBe('::lamina 2');
    await secondGroupBriefTab().click();
    // Back on the brief: written again on the repaint, before any key. (A follower tab comes
    // back on its primary's caret, which is the groups' rule and not this card's.)
    await expect.poll(() => crumb(1), { timeout: 10_000 }).toMatch(/^::lamina \d$/u);
    await caretTo(laminaLine(3) + 1);
    await expect.poll(() => crumb(1), { timeout: 5_000 }).toBe('::lamina 3');
  }, 60_000);

  it('shows nothing for a preview in front', async () => {
    await secondGroupBriefTab().click();
    await runFromBar('preview.open');
    // Whichever group the preview landed in, its header row is hidden and its breadcrumb empty.
    const previewCrumbs = (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll('tyto-editor-group')]
          .filter((group) => group.querySelector<HTMLElement>(':scope > .pane__header')?.hidden)
          .map((group) => group.querySelector('[data-breadcrumb]')?.textContent ?? '<none>'),
      );
    await expect.poll(previewCrumbs, { timeout: 10_000 }).toEqual(['']);
    expect(await crumb(0)).toBe('::lamina 2');
  }, 60_000);
});
