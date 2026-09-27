import { exec as execCommand, execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { parseRenderResult } from '@tyto/io';
import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';

import briefSource from './__fixtures__/cartaz.brief?raw';
import formatsSource from './__fixtures__/formats.yaml?raw';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import markSource from './__fixtures__/mark.svg?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * `tyto plugin install|remove|disable|enable` and a render that uses what was installed —
 * the acceptance criteria of TYTO-47, one `describe` each, against a real temp disk.
 *
 * **No network, and no fake of one.** A git URL is a `file://` repository this file makes
 * with `git init`, and an npm name is a tarball this file makes with `npm pack`: both go
 * through exactly the `git clone` and `npm pack` a real URL and a real name would, which is
 * the point — a fake fetcher would test that a fake fetcher works.
 *
 * The fixture plugin is plain ESM written here rather than a package in the repo, because
 * it is a third party's code and must not be something the build compiles.
 */

const exec = promisify(execFile);
// `npm` is `npm.cmd` on Windows, which only a shell starts.
const execInShell = promisify(execCommand);

/** A real 1×1 PNG: the fixture brief draws `./logo.png`, and a render needs its bytes. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let workspace: string;
let home: string;
let out: string[];
let errors: string[];

function environment(overrides: Partial<CliEnvironment> = {}): CliEnvironment {
  return {
    console: {
      out: (text) => out.push(text),
      err: (text) => errors.push(text),
    },
    version: '0.0.0-test',
    cwd: workspace,
    home,
    rasterizer: () => {
      throw new Error('nothing here rasters');
    },
    ...overrides,
  };
}

const stdout = (): string => out.join('');
const stderr = (): string => errors.join('');

/** The exporter `activate` of a fixture plugin: every frame becomes one line of text. */
function exporterSource(id: string, kinds: readonly string[]): string {
  return `export function activate(host) {
  host.registerExporter({
    id: ${JSON.stringify(id)},
    mime: 'text/plain',
    extension: 'txt',
    kinds: ${JSON.stringify(kinds)},
    rasterized: false,
    exportFrame: (scene, artwork, frame) => ({
      ok: true,
      value: artwork.id + ' ' + frame.format,
      diagnostics: [],
    }),
  });
}
`;
}

interface FixtureOptions {
  readonly name?: string;
  readonly engine?: string;
  readonly exporterId?: string;
  readonly kinds?: readonly string[];
  readonly permissions?: readonly string[];
}

/** A plugin folder on disk: manifest, code, and a package.json so npm can pack it. */
async function pluginFolder(options: FixtureOptions = {}): Promise<string> {
  const name = options.name ?? 'texto';
  const folder = join(workspace, 'sources', name);
  await mkdir(join(folder, 'dist'), { recursive: true });
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: options.engine ?? `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions: options.permissions ?? [],
    }),
  );
  await writeFile(
    join(folder, 'dist', 'index.js'),
    exporterSource(options.exporterId ?? name, options.kinds ?? ['txt']),
  );
  await writeFile(
    join(folder, 'package.json'),
    JSON.stringify({ name: `tyto-plugin-${name}`, version: '1.0.0', type: 'module' }),
  );
  return folder;
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-plugins-'));
  home = join(workspace, 'home', '.tyto');
  out = [];
  errors = [];

  const template = join(workspace, 'templates', 'cartaz');
  await mkdir(join(template, 'assets'), { recursive: true });
  await writeFile(join(template, 'manifest.yaml'), manifestSource);
  await writeFile(join(template, 'template.html'), templateMarkup);
  await writeFile(join(template, 'assets', 'mark.svg'), markSource);
  await writeFile(join(workspace, 'formats.yaml'), formatsSource);
  await mkdir(join(workspace, 'task', 'assets'), { recursive: true });
  await writeFile(join(workspace, 'task', 'brief.brief'), briefSource);
  await writeFile(join(workspace, 'task', 'assets', 'logo.png'), LOGO_PNG);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function listed(...flags: string[]): Promise<readonly { name: string; status: string }[]> {
  out = [];
  expect(await run(['plugin', 'list', '--json', ...flags], environment())).toBe(EXIT_OK);
  return (JSON.parse(stdout()) as { plugins: { name: string; status: string }[] }).plugins;
}

/* ------------------------------------------------------------------------ install -- */

describe('installing from each of the three sources', () => {
  it('installs a local folder and lists it as external and enabled', async () => {
    const code = await run(['plugin', 'install', await pluginFolder(), '--yes'], environment());

    expect(code, stderr()).toBe(EXIT_OK);
    expect(stdout()).toBe('Installed texto 1.0.0.\n');
    expect((await listed()).at(-1)).toMatchObject({ name: 'texto', status: 'enabled' });
    expect(await readdir(join(home, 'plugins', 'texto'))).toContain('tyto-plugin.json');
  });

  it('installs from a git URL, cloning it with git', async () => {
    const folder = await pluginFolder();
    const git = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];
    await exec('git', ['init', '--quiet', folder]);
    await exec('git', ['-C', folder, 'add', '.']);
    await exec('git', [...git, '-C', folder, 'commit', '--quiet', '-m', 'plugin']);
    // Renamed to end in `.git`, which is how install tells a repository from an npm name.
    const repository = `${folder}.git`;
    await exec('git', ['clone', '--quiet', '--bare', folder, repository]);

    const code = await run(
      ['plugin', 'install', pathToFileURL(repository).href, '--yes'],
      environment(),
    );

    expect(code, stderr()).toBe(EXIT_OK);
    // The checkout's history stays behind: nothing loads it.
    expect((await readdir(join(home, 'plugins', 'texto'))).sort()).toEqual([
      'dist',
      'package.json',
      'tyto-plugin.json',
    ]);
  });

  it('installs an npm spec, fetching it with npm pack', async () => {
    // A tarball is an npm spec like a name is; `npm pack` resolves both the same way, and
    // this one needs no registry.
    const folder = await pluginFolder();
    const packed = join(workspace, 'packed');
    await mkdir(packed);
    await execInShell(`npm pack "${folder}" --pack-destination "${packed}" --silent`);
    const [tarball] = await readdir(packed);

    const code = await run(
      ['plugin', 'install', join('packed', tarball ?? 'missing.tgz'), '--yes'],
      environment(),
    );

    expect(code, stderr()).toBe(EXIT_OK);
    expect((await listed()).at(-1)).toMatchObject({ name: 'texto', status: 'enabled' });
  }, 60_000);
});

describe('what install refuses', () => {
  it('refuses an incompatible engine, naming both versions, and copies nothing', async () => {
    const folder = await pluginFolder({ engine: '>=99' });

    const code = await run(['plugin', 'install', folder, '--yes'], environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain(
      `Plugin 'texto' needs plugin API >=99, and this Tyto provides plugin API ${PLUGIN_API_VERSION}.`,
    );
    await expect(readdir(join(home, 'plugins'))).rejects.toThrow();
  });

  it('refuses the name of a built-in', async () => {
    const code = await run(
      ['plugin', 'install', await pluginFolder({ name: 'svg' }), '--yes'],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain("A plugin named 'svg' is already here (built-in).");
  });

  it('shows the permissions, says they are not enforced, and asks', async () => {
    const questions: string[] = [];
    const code = await run(
      ['plugin', 'install', await pluginFolder({ permissions: ['net:api.example.com'] })],
      environment({
        confirm: (question) => {
          questions.push(question);
          return Promise.resolve(false);
        },
      }),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(questions).toEqual(['Install it? [y/N] ']);
    expect(stderr()).toContain('  - net:api.example.com\n');
    expect(stderr()).toContain('recorded and shown, and not yet enforced');
    expect(stderr()).toContain('Not installed.');
  });

  it('refuses to guess when nobody can answer and --yes was not given', async () => {
    const code = await run(['plugin', 'install', await pluginFolder()], environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain('run again with --yes');
  });

  it('records exactly the permissions that were approved', async () => {
    await run(
      ['plugin', 'install', await pluginFolder({ permissions: ['net:api.example.com'] }), '--yes'],
      environment(),
    );

    expect(JSON.parse(await readFile(join(home, 'plugins.json'), 'utf8'))).toMatchObject({
      plugins: { texto: { enabled: true, permissions: ['net:api.example.com'] } },
    });
  });
});

/* ------------------------------------------------------------- disable and remove -- */

describe('disable, enable and remove', () => {
  it('keeps a disabled plugin in the list and out of --active', async () => {
    await run(['plugin', 'install', await pluginFolder(), '--yes'], environment());

    expect(await run(['plugin', 'disable', 'texto'], environment())).toBe(EXIT_OK);

    expect((await listed()).at(-1)).toMatchObject({ name: 'texto', status: 'disabled' });
    expect((await listed('--active')).map((plugin) => plugin.name)).not.toContain('texto');

    expect(await run(['plugin', 'enable', 'texto'], environment())).toBe(EXIT_OK);
    expect((await listed('--active')).map((plugin) => plugin.name)).toContain('texto');
  });

  it('removes the folder and the approval together', async () => {
    await run(['plugin', 'install', await pluginFolder(), '--yes'], environment());

    expect(await run(['plugin', 'remove', 'texto'], environment())).toBe(EXIT_OK);

    expect((await listed()).map((plugin) => plugin.name)).not.toContain('texto');
    expect(JSON.parse(await readFile(join(home, 'plugins.json'), 'utf8'))).toEqual({ plugins: {} });
  });

  it('refuses to change a plugin that is not installed', async () => {
    expect(await run(['plugin', 'disable', 'svg'], environment())).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain("No installed plugin is named 'svg'.");
  });
});

/* ------------------------------------------------------------------ a render uses it -- */

const renderArguments = (types: string): string[] => [
  'render',
  'task/brief.brief',
  '--out',
  'task/out',
  '--types',
  types,
];

describe('an installed exporter at render', () => {
  it('produces a kind Tyto did not ship, and result.json names its mime', async () => {
    await run(['plugin', 'install', await pluginFolder(), '--yes'], environment());

    const code = await run(renderArguments('txt'), environment());

    expect(code, stderr()).toBe(EXIT_OK);
    const result = parseRenderResult(
      JSON.parse(await readFile(join(workspace, 'task', 'out', 'result.json'), 'utf8')),
    );
    if (!result.ok) throw new Error(result.error.join('; '));
    expect(result.value.artifacts.map((artifact) => [artifact.name, artifact.mime])).toEqual([
      ['slide-1-feed.txt', 'text/plain'],
      ['slide-2-feed.txt', 'text/plain'],
    ]);
    expect(await readFile(join(workspace, 'task', 'out', 'slide-1-feed.txt'), 'utf8')).toBe(
      'slide-1 feed',
    );
  });

  it('is not activated once disabled, so its kind cannot be asked for', async () => {
    await run(['plugin', 'install', await pluginFolder(), '--yes'], environment());
    await run(['plugin', 'disable', 'texto'], environment());

    const code = await run(renderArguments('txt'), environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain(
      "'txt' is not an output type any installed exporter produces. Available: png, jpeg, webp, svg.",
    );
  });

  it('refuses a plugin whose id collides, by name, and the run renders without it', async () => {
    // `vetor` registers an exporter called `svg`, which the built-in already holds.
    await run(
      [
        'plugin',
        'install',
        await pluginFolder({ name: 'vetor', exporterId: 'svg', kinds: ['svg'] }),
        '--yes',
      ],
      environment(),
    );

    const code = await run(renderArguments('svg'), environment());

    expect(code, stderr()).toBe(EXIT_OK);
    const result = JSON.parse(
      await readFile(join(workspace, 'task', 'out', 'result.json'), 'utf8'),
    ) as { status: string; diagnostics: { code: string; message: string }[] };
    expect(result.status).toBe('ok');
    expect(result.diagnostics.filter((item) => item.code === 'W_PLUGIN_SKIPPED')).toEqual([
      expect.objectContaining({
        message:
          "Plugin 'vetor' was skipped: Plugin 'vetor' was refused: extension point 'exporter' " +
          "already has 'svg', registered by plugin 'svg'.",
      }),
    ]);
    // Tyto's own exporter drew these; the impostor's would have written text.
    expect(await readFile(join(workspace, 'task', 'out', 'slide-1-feed.svg'), 'utf8')).toMatch(
      /^<svg/u,
    );
  });
});
