import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The recipe notebook against a real source, in the real window (TYTO-377, the card's
 * acceptance): a table under every cell, Run from here, Fetch again, an edit that reruns from
 * its line down, and a folded table that stays folded.
 *
 * A plugin installed by the real `tyto plugin install` registers the source verb `fixture.rows`.
 * Its `page` answers from its private cache (`host.cache`, ADR 0138) unless the run asked for
 * fresh data (`refresh`, ADR 0148 decision 10); otherwise it fetches from this file's own
 * server, which counts the requests. **Every request counted is a fetch the window caused.**
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139), and no workspace folder, so the recipe
 * runs as one outside any workspace does (ADR 0148 decision 5). `--lang=en`. With
 * `TYTO_RECIPE_NOTEBOOK_SHOTS` set to a folder it leaves a picture of the window.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');
for (const file of [built, cli]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

const PLUGIN = 'fixture-rows';
const VERB = 'fixture.rows';
const ROWS = 30;

/** Plain JavaScript with no imports, as `tyto plugin new --code` writes it. */
const pluginCode = (base: string): string => `
const BASE = ${JSON.stringify(base)};

export function activate(host) {
  host.registerRecipeVerb({
    id: '${VERB}',
    kind: 'source',
    arguments: [],
    async page({ refresh }) {
      let text;
      if (refresh !== true) {
        const kept = await host.cache.get('rows');
        if (kept !== undefined) text = new TextDecoder().decode(kept.bytes);
      }
      if (text === undefined) {
        const response = await host.fetch(BASE + '/rows');
        if (!response.ok) throw new Error('the server answered ' + String(response.status));
        text = new TextDecoder().decode(response.body);
        await host.cache.put('rows', text);
      }
      return { ok: true, value: { table: JSON.parse(text) }, diagnostics: [] };
    },
  });
}
`;

/** The table the server answers: 30 numbered rows, fetched three hours before the request. */
function rowsTable(): string {
  const fetchedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  return JSON.stringify({
    columns: [
      { name: 'n', type: 'number', origin: 'fixture' },
      { name: 'title', type: 'text', origin: 'fixture' },
    ],
    rows: Array.from({ length: ROWS }, (_, index) => ({
      key: `R-${String(index + 1)}`,
      values: {
        n: index + 1,
        title: `Row ${String(index + 1)} ${'long '.repeat(index === 0 ? 40 : 1)}`,
      },
      provenance: { source: 'fixture', id: String(index + 1), fetchedAt },
    })),
  });
}

/** Three cells, then enough comment lines that the first table can scroll out of view. */
const RECIPE = [
  'recipe notebook',
  VERB,
  'where n > 4',
  'select n, title',
  ...Array.from({ length: 400 }, (_, index) => `# note ${String(index + 1)}`),
  '',
].join('\n');

let scratch: string;
let home: string;
let recipePath: string;
let app: ElectronApplication | undefined;
let page: Page;
let server: Server;
/** One entry per request the server received: one per fetch the plugin made. */
let fetches = 0;
/** The fetch count after each step, for the proof line CI's log shows. */
const proof: string[] = [];
const note = (step: string): void => {
  proof.push(`${step} ${String(fetches)}`);
};

function install(base: string): void {
  const folder = join(scratch, 'plugin', PLUGIN);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(join(folder, 'dist', 'index.js'), pluginCode(base));
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['recipe-verb'],
      permissions: ['net:127.0.0.1'],
      namespace: 'fixture',
    }),
  );
  const installed = spawnSync(process.execPath, [cli, 'plugin', 'install', folder, '--yes'], {
    env: { ...process.env, TYTO_HOME: home },
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(`install failed: ${installed.stderr}`);
}

/** Runs a command the way the command bar would, and fails loudly if it was refused. */
async function run(commandId: string): Promise<void> {
  const ran = await page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

/** Each cell's summary, its age, its buttons and the rows its table draws. */
const cells = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('#editor .recipe-cell')].map((cell) => ({
      summary: cell.querySelector('.recipe-cell-summary')?.textContent ?? '',
      age: cell.querySelector('.recipe-cell-age')?.textContent ?? '',
      buttons: [...cell.querySelectorAll('.recipe-cell__action')].map((b) => b.textContent),
      rows: cell.querySelectorAll('table tbody tr').length,
      more: cell.querySelector('.recipe-cell__more')?.textContent ?? '',
      collapsed: cell.classList.contains('recipe-cell--collapsed'),
    })),
  );

/** Marks the first cell's element, to tell when a new answer has replaced it. */
const markFirstCell = () =>
  page.evaluate(() => {
    const first = document.querySelector<HTMLElement>('#editor .recipe-cell');
    if (first !== null) first.dataset['probe'] = 'before';
  });

const firstCellReplaced = () =>
  page.evaluate(
    () =>
      document.querySelector<HTMLElement>('#editor .recipe-cell')?.dataset['probe'] === undefined,
  );

const clickInFirstCell = (selector: string) =>
  page.locator('#editor .recipe-cell').first().locator(selector).click();

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-notebook-e2e-'));
  home = join(scratch, 'tyto-home');
  server = createServer((request, response) => {
    if (request.url === '/rows') {
      fetches += 1;
      response.writeHead(200, { 'content-type': 'application/json' }).end(rowsTable());
    } else response.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  install(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
  recipePath = join(scratch, 'recipes', 'notebook.recipe');
  mkdirSync(dirname(recipePath), { recursive: true });
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
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(scratch, { recursive: true, force: true });
});

describe('the recipe notebook against a source (TYTO-377)', () => {
  it('holds the source on open, and draws a table under every cell on Run', async () => {
    await app?.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, recipePath);
    await expect
      .poll(
        async () => {
          await run('editor.open');
          return (await cells()).map((cell) => cell.summary);
        },
        { timeout: 15_000 },
      )
      .toEqual(['Fetches on save or Run', 'Fetches on save or Run', 'Fetches on save or Run']);
    expect(fetches).toBe(0);
    note('open');

    await run('recipe.run');
    await expect
      .poll(async () => (await cells()).map((cell) => cell.summary), { timeout: 15_000 })
      .toEqual(['30 rows · 2 columns', '26 rows · 2 columns', '26 rows · 2 columns']);
    expect(fetches).toBe(1);
    note('Run');
    const shown = await cells();
    expect(shown.map((cell) => [cell.rows, cell.more])).toEqual([
      [20, '10 more rows'],
      [20, '6 more rows'],
      [20, '6 more rows'],
    ]);
    expect(shown.map((cell) => cell.buttons)).toEqual([
      ['Run from here', 'Fetch again'],
      ['Run from here'],
      ['Run from here'],
    ]);
    expect(shown[0]?.age).toMatch(/^ran now · data fetched 3 hr\. ago$/u);
    // A real table, laid out: it has a height, and its first long value is cut, not wrapped.
    const layout = await page.evaluate(() => {
      const table = document.querySelector('#editor .recipe-cell table');
      const cell = table?.querySelector('tbody td:nth-child(2)');
      return {
        height: table?.getBoundingClientRect().height ?? 0,
        cut: cell === null || cell === undefined ? false : cell.scrollWidth > cell.clientWidth,
      };
    });
    expect(layout.height).toBeGreaterThan(100);
    expect(layout.cut).toBe(true);

    const shots = process.env['TYTO_RECIPE_NOTEBOOK_SHOTS'];
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, 'recipe-notebook.png') });
    }
  }, 30_000);

  it('runs from the source cell against its cache, and fetches again only when asked', async () => {
    await markFirstCell();
    await clickInFirstCell('[data-action="run-from"]');
    await expect.poll(firstCellReplaced, { timeout: 15_000 }).toBe(true);
    // Run, and not a pause: the source ran (against its cache) instead of being held.
    expect((await cells()).map((cell) => cell.summary)).toEqual([
      '30 rows · 2 columns',
      '26 rows · 2 columns',
      '26 rows · 2 columns',
    ]);
    expect(fetches).toBe(1);
    note('Run from here');

    // Folded before the run, so the cell rebuilt with a new time must come back folded.
    await clickInFirstCell('.recipe-cell__toggle');
    expect((await cells())[0]?.collapsed).toBe(true);
    await markFirstCell();
    await clickInFirstCell('[data-action="fetch-again"]');
    await expect.poll(() => fetches, { timeout: 15_000 }).toBe(2);
    await expect.poll(firstCellReplaced, { timeout: 15_000 }).toBe(true);
    expect((await cells())[0]?.collapsed).toBe(true);
    note('Fetch again');
  }, 30_000);

  it('reruns the cells below an edited line, and a folded table stays folded', async () => {
    expect((await cells())[0]?.collapsed).toBe(true);

    await page.locator('#editor .cm-line', { hasText: 'where n > 4' }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('10');
    await expect
      .poll(async () => (await cells()).map((cell) => cell.summary), { timeout: 15_000 })
      .toEqual(['30 rows · 2 columns', '20 rows · 2 columns', '20 rows · 2 columns']);
    expect(fetches).toBe(2);
    expect((await cells())[0]?.collapsed).toBe(true);
    note('edit below');

    // Out of view and back: CodeMirror drops the widget from the DOM and asks for it again. The
    // cursor goes with the scroll, since the view always draws the cursor's line.
    await page.keyboard.press('Control+End');
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll('#editor .recipe-cell').length))
      .toBe(0);
    await page.keyboard.press('Control+Home');
    await expect.poll(async () => (await cells()).length).toBe(3);
    expect((await cells())[0]?.collapsed).toBe(true);
    expect(fetches).toBe(2);

    note('scrolled out and back, still folded,');
    // To stdout and not console: the default reporter hides a passing test's console.
    process.stdout.write(`[TYTO-377] fetches after each step: ${proof.join(', ')}\n`);
  }, 30_000);
});
