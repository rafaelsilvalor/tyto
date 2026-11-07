import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { longestPathUnder } from './home-path.js';
import {
  type PluginFilesSyncOptions,
  machinePluginFiles,
  projectPluginFiles,
  syncPluginFiles,
} from './plugin-files-sync.js';

/**
 * Both folders' sync as every app runs it (TYTO-433): the CLI's `plugin-files.test.ts` takes it
 * through `tyto plugin sync` and `tyto render`; this pins what an app hands in — the built-in
 * names, and who answers a permission prompt — which the desktop answers with a dialog.
 */

const exec = promisify(execFile);
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

let root: string;
let home: string;

/** A repository holding one plugin's manifest on `main`; answers its URL. */
async function repository(name: string, permissions: readonly string[] = []): Promise<string> {
  const folder = join(root, 'repositories', name);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: '>=0.1.0',
      contributes: ['template-pack'],
      permissions,
    }),
    'utf8',
  );
  await exec('git', ['init', '--quiet', '--initial-branch=main', folder]);
  await exec('git', [...AUTHOR, '-C', folder, 'add', '.']);
  await exec('git', [...AUTHOR, '-C', folder, 'commit', '--quiet', '-m', 'one']);
  return pathToFileURL(folder).href;
}

async function pluginFile(folder: string, git: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, 'pack.yaml'),
    `version: 1\nplugin:\n  source: { git: '${git}', ref: 'main' }\n`,
    'utf8',
  );
}

const options = (overrides: Partial<PluginFilesSyncOptions> = {}): PluginFilesSyncOptions => ({
  home,
  update: false,
  fetches: true,
  builtInNames: new Set(),
  shown: (path) => path,
  ...overrides,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-plugin-files-sync-'));
  home = join(root, 'home');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('approval', () => {
  it('asks about a plugin that wants permissions, naming its source, and records a yes', async () => {
    const git = await repository('asks', ['net:example.invalid']);
    await pluginFile(machinePluginFiles(home), git);
    const asked: string[] = [];

    const synced = await syncPluginFiles(
      options({
        approve: (manifest, source) => {
          asked.push(`${manifest.name} ${source}`);
          return Promise.resolve(true);
        },
      }),
    );

    expect(asked).toEqual([`asks ${git} at main`]);
    expect(synced.unapproved).toEqual([]);
    const state = JSON.parse(await readFile(join(home, 'plugins.json'), 'utf8')) as {
      plugins: Record<string, { permissions: string[] }>;
    };
    expect(state.plugins['asks']?.permissions).toEqual(['net:example.invalid']);
  });

  it('leaves the plugin unapproved on a no, and with nobody to ask', async () => {
    const git = await repository('asks', ['net:example.invalid']);
    await pluginFile(machinePluginFiles(home), git);

    const refused = await syncPluginFiles(options({ approve: () => Promise.resolve(false) }));
    const unasked = await syncPluginFiles(options());

    expect(refused.unapproved).toEqual(['asks']);
    expect(unasked.unapproved).toEqual(['asks']);
  });

  it('asks nothing of a plugin that wants no permissions', async () => {
    await pluginFile(machinePluginFiles(home), await repository('quiet'));
    let asked = false;

    const synced = await syncPluginFiles(
      options({
        approve: () => {
          asked = true;
          return Promise.resolve(false);
        },
      }),
    );

    expect(asked).toBe(false);
    expect(synced.copies.map((copy) => copy.plugin)).toEqual(['quiet']);
  });
});

describe('the two folders', () => {
  it("leaves a restricted workspace's files unread, and reads a trusted one's first", async () => {
    const workspace = join(root, 'workspace');
    await pluginFile(machinePluginFiles(home), await repository('machine'));
    await pluginFile(projectPluginFiles(workspace), await repository('project'));

    const restricted = await syncPluginFiles(
      options({ workspace: { folder: workspace, trusted: false } }),
    );
    const trusted = await syncPluginFiles(
      options({ workspace: { folder: workspace, trusted: true } }),
    );

    expect(restricted.copies.map((copy) => copy.plugin)).toEqual(['machine']);
    expect(trusted.copies.map((copy) => copy.plugin)).toEqual(['project', 'machine']);
  });

  it("refuses a built-in's name, as tyto plugin install does", async () => {
    await pluginFile(machinePluginFiles(home), await repository('built-in-templates'));

    const synced = await syncPluginFiles(
      options({ builtInNames: new Set(['built-in-templates']) }),
    );

    expect(synced.copies).toEqual([]);
    expect(synced.diagnostics.map((item) => item.code)).toContain('E_PLUGIN_NAME_TAKEN');
  });
});

describe('the configured templates', () => {
  it('names the plugin that fetched each one, and leaves out one nothing fetched (TYTO-462)', async () => {
    const git = await repository('tabelas-pack');
    const missing = pathToFileURL(join(root, 'repositories', 'not-there')).href;
    const folder = machinePluginFiles(home);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'tabelas.yaml'),
      [
        'version: 1',
        'templates:',
        '  tabela:',
        `    source: { git: '${git}', ref: 'main' }`,
        '    configurations: { roxo: { values: {} } }',
        '  aviso:',
        `    source: { git: '${missing}', ref: 'main' }`,
        '    configurations: { claro: { values: {} } }',
        '',
      ].join('\n'),
      'utf8',
    );

    const synced = await syncPluginFiles(options());

    expect(synced.configured.machine.map(({ template, plugin }) => ({ template, plugin }))).toEqual(
      [{ template: 'tabela', plugin: 'tabelas-pack' }],
    );
  });
});

describe('a TYTO_HOME too deep for its copies (TYTO-470)', () => {
  const workspace = (): { folder: string; trusted: boolean } => ({
    folder: join(root, 'project'),
    trusted: true,
  });

  it('stops before the first fetch with one error for both folders, and writes no cache', async () => {
    const git = await repository('deep-pack');
    await pluginFile(machinePluginFiles(home), git);
    await pluginFile(projectPluginFiles(workspace().folder), git);
    // The limit, not a real deep folder: Linux CI checks Windows' arithmetic this way.
    const limit = longestPathUnder(home, process.platform) - 1;

    const synced = await syncPluginFiles(options({ workspace: workspace(), homePath: { limit } }));

    expect(synced.diagnostics.map((item) => item.code)).toEqual(['E_TYTO_HOME_PATH_TOO_LONG']);
    expect(synced.diagnostics[0]?.message).toContain(home);
    expect(synced.copies).toEqual([]);
    expect(await readdir(home)).not.toContain('cache');
  });

  it('fetches as before from a home that fits', async () => {
    const git = await repository('shallow-pack');
    await pluginFile(machinePluginFiles(home), git);

    const synced = await syncPluginFiles(options());

    expect(synced.diagnostics).toEqual([]);
    expect(synced.copies.map((copy) => copy.plugin)).toEqual(['shallow-pack']);
  });

  it('turns a path the system refuses under the home into the same error, not a throw', async () => {
    const git = await repository('refused-pack');
    await pluginFile(projectPluginFiles(workspace().folder), git);
    // One name over 255 characters: every system refuses it, with or without long paths.
    const deepHome = join(root, 'h'.repeat(300));

    const synced = await syncPluginFiles(
      options({ home: deepHome, workspace: workspace(), homePath: { limit: 100_000 } }),
    );

    expect(synced.diagnostics.map((item) => item.code)).toEqual(['E_TYTO_HOME_PATH_TOO_LONG']);
    expect(synced.diagnostics[0]?.message).toContain('the system refused it');
  });
});
