import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '@tyto/command-line';
import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { recipeSkeleton } from '@tyto/recipe';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { switchingFolder } from './folder-switch.js';

/**
 * A recipe built from an empty trusted folder with the step picker and the step forms, in the
 * real window (TYTO-402, ADR 0176): New recipe; Add step picks a plugin's source from the
 * picker's Sources; Add step `where` and `select` through their forms, each offered the columns
 * of the cell before it; New vocabulary with one rule, typed in the vocabulary tab; Add step
 * `rules` reading it; Run, every cell ok. **The saved text is the skeleton and exactly the lines
 * the forms showed**: the form is a way of typing the line, and the text stays the source. The
 * steps make one block, each written at the end of the block the cursor is in (ADR 0196).
 *
 * The source is a plugin with no permissions and a static table, installed by the real `tyto
 * plugin install`; the folder is trusted through `tyto trust add` before launch. Its own
 * `TYTO_HOME`, `--user-data-dir` and `--lang=en`, one launch. With `TYTO_RECIPE_STEPS_SHOTS`
 * set to a folder it leaves two pictures at the same wait: the `select` form with its columns
 * offered, and the control, the same tab with the dialog closed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');
for (const file of [built, cli]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}
const shots = process.env['TYTO_RECIPE_STEPS_SHOTS'];

const PLUGIN = 'fixture-tasks';
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

let scratch: string;
let home: string;
let work: string;
let app: ElectronApplication | undefined;
let page: Page;
/** Every line a form showed before Write, in order. */
const shown: string[] = [];

const quiet = { out: () => {}, err: () => {} };

/** Runs a command the way the command bar would, and fails loudly if it was refused. */
async function command(commandId: string): Promise<void> {
  const ran = await page.evaluate(
    (id) =>
      (
        document.querySelector('tyto-command-bar') as { run?: (id: string) => boolean } | null
      )?.run?.(id) ?? false,
    commandId,
  );
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

const tabNames = (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

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

/** Types a name into the explorer's field New recipe or New vocabulary opened, and Enter. */
async function newFile(commandId: string, name: string, tab: string): Promise<void> {
  await command(commandId);
  const field = page.locator('.explorer__field');
  await field.waitFor({ timeout: 10_000 });
  await field.fill(name);
  await field.press('Enter');
  await expect.poll(tabNames, { timeout: 15_000 }).toContain(tab);
}

/** Add step, picking `verb` from the picker; answers the kind heading it was listed under. */
async function pick(verb: string): Promise<string> {
  await command('recipe.addStep');
  const option = page.locator(`tyto-recipe-step .recipe-step__verb[data-verb="${verb}"]`);
  await option.waitFor({ timeout: 10_000 });
  const kind = await option.evaluate(
    (node) => node.closest('.recipe-step__group')?.querySelector('.recipe-step__kind')?.textContent,
  );
  await option.click();
  await page.waitForSelector(`tyto-recipe-step .recipe-step-form[data-verb="${verb}"]`);
  return kind ?? '';
}

/** The columns the open form offers beside `field`. */
const offered = (field: string): Promise<string[]> =>
  page.evaluate(
    (name) =>
      [
        ...document.querySelectorAll(
          `tyto-recipe-step [data-field="${name}"] .recipe-step-form__column`,
        ),
      ].map((node) => node.textContent?.trim() ?? ''),
    field,
  );

/** Keeps the line the form shows, then Write; waits for the dialog to close. */
async function write(): Promise<void> {
  shown.push((await page.textContent('tyto-recipe-step .recipe-step-form__line')) ?? '');
  await page.click('tyto-recipe-step .recipe-step__write');
  await page.waitForSelector('tyto-recipe-step .recipe-step__panel', { state: 'detached' });
}

/** Run, then every cell's status line once there are `count` and each has a table. */
async function runCells(count: number): Promise<string[]> {
  await command('recipe.run');
  const handle = await page.waitForFunction(
    (wanted) => {
      const lines = [...document.querySelectorAll('#editor .recipe-cell-status')];
      if (lines.length !== wanted) return undefined;
      if (lines.some((line) => line.hasAttribute('data-failed'))) return undefined;
      const texts = lines.map((line) => line.textContent ?? '');
      return texts.every((text) => /\d+ rows? · \d+ columns?/u.test(text)) ? texts : undefined;
    },
    count,
    { timeout: 20_000 },
  );
  return (await handle.jsonValue()) as string[];
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-steps-'));
  home = join(scratch, 'tyto-home');
  work = join(scratch, 'work');
  mkdirSync(work, { recursive: true });
  mkdirSync(home, { recursive: true });
  install();
  const trusted = await run(['trust', 'add', work], {
    version: '0.0.0-e2e',
    cwd: work,
    home,
    console: quiet,
    confirm: () => Promise.resolve(true),
    rasterizer: () => {
      throw new Error('no render here');
    },
  });
  expect(trusted).toBe(0);

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, work);
  await switchingFolder(page, () => command('workspace.openFolder'));
  // The plugins start after the window opens (ADR 0044): the verb is asked for until main has it.
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
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a recipe built with the step picker and the forms (TYTO-402)', () => {
  it("adds a plugin's source from the picker's Sources, and runs it", async () => {
    await newFile('explorer.newRecipe', 'weekly', 'weekly.recipe');
    expect(await pick(VERB)).toBe('Sources');
    await write();
    expect(await runCells(1)).toEqual([expect.stringContaining('2 rows · 2 columns')]);
  }, 30_000);

  it('adds where and select through their forms, offered the columns before them', async () => {
    await pick('where');
    expect(await offered('expression')).toEqual(['title', 'status']);
    await page.click('tyto-recipe-step [data-field="expression"] [data-column="status"]');
    const expression = page.locator('tyto-recipe-step [data-field="expression"] input');
    await expression.press('End');
    await page.keyboard.type(' != done');
    await write();
    // The cursor is on the line just written: `where` joins its block, which shows one result.
    expect(await runCells(1)).toHaveLength(1);

    await pick('select');
    expect(await offered('columns')).toEqual(['title', 'status']);
    await page.click('tyto-recipe-step [data-field="columns"] [data-column="title"]');
    await page.click('tyto-recipe-step [data-field="columns"] [data-column="status"]');
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(shots, 'step-form.png') });
    }
    await write();
    if (shots !== undefined) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(shots, 'step-form-closed.png') });
    }
    expect(shown).toEqual([VERB, 'where status != done', 'select title,status']);
  }, 30_000);

  it('reads a rule from a new vocabulary, runs every cell, and saves exactly the lines shown', async () => {
    await newFile('explorer.newVocabulary', 'company', 'company.vocab.json');
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(
      `${JSON.stringify({ rules: { kinds: [{ when: 'title matches ^F', set: { kind: 'first' } }] } }, null, 2)}\n`,
    );
    await command('editor.save');

    await page.click('.tabs__tab:has-text("weekly.recipe")');
    await pick('rules');
    await page.fill('tyto-recipe-step [data-field="into"] input', 'kind');
    await page.fill(
      'tyto-recipe-step [data-field="using"] input',
      '@./company.vocab.json#/rules/kinds',
    );
    await write();
    // Edit step on the line just written: its form, filled from the line, writes it back as is.
    await command('recipe.editStep');
    const into = page.locator('tyto-recipe-step [data-field="into"] input');
    await into.waitFor({ timeout: 10_000 });
    expect(await into.inputValue()).toBe('kind');
    expect(await page.inputValue('tyto-recipe-step [data-field="using"] input')).toBe(
      '@./company.vocab.json#/rules/kinds',
    );
    await page.click('tyto-recipe-step .recipe-step__write');
    await page.waitForSelector('tyto-recipe-step .recipe-step__panel', { state: 'detached' });
    await command('editor.save');

    // One block of four steps, which shows its last step's result only (ADR 0196).
    const cells = await runCells(1);
    expect(cells.at(-1)).toContain('1 row · 3 columns');
    // The first step, picked with the cursor in the header, started a block at the end, under
    // the skeleton's note; each one after joined that block, the cursor still in it.
    const skeleton = recipeSkeleton('weekly');
    await expect
      .poll(() => readFileSync(join(work, 'weekly.recipe'), 'utf8'), { timeout: 10_000 })
      .toBe(`${skeleton.ok ? skeleton.value : 'no skeleton'}\n${shown.join('\n')}\n`);
    expect(shown.at(-1)).toBe('rules into=kind using=@./company.vocab.json#/rules/kinds');
  }, 30_000);
});
