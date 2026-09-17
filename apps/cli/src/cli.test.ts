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
        '--folder',
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
    // The built-ins are in the list because they are on the search path now (ADR 0020):
    // `tyto.templates` records which templates were here, and since the pack merged in,
    // they were. The project's own is still the only one this brief uses.
    expect(parsed.value.tyto.version).toBe(TYTO_VERSION);
    expect(parsed.value.tyto.templates).toContainEqual({ name: 'cartaz', version: '2.1.0' });
    expect(parsed.value.tyto.templates.map((entry) => entry.name).sort()).toEqual([
      'carrossel-lista',
      'cartaz',
      'promo-curso',
    ]);
  });

  it('renders the slots that are fine, and says so in result.json (ADR 0025)', async () => {
    // `rodape` is not a slot this manifest declares. It is an error the author has to fix,
    // and it costs that directive and nothing else — so the two slides are still drawn,
    // still written, and still listed. The third state: `status: error` with artifacts.
    await writeFile(
      join(workspace, 'task', 'brief.brief'),
      `${briefSource}\n::rodape Inscreva-se\n`,
    );

    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'],
      environment(),
    );

    expect(code, stderr()).toBe(EXIT_DIAGNOSTICS);
    expect(await outFiles('task', 'out')).toEqual([
      'result.json',
      'slide-1-feed.svg',
      'slide-2-feed.svg',
    ]);

    const parsed = parseRenderResult(await resultAt('task', 'out'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));
    expect(parsed.value.status).toBe('error');
    expect(parsed.value.planned).toBe(2);
    expect(parsed.value.artifacts.map((artifact) => artifact.name)).toEqual([
      'slide-1-feed.svg',
      'slide-2-feed.svg',
    ]);
    expect(parsed.value.diagnostics.some((item) => item.code === 'E_UNKNOWN_SLOT')).toBe(true);
  });

  it('writes no artifact at all when the brief names a template that does not exist', async () => {
    // The other side of the same rule: fatal means nothing is drawn, and `result.json` is
    // still written so the caller on the other end of ADR 0011 has something to read.
    await writeFile(
      join(workspace, 'task', 'brief.brief'),
      briefSource.replace('template: cartaz', 'template: nao-existe'),
    );

    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(await outFiles('task', 'out')).toEqual(['result.json']);

    const parsed = parseRenderResult(await resultAt('task', 'out'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));
    expect(parsed.value.status).toBe('error');
    expect(parsed.value.artifacts).toEqual([]);
    expect(parsed.value.diagnostics.some((item) => item.code === 'E_UNKNOWN_TEMPLATE')).toBe(true);
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

/* --------------------------------------------------------------------------- folder -- */

/**
 * `--folder`: the delivery layout of TYTO-121.
 *
 * The acceptance criterion is a **shape on disk**, so these read the disk rather than the
 * report. The brief used here is deliberately not `task/brief.brief`: its name would make the
 * folder `brief/`, which reads as a fixture rather than as a delivery, and a name with a space
 * and an accent in it is the case the card says must not be sanitised.
 */
describe('tyto render --folder', () => {
  /** What a person would actually call a brief, saved where the `assets/` beside it is found. */
  const NAME = 'campanha de setembro';

  beforeEach(async () => {
    await writeFile(join(workspace, 'task', `${NAME}.brief`), briefSource);
  });

  it('puts the artwork at the top and the brief underneath, in a folder named after it', async () => {
    const code = await run(
      ['render', `task/${NAME}.brief`, '--out', 'entregas', '--folder', '--types', 'svg'],
      environment(),
    );

    expect(code, stderr()).toBe(EXIT_OK);
    // Nothing but artwork at this level — the whole point of the layout. A `result.json`
    // here would be the one file somebody has to delete before sending the folder on.
    expect(await outFiles('entregas', NAME)).toEqual([
      'editaveis',
      'slide-1-feed.svg',
      'slide-2-feed.svg',
    ]);
    expect(await outFiles('entregas', NAME, 'editaveis')).toEqual([`${NAME}.brief`, 'result.json']);
  });

  it('keeps the brief byte for byte, so the copy is the text that made the artwork', async () => {
    await run(
      ['render', `task/${NAME}.brief`, '--out', 'entregas', '--folder', '--types', 'svg'],
      environment(),
    );

    // Read as bytes rather than as a string: a copy that normalised CR LF or dropped a BOM
    // would compare equal as text and be a different file, and a CR LF brief is supported
    // input (TYTO-64).
    const copied = await readFile(join(workspace, 'entregas', NAME, 'editaveis', `${NAME}.brief`));
    expect(copied.equals(Buffer.from(briefSource, 'utf8'))).toBe(true);
  });

  it('writes a result.json its own schema accepts, one level down', async () => {
    await run(
      ['render', `task/${NAME}.brief`, '--out', 'entregas', '--folder', '--types', 'svg'],
      environment(),
    );

    const parsed = parseRenderResult(await resultAt('entregas', NAME, 'editaveis'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));

    expect(parsed.value.status).toBe('ok');
    // The names are the same names `--out` produces. Only the folder around them moved, and
    // an artifact list that suddenly carried a path would be a change to the ADR 0011 schema.
    expect(parsed.value.artifacts.map((artifact) => artifact.name)).toEqual([
      'slide-1-feed.svg',
      'slide-2-feed.svg',
    ]);
  });

  it('leaves --out alone when the flag is absent, which is what Jacurutu relies on', async () => {
    // The same brief, the same destination, without the flag. `docs/render-contract.md` says
    // `--out` **is** the output folder, and this is the assertion that a flag added beside it
    // did not quietly make it a parent.
    await run(
      ['render', `task/${NAME}.brief`, '--out', 'entregas', '--types', 'svg'],
      environment(),
    );

    expect(await outFiles('entregas')).toEqual([
      'result.json',
      'slide-1-feed.svg',
      'slide-2-feed.svg',
    ]);
  });

  it('reuses an existing folder and overwrites by name, leaving what it did not produce', async () => {
    const delivery = join(workspace, 'entregas', NAME);
    await mkdir(delivery, { recursive: true });
    await writeFile(join(delivery, 'slide-3-feed.svg'), 'from a run that made three slides');

    await run(
      ['render', `task/${NAME}.brief`, '--out', 'entregas', '--folder', '--types', 'svg'],
      environment(),
    );

    // The documented rule, and the hazard it carries, pinned rather than left to be
    // discovered: a brief edited from three slides down to two leaves the third in the
    // delivery, and `result.json` does not mention it because it lists what this run wrote.
    expect(await outFiles('entregas', NAME)).toContain('slide-3-feed.svg');
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
    // Every frame failed here, so the honest report is two planned and none produced —
    // not the absent report an `Err` used to leave behind.
    expect(parsed.value.planned).toBe(2);
    expect(parsed.value.artifacts).toEqual([]);
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
