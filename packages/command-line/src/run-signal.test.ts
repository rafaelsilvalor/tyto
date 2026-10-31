import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Rasterizer } from '@tyto/raster';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { commandTree } from './commands.js';
import type { CliEnvironment, CommandInvocation } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { fetchPlugin } from './plugins/fetch.js';
import { run } from './program.js';

import briefSource from './__fixtures__/cartaz.brief?raw';
import formatsSource from './__fixtures__/formats.yaml?raw';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import markSource from './__fixtures__/mark.svg?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * What the window needs from `run` that a terminal never asked for (ADR 0159): a Stop that
 * really stops (decision 6), a refusal before a command starts (decision 2), and the tree as
 * data for the panel's help (decision 5).
 */

/** A real 1×1 PNG: the fixture brief draws `./logo.png`, and a render needs its bytes. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let workspace: string;
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
    rasterizer: () => {
      throw new Error('this test rasters nothing');
    },
    ...overrides,
  };
}

const stderr = (): string => errors.join('');

/** Settles with `value` after `ms`, so a run that never stops fails here instead of hanging. */
const after = <T>(ms: number, value: T): Promise<T> =>
  new Promise((done) => setTimeout(() => done(value), ms));

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-run-signal-'));
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

describe('a signal stops a run part of the way through', () => {
  it('stops a render between frames: the frame in flight finishes and no other starts', async () => {
    // Two frames, one at a time. Stop is pressed while the first is in the rasterizer.
    const stop = new AbortController();
    let frames = 0;
    const rasterizer: Rasterizer = {
      raster: () => {
        frames += 1;
        stop.abort();
        return Promise.resolve(new TextEncoder().encode('png'));
      },
    };

    await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'png', '--concurrency', '1'],
      environment({ rasterizer: () => rasterizer }),
      stop.signal,
    );

    expect(frames).toBe(1);
  });

  it('renders every frame when nothing stops it', async () => {
    let frames = 0;
    const rasterizer: Rasterizer = {
      raster: () => {
        frames += 1;
        return Promise.resolve(new TextEncoder().encode('png'));
      },
    };

    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'png', '--concurrency', '1'],
      environment({ rasterizer: () => rasterizer }),
      new AbortController().signal,
    );

    expect(code, stderr()).toBe(EXIT_OK);
    expect(frames).toBe(2);
  });

  it('ends a watch between sweeps, where it would otherwise run forever', async () => {
    const stop = new AbortController();
    const watching = run(
      ['watch', workspace, '--interval', '20', '--types', 'svg'],
      environment(),
      stop.signal,
    );

    expect(await Promise.race([watching.then(() => 'ended'), after(300, 'running')])).toBe(
      'running',
    );
    stop.abort();

    expect(await Promise.race([watching.then(() => 'ended'), after(5_000, 'running')])).toBe(
      'ended',
    );
  });
});

describe("the environment's refusal", () => {
  it('is asked with the command, its arguments and its parsed options, before it runs', async () => {
    const asked: CommandInvocation[] = [];
    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg', '--trust'],
      environment({
        refuse: (invocation) => {
          asked.push(invocation);
          return Promise.resolve('--trust is decided in the window.');
        },
      }),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toBe('error: --trust is decided in the window.\n');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.path).toEqual(['render']);
    expect(asked[0]?.args).toEqual(['task/brief.brief']);
    expect(asked[0]?.options['trust']).toBe(true);
    // Refused before the action: nothing was written.
    await expect(readdir(join(workspace, 'task', 'out'))).rejects.toThrow();
  });

  it('names a subcommand by its whole path', async () => {
    const asked: CommandInvocation[] = [];
    await run(
      ['plugin', 'list'],
      environment({
        refuse: (invocation) => {
          asked.push(invocation);
          return Promise.resolve(undefined);
        },
      }),
    );

    expect(asked.map((invocation) => invocation.path)).toEqual([['plugin', 'list']]);
  });

  it('runs the command when the answer is no refusal', async () => {
    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'],
      environment({ refuse: () => Promise.resolve(undefined) }),
    );

    expect(code, stderr()).toBe(EXIT_OK);
  });
});

describe('the command tree as data', () => {
  it('lists every command run parses, with its arguments and options', () => {
    const tree = commandTree(environment());
    const names = tree.commands.map((command) => command.name);

    expect(names).toEqual(expect.arrayContaining(['render', 'watch', 'plugin', 'trust']));
    const render = tree.commands.find((command) => command.name === 'render');
    expect(render?.arguments).toEqual([
      {
        name: 'brief',
        required: true,
        description: 'path to the .brief file',
        value: { kind: 'brief' },
      },
    ]);
    expect(render?.options.map((option) => option.flags)).toContain('--trust');
    const plugin = tree.commands.find((command) => command.name === 'plugin');
    expect(plugin?.commands.map((command) => command.name)).toContain('install');
  });
});

describe('a run that may not start a shell', () => {
  // On Windows `npm` is `npm.cmd`, which only a shell starts (`runNpm`). The refusal is keyed on
  // that step and not on a command, so whatever reaches npm there is refused the same way.
  it('refuses npm on Windows at the step that would start the shell, naming the reason', async () => {
    const fetched = await fetchPlugin('tyto-plugin-pdf@1', workspace, {
      platform: 'win32',
      shellRefusal: 'No shell in the window.',
    });

    expect(fetched.ok).toBe(false);
    if (fetched.ok) return;
    expect(fetched.error.map((found) => found.code)).toEqual(['E_PLUGIN_FETCH']);
    expect(fetched.error[0]?.message).toContain('No shell in the window.');
  });

  // The whole way from the command line, where the platform cannot be simulated: Windows only.
  it.runIf(process.platform === 'win32')(
    'refuses tyto plugin install of an npm package, through run, on this Windows',
    async () => {
      const code = await run(
        ['plugin', 'install', 'tyto-plugin-pdf@1', '--yes'],
        environment({ home: join(workspace, 'home'), shellRefusal: 'No shell in the window.' }),
      );

      expect(code).toBe(EXIT_DIAGNOSTICS);
      expect(stderr()).toContain('No shell in the window.');
    },
  );

  it('leaves a folder alone, which starts nothing', async () => {
    const fetched = await fetchPlugin('task', workspace, {
      platform: 'win32',
      shellRefusal: 'No shell in the window.',
    });

    expect(fetched.ok).toBe(true);
  });
});
