import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type RefreshPorts,
  type RepositoryScratch,
  type TemplateRepository,
  preparePluginHome,
  readTemplateRepository,
  refreshRepository,
  repositoryScratch,
} from './repository.ts';

/**
 * The private home and the stage of a template in its own repository (TYTO-485), with the
 * build and the install replaced by stand-ins. The two real programs run in `preview.test.ts`.
 */

let root: string;
let repository: TemplateRepository;
let scratch: RepositoryScratch;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-preview-repository-'));
  const folder = join(root, 'repo');
  await mkdir(join(folder, 'templates', 'demo'), { recursive: true });
  await mkdir(join(folder, 'dist'), { recursive: true });
  await mkdir(join(folder, 'node_modules', 'zod'), { recursive: true });
  await writeFile(join(folder, 'tyto-plugin.json'), JSON.stringify({ name: 'demo' }));
  await writeFile(
    join(folder, 'package.json'),
    JSON.stringify({ files: ['tyto-plugin.json', 'dist', 'templates', 'assets'] }),
  );
  await writeFile(join(folder, 'templates', 'demo', 'manifest.yaml'), 'name: demo\n');
  await writeFile(join(folder, 'dist', 'index.js'), '// committed\n');
  repository = readTemplateRepository(folder)!;
  scratch = repositoryScratch(join(root, 'run'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Calls {
  builds: number;
  installs: string[];
}

function ports(
  calls: Calls,
  outcome: { buildErrors?: string[]; install?: string } = {},
): RefreshPorts {
  return {
    build: async (_folder, outDir) => {
      calls.builds += 1;
      if (outcome.buildErrors !== undefined) return outcome.buildErrors.map((text) => ({ text }));
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'index.js'), `// build ${String(calls.builds)}\n`);
      return undefined;
    },
    install: (stage) => {
      calls.installs.push(stage);
      return Promise.resolve(outcome.install);
    },
  };
}

describe('readTemplateRepository', () => {
  it('names the plugin from tyto-plugin.json and answers undefined for a folder with none', () => {
    expect(repository.plugin).toBe('demo');
    expect(readTemplateRepository(join(root, 'repo', 'templates'))).toBeUndefined();
  });
});

describe('preparePluginHome', () => {
  it("copies the person's other plugins and approvals, not the previewed one or plugin-files", async () => {
    const person = join(root, 'person');
    for (const name of ['brand-kit', 'demo']) {
      await mkdir(join(person, 'plugins', name), { recursive: true });
      await writeFile(join(person, 'plugins', name, 'tyto-plugin.json'), '{}');
    }
    await mkdir(join(person, 'plugin-files'), { recursive: true });
    await writeFile(
      join(person, 'plugins.json'),
      JSON.stringify({
        plugins: { 'brand-kit': { enabled: true, permissions: [] }, demo: { enabled: true } },
      }),
    );

    await preparePluginHome(scratch, repository, person);

    expect(existsSync(join(scratch.home, 'plugins', 'brand-kit', 'tyto-plugin.json'))).toBe(true);
    expect(existsSync(join(scratch.home, 'plugins', 'demo'))).toBe(false);
    expect(existsSync(join(scratch.home, 'plugin-files'))).toBe(false);
    expect(existsSync(scratch.noTemplates)).toBe(true);
    const written = JSON.parse(await readFile(join(scratch.home, 'plugins.json'), 'utf8')) as {
      plugins: Record<string, unknown>;
    };
    expect(Object.keys(written.plugins)).toEqual(['brand-kit']);
  });

  it('starts from an empty home when the person has none', async () => {
    await preparePluginHome(scratch, repository, join(root, 'nobody'));
    expect(JSON.parse(await readFile(join(scratch.home, 'plugins.json'), 'utf8'))).toEqual({
      plugins: {},
    });
  });
});

describe('refreshRepository', () => {
  it('builds into the stage, copies the published files and installs the stage', async () => {
    const calls: Calls = { builds: 0, installs: [] };

    const outcome = await refreshRepository(
      repository,
      scratch,
      { kit: false, templates: true },
      ports(calls),
    );

    expect(outcome).toEqual({ ok: true, diagnostics: [] });
    expect(calls.installs).toEqual([scratch.stage]);
    expect(await readFile(join(scratch.stage, 'dist', 'index.js'), 'utf8')).toBe('// build 1\n');
    expect(existsSync(join(scratch.stage, 'templates', 'demo', 'manifest.yaml'))).toBe(true);
    expect(existsSync(join(scratch.stage, 'package.json'))).toBe(true);
    expect(existsSync(join(scratch.stage, 'node_modules'))).toBe(false);
    // The repository's committed build is the author's: never rewritten by a preview.
    expect(await readFile(join(repository.folder, 'dist', 'index.js'), 'utf8')).toBe(
      '// committed\n',
    );
  });

  it('installs without building when only a package file changed, and drops a deleted one', async () => {
    const calls: Calls = { builds: 0, installs: [] };
    await writeFile(join(repository.folder, 'templates', 'demo', 'old.yaml'), '');
    await refreshRepository(repository, scratch, { kit: false, templates: true }, ports(calls));
    await rm(join(repository.folder, 'templates', 'demo', 'old.yaml'));

    await refreshRepository(repository, scratch, { kit: false, templates: false }, ports(calls));

    expect(calls.builds).toBe(1);
    expect(calls.installs).toHaveLength(2);
    expect(existsSync(join(scratch.stage, 'templates', 'demo', 'old.yaml'))).toBe(false);
    expect(existsSync(join(scratch.stage, 'dist', 'index.js'))).toBe(true);
  });

  it('names the plugin in a failed build, and installs nothing', async () => {
    const calls: Calls = { builds: 0, installs: [] };

    const outcome = await refreshRepository(
      repository,
      scratch,
      { kit: false, templates: true },
      ports(calls, { buildErrors: ['Unexpected end of file'] }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.diagnostics[0]).toMatchObject({ code: 'PREVIEW_BUILD_FAILED' });
    expect(outcome.diagnostics[0]?.message).toMatch(/^demo did not rebuild.*Unexpected end/u);
    expect(calls.installs).toEqual([]);
  });

  it('reports an install the CLI refused', async () => {
    const calls: Calls = { builds: 0, installs: [] };

    const outcome = await refreshRepository(
      repository,
      scratch,
      { kit: false, templates: true },
      ports(calls, { install: 'E_PLUGIN_MANIFEST: engine is required' }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.diagnostics[0]).toMatchObject({ code: 'PREVIEW_INSTALL_FAILED' });
    expect(outcome.diagnostics[0]?.message).toMatch(/E_PLUGIN_MANIFEST/u);
  });
});
