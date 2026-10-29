import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { run } from './program.js';

/**
 * TYTO-456's acceptance: `tyto plugin list` shows what the plugin files name and their
 * aliases, and a restricted workspace's files are named as left out rather than skipped in
 * silence (ADR 0111, ADR 0151).
 *
 * Every source is a `file://` repository made with `git init`, as `plugin-files.test.ts`
 * makes them: no network and no fake of one.
 */

const exec = promisify(execFile);

const EXAMPLE_PACK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ...['..', '..', '..', 'examples', 'plugins', 'tyto-plugin-example-pack'],
);
const BRIEF = join(EXAMPLE_PACK, 'templates', 'aviso', 'examples', 'aviso.brief');
const FORMATS = join(EXAMPLE_PACK, 'templates', 'formats.yaml');

const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

let workspace: string;
let home: string;
let out: string[];
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: { out: (text) => out.push(text), err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    home,
    rasterizer: () => {
      throw new Error('these renders are svg and never raster');
    },
  };
}

const stdout = (): string => out.join('');
const stderr = (): string => errors.join('');

async function git(folder: string, ...args: string[]): Promise<string> {
  return (await exec('git', [...AUTHOR, '-C', folder, ...args])).stdout.trim();
}

async function edit(path: string, change: (text: string) => string): Promise<void> {
  await writeFile(path, change(await readFile(path, 'utf8')), 'utf8');
}

/**
 * The example pack as a repository tagged `v1`, named `plugin` (two sources may not share a
 * plugin's name) and asking for `permissions`.
 */
async function repository(
  name: string,
  plugin = 'example-pack',
  permissions: readonly string[] = [],
): Promise<string> {
  const folder = join(workspace, 'repositories', name);
  await cp(EXAMPLE_PACK, folder, { recursive: true });
  await edit(join(folder, 'tyto-plugin.json'), (text) =>
    text
      .replace('"example-pack"', `"${plugin}"`)
      .replace('"permissions": []', `"permissions": ${JSON.stringify(permissions)}`),
  );
  await edit(join(folder, 'dist', 'index.js'), (text) =>
    text.replace("id: 'example-pack'", `id: '${plugin}'`),
  );
  await exec('git', ['init', '--quiet', '--initial-branch=main', folder]);
  await git(folder, 'add', '.');
  await git(folder, 'commit', '--quiet', '-m', 'release');
  await git(folder, 'tag', 'v1');
  return folder;
}

const urlOf = (folder: string): string => pathToFileURL(folder).href;
/** A URL as a regular expression matches it literally. */
const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

async function machineYaml(lines: readonly string[]): Promise<void> {
  await mkdir(join(home, 'plugin-files'), { recursive: true });
  await writeFile(join(home, 'plugin-files', 'templates.yaml'), lines.join('\n'), 'utf8');
}

/** A workspace with its own plugin file naming `aviso` from `git`, and `aviso`'s brief. */
async function project(source: string): Promise<string> {
  const folder = join(workspace, 'project');
  await mkdir(join(folder, '.tyto', 'plugin-files'), { recursive: true });
  await writeFile(join(folder, '.tyto', 'project.json'), '{}\n', 'utf8');
  await writeFile(
    join(folder, '.tyto', 'plugin-files', 'aviso.yaml'),
    ['version: 1', 'templates:', '  aviso:', `    source: { git: '${source}', ref: v1 }`, ''].join(
      '\n',
    ),
    'utf8',
  );
  const brief = join(folder, 'aviso.brief');
  await cp(BRIEF, brief);
  return brief;
}

async function list(...flags: string[]): Promise<number> {
  out = [];
  errors = [];
  return run(['plugin', 'list', ...flags], environment());
}

async function render(brief: string): Promise<number> {
  out = [];
  errors = [];
  return run(
    ['render', brief, '--out', 'out', '--formats-file', FORMATS, '--types', 'svg'],
    environment(),
  );
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-plugin-files-list-'));
  home = join(workspace, 'home', '.tyto');
  out = [];
  errors = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// Each test runs git several times and a render starts a plugin's process.
const SLOW = 60_000;

describe('tyto plugin list', () => {
  it(
    'shows the installed plugins and the plugin files, with the locked commit once synced',
    async () => {
      const pack = await repository('pack');
      const asking = await repository('asking', 'asking-pack', ['net:example.invalid']);
      await machineYaml([
        'version: 1',
        'templates:',
        '  aviso:',
        `    source: { git: '${urlOf(pack)}', ref: v1 }`,
        '  outro:',
        `    source: { git: '${urlOf(asking)}', ref: v1 }`,
        '',
      ]);

      expect(await list(), stderr()).toBe(EXIT_OK);
      // The installed plugins as before, then the files' sources, never fetched by a listing.
      expect(stdout()).toMatch(/^built-in-templates\s.*\n[^]*^plugin files:$/mu);
      expect(stdout()).toMatch(
        new RegExp(
          `^-\\s+machine\\s+${literal(urlOf(pack))}\\s+v1\\s+-\\s+not synced\\s+\\S*templates\\.yaml$`,
          'mu',
        ),
      );

      // Not approved: the second asks for a permission nobody granted, so a render skips it.
      expect(await run(['plugin', 'sync'], environment())).toBe(EXIT_OK);
      expect(await list(), stderr()).toBe(EXIT_OK);
      const commit = (await git(pack, 'rev-parse', 'v1')).slice(0, 12);
      expect(stdout()).toMatch(
        new RegExp(
          `^example-pack\\s+machine\\s+${literal(urlOf(pack))}\\s+v1\\s+${commit}\\s+approved\\s`,
          'mu',
        ),
      );
      expect(stdout()).toMatch(
        new RegExp(`${literal(urlOf(asking))}\\s+v1\\s+\\w{12}\\s+not approved\\s`, 'u'),
      );

      // --active keeps what a render would load; --json carries the full commit.
      expect(await list('--active')).toBe(EXIT_OK);
      expect(stdout()).toContain(urlOf(pack));
      expect(stdout()).not.toContain(urlOf(asking));
      expect(await list('--json')).toBe(EXIT_OK);
      const document = JSON.parse(stdout()) as {
        pluginFiles: { plugin: string | null; commit: string | null; status: string }[];
      };
      expect(document.pluginFiles).toContainEqual(
        expect.objectContaining({
          plugin: 'example-pack',
          commit: await git(pack, 'rev-parse', 'v1'),
          status: 'approved',
        }),
      );
    },
    SLOW,
  );

  it(
    'shows each alias as alias → template (configuration), the written one and the default one',
    async () => {
      const pack = await repository('pack');
      await machineYaml([
        'version: 1',
        'templates:',
        '  aviso:',
        `    source: { git: '${urlOf(pack)}', ref: v1 }`,
        '    configurations:',
        '      roxo:',
        '        alias: aviso-roxo-da-casa',
        '      laranja: {}',
        '',
      ]);

      expect(await list(), stderr()).toBe(EXIT_OK);

      expect(stdout()).toMatch(/^aviso-roxo-da-casa → aviso \(roxo\)\s+\S*templates\.yaml$/mu);
      expect(stdout()).toMatch(/^aviso-laranja\s+→ aviso \(laranja\)\s+\S*templates\.yaml$/mu);
      expect(await list('--json')).toBe(EXIT_OK);
      expect((JSON.parse(stdout()) as { aliases: unknown[] }).aliases).toContainEqual(
        expect.objectContaining({
          alias: 'aviso-laranja',
          template: 'aviso',
          configuration: 'laranja',
          scope: 'machine',
        }),
      );
    },
    SLOW,
  );
});

describe('a restricted workspace', () => {
  it(
    'names its plugin files as left out, in render and in list, and lists them once trusted',
    async () => {
      const pack = await repository('pack');
      const brief = await project(urlOf(pack));
      const files = join('project', '.tyto', 'plugin-files');
      const notice = (what: string): string =>
        `${files} was not ${what}: this folder is restricted`;

      await render(brief);
      expect(stderr()).toContain(notice('loaded'));

      expect(await list(join(workspace, 'project')), stderr()).toBe(EXIT_OK);
      expect(stderr()).toContain(notice('listed'));
      expect(stdout()).not.toContain(urlOf(pack));

      expect(await run(['trust', 'add', join(workspace, 'project')], environment())).toBe(EXIT_OK);
      await render(brief);
      expect(stderr()).not.toContain('was not loaded');
      expect(await list(join(workspace, 'project')), stderr()).toBe(EXIT_OK);
      expect(stdout()).toMatch(
        new RegExp(`project\\s+${literal(urlOf(pack))}\\s+v1\\s+\\w{12}\\s+approved`, 'u'),
      );
    },
    SLOW,
  );

  it(
    'says nothing when the restricted workspace has no plugin files',
    async () => {
      const brief = await project('unused');
      await rm(join(workspace, 'project', '.tyto', 'plugin-files'), { recursive: true });

      await render(brief);

      expect(stderr()).not.toContain('was not loaded');
    },
    SLOW,
  );
});

describe('a plugin-file diagnostic with no range', () => {
  it(
    "prints with no path, not under the brief's name",
    async () => {
      await machineYaml([
        'version: 1',
        'templates:',
        '  aviso:',
        `    source: { git: '${urlOf(join(workspace, 'nowhere'))}', ref: v1 }`,
        '',
      ]);
      const brief = join(workspace, 'aviso.brief');
      await cp(BRIEF, brief);

      await render(brief);

      expect(stderr()).toMatch(/^warning W_PLUGIN_FILE_FETCH /mu);
      // The brief's own problem still prints under its name.
      expect(stderr()).toMatch(/^aviso\.brief:\d+:\d+: error E_UNKNOWN_TEMPLATE /mu);
    },
    SLOW,
  );
});
