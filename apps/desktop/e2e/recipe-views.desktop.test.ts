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
 * The recipe's grouping views in the real window (TYTO-381, ADR 0177): `show board by=status`
 * draws one column per status of 300 rows, with the counts main made, and a column draws fifty
 * cards before "N more" asks for the next ones.
 *
 * A plugin installed by the real `tyto plugin install` registers the source verb `fixture.rows`,
 * which fetches the table from this file's own server, as `recipe-table.desktop.test.ts` does.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, `--lang=en`. With `TYTO_RECIPE_VIEWS_SHOTS` set to a
 * folder it leaves a picture of the window.
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

/**
 * 300 rows in four statuses, which the board orders To Do, In Progress, Done, then Blocked by
 * first appearance: 20 of the 90 Done rows write it `done`, which is the same column.
 */
const STATUSES: readonly (readonly [string, number])[] = [
  ['Blocked', 30],
  ['To Do', 100],
  ['Done', 70],
  ['In Progress', 80],
  ['done', 20],
];

/** Plain JavaScript with no imports, as `tyto plugin new --code` writes it. */
const pluginCode = (base: string): string => `
export function activate(host) {
  host.registerRecipeVerb({
    id: '${VERB}',
    kind: 'source',
    arguments: [],
    async page() {
      const response = await host.fetch(${JSON.stringify(base)} + '/rows');
      if (!response.ok) throw new Error('the server answered ' + String(response.status));
      const table = JSON.parse(new TextDecoder().decode(response.body));
      return { ok: true, value: { table }, diagnostics: [] };
    },
  });
}
`;

function rowsTable(): string {
  const fetchedAt = new Date().toISOString();
  const statuses = STATUSES.flatMap(([status, count]) =>
    Array.from({ length: count }, () => status),
  );
  return JSON.stringify({
    columns: [
      { name: 'key', type: 'text', origin: 'fixture' },
      { name: 'title', type: 'text', origin: 'fixture' },
      { name: 'status', type: 'text', origin: 'fixture' },
      { name: 'owner', type: 'text', origin: 'fixture' },
    ],
    rows: statuses.map((status, index) => ({
      key: `C-${String(index + 1)}`,
      values: {
        key: `C-${String(index + 1)}`,
        title: `Card ${String(index + 1)}`,
        status,
        owner: index % 2 === 0 ? 'Ana' : 'Rui',
      },
      provenance: { source: 'fixture', id: String(index + 1), fetchedAt },
    })),
  });
}

const RECIPE = [
  'recipe board',
  VERB,
  'show board by=status order="To Do,In Progress,Done" fields=title,owner',
  '',
].join('\n');

let scratch: string;
let home: string;
let recipePath: string;
let app: ElectronApplication | undefined;
let page: Page;
let server: Server;

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

const BOARD = '#editor .recipe-board';

/** Each column the board draws: its name, main's count, the cards drawn and its "more" button. */
const columns = () =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll(`${selector} .recipe-board__column`)].map((column) => ({
        name: column.querySelector('.recipe-board__name')?.textContent ?? '',
        tally: column.querySelector('.recipe-board__tally')?.textContent ?? '',
        cards: column.querySelectorAll('.recipe-board__card').length,
        more: column.querySelector('.recipe-board__more')?.textContent ?? '',
      })),
    BOARD,
  );

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-views-e2e-'));
  home = join(scratch, 'tyto-home');
  server = createServer((request, response) => {
    if (request.url === '/rows') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(rowsTable());
    } else response.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  install(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
  recipePath = join(scratch, 'recipes', 'board.recipe');
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

describe('the Board view over 300 rows (TYTO-381)', () => {
  it('draws one column per status with the counts main made, fifty cards at a time', async () => {
    await app?.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, recipePath);
    await run('editor.open');
    await page.waitForSelector('#editor .recipe-cell');
    await run('recipe.run');
    await page.waitForFunction(
      (selector) =>
        document.querySelectorAll(`${selector} .recipe-board__card`).length === 50 + 50 + 50 + 30,
      BOARD,
      { timeout: 20_000 },
    );

    expect(await columns()).toEqual([
      { name: 'To Do', tally: '100', cards: 50, more: '50 more' },
      { name: 'In Progress', tally: '80', cards: 50, more: '30 more' },
      { name: 'Done', tally: '90', cards: 50, more: '40 more' },
      { name: 'Blocked', tally: '30', cards: 30, more: '' },
    ]);
    const card = await page.evaluate(
      (selector) =>
        [...(document.querySelector(`${selector} .recipe-board__card`)?.children ?? [])].map(
          (line) => line.textContent,
        ),
      BOARD,
    );
    // The first To Do row is row 31, after the 30 Blocked ones.
    expect(card).toEqual(['Card 31', 'owner: Ana']);

    // The source's preview above is 20 rows tall: folded, the board below it comes into sight.
    await page.locator('#editor .recipe-cell').first().locator('.recipe-cell__toggle').click();
    const shots = process.env['TYTO_RECIPE_VIEWS_SHOTS'];
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, 'recipe-board.png') });
    }

    await page
      .locator(`${BOARD} .recipe-board__column`)
      .nth(2)
      .locator('.recipe-board__more')
      .click();
    await page.waitForFunction(
      (selector) =>
        document
          .querySelectorAll(`${selector} .recipe-board__column`)[2]
          ?.querySelectorAll('.recipe-board__card').length === 90,
      BOARD,
      { timeout: 10_000 },
    );
    expect((await columns())[2]).toEqual({ name: 'Done', tally: '90', cards: 90, more: '' });

    // The filter is counted again in main: "Card 3" is in the title of 3, 30–39 and 300. Row 300
    // writes `done`, and a column is named as the first row the filter keeps wrote it.
    await page.locator(`${BOARD} .recipe-table__filter`).fill('Card 3');
    await page.waitForFunction(
      (selector) =>
        document.querySelector(`${selector} .recipe-table__count`)?.textContent ===
        'Rows: 12 of 300',
      BOARD,
      { timeout: 10_000 },
    );
    expect((await columns()).map((column) => [column.name, column.tally])).toEqual([
      ['To Do', '9'],
      ['done', '1'],
      ['Blocked', '2'],
    ]);
  }, 45_000);
});
