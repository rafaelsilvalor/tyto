import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * A recipe's command mode in the real window (TYTO-676, ADR 0195 decision 7, third pull
 * request): what only real keys, real focus and the vim engine can show.
 *
 * - In the desktop's input mode, `a` typed in a line is an `a`; Escape moves focus off the text
 *   onto the blocks, where `k` selects the block above, `d` `d` deletes it, `z` brings it back,
 *   Escape does nothing, and Enter puts the caret back in the text.
 * - With vim on, Escape is the engine's: pressed twice by habit and followed by `dd`, it deletes
 *   one line of a two-line note, as vim does, and never the note block; Shift+Escape enters
 *   command mode, and Enter returns to the text in vim's normal mode.
 *
 * The mapping of each key to its action is `commands.test.ts`'s, and what each action does to
 * the text is `recipe-command-mode.test.ts`'s. Its own `--user-data-dir` and `TYTO_HOME`, one
 * launch, no workspace folder and no plugin: no step here needs to run. `--lang=en`. With
 * `TYTO_RECIPE_COMMAND_MODE_SHOTS` set to a folder it leaves two pictures of one block at the
 * same wait: selected in command mode, and the control, the same block back in the text.
 */

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env['TYTO_RECIPE_COMMAND_MODE_SHOTS'];

// Blocks between blank lines (ADR 0196): one of two steps, a note of two lines, and one step.
const RECIPE = [
  'recipe keys',
  '',
  'where status = done',
  'select key',
  '',
  '# one',
  '# two',
  '',
  'sort key',
  '',
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

/** The recipe's lines as the editor holds them, read through its view. */
const text = (): Promise<string> =>
  page.evaluate(() => {
    const content = document.querySelector('#editor .cm-content') as unknown as {
      cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } };
    };
    return content.cmTile?.root?.view?.state.doc.toString() ?? '';
  });

/** Where focus is: on the blocks (command mode), in the text, or elsewhere. */
const focus = (): Promise<string> =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.dataset['notebookCommand'] !== undefined) return 'blocks';
    if (active?.closest('#editor .cm-content') != null) return 'text';
    return active?.tagName ?? 'none';
  });

/** The text of the selected block's lines, in command mode. */
const selectedLines = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('#editor .cm-notebook-frame--selected')].map(
      (line) => line.textContent ?? '',
    ),
  );

/** Clicks at the end of the line whose text is `wanted`. */
async function clickLineEnd(wanted: string): Promise<void> {
  const line = page.locator('#editor .cm-line', { hasText: wanted }).first();
  const box = await line.boundingBox();
  if (box === null) throw new Error(`no line ${wanted}`);
  const words = await line.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().right;
  });
  await page.mouse.click(words + 2, box.y + box.height / 2);
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-command-mode-e2e-'));
  const work = join(scratch, 'recipes');
  mkdirSync(work, { recursive: true });
  recipePath = join(work, 'keys.recipe');
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
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe("a recipe's command mode in the window (TYTO-676)", () => {
  it('moves focus off the text onto the blocks with Escape', async () => {
    // The window refuses an open until it has read the last session, so it is asked again.
    await expect
      .poll(
        async () => {
          await run('editor.open');
          return tabNames();
        },
        { timeout: 15_000 },
      )
      .toContain('keys.recipe');
    await page.waitForSelector('#editor .cm-notebook-frame');
    await clickLineEnd('select key');
    // With text selected, Escape narrows the selection, as CodeMirror's does; it stays in the text.
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Escape');
    expect(await focus()).toBe('text');
    // Escape right after typing first closes the completion the typing asked for, as it does in
    // any CodeMirror editor; from a click it is command mode's at once.
    await page.keyboard.press('Escape');
    expect(await focus()).toBe('blocks');
    // The whole block the cursor was in, both its lines.
    expect(await selectedLines()).toEqual(['where status = done', 'select key']);
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(shots, 'command-mode.png') });
    }
  }, 60_000);

  it('selects down with j, deletes with d d, brings it back with z, and Escape does nothing', async () => {
    // k from the first block stays: the header is never selected.
    await page.keyboard.press('k');
    expect(await selectedLines()).toEqual(['where status = done', 'select key']);
    await page.keyboard.press('j');
    expect(await selectedLines()).toEqual(['# one', '# two']);
    await page.keyboard.press('d');
    expect(await text()).toBe(RECIPE);
    await page.keyboard.press('d');
    // The whole note block and the blank line that set it apart.
    expect(await text()).toBe(RECIPE.replace('# one\n# two\n\n', ''));
    expect(await focus()).toBe('blocks');
    // The selection went to the block that took the note's place, and stays there on z.
    expect(await selectedLines()).toEqual(['sort key']);
    await page.keyboard.press('z');
    expect(await text()).toBe(RECIPE);
    expect(await selectedLines()).toEqual(['sort key']);
    await page.keyboard.press('Escape');
    expect(await focus()).toBe('blocks');
    expect(await text()).toBe(RECIPE);
  }, 30_000);

  it('returns to the text with Enter, where an a types an a', async () => {
    await page.keyboard.press('Enter');
    expect(await focus()).toBe('text');
    expect(await selectedLines()).toEqual([]);
    if (shots !== undefined) {
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(shots, 'command-mode-control.png') });
    }
    await page.keyboard.type('a');
    expect(await text()).toBe(RECIPE.replace('sort key', 'sort keya'));
    await page.keyboard.press('Backspace');
    expect(await text()).toBe(RECIPE);
  }, 30_000);

  it("leaves vim's Escape and dd to vim: one line goes, never the note block", async () => {
    expect(await run('editor.toggleVim')).toBe(true);
    await page.waitForSelector('.shell__foot[data-vim-mode]');
    await clickLineEnd('# one');
    await page.keyboard.press('i');
    await page.keyboard.press('Escape');
    // A second Escape by habit, then vim's own dd.
    await page.keyboard.press('Escape');
    await page.keyboard.type('dd');
    expect(await focus()).toBe('text');
    expect(await text()).toBe(RECIPE.replace('# one\n', ''));
    await page.keyboard.press('u');
    expect(await text()).toBe(RECIPE);
  }, 30_000);

  it('enters command mode with Shift+Escape in vim, and Enter returns in normal mode', async () => {
    await page.keyboard.press('i');
    await page.keyboard.press('Shift+Escape');
    expect(await focus()).toBe('blocks');
    expect(await selectedLines()).toEqual(['# one', '# two']);
    await page.keyboard.press('Enter');
    expect(await focus()).toBe('text');
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLElement>('.shell__foot')?.dataset['vimMode'],
      ),
    ).toBe('normal');
    expect(await text()).toBe(RECIPE);
  }, 30_000);
});
