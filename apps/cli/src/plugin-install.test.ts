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

/**
 * The exporter `activate` of a fixture plugin: every frame becomes one line of text.
 *
 * `crashes` makes every frame end the plugin's process instead — `process.exit` inside it
 * ends that process and nothing else, which is the kill the acceptance test needs.
 */
function exporterSource(
  id: string,
  kinds: readonly string[],
  rasterized = false,
  crashes = false,
): string {
  const body = crashes
    ? 'process.exit(7)'
    : `({ ok: true, value: artwork.id + ' ' + frame.format, diagnostics: [] })`;
  return `export function activate(host) {
  host.registerExporter({
    id: ${JSON.stringify(id)},
    mime: 'text/plain',
    extension: 'txt',
    kinds: ${JSON.stringify(kinds)},
    rasterized: ${String(rasterized)},
    exportFrame: (scene, artwork, frame) => ${body},
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
  readonly rasterized?: boolean;
  readonly crashes?: boolean;
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
    exporterSource(
      options.exporterId ?? name,
      options.kinds ?? ['txt'],
      options.rasterized,
      options.crashes,
    ),
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

  // Four git processes: measured at 5.3 s under a full `pnpm check`, past Vitest's 5 s default.
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
  }, 60_000);

  it('installs an npm spec, fetching it with npm pack', async () => {
    // A tarball is an npm spec like a name is; `npm pack` resolves both the same way, and
    // this one needs no registry.
    const folder = await pluginFolder();
    const packed = join(workspace, 'packed');
    await mkdir(packed);
    await execInShell(`npm pack "${folder}" --pack-destination "${packed}" --silent`);
    const [tarball] = await readdir(packed);

    // Relative, with a forward slash and no `./`: what a person types, and what npm on its
    // own reads as a GitHub `user/repo` shorthand rather than as a file.
    const code = await run(
      ['plugin', 'install', `packed/${tarball ?? 'missing.tgz'}`, '--yes'],
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

  it('shows the permissions, says what the process is confined to, and asks', async () => {
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
    expect(stderr()).toContain("confines that process to the plugin's own folder");
    expect(stderr()).toContain('It is not confined on the\nnetwork');
    expect(stderr()).toContain('net: permissions filter host.fetch only');
    expect(stderr()).toContain('Not installed.');
  });

  it('says what a font: permission sends, and only for a plugin that asks for one', async () => {
    const answer = (): Partial<CliEnvironment> => ({ confirm: () => Promise.resolve(false) });

    await run(
      ['plugin', 'install', await pluginFolder({ permissions: ['font:CircularXX'] })],
      environment(answer()),
    );
    expect(stderr()).toContain('  - font:CircularXX\n');
    expect(stderr()).toContain(
      'font: permissions send its code templates the files of CircularXX as\n' +
        'installed on this computer, which may be licensed to you and not to its author.\n',
    );

    errors.length = 0;
    await run(['plugin', 'install', await pluginFolder()], environment(answer()));
    expect(stderr()).not.toContain('font: permissions');
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
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
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
  }, 60_000);

  it('is not activated once disabled, so its kind cannot be asked for', async () => {
    await run(['plugin', 'install', await pluginFolder(), '--yes'], environment());
    await run(['plugin', 'disable', 'texto'], environment());

    const code = await run(renderArguments('txt'), environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain(
      "'txt' is not an output type any installed exporter produces. Available: png, jpeg, webp, svg.",
    );
  });

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('refuses a rasterized exporter for a kind no rasterizer encodes, naming the plugin', async () => {
    // The third party's mistake used to reach `runJob` and come out as exit 2, an internal
    // failure. It is refused at activation instead, and the refused `--types` says why.
    await run(
      [
        'plugin',
        'install',
        await pluginFolder({ name: 'gifs', kinds: ['gif'], rasterized: true }),
        '--yes',
      ],
      environment(),
    );

    const code = await run(renderArguments('gif'), environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain(
      "Plugin 'gifs' registers exporter 'gifs' as rasterized for 'gif', and a rasterizer " +
        'encodes only png, jpeg and webp.',
    );
    expect(stderr()).toContain("'gif' is not an output type any installed exporter produces.");
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
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
  }, 60_000);
});

describe('a plugin whose process is killed mid-render', () => {
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('fails its own frames, renders the rest, and is listed as crashed until enabled', async () => {
    await run(['plugin', 'install', await pluginFolder({ crashes: true }), '--yes'], environment());

    const code = await run(renderArguments('txt,svg'), environment());

    // Exit 1: the txt frames failed, as data. The command itself finished, and Tyto's own
    // exporter drew every svg frame after the plugin's process was gone.
    expect(code, stderr()).toBe(EXIT_DIAGNOSTICS);
    const result = JSON.parse(
      await readFile(join(workspace, 'task', 'out', 'result.json'), 'utf8'),
    ) as { artifacts: { name: string }[]; diagnostics: { code: string; message: string }[] };
    expect(result.artifacts.map((artifact) => artifact.name)).toEqual([
      'slide-1-feed.svg',
      'slide-2-feed.svg',
    ]);
    expect(new Set(result.diagnostics.map((item) => item.message))).toEqual(
      new Set(["Plugin 'texto' stopped running: its process exited with code 7."]),
    );

    // Written beside plugins.json and not into it: an older CLI or desktop reading
    // plugins.json must see exactly what it would have written itself (ADR 0041).
    const state = await readFile(join(home, 'plugins.json'), 'utf8');
    expect(state).not.toContain('crash');
    const history = JSON.parse(await readFile(join(home, 'crashes.json'), 'utf8')) as {
      crashes: Record<string, { reason: string }>;
    };
    expect(history.crashes['texto']?.reason).toBe('its process exited with code 7');

    errors = [];
    const plugins = await listed();
    expect(plugins.at(-1)).toMatchObject({
      name: 'texto',
      status: 'crashed',
      crashed: { reason: 'its process exited with code 7' },
    });
    expect(stderr()).toMatch(
      /Plugin 'texto' crashed at \d{4}-\d\d-\d\dT[^:]+:\d\d:\d\d\.\d+Z: its process exited with code 7\. It is still activated/u,
    );
    // History, not a refusal: it is still what a render would activate.
    expect((await listed('--active')).map((plugin) => plugin.name)).toContain('texto');

    // And it is started afresh on the next run, which is what "responsive" means for a
    // command: the crash cost one render's frames and nothing after it.
    expect(await run(renderArguments('svg'), environment())).toBe(EXIT_OK);

    expect(await run(['plugin', 'enable', 'texto'], environment())).toBe(EXIT_OK);
    expect((await listed()).at(-1)).toMatchObject({
      name: 'texto',
      status: 'enabled',
      crashed: null,
    });
  }, 60_000);
});

/* ------------------------------------------------------------- a plugin directive -- */

/**
 * `::demo/shout {slot: name} text` — the card's test plugin (TYTO-49, ADR 0043), as a
 * third party would ship it: plain ESM, run in its own worker thread. The slot is named by
 * a parsed adjustment and the body comes back uppercased.
 */
const SHOUT_SOURCE = `const loud = (inline) =>
  inline.kind === 'text'
    ? { kind: 'text', value: inline.value.toUpperCase() }
    : inline.kind === 'break'
      ? { kind: 'break' }
      : { ...inline, range: undefined, children: inline.children.map(loud) };

export function activate(host) {
  host.registerDirective({
    id: 'demo',
    names: ['shout'],
    transform: (directive) => {
      const slot = directive.adjustments.find((item) => item.name === 'slot');
      if (slot === undefined || slot.value === undefined) {
        return {
          ok: false,
          error: [{
            severity: 'error',
            code: 'E_DIRECTIVE_ARGUMENT',
            message: "Directive '::demo/shout' needs {slot: name}.",
          }],
        };
      }
      return { ok: true, value: [{ name: slot.value, body: directive.body.map(loud) }], diagnostics: [] };
    },
  });
}
`;

async function shoutFolder(): Promise<string> {
  const folder = join(workspace, 'sources', 'demo');
  await mkdir(join(folder, 'dist'), { recursive: true });
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'demo',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['directive'],
      permissions: [],
    }),
  );
  await writeFile(join(folder, 'dist', 'index.js'), SHOUT_SOURCE);
  return folder;
}

interface ReportedDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly range?: { readonly start: number; readonly end: number };
}

async function renderedWith(brief: string): Promise<{
  readonly code: number;
  readonly artifacts: readonly string[];
  readonly diagnostics: readonly ReportedDiagnostic[];
}> {
  await writeFile(join(workspace, 'task', 'brief.brief'), brief);
  const code = await run(renderArguments('svg'), environment());
  const result = JSON.parse(
    await readFile(join(workspace, 'task', 'out', 'result.json'), 'utf8'),
  ) as { artifacts: { name: string }[]; diagnostics: ReportedDiagnostic[] };
  return {
    code,
    artifacts: result.artifacts.map((artifact) => artifact.name),
    diagnostics: result.diagnostics,
  };
}

const HEAD = '---\ntemplate: cartaz\nformats: [feed]\nimagem: ./logo.png\n---\n';
/** Every brief below is `HEAD`, `::slide Um`, then the plugin directive, which starts here. */
const DIRECTIVE_AT = HEAD.length + '::slide Um\n'.length;

describe('an installed directive at render', () => {
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('expands ::demo/shout into the slot it names, through the worker', async () => {
    await run(['plugin', 'install', await shoutFolder(), '--yes'], environment());

    const rendered = await renderedWith(`${HEAD}::slide Um\n::demo/shout {slot: slide} dois\n`);

    expect(rendered.code, stderr()).toBe(EXIT_OK);
    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.artifacts).toEqual(['slide-1-feed.svg', 'slide-2-feed.svg']);
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('uppercases the text, and the manifest checks the replacement on the directive', async () => {
    // `cor` is an enum of lowercase values, so the uppercased one is refused by name — which
    // is the text having crossed the thread both ways, and resolve checking what came back.
    await run(['plugin', 'install', await shoutFolder(), '--yes'], environment());

    const rendered = await renderedWith(`${HEAD}::slide Um\n::demo/shout {slot: cor} laranja\n`);

    expect(rendered.diagnostics.map((item) => [item.code, item.range?.start])).toEqual([
      ['E_BAD_SLOT_VALUE', DIRECTIVE_AT],
    ]);
    expect(rendered.diagnostics[0]?.message).toContain('LARANJA');
  }, 60_000);

  it('is E_UNKNOWN_DIRECTIVE without the plugin, on the name', async () => {
    const rendered = await renderedWith(`${HEAD}::slide Um\n::demo/shout {slot: slide} dois\n`);

    expect(rendered.code).toBe(EXIT_DIAGNOSTICS);
    expect(rendered.diagnostics.map((item) => [item.code, item.range?.start])).toEqual([
      ['E_UNKNOWN_DIRECTIVE', DIRECTIVE_AT + 2],
    ]);
    expect(rendered.artifacts).toEqual(['slide-1-feed.svg']);
  });

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('cannot take an argument value outside [a-zA-Z0-9_-] — the known limit', async () => {
    // Adjustment values are the grammar's `value` token; a plugin argument is one of them
    // until the grammar has an argument node of its own (ADR 0043).
    await run(['plugin', 'install', await shoutFolder(), '--yes'], environment());

    const rendered = await renderedWith(
      `${HEAD}::slide Um\n::demo/shout {slot: sub.titulo} dois\n`,
    );

    // Measured, not designed: the value stops at `sub`, the rest of the list is two syntax
    // errors, and the plugin still runs with the part that parsed.
    expect(rendered.diagnostics.map((item) => item.code)).toEqual([
      'E_SYNTAX',
      'E_SYNTAX',
      'E_UNKNOWN_SLOT',
    ]);
    expect(rendered.diagnostics[0]?.message).toBe(
      'Syntax error: an adjustment list is missing its closing }.',
    );
    expect(rendered.diagnostics[2]?.message).toContain("Unknown slot 'sub'.");
  }, 60_000);
});
