import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRenderResult } from '@tyto/io';
import type { Rasterizer } from '@tyto/raster';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK } from './exit.js';
import { run } from './program.js';

import briefSource from './__fixtures__/cartaz.brief?raw';
import formatsSource from './__fixtures__/formats.yaml?raw';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import markSource from './__fixtures__/mark.svg?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * The acceptance criteria are about a command, so the tests are about a command: a real
 * project in the OS temp space, `run(argv, environment)` over it, and the real files read
 * back off the disk afterwards. Nothing below reaches inside a command handler.
 *
 * ## What is real and what is not
 *
 * The **`--types svg` path is real end to end** — no fake anywhere, because SVG needs no
 * browser. That is the run `result.json` is validated from.
 *
 * The raster path uses a **fake `Rasterizer`**, for the reason `pipeline`'s and `io`'s own
 * tests give: whether a folder comes out with the right files in it, and whether the exit
 * code matches the outcome, are not questions a browser can answer better. The Playwright
 * adapter has its own suite (`packages/raster`), including a pixel-level visual one.
 */

const TYTO_VERSION = '0.0.0-test';

/** A real 1×1 PNG, so the asset resolver has bytes to hash and a file to find. */
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
    version: TYTO_VERSION,
    cwd: workspace,
    rasterizer: () => fakeRasterizer(),
    ...overrides,
  };
}

function fakeRasterizer(failWhen?: (width: number) => boolean): Rasterizer {
  return {
    raster: (_html, options) => {
      if (failWhen?.(options.width) === true) return Promise.reject(new Error('the tab crashed'));
      return Promise.resolve(new TextEncoder().encode(`png:${String(options.width)}`));
    },
  };
}

const stdout = (): string => out.join('');
const stderr = (): string => errors.join('');

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-cli-'));
  out = [];
  errors = [];

  // `templates/cartaz/` with its own `assets/mark.svg`, plus the project's formats.yaml.
  const template = join(workspace, 'templates', 'cartaz');
  await mkdir(join(template, 'assets'), { recursive: true });
  await writeFile(join(template, 'manifest.yaml'), manifestSource);
  await writeFile(join(template, 'template.html'), templateMarkup);
  await writeFile(join(template, 'assets', 'mark.svg'), markSource);
  await writeFile(join(workspace, 'formats.yaml'), formatsSource);

  // A task folder in the ADR 0011 shape: a brief with `assets/` beside it.
  await mkdir(join(workspace, 'task', 'assets'), { recursive: true });
  await writeFile(join(workspace, 'task', 'brief.brief'), briefSource);
  await writeFile(join(workspace, 'task', 'assets', 'logo.png'), LOGO_PNG);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function outFiles(...segments: string[]): Promise<readonly string[]> {
  return [...(await readdir(join(workspace, ...segments)))].sort();
}

async function resultAt(...segments: string[]): Promise<unknown> {
  return JSON.parse(await readFile(join(workspace, ...segments, 'result.json'), 'utf8'));
}

/* --------------------------------------------------------------------------- --help -- */

describe('--help', () => {
  it('lists every command', async () => {
    expect(await run(['--help'], environment())).toBe(EXIT_OK);

    for (const command of ['render', 'watch', 'template']) {
      expect(stdout()).toContain(command);
    }
  });

  it('documents every flag of every command, with a description on each', async () => {
    // Walked rather than listed: a flag added to a command and forgotten here would pass
    // a hard-coded list and fail this.
    for (const argv of [
      ['render', '--help'],
      ['watch', '--help'],
      ['template', 'check', '--help'],
      ['template', 'new', '--help'],
    ]) {
      out = [];
      expect(await run(argv, environment()), argv.join(' ')).toBe(EXIT_OK);
      const help = stdout();

      for (const flag of [
        '--templates',
        '--formats-file',
        '--template',
        '--formats',
        '--types',
        '--scale',
        '--quality',
        '--concurrency',
        '--json',
        '--out',
      ]) {
        // Only the flags this command actually has; the point is that whatever it has is
        // documented, not that every command has everything.
        if (!help.includes(flag)) continue;
        const line = help.split('\n').find((entry) => entry.includes(flag)) ?? '';
        expect(
          line.replace(/^\s*[^\s]+(\s+<[^>]+>)?/u, '').trim(),
          `${argv.join(' ')} ${flag}`,
        ).not.toBe('');
      }
    }
  });

  it("names the exit codes, because they are the contract's other half", async () => {
    await run(['--help'], environment());

    expect(stdout()).toMatch(/0 ok, 1 error diagnostics.*2 internal failure/u);
  });
});

/* --------------------------------------------------------------------------- render -- */

describe('tyto render', () => {
  it('writes the artifacts and a result.json into --out, and exits 0', async () => {
    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'],
      environment(),
    );

    expect(code, stderr()).toBe(EXIT_OK);
    // Two slides × one format × one encoding, plus the manifest.
    expect(await outFiles('task', 'out')).toEqual([
      'result.json',
      'slide-1-feed.svg',
      'slide-2-feed.svg',
    ]);
  });

  it('writes a result.json its own schema accepts', async () => {
    await run(['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'], environment());

    const parsed = parseRenderResult(await resultAt('task', 'out'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));

    expect(parsed.value.status).toBe('ok');
    expect(parsed.value.cancelled).toBe(false);
    expect(parsed.value.planned).toBe(2);
    expect(parsed.value.artifacts).toHaveLength(2);
    // Sizes, not just names: a zero-byte file would satisfy a listing and nothing else.
    expect(parsed.value.artifacts.every((artifact) => artifact.bytes > 0)).toBe(true);
    expect(parsed.value.tyto).toEqual({
      version: TYTO_VERSION,
      templates: [{ name: 'cartaz', version: '2.1.0' }],
    });
  });

  it("embeds the template's own <vector src>, which nothing but the CLI resolves", async () => {
    await run(['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'], environment());

    const svg = await readFile(join(workspace, 'task', 'out', 'slide-1-feed.svg'), 'utf8');
    // The mark's path data reached the document, so `assets/mark.svg` beside the template
    // was read and handed to `compileTemplate` as a `TemplateAssets`.
    expect(svg).toContain('M2 2h20v20H2z');
  });

  it('rasters through the injected rasterizer and names the files on stdout', async () => {
    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'png,svg'],
      environment(),
    );

    expect(code, stderr()).toBe(EXIT_OK);
    expect(await outFiles('task', 'out')).toEqual([
      'result.json',
      'slide-1-feed.png',
      'slide-1-feed.svg',
      'slide-2-feed.png',
      'slide-2-feed.svg',
    ]);
    expect(stdout().trim().split('\n')).toEqual([
      'slide-1-feed.png',
      'slide-1-feed.svg',
      'slide-2-feed.png',
      'slide-2-feed.svg',
    ]);
  });

  it('never builds a rasterizer for an svg-only run', async () => {
    let built = 0;
    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'],
      environment({
        rasterizer: () => {
          built += 1;
          return fakeRasterizer();
        },
      }),
    );

    expect(code, stderr()).toBe(EXIT_OK);
    expect(built).toBe(0);
  });

  it('takes --formats for a brief whose frontmatter lists none', async () => {
    await writeFile(
      join(workspace, 'task', 'plain.brief'),
      '---\ntemplate: cartaz\ncor: laranja\n---\n::slide\n  Um\n',
    );

    const code = await run(
      ['render', 'task/plain.brief', '--out', 'task/plain', '--types', 'svg', '--formats', 'story'],
      environment(),
    );

    expect(code, stderr()).toBe(EXIT_OK);
    expect(await outFiles('task', 'plain')).toEqual(['result.json', 'slide-1-story.svg']);
  });

  it('reports a format the template does not render, rather than rendering nothing', async () => {
    await writeFile(
      join(workspace, 'task', 'plain.brief'),
      '---\ntemplate: cartaz\n---\n::slide\n  Um\n',
    );

    const code = await run(
      [
        'render',
        'task/plain.brief',
        '--out',
        'task/plain',
        '--types',
        'svg',
        '--formats',
        'banner',
      ],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain('E_UNKNOWN_FORMAT');
  });
});

/* ----------------------------------------------------------------------- exit codes -- */

describe('the three exit codes ADR 0011 fixes', () => {
  it('exits 0 when the run produced no errors', async () => {
    expect(
      await run(
        ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'],
        environment(),
      ),
    ).toBe(EXIT_OK);
  });

  it('exits 1 for a brief that names a template the registry does not have', async () => {
    await writeFile(join(workspace, 'task', 'bad.brief'), '---\ntemplate: naoexiste\n---\n');

    const code = await run(
      ['render', 'task/bad.brief', '--out', 'task/bad', '--types', 'svg'],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain('E_UNKNOWN_TEMPLATE');
    // Located in the file the author opens, at the line the frontmatter key is on.
    expect(stderr()).toMatch(/task[\\/]bad\.brief:2:1: error E_UNKNOWN_TEMPLATE/u);
  });

  it('exits 1 for a frame the rasterizer could not produce, and still writes result.json', async () => {
    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'png'],
      environment({ rasterizer: () => fakeRasterizer(() => true) }),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);

    const parsed = parseRenderResult(await resultAt('task', 'out'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));
    expect(parsed.value.status).toBe('error');
    expect(parsed.value.diagnostics.some((item) => item.code === 'E_RENDER_FAILED')).toBe(true);
  });

  it('exits 1 for a brief that is not on disk', async () => {
    const code = await run(
      ['render', 'task/missing.brief', '--out', 'task/out', '--types', 'svg'],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain('E_INPUT_READ');
  });

  it('exits 1 for a command line the parser refuses', async () => {
    // Not 2: a flag that does not exist is something the caller must change before trying
    // again, which is what 1 means to the other side of the contract.
    expect(await run(['render', 'task/brief.brief', '--nope'], environment())).toBe(
      EXIT_DIAGNOSTICS,
    );
  });

  it('exits 2 when the composition root cannot build its adapters', async () => {
    // A machine with no `playwright` installed is exactly this: nothing about any brief
    // went wrong, and the same command on another machine would succeed — which is the
    // difference Jacurutu retries on.
    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'png'],
      environment({
        rasterizer: () => {
          throw new Error('playwright is not installed');
        },
      }),
    );

    expect(code).toBe(EXIT_INTERNAL);
    expect(stderr()).toContain('internal failure');
  });
});

/* ----------------------------------------------------------------------------- json -- */

describe('--json', () => {
  it('prints a located document on stdout and nothing on stderr', async () => {
    await writeFile(join(workspace, 'task', 'bad.brief'), '---\ntemplate: naoexiste\n---\n');

    const code = await run(
      ['render', 'task/bad.brief', '--out', 'task/bad', '--types', 'svg', '--json'],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toBe('');

    const document = JSON.parse(stdout()) as {
      status: string;
      diagnostics: { code: string; line?: number; column?: number; path?: string }[];
    };
    expect(document.status).toBe('error');
    expect(document.diagnostics[0]?.code).toBe('E_UNKNOWN_TEMPLATE');
    expect(document.diagnostics[0]?.line).toBe(2);
    expect(document.diagnostics[0]?.column).toBe(1);
  });
});

/* ---------------------------------------------------------------------------- watch -- */

describe('tyto watch --once', () => {
  beforeEach(async () => {
    const task = join(workspace, 'queue', 'inbox', 'issue-42', 'assets');
    await mkdir(task, { recursive: true });
    await writeFile(join(workspace, 'queue', 'inbox', 'issue-42', 'brief.brief'), briefSource);
    await writeFile(join(task, 'logo.png'), LOGO_PNG);
  });

  it('renders the inbox into the outbox in the shape ADR 0011 fixes', async () => {
    const code = await run(['watch', 'queue', '--once', '--types', 'svg'], environment());

    expect(code, stderr()).toBe(EXIT_OK);
    expect(await outFiles('queue', 'outbox', 'issue-42', 'out')).toEqual([
      'result.json',
      'slide-1-feed.svg',
      'slide-2-feed.svg',
    ]);
  });

  it('acks a task that succeeded by moving it out of the inbox', async () => {
    await run(['watch', 'queue', '--once', '--types', 'svg'], environment());

    expect(await outFiles('queue', 'inbox')).toEqual([]);
    // Moved, not deleted: a render that produced the wrong thing is one somebody will
    // want to look at again.
    expect(await outFiles('queue', 'done', 'issue-42')).toContain('brief.brief');
  });

  it('leaves a task that failed exactly where it is, and exits 1', async () => {
    const code = await run(
      ['watch', 'queue', '--once', '--types', 'png'],
      environment({ rasterizer: () => fakeRasterizer(() => true) }),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    // ADR 0008: never ack on error. A queue that acknowledges failures loses work and
    // tells nobody.
    expect(await outFiles('queue', 'inbox')).toEqual(['issue-42']);

    const parsed = parseRenderResult(await resultAt('queue', 'outbox', 'issue-42', 'out'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));
    expect(parsed.value.status).toBe('error');
  });
});
