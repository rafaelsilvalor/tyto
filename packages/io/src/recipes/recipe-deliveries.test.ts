import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import type { RecipeContributions, RecipeVerbContribution } from '@tyto/plugin-api';
import type { RunClock, Table } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRecipeRunner } from './recipe-runner.js';

/**
 * TYTO-755, ADR 0210: a recipe over three tracker tasks plans three delivery folders with their
 * records, Apply writes them, and the next run plans no change. Through the runner as main
 * composes it, with no templates lent, over a real workspace whose project file moves deliveries
 * into `entregas/`.
 */

const NOW = '2026-11-17T12:00:00.000Z';
const clock: RunClock = { now: () => new Date(NOW), offsetMinutes: () => 0 };

const task = (key: string, folder: string, due: string) => ({
  key,
  values: { key, folder, due, formats: 'feed:2,story:1' },
  provenance: { source: 'demo', id: key, fetchedAt: '2026-11-17T09:00:00.000Z' },
});

const TASKS: Table = {
  columns: ['key', 'folder', 'due', 'formats'].map((name) => ({
    name,
    type: 'text' as const,
    origin: 'demo',
  })),
  rows: [
    task('MCA-1', 'mca-1_aula', '2026-11-20'),
    task('MCA-2', 'mca-2_simulado', '2026-11-21'),
    task('MCA-3', 'mca-3_banner', '2026-11-22'),
  ],
};

function contributions(): RecipeContributions {
  const rows: RecipeVerbContribution = {
    id: 'demo.tasks',
    kind: 'source',
    arguments: [],
    page: () => Promise.resolve(ok({ table: TASKS })),
  };
  return {
    recipeVerbs: () => [rows],
    ownedRecipeVerbs: () => [{ plugin: 'demo', verb: rows }],
    recipeDerivations: () => [],
  };
}

const RECIPE = [
  'recipe deliveries',
  'demo.tasks',
  'to-delivery name=folder fields=key:key,due:due,formats:formats',
  '',
].join('\n');

let scratch: string;
let workspace: string;
let recipePath: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-deliveries-')));
  workspace = join(scratch, 'campanha');
  await mkdir(join(workspace, 'recipes'), { recursive: true });
  await mkdir(join(workspace, '.tyto'), { recursive: true });
  await writeFile(
    join(workspace, '.tyto', 'project.json'),
    JSON.stringify({ delivery: { parent: 'entregas' } }),
    'utf8',
  );
  recipePath = join(workspace, 'recipes', 'deliveries.recipe');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('to-delivery through the recipe runner (TYTO-755)', () => {
  it('plans three folders, writes them on Apply, and plans none on the next run', async () => {
    const runner = createRecipeRunner({
      contributions: contributions(),
      placeOf: () => Promise.resolve({ trust: 'trusted', folder: workspace }),
      sectionFor: () => undefined,
      home: join(scratch, 'home'),
      clock: () => clock,
    });
    const run = () =>
      runner.run({ documentId: 'tab-1', text: RECIPE, path: recipePath, explicit: true });

    const first = await run();
    const cell = first.cells[1];
    expect(cell?.diagnostics).toEqual([]);
    expect(cell?.plan?.operations.map((operation) => operation.description)).toEqual([
      'entregas/mca-1_aula: new',
      'entregas/mca-2_simulado: new',
      'entregas/mca-3_banner: new',
    ]);

    const applied = await runner.apply({
      documentId: 'tab-1',
      index: 1,
      planId: cell?.planId ?? -1,
      path: recipePath,
    });
    expect(applied?.applied?.operations.map((operation) => operation.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    expect((await readdir(join(workspace, 'entregas'))).sort()).toEqual([
      'mca-1_aula',
      'mca-2_simulado',
      'mca-3_banner',
    ]);
    expect((await readdir(join(workspace, 'entregas', 'mca-1_aula'))).sort()).toEqual([
      'assets',
      'editaveis',
    ]);
    const record = JSON.parse(
      await readFile(
        join(workspace, 'entregas', 'mca-1_aula', 'editaveis', 'delivery.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(record).toMatchObject({
      version: 1,
      key: 'MCA-1',
      due: '2026-11-20',
      formats: [
        { format: 'feed', count: 2 },
        { format: 'story', count: 1 },
      ],
    });

    const again = await run();
    expect(again.cells[1]?.diagnostics).toEqual([]);
    expect(again.cells[1]?.plan?.count).toBe(0);

    // TYTO-771, ADR 0211: the folder is the source. `deliveries` reads the three records back,
    // and writing them again through a transform plans nothing.
    const fromFolder = await runner.run({
      documentId: 'tab-2',
      text: [
        'recipe from-folder',
        'deliveries',
        'where key != MCA-9',
        'to-delivery name=folder fields=key:key,due:due,formats:formats',
        '',
      ].join('\n'),
      path: join(workspace, 'recipes', 'from-folder.recipe'),
      explicit: true,
    });
    expect(fromFolder.cells.flatMap((found) => found.diagnostics)).toEqual([]);
    expect(fromFolder.cells[0]?.table?.rows.map((row) => row.key)).toEqual([
      'MCA-1',
      'MCA-2',
      'MCA-3',
    ]);
    expect(fromFolder.cells[2]?.plan?.count).toBe(0);
  });

  it("checks each delivery's exports against its record, sizes from the catalogue (ADR 0215)", async () => {
    await writeFile(
      join(workspace, '.tyto', 'project.json'),
      JSON.stringify({ delivery: { parent: 'entregas', sizes: { story: '1080x1920' } } }),
      'utf8',
    );
    const folder = join(workspace, 'entregas', 'mca-1_aula');
    await mkdir(join(folder, 'editaveis'), { recursive: true });
    await writeFile(
      join(folder, 'editaveis', 'delivery.json'),
      JSON.stringify({
        version: 1,
        key: 'MCA-1',
        formats: [
          { format: 'feed', count: 1 },
          { format: 'story', count: 1 },
        ],
      }),
    );
    await writeFile(join(folder, 'editaveis', 'arte.psd'), 'psd');
    await writeFile(join(folder, 'feed.png'), header(1080, 1350));
    await writeFile(join(folder, 'story.png'), header(1080, 1920));
    const runner = createRecipeRunner({
      contributions: contributions(),
      placeOf: () => Promise.resolve({ trust: 'trusted', folder: workspace }),
      sectionFor: () => undefined,
      home: join(scratch, 'home'),
      clock: () => clock,
      formatSizes: () => Promise.resolve({ feed: { w: 1080, h: 1350 }, story: { w: 9, h: 9 } }),
    });
    const read = await runner.run({
      documentId: 'tab-3',
      text: ['recipe check', 'deliveries', ''].join('\n'),
      path: join(workspace, 'recipes', 'check.recipe'),
      explicit: true,
    });
    expect(read.cells[0]?.diagnostics).toEqual([]);
    const row = read.cells[0]?.table?.rows[0]?.values;
    expect([row?.['check'], row?.['check_problems'], row?.['found_formats']]).toEqual([
      'ready',
      null,
      '4:5:1,9:16:1',
    ]);
  });
});

/** A PNG header that states `width` by `height`: all the check reads of it. */
function header(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  bytes.writeUInt32BE(0x89_50_4e_47, 0);
  bytes.writeUInt32BE(0x0d_0a_1a_0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
