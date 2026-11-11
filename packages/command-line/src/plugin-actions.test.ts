import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

import { PLUGIN_API_VERSION, type PluginManifest } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { changePluginState, installPlugin } from './plugin-actions.js';
import { permissionPrompt } from './plugin.js';
import { run } from './program.js';

/**
 * The install and state-change steps both apps call (TYTO-373), and the `archive` source.
 *
 * Every archive here is packed at test time with the same `tar` the source unpacks with, so
 * no binary is committed and the fixture is exactly what a person would hand over.
 */

const exec = promisify(execFile);

let scratch: string;
let home: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tyto-plugin-actions-'));
  home = join(scratch, 'home');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

interface PluginOptions {
  readonly name?: string;
  readonly permissions?: readonly string[];
}

/** A plugin folder at `scratch/<relative>`: manifest and code, nothing else. */
async function pluginAt(relative: string, options: PluginOptions = {}): Promise<string> {
  const folder = join(scratch, relative);
  await mkdir(join(folder, 'dist'), { recursive: true });
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: options.name ?? 'texto',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions: options.permissions ?? [],
    }),
  );
  await writeFile(join(folder, 'dist', 'index.js'), 'export function activate() {}\n');
  return folder;
}

/**
 * Packs `scratch/<from>` into `scratch/<archive>`, its contents at the archive's root. Paths
 * stay relative to `scratch`: GNU tar reads `C:\…` as a host named `C`.
 */
async function pack(from: string, archive: string): Promise<string> {
  await exec('tar', ['-czf', archive, '-C', from, '.'], { cwd: scratch });
  return join(scratch, archive);
}

const approveAll = (): Promise<boolean> => Promise.resolve(true);

async function installedFolders(): Promise<readonly string[]> {
  return readdir(join(home, 'plugins')).catch(() => []);
}

describe('installing from a .tgz archive', () => {
  it('unpacks an archive whose root holds the manifest, with no npm', async () => {
    await pluginAt('source');
    const archive = await pack('source', 'texto.tgz');

    const answer = await installPlugin(archive, { home, cwd: scratch, approve: approveAll });

    expect(answer).toMatchObject({ ok: true, value: { status: 'installed', kind: 'archive' } });
    expect((await readdir(join(home, 'plugins', 'texto'))).sort()).toEqual([
      'dist',
      'tyto-plugin.json',
    ]);
  }, 30_000);

  it('finds the manifest one folder down, as npm pack and git hosts nest it', async () => {
    await pluginAt(join('wrapped', 'package'));
    const archive = await pack('wrapped', 'texto.tar.gz');

    const answer = await installPlugin(archive, { home, cwd: scratch, approve: approveAll });

    expect(answer).toMatchObject({ ok: true, value: { status: 'installed', kind: 'archive' } });
    expect(await installedFolders()).toEqual(['texto']);
  }, 30_000);

  it('is what tyto plugin install does with a relative .tgz path', async () => {
    await pluginAt('source');
    await pack('source', 'texto.tgz');
    const out: string[] = [];
    const environment: CliEnvironment = {
      console: { out: (text) => out.push(text), err: () => undefined },
      version: '0.0.0-test',
      cwd: scratch,
      home,
      rasterizer: () => {
        throw new Error('nothing here rasters');
      },
    };

    expect(await run(['plugin', 'install', 'texto.tgz', '--yes'], environment)).toBe(EXIT_OK);
    expect(out.join('')).toBe('Installed texto 1.0.0.\n');
  }, 30_000);

  it('refuses an archive with no manifest, and installs nothing', async () => {
    await mkdir(join(scratch, 'empty'));
    await writeFile(join(scratch, 'empty', 'README.txt'), 'no plugin here\n');
    const archive = await pack('empty', 'empty.tgz');

    const answer = await installPlugin(archive, { home, cwd: scratch, approve: approveAll });

    expect(answer.ok).toBe(false);
    expect(JSON.stringify(answer)).toContain('E_PLUGIN_FETCH');
    expect(JSON.stringify(answer)).toContain('it has no tyto-plugin.json');
    expect(await installedFolders()).toEqual([]);
  }, 30_000);

  it('refuses an archive holding two plugins side by side rather than pick one', async () => {
    await pluginAt(join('two', 'a'), { name: 'alpha' });
    await pluginAt(join('two', 'b'), { name: 'beta' });
    const archive = await pack('two', 'two.tgz');

    const answer = await installPlugin(archive, { home, cwd: scratch, approve: approveAll });

    expect(answer.ok).toBe(false);
    expect(JSON.stringify(answer)).toContain('more than one tyto-plugin.json');
    expect(await installedFolders()).toEqual([]);
  }, 30_000);
});

/** One ustar entry: a 512-byte header, then the body padded to 512. `type` 0 file, 2 symlink. */
function tarEntry(name: string, body: string, type: '0' | '2' = '0', link = ''): Buffer {
  const header = Buffer.alloc(512);
  const data = Buffer.from(type === '0' ? body : '');
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write(type, 156);
  header.write(link, 157, 100, 'utf8');
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

/**
 * An archive a hostile author wrote by hand, as no `tar -c` would (TYTO-373): written byte by
 * byte, so the entries are exactly the attack and not what this machine's `tar` would pack.
 */
async function hostileArchive(entries: readonly Buffer[]): Promise<string> {
  const manifest = tarEntry(
    'tyto-plugin.json',
    JSON.stringify({
      name: 'texto',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions: [],
    }),
  );
  const archive = join(scratch, 'hostile.tgz');
  await writeFile(archive, gzipSync(Buffer.concat([manifest, ...entries, Buffer.alloc(1024)])));
  return archive;
}

describe('an archive that tries to write outside the folder it is unpacked into', () => {
  // The unpack folder is `<tmp>/tyto-plugin-*/extracted`, so `<tmp>` is pointed at a folder of
  // this test's: anything that lands in it survives the fetch's cleanup and is an escape.
  let tmp: string;
  const saved: Record<string, string | undefined> = {};
  const VARIABLES = ['TMPDIR', 'TMP', 'TEMP'] as const;

  beforeEach(async () => {
    tmp = join(scratch, 'tmp');
    await mkdir(tmp);
    for (const name of VARIABLES) {
      saved[name] = process.env[name];
      process.env[name] = tmp;
    }
  });

  afterEach(() => {
    for (const name of VARIABLES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('writes nothing for a ../ entry, and installs nothing', async () => {
    const archive = await hostileArchive([tarEntry('../../escaped.txt', 'out')]);

    const answer = await installPlugin(archive, { home, cwd: scratch, approve: approveAll });

    expect(await readdir(tmp)).toEqual([]);
    expect(answer.ok).toBe(false);
    expect(await installedFolders()).toEqual([]);
  }, 30_000);

  it('writes nothing through a symlink an earlier entry planted', async () => {
    const archive = await hostileArchive([
      tarEntry('link', '', '2', '../..'),
      tarEntry('link/through-the-link.txt', 'out'),
    ]);

    await installPlugin(archive, { home, cwd: scratch, approve: approveAll });

    expect(await readdir(tmp)).toEqual([]);
  }, 30_000);
});

describe('what installPlugin refuses', () => {
  it('installs nothing when the person declines', async () => {
    const folder = await pluginAt('source', { permissions: ['net:api.example.com'] });
    const shown: { manifest: PluginManifest; source: string }[] = [];

    const answer = await installPlugin(folder, {
      home,
      cwd: scratch,
      approve: (manifest, source) => {
        shown.push({ manifest, source });
        return Promise.resolve(false);
      },
    });

    expect(answer).toMatchObject({ ok: true, value: { status: 'declined', kind: 'folder' } });
    expect(shown.map((item) => item.manifest.permissions)).toEqual([['net:api.example.com']]);
    expect(shown[0]?.source).toBe(folder);
    expect(await installedFolders()).toEqual([]);
  });

  it('installs nothing when the approval box is dismissed and answers no boolean', async () => {
    const folder = await pluginAt('source');

    const answer = await installPlugin(folder, {
      home,
      cwd: scratch,
      // A box closed with Escape: the promise resolves, with nothing.
      approve: () => Promise.resolve(undefined as unknown as boolean),
    });

    expect(answer).toMatchObject({ ok: true, value: { status: 'declined' } });
    expect(await installedFolders()).toEqual([]);
  });

  it('refuses the name of a built-in without asking', async () => {
    const folder = await pluginAt('source', { name: 'svg' });
    let asked = false;

    const answer = await installPlugin(folder, {
      home,
      cwd: scratch,
      approve: () => {
        asked = true;
        return Promise.resolve(true);
      },
    });

    expect(answer.ok).toBe(false);
    expect(JSON.stringify(answer)).toContain('E_PLUGIN_NAME_TAKEN');
    expect(asked).toBe(false);
    expect(await installedFolders()).toEqual([]);
  });

  it('records exactly the permissions that were shown', async () => {
    const folder = await pluginAt('source', { permissions: ['workspace:read'] });

    await installPlugin(folder, { home, cwd: scratch, approve: approveAll });

    expect(JSON.parse(await readFile(join(home, 'plugins.json'), 'utf8'))).toMatchObject({
      plugins: { texto: { enabled: true, permissions: ['workspace:read'], source: folder } },
    });
  });
});

describe('changePluginState', () => {
  it('disables, enables and removes, answering what it did', async () => {
    await installPlugin(await pluginAt('source'), { home, cwd: scratch, approve: approveAll });
    const state = async (): Promise<unknown> =>
      JSON.parse(await readFile(join(home, 'plugins.json'), 'utf8'));

    expect(await changePluginState('disable', 'texto', { home })).toEqual({
      ok: true,
      value: { change: 'disable', name: 'texto' },
      diagnostics: [],
    });
    expect(await state()).toMatchObject({ plugins: { texto: { enabled: false } } });

    expect((await changePluginState('enable', 'texto', { home })).ok).toBe(true);
    expect(await state()).toMatchObject({ plugins: { texto: { enabled: true } } });

    expect((await changePluginState('remove', 'texto', { home })).ok).toBe(true);
    expect(await state()).toEqual({ plugins: {} });
    expect(await installedFolders()).toEqual([]);
  });

  it('refuses a plugin that is not installed', async () => {
    const answer = await changePluginState('enable', 'texto', { home });

    expect(answer.ok).toBe(false);
    expect(JSON.stringify(answer)).toContain('E_PLUGIN_NOT_INSTALLED');
  });
});

describe('the permission prompt', () => {
  const manifest = (permissions: readonly string[]): PluginManifest =>
    ({
      name: 'texto',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions,
    }) as PluginManifest;

  it('says what workspace:read and workspace:write reach, and only when asked', () => {
    expect(permissionPrompt(manifest(['workspace:read', 'workspace:write']), 'x')).toContain(
      'workspace: permissions let Tyto read and write files for it in the folder open in Tyto:\n' +
        'never outside that folder or inside its .tyto/, and nothing while it is restricted.\n',
    );
    expect(permissionPrompt(manifest(['workspace:write']), 'x')).toContain(
      'let Tyto write files for it',
    );
    expect(permissionPrompt(manifest(['net:api.example.com']), 'x')).not.toContain(
      'workspace: permissions',
    );
  });

  it('names each program a process: permission starts, and only when asked (ADR 0182)', () => {
    const prompt = permissionPrompt(manifest(['net:api.example.com', 'process:claude']), 'x');
    expect(prompt).toContain(
      '  - net:api.example.com\n  - process:claude: start the program claude on your computer\n',
    );
    expect(prompt).toContain(
      'It may ask Tyto to start `claude`, found on your PATH, in the folder open in Tyto,\n' +
        'and never while that folder is restricted. Tyto starts no other program for it.\n' +
        'That program runs with your rights and is not confined to the folder.\n' +
        'That program can also reach the Tyto window as an agent while Tyto lets agents connect\n' +
        '(setting `agentsListen`): it reads what is open there, and its edits arrive as proposals\n' +
        'you approve or reject.\n' +
        'The plugin may also open a terminal tab in Tyto running that program, for you to type\n' +
        'into (to sign in, say); you see the tab and can close it.\n',
    );
    expect(permissionPrompt(manifest(['net:api.example.com']), 'x')).not.toContain('process:');
    expect(permissionPrompt(manifest(['net:api.example.com']), 'x')).not.toContain(
      'It may ask Tyto to start',
    );
    // The window sentence comes with a program, never alone (ADR 0183).
    expect(permissionPrompt(manifest(['net:api.example.com']), 'x')).not.toContain('Tyto window');
  });

  it('says in words what window:tools lets the plugin do, and only when asked (ADR 0190)', () => {
    expect(permissionPrompt(manifest(['net:api.example.com', 'window:tools']), 'x')).toContain(
      '  - net:api.example.com\n' +
        "  - window:tools: use Tyto's tools in the open window: read what is open there and propose\n" +
        '    edits you accept or reject, while Tyto lets agents connect (setting `agentsListen`)\n',
    );
    expect(permissionPrompt(manifest(['process:claude']), 'x')).not.toContain('window:tools');
  });

  it('names every program, joined by "or", when a plugin declares several', () => {
    expect(permissionPrompt(manifest(['process:claude', 'process:codex']), 'x')).toContain(
      'It may ask Tyto to start `claude` or `codex`, found on your PATH, in the folder open in Tyto,\n' +
        'and never while that folder is restricted. Tyto starts no other program for it.\n' +
        'Those programs run with your rights and are not confined to the folder.\n' +
        'Those programs can also reach the Tyto window as agents while Tyto lets agents connect\n' +
        '(setting `agentsListen`): they read what is open there, and their edits arrive as proposals\n' +
        'you approve or reject.\n' +
        'The plugin may also open a terminal tab in Tyto running one of those programs, for you to\n' +
        'type into (to sign in, say); you see the tab and can close it.\n',
    );
  });

  it("says a plugin's own program is its own code, and what holds it (ADR 0184)", () => {
    const prompt = permissionPrompt(
      {
        ...manifest(['process:claude-agent-acp', 'process:codex']),
        programs: { 'claude-agent-acp': 'adapter/claude-agent-acp.mjs' },
      },
      'x',
    );
    expect(prompt).toContain(
      "  - process:claude-agent-acp: run this plugin's own program claude-agent-acp " +
        "(adapter/claude-agent-acp.mjs) on Tyto's Node\n" +
        '  - process:codex: start the program codex on your computer\n',
    );
    expect(prompt).toContain(
      'It may ask Tyto to start `codex`, found on your PATH, in the folder open in Tyto,\n' +
        'and never while that folder is restricted. Tyto starts no other program for it.\n' +
        "`claude-agent-acp` is the plugin's own code, a script that came with it.\n" +
        'Tyto runs it on the Node it ships with, in the folder open in Tyto, and never while that\n' +
        "folder is restricted. Unlike the plugin's process, it is not confined: it can read and\n" +
        'change your files and reach the network, as any program you run can. Tyto runs it only\n' +
        "from the plugin's folder, passes it no API key or token from its own environment, and runs\n" +
        "at most 2 of the plugin's programs at once.\n" +
        'Those programs run with your rights and are not confined to the folder.\n',
    );
    // Only its own programs: nothing says "found on your PATH" for a plugin with none there.
    const ownOnly = permissionPrompt(
      {
        ...manifest(['process:claude-agent-acp']),
        programs: { 'claude-agent-acp': 'adapter/claude-agent-acp.mjs' },
      },
      'x',
    );
    expect(ownOnly).not.toContain('found on your PATH');
    expect(ownOnly).toContain("`claude-agent-acp` is the plugin's own code");
  });
});
