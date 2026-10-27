import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type TrustStore, ok } from '@tyto/core';
import { loadWorkspace } from '@tyto/io';
import {
  type InProcessHost,
  type IsolatedPlugin,
  connectIsolatedPlugin,
  createPluginHost,
  recipeRegistriesOf,
} from '@tyto/plugin-api';
import { parseRecipe, runRecipe } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { type SectionOverrides, parseSection } from '../options.js';
import { projectSections } from '../sources.js';
import { ALWAYS_RESTRICTED } from '../workspace.js';
import { pluginProcessLauncher } from './plugin-process.js';

/**
 * A plugin's section of `.tyto/project.json` on its recipe verbs, with real confined processes
 * (TYTO-428, ADR 0147).
 *
 * Two installed plugins, `demo` and `other`, each with a source verb that answers the section
 * its call carried as a one-row table. The sections come from a real project file, read by
 * `loadWorkspace` trusted or restricted, with `--section` typed over them as the CLI merges it,
 * and reach each process only through `sectionOf` on each call.
 */

const PROJECT = {
  plugins: {
    demo: { site: 'acme.example', limit: 10 },
    other: { site: 'rival.example', token: 'never-for-demo' },
  },
};

const TRUSTED: TrustStore = {
  trustOf: () => Promise.resolve({ trust: 'trusted', diagnostics: [] }),
  grant: () => Promise.resolve(ok(false)),
  revoke: () => Promise.resolve(ok(false)),
};

let root: string;
let folder: string;
const started: IsolatedPlugin[] = [];

/** The plugin's code: a source that answers what its request carried, or `none`. */
function pluginSource(id: string): string {
  return `export function activate(host) {
  host.registerRecipeVerb({
    id: '${id}.section', kind: 'source', arguments: [],
    page: (request) => ({
      ok: true,
      diagnostics: [],
      value: {
        table: {
          columns: [{ name: 'section', type: 'text', origin: '${id}' }],
          rows: [{
            key: '${id}',
            values: { section: 'section' in request ? JSON.stringify(request.section) : 'none' },
            provenance: { source: '${id}', id: '${id}', fetchedAt: '2026-10-27' },
          }],
        },
      },
    }),
  });
}
`;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-section-'));
  for (const id of ['demo', 'other']) {
    await mkdir(join(root, id));
    await writeFile(join(root, id, 'index.js'), pluginSource(id));
  }
  folder = join(root, 'workspace');
  await mkdir(join(folder, '.tyto'), { recursive: true });
  await writeFile(join(folder, '.tyto', 'project.json'), JSON.stringify(PROJECT, null, 2));
});

afterEach(async () => {
  await Promise.all(started.splice(0).map((plugin) => plugin.close()));
  await rm(root, { recursive: true, force: true });
});

async function start(id: string): Promise<IsolatedPlugin> {
  const launch = pluginProcessLauncher({ guest: inject('pluginGuest') });
  const connected = await connectIsolatedPlugin({
    name: id,
    manifest: {
      name: id,
      version: '1.0.0',
      engine: '>=0.1',
      contributes: ['recipe-verb'],
      permissions: [],
      namespace: id,
    },
    channel: launch({ name: id, entry: join(root, id, 'index.js'), directory: join(root, id) }),
    requireSandbox: true,
  });
  if (!connected.ok) throw new Error(connected.error[0]?.message);
  started.push(connected.value);
  return connected.value;
}

async function bothPlugins(): Promise<InProcessHost> {
  const host = createPluginHost();
  for (const plugin of await Promise.all([start('demo'), start('other')])) {
    const activated = host.tryActivate(plugin.plugin);
    if (!activated.ok) throw new Error(activated.error[0]?.message);
  }
  return host;
}

/** What each plugin's verb was handed, for a folder trusted or not and the flags typed. */
async function seen(
  trustStore: TrustStore,
  flags: readonly string[] = [],
): Promise<Record<string, unknown>> {
  const workspace = await loadWorkspace(folder, { trustStore });
  if (workspace === undefined) throw new Error('the folder must load');
  const typed = flags.reduce<SectionOverrides>((known, flag) => parseSection(flag, known), {});
  const sections = projectSections(workspace, typed);
  const host = await bothPlugins();
  const registries = recipeRegistriesOf(host.registry, { sectionOf: (plugin) => sections[plugin] });
  const answers: Record<string, unknown> = {};
  for (const id of ['demo', 'other']) {
    const recipe = parseRecipe(`recipe sections\n${id}.section`);
    if (!recipe.ok) throw new Error('the recipe must parse');
    const run = await runRecipe(recipe.value, {
      ...registries,
      resolveRecipe: () => Promise.resolve({ ok: false, error: [] }),
    });
    if (!run.ok) throw new Error('the run must start');
    expect(run.value.cells.flatMap((cell) => cell.diagnostics)).toEqual([]);
    const value = run.value.table?.rows[0]?.values['section'];
    answers[id] = value === 'none' ? value : JSON.parse(String(value));
  }
  return answers;
}

// Each case starts two plugin processes, which a full `pnpm check` can hold past Vitest's 5 s.
describe("a plugin's project section on its recipe verbs, in real processes (ADR 0147)", () => {
  it("hands each plugin its own section in a trusted folder, and never the other's", async () => {
    expect(await seen(TRUSTED)).toEqual({
      demo: { site: 'acme.example', limit: 10 },
      other: { site: 'rival.example', token: 'never-for-demo' },
    });
  }, 60_000);

  it('hands no section at all in a restricted folder', async () => {
    expect(await seen(ALWAYS_RESTRICTED)).toEqual({ demo: 'none', other: 'none' });
  }, 60_000);

  it("lets --section override one key of one plugin's section and leave the rest", async () => {
    expect(await seen(TRUSTED, ['demo.limit=25', 'demo.board="42"'])).toEqual({
      demo: { site: 'acme.example', limit: 25, board: '42' },
      other: { site: 'rival.example', token: 'never-for-demo' },
    });
  }, 60_000);

  it("applies --section in a restricted folder while the file's sections stay withheld", async () => {
    expect(await seen(ALWAYS_RESTRICTED, ['demo.site=typed.example'])).toEqual({
      demo: { site: 'typed.example' },
      other: 'none',
    });
  }, 60_000);
});
