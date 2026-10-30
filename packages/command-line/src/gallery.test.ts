import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { launchPluginProcess } from './plugins/plugin-process.js';
import { run } from './program.js';

/**
 * TYTO-503's acceptance: `tyto gallery` against a real plugin file and lock (ADR 0162).
 *
 * As `plugin-files.test.ts` does it, **no network and no fake of one**: the index and every
 * template are `file://` repositories made here with `git init`, so each fetch is the
 * `git fetch --depth 1` a real URL gets. The templates are `examples/plugins/`'s pack under
 * three names, committed with its `dist/` as a release is.
 */

const exec = promisify(execFile);

const EXAMPLE_PACK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ...['..', '..', '..', 'examples', 'plugins', 'tyto-plugin-example-pack'],
);
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

let root: string;
let home: string;
let out: string[];
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: { out: (text) => out.push(text), err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: root,
    home,
    launch: launchPluginProcess,
    rasterizer: () => {
      throw new Error('the gallery never rasterizes');
    },
  };
}

async function git(folder: string, ...args: string[]): Promise<string> {
  return (await exec('git', [...AUTHOR, '-C', folder, ...args])).stdout.trim();
}

async function edit(path: string, change: (text: string) => string): Promise<void> {
  await writeFile(path, change(await readFile(path, 'utf8')), 'utf8');
}

/** The example pack as a repository holding one template, `name`, tagged `v1`. */
async function templateRepository(name: string): Promise<string> {
  const folder = join(root, 'repositories', name);
  await cp(EXAMPLE_PACK, folder, { recursive: true });
  await edit(join(folder, 'tyto-plugin.json'), (text) =>
    text.replace('"example-pack"', `"${name}-pack"`),
  );
  await edit(join(folder, 'dist', 'index.js'), (text) =>
    text.replace("id: 'example-pack'", `id: '${name}-pack'`),
  );
  await rename(join(folder, 'templates', 'aviso'), join(folder, 'templates', name));
  await edit(join(folder, 'templates', name, 'manifest.yaml'), (text) =>
    text.replace(/^name: aviso$/mu, `name: ${name}`),
  );
  await exec('git', ['init', '--quiet', '--initial-branch=main', folder]);
  await git(folder, 'add', '.');
  await git(folder, 'commit', '--quiet', '-m', 'release');
  await git(folder, 'tag', 'v1');
  return pathToFileURL(folder).href;
}

/** A second release, `v2`, of a template repository. */
async function release(name: string): Promise<void> {
  const folder = join(root, 'repositories', name);
  await edit(join(folder, 'templates', name, 'template.html'), (text) =>
    text.replaceAll('#ff5900', '#0057ff'),
  );
  await git(folder, 'commit', '--quiet', '-am', 'blue');
  await git(folder, 'tag', 'v2');
}

function entry(id: string, git: string, latest: string, engine = '>=0.1.0'): string {
  return `  - id: ${id}
    kind: template
    name: ${id}
    description: The ${id} template.
    source: { git: '${git}' }
    latest: ${latest}
    templates: [${id}]
    engine: '${engine}'
    changes: What ${latest} changes.
`;
}

/** The index repository, holding `entries` as its `index.yaml`; answers its URL. */
async function indexRepository(entries: string): Promise<string> {
  const folder = join(root, 'repositories', 'index');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'index.yaml'), `version: 1\nentries:\n${entries}`, 'utf8');
  await exec('git', ['init', '--quiet', '--initial-branch=main', folder]);
  await git(folder, 'add', '.');
  await git(folder, 'commit', '--quiet', '-m', 'index');
  return pathToFileURL(folder).href;
}

const machineFolder = (): string => join(home, 'plugin-files');
const read = (name: string): Promise<string> => readFile(join(machineFolder(), name), 'utf8');

interface Lock {
  readonly sources: readonly { git: string; ref: string; commit: string; plugin: string }[];
}
async function lock(): Promise<Lock> {
  return JSON.parse(await read('plugin-files.lock.json')) as Lock;
}

let urls: Record<'tabela' | 'agenda' | 'concursos', string>;
let index: string;
/** The person's own file, kept by hand: comments, a blank line and an inline source. */
let handFile: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-gallery-cli-'));
  home = join(root, 'home');
  out = [];
  errors = [];
  urls = {
    tabela: await templateRepository('tabela'),
    agenda: await templateRepository('agenda'),
    concursos: await templateRepository('concursos'),
  };
  await release('tabela');
  index = await indexRepository(
    entry('tabela', urls.tabela, 'v2') +
      entry('agenda', urls.agenda, 'v1') +
      entry('concursos', urls.concursos, 'v1'),
  );
  handFile = `# Rafael's templates, pinned by hand.
version: 1
templates:
  tabela:
    source:
      git: '${urls.tabela}'
      ref: v1      # the release we tested


  agenda:
    source: {git: '${urls.agenda}',  ref: v1}
`;
  await mkdir(machineFolder(), { recursive: true });
  await writeFile(join(machineFolder(), 'templates.yaml'), handFile, 'utf8');
  expect(await run(['plugin', 'sync', '--yes'], environment())).toBe(EXIT_OK);
  out = [];
  errors = [];
}, 60_000);

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const gallery = (...args: string[]): Promise<number> =>
  run(['gallery', ...args, '--index', index], environment());

describe('tyto gallery list', () => {
  it('shows update available, installed and not installed, against the real file and lock', async () => {
    expect(await gallery('list')).toBe(EXIT_OK);
    const lines = out
      .join('')
      .split('\n')
      .filter((line) => !line.startsWith('    '));
    const file = join('home', 'plugin-files', 'templates.yaml');
    expect(lines.filter((line) => line !== '')).toEqual([
      `tabela  template  update available  v1 -> v2  ${file}`,
      `agenda  template  installed  v1  ${file}`,
      'concursos  template  not installed  v1',
    ]);
    expect(out.join('')).toContain('    v2: What v2 changes.\n');
    expect(errors.join('')).toBe('');
  });

  it('says where the index comes from when nobody set one', async () => {
    expect(await run(['gallery', 'list'], environment())).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('pass --index <git> or set TYTO_GALLERY_INDEX');
  });
});

describe('tyto gallery install and update', () => {
  it('installs into gallery.yaml and updates in place, leaving a file plugin sync accepts', async () => {
    expect(await gallery('install', 'concursos', '--yes')).toBe(EXIT_OK);
    expect(await read('gallery.yaml')).toBe(
      `version: 1\ntemplates:\n  concursos:\n    source:\n      git: ${urls.concursos}\n      ref: v1\n`,
    );
    expect(await read('templates.yaml')).toBe(handFile);

    expect(await gallery('update', 'tabela', '--yes')).toBe(EXIT_OK);
    // The ref, and only the ref, moved: the comment beside it and the rest stay.
    expect(await read('templates.yaml')).toBe(
      handFile.replace('ref: v1      # the release', 'ref: v2      # the release'),
    );
    expect(errors.join('')).toContain(
      `tabela in ${join('home', 'plugin-files', 'templates.yaml')} was written by hand; moving its ref v1 -> v2`,
    );

    errors = [];
    expect(await run(['plugin', 'sync', '--yes'], environment())).toBe(EXIT_OK);
    expect(errors.join('')).toBe('');
    const pinned = (await lock()).sources.map(({ git: location, ref }) => [location, ref]);
    expect(pinned).toEqual(
      expect.arrayContaining([
        [urls.tabela, 'v2'],
        [urls.agenda, 'v1'],
        [urls.concursos, 'v1'],
      ]),
    );

    out = [];
    expect(await gallery('list')).toBe(EXIT_OK);
    expect(out.join('')).not.toContain('update available');
  }, 60_000);

  it('writes nothing for an entry already in some file, and says where', async () => {
    expect(await gallery('install', 'agenda')).toBe(EXIT_OK);
    expect(out.join('')).toContain('agenda is already in');
    expect(out.join('')).toContain('nothing was written');
    await expect(read('gallery.yaml')).rejects.toThrow();
  });

  it('refuses to move a ref changed by hand since the gallery wrote it, unless forced', async () => {
    expect(await gallery('install', 'concursos', '--yes')).toBe(EXIT_OK);
    const handMoved = (await read('gallery.yaml')).replace('ref: v1', 'ref: main');
    await writeFile(join(machineFolder(), 'gallery.yaml'), handMoved, 'utf8');

    errors = [];
    expect(await gallery('update', 'concursos', '--yes')).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_GALLERY_ENTRY_EDITED');
    expect(errors.join('')).toContain('(v1 is now main)');
    expect(await read('gallery.yaml')).toBe(handMoved);

    expect(await gallery('update', 'concursos', '--yes', '--force')).toBe(EXIT_OK);
    expect(await read('gallery.yaml')).toBe(handMoved.replace('ref: main', 'ref: v1'));
  }, 60_000);

  it('lists an entry that needs a newer plugin API, and refuses to install it', async () => {
    await rm(join(root, 'repositories', 'index'), { recursive: true, force: true });
    index = await indexRepository(entry('concursos', urls.concursos, 'v1', '>=99.0.0'));
    expect(await gallery('list')).toBe(EXIT_OK);
    expect(out.join('')).toContain('concursos  template  needs plugin API >=99.0.0  v1');

    expect(await gallery('install', 'concursos')).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_GALLERY_ENGINE');
    await expect(read('gallery.yaml')).rejects.toThrow();
  });

  it('names an entry the index does not list', async () => {
    expect(await gallery('install', 'nowhere')).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_GALLERY_ENTRY_UNKNOWN');
  });
});
