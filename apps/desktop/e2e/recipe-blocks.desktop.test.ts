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
 * A recipe's blocks in the real window (TYTO-676, ADR 0195 and ADR 0196): each block
 * framed over the one editor with its toolbar on its first line; Run this block runs from the
 * first changed cell to it and leaves the cells below stale; the toolbar folds a result; Up
 * moves a block and Delete takes one, and **the saved file is the blocks in their new order**.
 * A block of several steps runs them all and shows its last step's result only, and a middle
 * step's error is still marked at its line (ADR 0196).
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

// One step per block, a blank line apart (ADR 0196), and a note block of its own.
const RECIPE = [
  'recipe blocks',
  '',
  VERB,
  '',
  '# keep the open ones',
  '',
  'where status = open',
  '',
  'select title',
  '',
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
 * Runs CodeMirror's pending measure now. The toolbars and the "+" are drawn on its measure,
 * which waits for an animation frame, and **this suite's window is never shown**
 * (`TYTO_HEADLESS`): measured on 2026-11-12, a `requestAnimationFrame` there did not fire in
 * 500 ms, so a layer drew only when something else read the layout (a click does). A shown
 * window draws them on the next frame. `coordsAtPos` reads the layout, which runs the measure
 * first, as `block-enter.desktop.test.ts` reaches the view.
 */
async function measured(): Promise<void> {
  await page.evaluate(() => {
    const content = document.querySelector('#editor .cm-content') as unknown as {
      cmTile?: { root?: { view?: { coordsAtPos(at: number): unknown } } };
    };
    content.cmTile?.root?.view?.coordsAtPos(0);
  });
}

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
async function overLine(text: string): Promise<number> {
  await measured();
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
    await measured();
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
    // A "+" sits on its boundary and touches neither a toolbar nor a button of a result.
    const crossings = await page.evaluate(() => {
      const boxes = (selector: string) =>
        [...document.querySelectorAll(selector)].map((each) => each.getBoundingClientRect());
      const meets = (one: DOMRect, other: DOMRect) =>
        one.left < other.right &&
        other.left < one.right &&
        one.top < other.bottom &&
        other.top < one.bottom;
      const plus = boxes('#editor .recipe-block-insert');
      const others = [
        ...boxes('#editor .recipe-block-toolbar'),
        ...boxes('#editor .recipe-cell-status button'),
        ...boxes('#editor .recipe-cell-status span'),
      ];
      return {
        count: plus.length,
        crossing: plus.filter((one) => others.some((other) => meets(one, other))).length,
      };
    });
    // Above each of the five blocks under the header, and one below the last.
    expect(crossings).toEqual({ count: 6, crossing: 0 });
    // A line's text is its own: no toolbar glyph is in it.
    expect(laid.map((line) => line.text)).toEqual(RECIPE.split('\n'));
    // Header, then the source, the note and three steps, each after a blank line, and the
    // empty last line.
    expect(laid.map((line) => line.classes)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(laid.filter((line) => line.toolbar !== undefined).map((line) => line.toolbar)).toEqual(
      // The header's (Run all) and one per step and note.
      Array.from({ length: 6 }, () => ({
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
        [
          'recipe blocks',
          '',
          VERB,
          '',
          'select title',
          '',
          'where status = open',
          '',
          'sort title',
          '',
        ].join('\n'),
      );
  }, 30_000);
});

/**
 * The "+" drawn on the boundary right above the line whose text is `text`: matched by where it
 * is drawn, its centre within a few pixels of that line's top.
 */
async function plusAbove(text: string) {
  await measured();
  const index = await page.evaluate((wanted) => {
    const line = [...document.querySelectorAll('#editor .cm-line')].find(
      (each) => each.textContent === wanted,
    );
    const top = line?.getBoundingClientRect().top;
    if (top === undefined) return -1;
    return [...document.querySelectorAll('#editor .recipe-block-insert')].findIndex((each) => {
      const box = each.getBoundingClientRect();
      return Math.abs((box.top + box.bottom) / 2 - top) < 3;
    });
  }, text);
  if (index === -1) {
    const drawn = await page.evaluate(() =>
      [...document.querySelectorAll('#editor .recipe-block-insert')].map((each) => {
        const box = each.getBoundingClientRect();
        return Math.round((box.top + box.bottom) / 2);
      }),
    );
    throw new Error(`no + above '${text}': + centres ${JSON.stringify(drawn)}`);
  }
  return page.locator('#editor .recipe-block-insert').nth(index);
}

/** The gutter's counter on the line whose text is `text`, and whether it is marked stale. */
const counterOn = async (text: string): Promise<{ text: string; stale: boolean } | undefined> => {
  await measured();
  return page.evaluate((wanted) => {
    const line = [...document.querySelectorAll('#editor .cm-line')].find(
      (each) => each.textContent === wanted,
    );
    const top = line?.getBoundingClientRect().top;
    const mark = [...document.querySelectorAll('#editor .recipe-block-count')].find(
      (each) => top !== undefined && Math.abs(each.getBoundingClientRect().top - top) < 4,
    );
    return mark === undefined
      ? undefined
      : {
          text: mark.textContent ?? '',
          stale: mark.classList.contains('recipe-block-count--stale'),
        };
  }, text);
};

// TYTO-676's acceptance (second pull request): insert a block between two others with "+",
// pick a verb, run only that block, move it up, and the saved text is the blocks' order.
describe("the card's acceptance (TYTO-676)", () => {
  it('inserts a step between two blocks with "+" and the step picker', async () => {
    const plus = await plusAbove('where status = open');
    await plus.locator('[data-action="insert"]').click();
    if (shots !== undefined) {
      await page.screenshot({ path: join(shots, 'recipe-blocks-insert-menu.png') });
    }
    await plus.locator('[data-action="step"]').click();
    const option = page.locator('tyto-recipe-step .recipe-step__verb[data-verb="where"]');
    await option.waitFor({ timeout: 10_000 });
    await option.click();
    await page.waitForSelector('tyto-recipe-step .recipe-step-form[data-verb="where"]');
    // The form offers the columns of the step above the "+": `select title` keeps one.
    await page.click('tyto-recipe-step [data-field="expression"] [data-column="title"]');
    await page.locator('tyto-recipe-step [data-field="expression"] input').press('End');
    await page.keyboard.type(' != Second');
    await page.click('tyto-recipe-step .recipe-step__write');
    await page.waitForSelector('tyto-recipe-step .recipe-step__panel', { state: 'detached' });
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll('#editor .cm-line')].map((line) => line.textContent ?? ''),
    );
    // A block of its own, a blank line either side (ADR 0196).
    expect(lines.slice(2, 11)).toEqual([
      VERB,
      '',
      'select title',
      '',
      'where title != Second',
      '',
      'where status = open',
      '',
      'sort title',
    ]);
  }, 30_000);

  it('runs only that block: it gets the newest number, and the blocks below go stale', async () => {
    await (await toolbar('where title != Second')).locator('[data-action="run"]').click();
    await expect.poll(summaries, { timeout: 15_000 }).toMatchObject({
      'where title != Second': '1 row · 1 column',
      'where status = open': 'Below the block run: runs on the next run',
      'sort title': 'Below the block run: runs on the next run',
    });
    const above = await counterOn('select title');
    const own = await counterOn('where title != Second');
    expect(own?.stale).toBe(false);
    expect(Number(own?.text.slice(1, -1))).toBeGreaterThan(Number(above?.text.slice(1, -1)));
    // `where status = open` ran before, and is stale now. `sort title` never ran: since `select
    // title` moved above it, `status` is gone, the `where` fails and the `sort` is skipped.
    expect(await counterOn('where status = open')).toMatchObject({ stale: true });
    expect(await counterOn('sort title')).toEqual({ text: '[ ]', stale: false });
  }, 30_000);

  it('moves it up, and saves the blocks in their new order', async () => {
    await (await toolbar('where title != Second')).locator('[data-action="up"]').click();
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => readFileSync(recipePath, 'utf8'), { timeout: 10_000 })
      .toBe(
        [
          'recipe blocks',
          '',
          VERB,
          '',
          'where title != Second',
          '',
          'select title',
          '',
          'where status = open',
          '',
          'sort title',
          '',
        ].join('\n'),
      );
    if (shots !== undefined) {
      await page.screenshot({ path: join(shots, 'recipe-blocks-acceptance.png') });
    }
  }, 30_000);
});

/** Replaces the whole text of the recipe in front, as typing it would. */
async function retype(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
}

/** The text of every line an error squiggle sits on. */
const markedLines = (): Promise<string[]> =>
  page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('#editor .cm-lintRange-error')].map(
        (mark) => mark.closest('.cm-line')?.textContent ?? '',
      ),
    ),
  ]);

// ADR 0196: a block is a run of lines between blank lines, like a Jupyter cell, and shows only
// its last step's result. Every step still runs and keeps its result, and its problems.
describe('a block of several steps (TYTO-676, ADR 0196)', () => {
  const steps = (where: string): string =>
    ['recipe blocks', '', VERB, where, 'select title', '', 'sort title', ''].join('\n');

  it("runs every step of the block and draws only its last step's result", async () => {
    await retype(steps('where status = open'));
    await (await toolbar(VERB)).locator('[data-action="run"]').click();
    // One result for the block of three steps, under its last line; the block below is stale.
    await expect.poll(summaries, { timeout: 15_000 }).toEqual({
      'select title': '1 row · 1 column',
      'sort title': 'Below the block run: runs on the next run',
    });
    // The counter sits on the block's first line, and carries the last step's number.
    expect(await counterOn(VERB)).toMatchObject({ text: expect.stringMatching(/^\[\d+\]$/u) });
    expect(await counterOn('where status = open')).toBeUndefined();
    if (shots !== undefined) {
      await page.screenshot({ path: join(shots, 'recipe-blocks-several-steps.png') });
    }
  }, 30_000);

  it("marks a middle step's error at its line, and the block's result says it was skipped", async () => {
    await retype(steps('where nothing = open'));
    await (await toolbar(VERB)).locator('[data-action="run"]').click();
    await expect.poll(summaries, { timeout: 15_000 }).toMatchObject({
      'select title': expect.stringContaining('Skipped'),
    });
    expect(Object.keys(await summaries())).not.toContain('where nothing = open');
    await expect.poll(markedLines, { timeout: 10_000 }).toContain('where nothing = open');
    if (shots !== undefined) {
      await page.screenshot({ path: join(shots, 'recipe-blocks-middle-error.png') });
    }
  }, 30_000);
});

// TYTO-676, fourth pull request: a block dragged by its grip, with the real mouse.
describe('dragging a block (TYTO-676)', () => {
  const BEFORE = [
    'recipe blocks',
    '',
    VERB,
    '',
    '# a note',
    '',
    'where status = open',
    'select title',
    '',
    'sort title',
    '',
  ].join('\n');

  /** The top of the line whose text is `text`, in the window's coordinates. */
  const lineTop = (text: string): Promise<number> =>
    page.evaluate((wanted) => {
      const line = [...document.querySelectorAll('#editor .cm-line')].find(
        (each) => each.textContent === wanted,
      );
      return line?.getBoundingClientRect().top ?? Number.NaN;
    }, text);

  /** The grips drawn, by the frame each drags, with the centre of each. */
  const grips = async (): Promise<Record<string, { x: number; y: number }>> => {
    await measured();
    return page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('#editor .cm-notebook-grip')].map((grip) => {
          const box = grip.getBoundingClientRect();
          return [
            grip.dataset['notebookGrip'] ?? '',
            { x: box.left + box.width / 2, y: box.top + box.height / 2 },
          ];
        }),
      ),
    );
  };

  const dropTop = (): Promise<number | undefined> =>
    page.evaluate(() => {
      const line = document.querySelector('#editor .cm-notebook-drop');
      if (line === null) return undefined;
      const box = line.getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    });

  it('has a grip on every block but the header, at the left of its first line', async () => {
    await retype(BEFORE);
    // The pause in typing runs the recipe: its results move every line below them, so the
    // grips are read once they are drawn.
    await expect.poll(summaries, { timeout: 15_000 }).toMatchObject({
      'select title': expect.stringMatching(/row/u),
      'sort title': expect.stringMatching(/row/u),
    });
    const drawn = await grips();
    // Blocks: the header (0), the source (1), the note (2), `where`/`select` (3), `sort` (4).
    expect(Object.keys(drawn).sort()).toEqual(['1', '2', '3', '4']);
    // Centred on the block's first line: within its line's height of that line's top.
    const offset = (drawn['4']?.y ?? 0) - (await lineTop('sort title'));
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(30);
  }, 30_000);

  it('drags the last block above the block of two steps, one undo taking it back', async () => {
    if (shots !== undefined) {
      await page.waitForTimeout(200);
      await measured();
      await page.screenshot({ path: join(shots, 'recipe-blocks-drag-control.png') });
    }
    // Read right before the press: anything drawn since moves the lines.
    const grip = (await grips())['4'];
    if (grip === undefined) throw new Error('no grip on the last block');
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    const target = await lineTop('where status = open');
    await page.mouse.move(grip.x, target + 3, { steps: 8 });
    await measured();
    // The drop line on the boundary above `where`, and the dragged block's lines dimmed.
    await expect.poll(dropTop, { timeout: 5_000 }).toBeDefined();
    expect(Math.abs(((await dropTop()) ?? 0) - target)).toBeLessThan(4);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll('#editor .cm-notebook-frame--dragged')].map(
          (line) => line.textContent,
        ),
      ),
    ).toEqual(['sort title']);
    if (shots !== undefined) {
      // The same wait as the control's, and a measure: this window draws layers on a read.
      await page.waitForTimeout(200);
      await measured();
      await page.screenshot({ path: join(shots, 'recipe-blocks-drag.png') });
    }
    await page.mouse.up();

    const after = [
      'recipe blocks',
      '',
      VERB,
      '',
      '# a note',
      '',
      'sort title',
      '',
      'where status = open',
      'select title',
      '',
    ].join('\n');
    const text = (): Promise<string> =>
      page.evaluate(() => {
        const content = document.querySelector('#editor .cm-content') as unknown as {
          cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } };
        };
        return content.cmTile?.root?.view?.state.doc.toString() ?? '';
      });
    await expect.poll(text, { timeout: 5_000 }).toBe(after);
    // The layer redraws on the editor's measure, which this window runs only on a layout read.
    await measured();
    expect(await dropTop()).toBeUndefined();
    await page.keyboard.press('Control+s');
    await expect.poll(() => readFileSync(recipePath, 'utf8'), { timeout: 10_000 }).toBe(after);

    // One Ctrl+Z takes the whole drag back: it was one edit.
    await page.keyboard.press('Control+z');
    await expect.poll(text, { timeout: 5_000 }).toBe(BEFORE);
  }, 30_000);
});
