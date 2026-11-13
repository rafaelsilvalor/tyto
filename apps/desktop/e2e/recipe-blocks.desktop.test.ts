import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * A recipe's blocks in the real window (TYTO-676, ADR 0195, first pull request): each block
 * framed over the one editor with its toolbar on its first line; Run this block runs from the
 * first changed cell to it and leaves the cells below stale; the toolbar folds a result; Up
 * moves a block and Delete takes one, and **the saved file is the blocks in their new order**.
 *
 * What it asserts is what jsdom cannot: where the toolbar sits on the line, that a click on it
 * leaves the text and its caret to the editor, and the run in main. The edits themselves are
 * `recipe-blocks-view.test.ts`'s and `blocks.test.ts`'s.
 *
 * The source is a plugin with no permissions and a static table, installed by the real `tyto
 * plugin install`. Its own `TYTO_HOME`, `--user-data-dir` and `--lang=en`, one launch, no
 * workspace folder, so the recipe runs as one outside any workspace does (ADR 0148 decision 5)
 * and a pause in typing stops before the source. With `TYTO_RECIPE_BLOCKS_SHOTS` set to a
 * folder it leaves two pictures at the same wait: the blocks, and the control, the same text in
 * a plain-text tab, drawn with no frames.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');
for (const file of [built, cli]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}
const shots = process.env['TYTO_RECIPE_BLOCKS_SHOTS'];

const PLUGIN = 'fixture-blocks';
const VERB = 'fixture.tasks';

/** Two rows and no network: one open, one done. */
const PLUGIN_CODE = `
export function activate(host) {
  host.registerRecipeVerb({
    id: '${VERB}',
    kind: 'source',
    arguments: [],
    async page() {
      const fetchedAt = new Date().toISOString();
      const row = (title, status) => ({
        key: title, values: { title, status },
        provenance: { source: 'fixture', id: title, fetchedAt },
      });
      return {
        ok: true,
        value: { table: { columns: [
          { name: 'title', type: 'text', origin: 'fixture' },
          { name: 'status', type: 'text', origin: 'fixture' },
        ], rows: [row('First', 'open'), row('Second', 'done')] } },
        diagnostics: [],
      };
    },
  });
}
`;

const RECIPE = [
  'recipe blocks',
  '',
  VERB,
  '# keep the open ones',
  'where status = open',
  'select title',
  'sort title',
  '',
].join('\n');

let scratch: string;
let home: string;
let recipePath: string;
let app: ElectronApplication | undefined;
let page: Page;

function install(): void {
  const folder = join(scratch, 'plugin', PLUGIN);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(join(folder, 'dist', 'index.js'), PLUGIN_CODE);
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['recipe-verb'],
      permissions: [],
      namespace: 'fixture',
    }),
  );
  const installed = spawnSync(process.execPath, [cli, 'plugin', 'install', folder, '--yes'], {
    env: { ...process.env, TYTO_HOME: home },
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(`install failed: ${installed.stderr}`);
}

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

/** Each cell's summary, by the recipe line drawn just above its output. */
const summaries = (): Promise<Record<string, string>> =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('#editor .recipe-cell-status')].map((line) => {
        const above = line.closest('.cm-cell-output')?.previousElementSibling;
        return [
          above?.textContent ?? '',
          line.querySelector('.recipe-cell-summary')?.textContent ?? '',
        ];
      }),
    ),
  );

/**
 * The toolbar drawn over the line whose text is `text`: toolbars sit in a layer beside the
 * text, so a toolbar is matched to its line by where it is drawn.
 */
async function toolbar(text: string) {
  // The layer draws on the editor's next measure: a result folded just now moves it a frame on.
  let index = -1;
  for (let tries = 0; tries < 20 && index === -1; tries += 1) {
    if (tries > 0) await page.waitForTimeout(100);
    index = await overLine(text);
  }
  if (index === -1) {
    const tops = await page.evaluate(() => ({
      lines: [...document.querySelectorAll('#editor .cm-line')].map((each) => [
        each.textContent,
        Math.round(each.getBoundingClientRect().top),
      ]),
      bars: [...document.querySelectorAll('#editor .recipe-block-toolbar')].map((each) =>
        Math.round(each.getBoundingClientRect().top),
      ),
    }));
    throw new Error(`no toolbar over '${text}' ${JSON.stringify(tops)}`);
  }
  return page.locator('#editor .recipe-block-toolbar').nth(index);
}

/** The index of the toolbar drawn over the line whose text is `text`, or -1. */
function overLine(text: string): Promise<number> {
  return page.evaluate((wanted) => {
    const line = [...document.querySelectorAll('#editor .cm-line')].find(
      (each) => each.textContent === wanted,
    );
    const box = line?.getBoundingClientRect();
    if (box === undefined) return -1;
    return [...document.querySelectorAll('#editor .recipe-block-toolbar')].findIndex((each) => {
      const tools = each.getBoundingClientRect();
      return Math.abs(tools.top - box.top) < 2;
    });
  }, text);
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-blocks-e2e-'));
  home = join(scratch, 'tyto-home');
  install();
  const work = join(scratch, 'recipes');
  mkdirSync(work, { recursive: true });
  recipePath = join(work, 'blocks.recipe');
  writeFileSync(recipePath, RECIPE);
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  // The plugins start after the window opens (ADR 0044): the verb is asked for until main has it.
  // A loop and not `expect.poll`, which belongs to a test.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const verbs = await page.evaluate(async () => {
      const bridge = (
        window as unknown as {
          tyto?: Record<string, (request: object) => Promise<{ verbs: string[] }>>;
        }
      ).tyto;
      return (await bridge?.['recipe:verbs']?.({}))?.verbs ?? [];
    });
    if (verbs.includes(VERB)) break;
    if (Date.now() > deadline) throw new Error(`no '${VERB}' among ${verbs.join(', ')}`);
    await page.waitForTimeout(250);
  }
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, recipePath);
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe("a recipe's blocks in the window (TYTO-676)", () => {
  it('frames each block and lays its toolbar at the right of its first line, off the text', async () => {
    // The window refuses an open until it has read the last session, so it is asked again.
    await expect
      .poll(
        async () => {
          await run('editor.open');
          return tabNames();
        },
        { timeout: 15_000 },
      )
      .toContain('blocks.recipe');
    await page.waitForSelector('#editor .recipe-block-toolbar');
    const laid = await page.evaluate(() => {
      const tools = [...document.querySelectorAll<HTMLElement>('#editor .recipe-block-toolbar')];
      const scroller = document.querySelector<HTMLElement>('#editor .cm-scroller');
      const visibleRight =
        (scroller?.getBoundingClientRect().left ?? 0) + (scroller?.clientWidth ?? 0);
      return [...document.querySelectorAll<HTMLElement>('#editor .cm-line')].map((line) => {
        const box = line.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(line);
        const text = range.getBoundingClientRect();
        const bar = tools.find((each) => Math.abs(each.getBoundingClientRect().top - box.top) < 2);
        const drawn = bar?.getBoundingClientRect();
        return {
          text: line.textContent ?? '',
          classes: line.className.includes('cm-notebook-frame'),
          toolbar:
            drawn === undefined
              ? undefined
              : {
                  inLine: drawn.top >= box.top - 1 && drawn.bottom <= box.bottom + 1,
                  right: Math.abs(visibleRight - drawn.right) < 24,
                  clear: text.width === 0 || drawn.left >= text.right,
                  outsideText: !line.contains(bar ?? null),
                },
        };
      });
    });
    // The toolbars widen nothing: the editor scrolls sideways no more than its text needs.
    const overflow = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('#editor .cm-scroller');
      return scroller === null ? -1 : scroller.scrollWidth - scroller.clientWidth;
    });
    expect(overflow).toBe(0);
    // A line's text is its own: no toolbar glyph is in it.
    expect(laid.map((line) => line.text)).toEqual(RECIPE.split('\n'));
    // Header, blank, source, note, three steps, and the empty last line.
    expect(laid.map((line) => line.classes)).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(laid.filter((line) => line.toolbar !== undefined).map((line) => line.toolbar)).toEqual(
      Array.from({ length: 5 }, () => ({
        inLine: true,
        right: true,
        clear: true,
        outsideText: true,
      })),
    );

    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, 'recipe-blocks.png') });
      // The control: the same text in a plain-text tab, drawn with no frames, at the same wait.
      const plain = join(dirname(recipePath), 'blocks.txt');
      writeFileSync(plain, RECIPE);
      await app?.evaluate(({ dialog }, chosen) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
      }, plain);
      await run('editor.open');
      await expect.poll(tabNames, { timeout: 10_000 }).toContain('blocks.txt');
      await page.waitForSelector('#editor .cm-line');
      await page.screenshot({ path: join(shots, 'recipe-blocks-control.png') });
      await page.locator('.tabs__tab', { hasText: 'blocks.recipe' }).first().click();
      await page.waitForSelector('#editor .recipe-block-toolbar');
    }
  }, 30_000);

  it('runs one block: the source and the cell, and the cells below stay stale', async () => {
    // A pause in typing stopped before the source: every cell is held.
    await expect
      .poll(summaries, { timeout: 15_000 })
      .toMatchObject({ [VERB]: expect.stringMatching(/save|Run/u) });

    await (await toolbar('where status = open')).locator('[data-action="run"]').click();
    await expect.poll(summaries, { timeout: 15_000 }).toEqual({
      [VERB]: '2 rows · 2 columns',
      'where status = open': '1 row · 2 columns',
      'select title': 'Below the block run: runs on the next run',
      'sort title': 'Below the block run: runs on the next run',
    });
    // The caret is where it was: a toolbar is not a click in the text.
    const caretLine = await page.evaluate(() => {
      const selection = window.getSelection();
      return selection?.anchorNode?.parentElement?.closest('.cm-line')?.textContent ?? '';
    });
    expect(caretLine).not.toContain('where status = open');
  }, 30_000);

  it("folds a block's result from its toolbar, and the result's own toggle agrees", async () => {
    const fold = (await toolbar(VERB)).locator('[data-action="collapse"]');
    await fold.click();
    await page.waitForSelector('#editor .recipe-cell--collapsed');
    await expect
      .poll(() => fold.getAttribute('aria-label'), { timeout: 5_000 })
      .toBe('Show result');
    const toggle = page.locator('#editor .recipe-cell--collapsed .recipe-cell__toggle').first();
    expect(await toggle.getAttribute('aria-expanded')).toBe('false');
  }, 30_000);

  it('moves a block up and deletes a note, and saves the blocks in their order', async () => {
    await (await toolbar('select title')).locator('[data-action="up"]').click();
    await (await toolbar('# keep the open ones')).locator('[data-action="delete"]').click();
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => readFileSync(recipePath, 'utf8'), { timeout: 10_000 })
      .toBe(
        ['recipe blocks', '', VERB, 'select title', 'where status = open', 'sort title', ''].join(
          '\n',
        ),
      );
  }, 30_000);
});
