import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import {
  type RecipeContributions,
  type RecipeVerbContribution,
  recipeRegistriesOf,
} from '@tyto/plugin-api';
import type { PlannedRename, RunClock, Verb } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRecipeRunner } from './recipe-runner.js';

/**
 * ADR 0219, through the runner as main composes it, over a real workspace: `apply together`
 * applies every plan of the run in order with one call and stops at the first cell that does not
 * go through, and a step below `rename-exports` is handed the renames planned above it, from a
 * cell the run reused too. The workspace projection itself is `@tyto/plugin-api`'s, tested there.
 */

const NOW = '2026-11-19T12:00:00.000Z';
const clock: RunClock = { now: () => new Date(NOW), offsetMinutes: () => 0 };

interface Stand {
  /** What `probe.see` was handed as the renames above it, one entry per run of it. */
  readonly seen: (readonly PlannedRename[] | undefined)[];
  /** The order the plans were applied in, by verb. */
  readonly applied: string[];
  /** When set, `demo.send` fails every operation. */
  failSend: boolean;
}

function contributions(stand: Stand): RecipeContributions {
  const send: RecipeVerbContribution = {
    id: 'demo.send',
    kind: 'action',
    arguments: [],
    writes: ['send'],
    plan: ({ table }) => {
      const operations = table.rows.map((row) => ({
        write: 'send',
        rowKey: row.key,
        description: `Send ${row.key}`,
      }));
      return Promise.resolve(ok({ target: 'remote', operations, count: operations.length }));
    },
    apply: ({ operations }) => {
      stand.applied.push('demo.send');
      return Promise.resolve(
        ok({
          operations: operations.map(() =>
            stand.failSend
              ? { status: 'failed' as const, reason: 'the remote said no' }
              : { status: 'applied' as const },
          ),
        }),
      );
    },
  };
  return {
    recipeVerbs: () => [send],
    ownedRecipeVerbs: () => [{ plugin: 'demo', verb: send }],
    recipeDerivations: () => [],
  };
}

/** A transform that remembers the renames its context carries and passes the table on. */
function probe(stand: Stand): Verb {
  return {
    kind: 'transform',
    run: (context) => {
      stand.seen.push(context.plannedRenames);
      return Promise.resolve(ok({ table: context.table ?? { columns: [], rows: [] } }));
    },
  };
}

/** A PNG header that states `width` by `height`: all the check and the names read of it. */
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

let scratch: string;
let workspace: string;
let exportsFolder: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-together-')));
  workspace = join(scratch, 'campanha');
  await mkdir(join(workspace, '.tyto'), { recursive: true });
  await mkdir(join(workspace, 'recipes'), { recursive: true });
  await writeFile(
    join(workspace, '.tyto', 'project.json'),
    JSON.stringify({
      delivery: { parent: 'entregas', exports: 'final', sizes: { feed: '1080x1350' } },
    }),
    'utf8',
  );
  const folder = join(workspace, 'entregas', 'mca-1');
  exportsFolder = join(folder, 'final');
  await mkdir(join(folder, 'editaveis'), { recursive: true });
  await mkdir(exportsFolder, { recursive: true });
  await writeFile(
    join(folder, 'editaveis', 'delivery.json'),
    JSON.stringify({
      version: 1,
      key: 'MCA-1',
      stem: 'mca-1',
      formats: [{ format: 'feed', count: 1 }],
    }),
  );
  await writeFile(join(exportsFolder, 'feed.png'), header(1080, 1350));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function runnerFor(stand: Stand) {
  const contributed = contributions(stand);
  return createRecipeRunner({
    contributions: contributed,
    placeOf: () => Promise.resolve({ trust: 'trusted', folder: workspace }),
    sectionFor: () => undefined,
    home: join(scratch, 'home'),
    clock: () => clock,
    registries: (request) => {
      const registries = recipeRegistriesOf(contributed, {
        sectionOf: request.sectionOf,
        refresh: request.refresh,
        ...(request.now === undefined ? {} : { now: request.now }),
        ...(request.deliveries === undefined ? {} : { deliveries: request.deliveries }),
      });
      registries.verbs.register('probe.see', probe(stand));
      return registries;
    },
  });
}

const SHIP = (apply: string) =>
  [
    'recipe ship',
    ...(apply === '' ? [] : [apply]),
    'deliveries',
    'rename-exports stem=stem',
    'probe.see',
    'demo.send',
    '',
  ].join('\n');

describe('apply together (ADR 0219)', () => {
  it('hands a step below the renames planned above it, and applies every plan in order', async () => {
    const stand: Stand = { seen: [], applied: [], failSend: false };
    const runner = runnerFor(stand);
    const path = join(workspace, 'recipes', 'ship.recipe');
    const text = SHIP('apply together');

    const first = await runner.run({ documentId: 'ship', text, path, explicit: true });
    expect(first.together).toBe(true);
    expect(first.cells.flatMap((cell) => cell.diagnostics)).toEqual([]);
    expect(stand.seen).toEqual([
      [{ from: 'entregas/mca-1/final/feed.png', to: 'entregas/mca-1/final/mca-1-01.png' }],
    ]);

    // Run from the probe down: the rename cell is reused, and its renames still reach the probe.
    await runner.run({ documentId: 'ship', text, path, explicit: true, from: 2 });
    expect(stand.seen[1]).toEqual(stand.seen[0]);

    const together = await runner.applyTogether({ documentId: 'ship', path });
    expect(together.diagnostics).toEqual([]);
    expect(
      together.cells.map((cell) => cell.applied?.operations.map(({ status }) => status)),
    ).toEqual([undefined, ['applied'], undefined, ['applied']]);
    expect(stand.applied).toEqual(['demo.send']);
    expect(await readdir(exportsFolder)).toEqual(['mca-1-01.png']);
  });

  it('hands no renames below without apply together', async () => {
    const stand: Stand = { seen: [], applied: [], failSend: false };
    const runner = runnerFor(stand);
    const path = join(workspace, 'recipes', 'ship.recipe');

    await runner.run({ documentId: 'plain', text: SHIP(''), path, explicit: true });

    expect(stand.seen).toEqual([undefined]);
    const together = await runner.applyTogether({ documentId: 'plain', path });
    expect(together.diagnostics.map(({ message }) => message)).toEqual([
      "'apply together' was refused: the recipe's header does not say 'apply together'; apply each plan instead.",
    ]);
    expect(await readdir(exportsFolder)).toEqual(['feed.png']);
  });

  it('stops at the first cell that does not go through, and applies nothing below it', async () => {
    const stand: Stand = { seen: [], applied: [], failSend: true };
    const runner = runnerFor(stand);
    const path = join(workspace, 'recipes', 'ship.recipe');
    const text = [
      'recipe ship',
      'apply together',
      'deliveries',
      'demo.send',
      'rename-exports stem=stem',
      '',
    ].join('\n');
    await runner.run({ documentId: 'stop', text, path, explicit: true });

    const together = await runner.applyTogether({ documentId: 'stop', path });

    expect(
      together.cells.map((cell) => cell.applied?.operations.map(({ status }) => status)),
    ).toEqual([undefined, ['failed'], undefined]);
    expect(together.diagnostics.map(({ message }) => message)).toEqual([
      "'apply together' stopped at cell 2: its Apply did not go through, and 1 plan below it was not applied; run the recipe again for what is left.",
    ]);
    expect(await readdir(exportsFolder)).toEqual(['feed.png']);
  });

  it('refuses before any write when a cell did not run this time', async () => {
    const stand: Stand = { seen: [], applied: [], failSend: false };
    const runner = runnerFor(stand);
    const path = join(workspace, 'recipes', 'ship.recipe');
    const text = SHIP('apply together');
    await runner.run({ documentId: 'stale', text, path, explicit: true, until: 1 });

    const together = await runner.applyTogether({ documentId: 'stale', path });

    expect(together.diagnostics.map(({ message }) => message)[0]).toContain(
      'cell 3 did not run this time',
    );
    expect(stand.applied).toEqual([]);
    expect(await readdir(exportsFolder)).toEqual(['feed.png']);
  });
});
