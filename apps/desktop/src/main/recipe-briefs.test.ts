import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { type CliEnvironment, type LocatedDiagnostic, run } from '@tyto/command-line';
import { ok } from '@tyto/core';
import { type RecipePlace, createRecipeRunner, nodeFileSystem } from '@tyto/io';
import type { RecipeContributions, RecipeVerbContribution } from '@tyto/plugin-api';
import type { RunClock, Table } from '@tyto/recipe';
import { BUILT_IN_TEMPLATES_DIRECTORY } from '@tyto/templates';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectSources, templateManifestsOf } from './project.js';

/**
 * `to-brief` in the notebook (TYTO-380, ADR 0172), as main composes it: a table of three rows
 * from a source, planned into a folder of a real workspace, applied through `@tyto/io`'s
 * adapter, and each brief then rendered by `tyto render` — the command tree the terminal and
 * the window both run (ADR 0159) — over the built-in pack's test template `promo-curso`.
 *
 * The templates are found by `templateManifestsOf`, the function main hands the runner, over
 * the same project sources the preview reads. The rows are neutral example data.
 */

const NOW = '2026-11-08T12:00:00.000Z';
const clock: RunClock = { now: () => new Date(NOW), offsetMinutes: () => 0 };

const lesson = (slug: string, title: string, summary: string) => ({
  key: slug,
  values: { slug, title, summary },
  provenance: { source: 'demo', id: slug, fetchedAt: '2026-11-08T09:00:00.000Z' },
});

const LESSONS: Table = {
  columns: [
    { name: 'slug', type: 'text', origin: 'demo' },
    { name: 'title', type: 'text', origin: 'demo' },
    { name: 'summary', type: 'text', origin: 'demo' },
  ],
  rows: [
    lesson('lesson-1', 'First **lesson**', 'An opening session with examples.'),
    lesson('lesson-2', 'Second lesson', 'Exercises in pairs.'),
    lesson('lesson-3', 'Third lesson', 'A review of the whole series.'),
  ],
};

const rows: RecipeVerbContribution = {
  id: 'demo.rows',
  kind: 'source',
  arguments: [],
  page: () => Promise.resolve(ok({ table: LESSONS })),
};

const contributions: RecipeContributions = {
  recipeVerbs: () => [rows],
  ownedRecipeVerbs: () => [{ plugin: 'demo', verb: rows }],
  recipeDerivations: () => [],
};

const RECIPE = [
  'recipe lessons',
  'demo.rows',
  'to-brief template=promo-curso into=../briefs name=slug slots=titulo:title,subtitulo:summary',
  '',
].join('\n');

const pack = join(
  dirname(createRequire(import.meta.url).resolve('@tyto/templates/package.json')),
  BUILT_IN_TEMPLATES_DIRECTORY,
);

let scratch: string;
let workspace: string;
let recipePath: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-briefs-')));
  workspace = join(scratch, 'promo');
  await mkdir(join(workspace, 'recipes'), { recursive: true });
  recipePath = join(workspace, 'recipes', 'lessons.recipe');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function harness(trust: RecipePlace['trust'] = 'trusted', withTemplates = true) {
  const sources = await createProjectSources({ fileSystem: nodeFileSystem(), builtIn: pack });
  const runner = createRecipeRunner({
    contributions,
    placeOf: () => Promise.resolve(trust === 'none' ? { trust } : { trust, folder: workspace }),
    sectionFor: () => undefined,
    home: join(scratch, 'home'),
    clock: () => clock,
    ...(withTemplates ? { templates: templateManifestsOf(sources) } : {}),
  });
  /** Run, from the to-brief cell down when `again`, as the notebook's rerun of a cell does. */
  const plan = (again = false) =>
    runner.run({
      documentId: 'tab-1',
      text: RECIPE,
      path: recipePath,
      explicit: true,
      ...(again ? { from: 1 } : {}),
    });
  const apply = (planId: number) =>
    runner.apply({ documentId: 'tab-1', index: 1, planId, path: recipePath });
  return { plan, apply };
}

/** `tyto render <brief> --types svg`, in-process, with what it reported as data. */
async function render(brief: string) {
  const reported: LocatedDiagnostic[] = [];
  const printed: string[] = [];
  const environment: CliEnvironment = {
    console: { out: () => undefined, err: (text) => printed.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    rasterizer: () => {
      throw new Error('an SVG render needs no browser');
    },
    diagnostics: (items) => reported.push(...items),
  };
  const code = await run(
    [
      'render',
      brief,
      '--out',
      join('out', brief.replace(/\.brief$/u, '')),
      '--types',
      'svg',
      '--templates',
      pack,
      '--formats-file',
      join(pack, 'formats.yaml'),
    ],
    environment,
  );
  return { code, reported, printed: printed.join('') };
}

describe('to-brief in the notebook', () => {
  it('plans one brief per row, applies them into the folder, and each renders clean', async () => {
    const { plan, apply } = await harness();
    const answer = await plan();
    const cell = answer.cells[1];

    expect(cell?.diagnostics).toEqual([]);
    expect(cell?.plan?.operations.map((operation) => operation.description)).toEqual([
      'briefs/lesson-1.brief: new',
      'briefs/lesson-2.brief: new',
      'briefs/lesson-3.brief: new',
    ]);
    expect(cell?.applicable).toBe(true);
    // Planning wrote nothing.
    expect(await readdir(workspace)).toEqual(['recipes']);

    const applied = await apply(cell?.planId ?? -1);
    expect(applied?.applied?.operations.map((operation) => operation.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    expect((await readdir(join(workspace, 'briefs'))).sort()).toEqual([
      'lesson-1.brief',
      'lesson-2.brief',
      'lesson-3.brief',
    ]);
    expect(await readFile(join(workspace, 'briefs', 'lesson-1.brief'), 'utf8')).toContain(
      'template: promo-curso',
    );

    for (const name of ['lesson-1', 'lesson-2', 'lesson-3']) {
      const rendered = await render(`briefs/${name}.brief`);
      // Machine fonts differ from CI's, which adds W_FONT_SUBSTITUTED: errors are what count.
      const errors = rendered.reported.filter((found) => found.severity === 'error');
      expect(errors, rendered.printed).toEqual([]);
      expect(rendered.code, rendered.printed).toBe(0);
      const svgs = (await readdir(join(workspace, 'out', 'briefs', name), { recursive: true }))
        .map(String)
        .filter((file) => file.endsWith('.svg'));
      expect(svgs.length).toBeGreaterThan(0);
    }
  });

  it('marks an overwrite, and fails the brief edited since the plan while the others apply', async () => {
    const { plan, apply } = await harness();
    const first = await plan();
    await apply(first.cells[1]?.planId ?? -1);

    const second = await plan(true);
    const cell = second.cells[1];
    expect(cell?.plan?.operations.map((operation) => operation.description)).toEqual([
      'briefs/lesson-1.brief: overwrites',
      'briefs/lesson-2.brief: overwrites',
      'briefs/lesson-3.brief: overwrites',
    ]);
    const edited = join(workspace, 'briefs', 'lesson-2.brief');
    await writeFile(edited, 'edited by hand\n');

    const applied = await apply(cell?.planId ?? -1);

    expect(applied?.applied?.operations).toEqual([
      { rowKey: 'lesson-1', status: 'applied', appliedAt: NOW },
      {
        rowKey: 'lesson-2',
        status: 'failed',
        reason: 'briefs/lesson-2.brief changed since the plan',
      },
      { rowKey: 'lesson-3', status: 'applied', appliedAt: NOW },
    ]);
    expect(await readFile(edited, 'utf8')).toBe('edited by hand\n');
  });

  it('plans nothing in a restricted folder, and writes nothing', async () => {
    const { plan } = await harness('restricted');
    const cell = (await plan()).cells[1];

    expect(cell?.status).toBe('failed');
    expect(cell?.diagnostics.map((found) => found.code)).toEqual(['E_RECIPE_BRIEF']);
    expect(cell?.diagnostics[0]?.message).toContain('restricted');
    expect(await readdir(workspace)).toEqual(['recipes']);
  });

  it('plans nothing for a recipe in no workspace, and says where it may write', async () => {
    const { plan } = await harness('none');
    const cell = (await plan()).cells[1];

    expect(cell?.diagnostics.map((found) => found.code)).toEqual(['E_RECIPE_BRIEF']);
    expect(cell?.diagnostics[0]?.message).toContain('inside a workspace');
  });

  it('says this host writes no briefs when it lends no templates', async () => {
    const { plan } = await harness('trusted', false);
    const cell = (await plan()).cells[1];

    expect(cell?.diagnostics[0]?.message).toContain('this host writes no briefs');
  });
});
