import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { BUILT_IN_TEMPLATE_NAMES } from '@tyto/templates';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { launchPluginProcess } from './plugins/plugin-process.js';
import { run } from './program.js';
import type { ListedTemplate } from './template-list.js';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * `tyto template list` (TYTO-728): what it prints is what `tyto render` in the same folder
 * accepts, because both read `templatesInReach`. One fixture holds every origin — the built-in
 * pack, the folder's own `templates/cartaz`, and the example pack fetched through the project's
 * plugin files with an alias over it — and every name the list prints is rendered, as is every
 * name it leaves out. No network: the pack is a `file://` repository, as `plugin-files.test.ts`
 * fetches it.
 */

const exec = promisify(execFile);

const EXAMPLE_PACK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ...['..', '..', '..', 'examples', 'plugins', 'tyto-plugin-example-pack'],
);
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

let scratch: string;
let project: string;
let home: string;
let out: string[];
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: { out: (text) => out.push(text), err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: project,
    home,
    launch: launchPluginProcess,
    rasterizer: () => {
      throw new Error('these renders are svg and never raster');
    },
  };
}

const stderr = (): string => errors.join('');

async function git(folder: string, ...args: string[]): Promise<void> {
  await exec('git', [...AUTHOR, '-C', folder, ...args]);
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tyto-template-list-'));
  project = join(scratch, 'project');
  home = join(scratch, 'home', '.tyto');
  out = [];
  errors = [];
  await mkdir(home, { recursive: true });

  const pack = join(scratch, 'repositories', 'pack');
  await cp(EXAMPLE_PACK, pack, { recursive: true });
  await exec('git', ['init', '--quiet', '--initial-branch=main', pack]);
  await git(pack, 'add', '.');
  await git(pack, 'commit', '--quiet', '-m', 'release');

  const cartaz = join(project, 'templates', 'cartaz');
  await mkdir(cartaz, { recursive: true });
  await writeFile(join(cartaz, 'manifest.yaml'), manifestSource);
  await writeFile(join(cartaz, 'template.html'), templateMarkup);
  await mkdir(join(project, '.tyto', 'plugin-files'), { recursive: true });
  await writeFile(join(project, '.tyto', 'project.json'), '{}\n', 'utf8');
  await writeFile(
    join(project, '.tyto', 'plugin-files', 'aviso.yaml'),
    [
      'version: 1',
      'templates:',
      '  aviso:',
      `    source: { git: '${pathToFileURL(pack).href}', ref: main }`,
      '    configurations:',
      '      laranja:',
      '        values:',
      "          paper: '#ffffff'",
      '',
    ].join('\n'),
    'utf8',
  );
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

// Git and a plugin's process per run: past Vitest's 5 s default.
const SLOW = 120_000;

async function list(...flags: string[]): Promise<readonly ListedTemplate[]> {
  out = [];
  errors = [];
  const code = await run(['template', 'list', '--json', ...flags], environment());
  expect(code, stderr()).toBe(EXIT_OK);
  return (JSON.parse(out.join('')) as { templates: ListedTemplate[] }).templates;
}

/** Whether a render of a brief naming `template` found it: its stage may fail, its lookup not. */
async function renderFinds(template: string, ...flags: string[]): Promise<boolean> {
  errors = [];
  const brief = join(project, `${template}.brief`);
  await writeFile(brief, `---\ntemplate: ${template}\n---\n`, 'utf8');
  await run(['render', brief, '--out', 'out', '--types', 'svg', ...flags], environment());
  return !stderr().includes('E_UNKNOWN_TEMPLATE');
}

describe('tyto template list', () => {
  it(
    'prints every origin, and each name it prints is one a render there finds',
    async () => {
      const listed = await list('--trust');

      expect(listed.find((row) => row.name === 'cartaz')).toMatchObject({ origin: 'workspace' });
      expect(listed.find((row) => row.name === 'aviso')).toMatchObject({
        origin: 'plugin',
        plugin: 'example-pack',
      });
      expect(listed.find((row) => row.name === 'aviso-laranja')).toMatchObject({
        origin: 'plugin',
        aliasOf: 'aviso',
      });
      const builtIns = listed.filter((row) => row.origin === 'built-in').map((row) => row.name);
      expect(builtIns.sort()).toEqual([...BUILT_IN_TEMPLATE_NAMES].sort());

      for (const row of listed) {
        expect(await renderFinds(row.name, '--trust'), `${row.name}: ${stderr()}`).toBe(true);
      }
      // The control: a name nobody has is one the render does not find, so the check can fail.
      expect(await renderFinds('nenhum', '--trust')).toBe(false);
    },
    SLOW,
  );

  it(
    'lists, in a restricted folder, only what a restricted render finds, and says what it left out',
    async () => {
      const trusted = await list('--trust');
      const restricted = await list();
      expect(stderr()).toMatch(/plugin-files was not listed: this folder is restricted/u);

      const names = new Set(restricted.map((row) => row.name));
      const leftOut = trusted.filter((row) => !names.has(row.name)).map((row) => row.name);
      expect(leftOut.sort()).toEqual(['aviso', 'aviso-laranja']);

      for (const name of leftOut) {
        expect(await renderFinds(name), name).toBe(false);
      }
      for (const name of names) {
        expect(await renderFinds(name), `${name}: ${stderr()}`).toBe(true);
      }
    },
    SLOW,
  );

  // TYTO-729: what the window's completion asks, so a keystroke never reaches the network.
  it(
    'fetches nothing with --no-sync, says what it left out, and lists the copy once one is fetched',
    async () => {
      const fetched = join(home, 'cache', 'plugin-files');

      const before = await list('--trust', '--no-sync');
      expect(before.map((row) => row.name)).not.toContain('aviso');
      expect(stderr()).toContain(
        'it has not been fetched yet, and tyto template list --no-sync never fetches',
      );
      expect(existsSync(fetched)).toBe(false);

      // The typed listing still fetches, as before.
      const typed = await list('--trust');
      expect(typed.map((row) => row.name)).toContain('aviso');
      expect(existsSync(fetched)).toBe(true);

      // And then the copy on this computer counts without fetching.
      const after = await list('--trust', '--no-sync');
      expect(after.map((row) => row.name)).toEqual(typed.map((row) => row.name));
    },
    SLOW,
  );

  it(
    'prints a column each for the name, the origin and the formats',
    async () => {
      out = [];
      const code = await run(['template', 'list', '--trust'], environment());
      expect(code, stderr()).toBe(EXIT_OK);
      const lines = out.join('').split('\n');
      expect(lines.find((line) => line.startsWith('cartaz '))).toMatch(/^cartaz +workspace +\S/u);
      expect(lines.find((line) => line.startsWith('aviso-laranja'))).toMatch(
        /^aviso-laranja → aviso +plugin example-pack +\S/u,
      );
    },
    SLOW,
  );
});
