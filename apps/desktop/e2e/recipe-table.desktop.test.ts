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
 * The Table view over 5,000 rows, in the real window (TYTO-379, ADR 0171): the rows come from main
 * a page at a time through `recipe:rows`, the wheel scrolls to the last row while only the rows in
 * sight exist, a header sorts in main, and the quick filter counts what it kept.
 *
 * A plugin installed by the real `tyto plugin install` registers the source verb `fixture.rows`,
 * which fetches the table from this file's own server, as `recipe-notebook.desktop.test.ts` does.
 * Copy is not driven here: it writes the real clipboard (`ipc.test.ts` holds it).
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, `--lang=en`. With `TYTO_RECIPE_TABLE_SHOTS` set to a
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
const ROWS = 5_000;

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

/** 5,000 numbered rows: a number, a title, and a web link. */
function rowsTable(): string {
  const fetchedAt = new Date().toISOString();
  return JSON.stringify({
    columns: [
      { name: 'n', type: 'number', origin: 'fixture' },
      { name: 'title', type: 'text', origin: 'fixture' },
      { name: 'site', type: 'link', origin: 'fixture' },
    ],
    rows: Array.from({ length: ROWS }, (_, index) => ({
      key: `R-${String(index + 1)}`,
      values: {
        n: index + 1,
        title: `Row ${String(index + 1)}`,
        site: `https://example.com/${String(index + 1)}`,
      },
      provenance: { source: 'fixture', id: String(index + 1), fetchedAt },
    })),
  });
}

const RECIPE = ['recipe big', VERB, 'show table', ''].join('\n');

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

const TABLE = '#editor .recipe-table';

/** What the view draws now: its count, its headers, and each drawn row's place and first value. */
const drawn = () =>
  page.evaluate((selector) => {
    const table = document.querySelector(selector);
    const viewport = table?.querySelector('.recipe-table__viewport');
    return {
      count: table?.querySelector('.recipe-table__count')?.textContent ?? '',
      headings: [...(table?.querySelectorAll('.recipe-table__heading') ?? [])].map(
        (heading) => heading.textContent,
      ),
      rows: [...(table?.querySelectorAll<HTMLElement>('.recipe-table__row') ?? [])].map((row) => [
        Number(row.dataset['row']),
        row.querySelector('.recipe-table__cell')?.textContent ?? '',
      ]),
      scrollTop: viewport?.scrollTop ?? -1,
      viewportHeight: viewport?.getBoundingClientRect().height ?? 0,
      // The column picker opens on its button only: a stylesheet's display must not show it.
      pickerHeight: table?.querySelector('.recipe-table__picker')?.getBoundingClientRect().height,
    };
  }, TABLE);

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-recipe-table-e2e-'));
  home = join(scratch, 'tyto-home');
  server = createServer((request, response) => {
    if (request.url === '/rows') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(rowsTable());
    } else response.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  install(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
  recipePath = join(scratch, 'recipes', 'big.recipe');
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

describe('the Table view over 5,000 rows (TYTO-379)', () => {
  it('draws the rows in sight of a table main pages, and scrolls to the last one', async () => {
    await app?.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, recipePath);
    await run('editor.open');
    await page.waitForSelector('#editor .recipe-cell');
    await run('recipe.run');
    await page.waitForFunction(
      (selector) =>
        document.querySelector(`${selector} .recipe-table__row .recipe-table__cell`)
          ?.textContent === '1',
      TABLE,
      { timeout: 20_000 },
    );

    // The source's preview above is 20 rows tall: folded, the view below it comes into sight.
    await page.locator('#editor .recipe-cell').first().locator('.recipe-cell__toggle').click();
    await page.waitForFunction(
      (selector) => {
        const box = document
          .querySelector(`${selector} .recipe-table__viewport`)
          ?.getBoundingClientRect();
        return box !== undefined && box.top > 0 && box.bottom < window.innerHeight;
      },
      TABLE,
      { timeout: 10_000 },
    );

    const top = await drawn();
    expect(top.count).toBe('Rows: 5,000');
    expect(top.headings).toEqual(['n', 'title', 'site']);
    // 12 rows in sight and 8 more below them: 20 of 5,000 rows exist in the document.
    expect(top.rows).toEqual(Array.from({ length: 20 }, (_, index) => [index, String(index + 1)]));
    expect(top.viewportHeight).toBeGreaterThan(250);
    expect(top.pickerHeight).toBe(0);

    const shots = process.env['TYTO_RECIPE_TABLE_SHOTS'];
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, 'recipe-table.png') });
    }

    const box = await page.locator(`${TABLE} .recipe-table__viewport`).boundingBox();
    if (box === null) throw new Error('the viewport has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const lastDrawn = () =>
      page.evaluate(
        (selector) =>
          [...document.querySelectorAll<HTMLElement>(`${selector} .recipe-table__row`)]
            .filter((row) => row.dataset['row'] === '4999')
            .map((row) => row.querySelector('.recipe-table__cell')?.textContent ?? '')[0] ?? '',
        TABLE,
      );
    // The wheel moves the viewport and not the editor: the inner box takes it while it can scroll.
    for (let turn = 0; turn < 40 && (await lastDrawn()) !== '5,000'; turn += 1) {
      await page.mouse.wheel(0, 8_000);
      await page.waitForTimeout(50);
    }
    await page.waitForFunction(
      (selector) =>
        [...document.querySelectorAll<HTMLElement>(`${selector} .recipe-table__row`)].some(
          (row) =>
            row.dataset['row'] === '4999' &&
            row.querySelector('.recipe-table__cell')?.textContent === '5,000',
        ),
      TABLE,
      { timeout: 10_000 },
    );
    const bottom = await drawn();
    expect(bottom.rows.length).toBeLessThanOrEqual(30);
    expect(bottom.rows.at(-1)).toEqual([4_999, '5,000']);
  }, 45_000);

  it('sorts in main from a header, and filters over the shown columns', async () => {
    await page.locator(`${TABLE} .recipe-table__heading[data-column="n"]`).click();
    await page.locator(`${TABLE} .recipe-table__heading[data-column="n"]`).click();
    await page.waitForFunction(
      (selector) =>
        document.querySelector(`${selector} .recipe-table__row .recipe-table__cell`)
          ?.textContent === '5,000',
      TABLE,
      { timeout: 10_000 },
    );
    const sorted = await drawn();
    expect(sorted.headings[0]).toBe('n ▼');
    expect(sorted.rows.slice(0, 3)).toEqual([
      [0, '5,000'],
      [1, '4,999'],
      [2, '4,998'],
    ]);
    expect(sorted.scrollTop).toBe(0);

    // "Row 49" is in the title of rows 49, 490–499 and 4900–4999.
    await page.locator(`${TABLE} .recipe-table__filter`).fill('Row 49');
    await page.waitForFunction(
      (selector) =>
        document.querySelector(`${selector} .recipe-table__count`)?.textContent ===
        'Rows: 111 of 5,000',
      TABLE,
      { timeout: 10_000 },
    );
    const filtered = await drawn();
    expect(filtered.rows.slice(0, 2)).toEqual([
      [0, '4,999'],
      [1, '4,998'],
    ]);
    // A web link is an anchor that opens outside the app.
    const link = await page
      .locator(`${TABLE} .recipe-table__row[data-row="0"] a.recipe-table__link`)
      .getAttribute('href');
    expect(link).toBe('https://example.com/4999');
  }, 20_000);
});
