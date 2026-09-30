import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GAP_COLOR_CSS } from '@tyto/core';
import { parseRenderResult } from '@tyto/io';
import type { Rasterizer } from '@tyto/raster';
import { BUILT_IN_TEMPLATE_NAMES } from '@tyto/templates';
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
      ['plugin', 'new', '--help'],
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
    expect(await outFiles('task', 'out')).toEqual(['feed-01.svg', 'feed-02.svg', 'result.json']);
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
    // The whole list and not a `toContain`: a host that wired half the pack would pass a
    // containment check. The pack's half comes from its own constant, so shipping a template
    // does not redden this file (TYTO-171); the project's `cartaz` is added by hand, because
    // it is this project's and not the pack's. The `Set` is the shadowing rule: were the pack
    // ever to ship a `cartaz`, the project's would replace it rather than sit beside it.
    const expected = [...new Set([...BUILT_IN_TEMPLATE_NAMES, 'cartaz'])].sort();
    expect(parsed.value.tyto.templates.map((entry) => entry.name).sort()).toEqual(expected);
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
    expect(await outFiles('task', 'out')).toEqual(['feed-01.svg', 'feed-02.svg', 'result.json']);

    const parsed = parseRenderResult(await resultAt('task', 'out'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));
    expect(parsed.value.status).toBe('error');
    expect(parsed.value.planned).toBe(2);
    expect(parsed.value.artifacts.map((artifact) => artifact.name)).toEqual([
      'feed-01.svg',
      'feed-02.svg',
    ]);
    expect(parsed.value.diagnostics.some((item) => item.code === 'E_UNKNOWN_SLOT')).toBe(true);
  });

  it('draws and stamps a brief that left a required slot unset (ADR 0035)', async () => {
    // The acceptance criterion this closes is "the marker is in the exported bytes, not
    // only in the live preview": a CLI run has no preview and no problems panel, so an
    // artwork with a hole used to be indistinguishable from a finished one. The manifest
    // is rewritten rather than the shipped fixture changed, because every other test here
    // wants `imagem` optional.
    await writeFile(
      join(workspace, 'templates', 'cartaz', 'manifest.yaml'),
      manifestSource.replace('imagem: { type: image }', 'imagem: { type: image, required: true }'),
    );
    await writeFile(
      join(workspace, 'task', 'brief.brief'),
      briefSource.replace(/imagem: \.\/logo\.png\r?\n/u, ''),
    );

    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'],
      environment(),
    );

    // Still non-zero: fatality decides what is drawn, severity decides what fails.
    expect(code, stderr()).toBe(EXIT_DIAGNOSTICS);
    expect(await outFiles('task', 'out')).toEqual(['feed-01.svg', 'feed-02.svg', 'result.json']);

    const svg = await readFile(join(workspace, 'task', 'out', 'feed-01.svg'), 'utf8');
    expect(svg).toContain(GAP_COLOR_CSS);

    const parsed = parseRenderResult(await resultAt('task', 'out'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));
    expect(parsed.value.status).toBe('error');
    expect(parsed.value.diagnostics.some((item) => item.code === 'E_MISSING_REQUIRED_SLOT')).toBe(
      true,
    );
  });

  it('leaves the mark out of an artwork with nothing missing, which is the control', async () => {
    await run(['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'], environment());

    const svg = await readFile(join(workspace, 'task', 'out', 'feed-01.svg'), 'utf8');
    expect(svg).not.toContain(GAP_COLOR_CSS);
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

    const svg = await readFile(join(workspace, 'task', 'out', 'feed-01.svg'), 'utf8');
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
      'feed-01.png',
      'feed-01.svg',
      'feed-02.png',
      'feed-02.svg',
      'result.json',
    ]);
    expect(stdout().trim().split('\n')).toEqual([
      'feed-01.png',
      'feed-01.svg',
      'feed-02.png',
      'feed-02.svg',
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
    expect(await outFiles('task', 'plain')).toEqual(['result.json', 'story-01.svg']);
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
 * ADR 0056: the path as written, from the brief's folder, then `assets/` beside it.
 *
 * The fixture's `task/` is already the Jacurutu shape — `./logo.png` with the file only in
 * `assets/` — so the fallback is proved by every render above. These pin the other two
 * cases, and which bytes are drawn when both files exist.
 */
describe('tyto render, where an asset is found', () => {
  /** Different bytes under the same name: trailing data after IEND, still a valid PNG. */
  const BESIDE_PNG = Buffer.concat([LOGO_PNG, Buffer.from('beside')]);

  async function svgOf(): Promise<string> {
    const code = await run(
      ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'],
      environment(),
    );
    expect(code, stderr()).toBe(EXIT_OK);
    return readFile(join(workspace, 'task', 'out', 'feed-01.svg'), 'utf8');
  }

  it('draws ./assets/logo.png as written', async () => {
    await writeFile(
      join(workspace, 'task', 'brief.brief'),
      briefSource.replace('imagem: ./logo.png', 'imagem: ./assets/logo.png'),
    );

    expect(await svgOf()).toContain(LOGO_PNG.toString('base64'));
  });

  it('draws an image beside the brief, with no assets/ at all', async () => {
    await rm(join(workspace, 'task', 'assets'), { recursive: true });
    await writeFile(join(workspace, 'task', 'logo.png'), LOGO_PNG);

    expect(await svgOf()).toContain(LOGO_PNG.toString('base64'));
  });

  it('draws the literal one when both exist', async () => {
    await writeFile(join(workspace, 'task', 'logo.png'), BESIDE_PNG);

    const svg = await svgOf();
    expect(svg).toContain(BESIDE_PNG.toString('base64'));
    expect(svg).not.toContain(`base64,${LOGO_PNG.toString('base64')}"`);
  });

  it('searches only the --assets folder when one is named', async () => {
    // The person said where the files are, so `assets/` beside the brief is not searched.
    await mkdir(join(workspace, 'elsewhere'));

    const code = await run(
      [
        'render',
        'task/brief.brief',
        '--out',
        'task/out',
        '--types',
        'svg',
        '--assets',
        join(workspace, 'elsewhere'),
      ],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    const parsed = parseRenderResult(await resultAt('task', 'out'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));
    const missing = parsed.value.diagnostics.find((item) => item.code === 'E_ASSET_NOT_FOUND');
    // The one folder it searched, and not the brief's assets/ it never looked in (TYTO-205).
    expect(missing?.message).toBe(
      `Asset './logo.png' was not found in '${join(workspace, 'elsewhere')}'.`,
    );
  });
});

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
    // Artwork, and the two folders beside it — the whole point of the layout. A `result.json`
    // here would be the one file somebody has to delete before sending the folder on.
    expect(await outFiles('entregas', NAME)).toEqual([
      'assets',
      'editaveis',
      'feed-01.svg',
      'feed-02.svg',
    ]);
    // The image the brief used, and nothing it did not (TYTO-205).
    expect(await outFiles('entregas', NAME, 'assets')).toEqual(['logo.png']);
    expect(await outFiles('entregas', NAME, 'editaveis')).toEqual([
      `${NAME}.brief`,
      'result.json',
      'template.txt',
    ]);
  });

  it('names the template that made the artwork, without copying it', async () => {
    await run(
      ['render', `task/${NAME}.brief`, '--out', 'entregas', '--folder', '--types', 'svg'],
      environment(),
    );

    const note = await readFile(
      join(workspace, 'entregas', NAME, 'editaveis', 'template.txt'),
      'utf8',
    );

    // Name **and** version. `result.json`'s `tyto.templates` lists every template that was on
    // the search path — two, on this fixture — so it cannot answer which one drew these files.
    // The job reports the one it loaded, and that is what lands here.
    expect(note).toContain('cartaz 2.1.0');
    // Nothing of the template itself. A folder per delivery holding a copy of a template that
    // lives in a repository is the thing this deliberately does not do.
    expect(await outFiles('entregas', NAME)).not.toContain('template.html');
    expect(await outFiles('entregas', NAME, 'editaveis')).not.toContain('manifest.yaml');
  });

  it('names the template the --template fallback chose, which the brief does not record', async () => {
    // The case the copied brief cannot cover on its own: the frontmatter names no template, so
    // the only thing that knows which one was used is the run itself.
    // The `cartaz` fixture's own slot, and no frontmatter at all — so the template can only
    // come from the flag.
    await writeFile(join(workspace, 'task', 'sem-frontmatter.brief'), '::slide\n  Primeiro\n');

    const code = await run(
      [
        'render',
        'task/sem-frontmatter.brief',
        '--out',
        'entregas',
        '--folder',
        '--template',
        'cartaz',
        '--types',
        'svg',
      ],
      environment(),
    );

    expect(code, stderr()).toBe(EXIT_OK);
    expect(
      await readFile(
        join(workspace, 'entregas', 'sem-frontmatter', 'editaveis', 'template.txt'),
        'utf8',
      ),
    ).toContain('cartaz 2.1.0');
  });

  it('keeps the brief byte for byte but for its image paths, which point at assets/', async () => {
    await run(
      ['render', `task/${NAME}.brief`, '--out', 'entregas', '--folder', '--types', 'svg'],
      environment(),
    );

    // Read as bytes rather than as a string: a copy that normalised CR LF or dropped a BOM
    // would compare equal as text and be a different file, and a CR LF brief is supported
    // input (TYTO-64). The one change is the image path (ADR 0057).
    const copied = await readFile(join(workspace, 'entregas', NAME, 'editaveis', `${NAME}.brief`));
    expect(
      copied.equals(
        Buffer.from(briefSource.replace('imagem: ./logo.png', 'imagem: logo.png'), 'utf8'),
      ),
    ).toBe(true);
  });

  it('renders the copied brief from editaveis/ to the same bytes (TYTO-205)', async () => {
    await run(
      ['render', `task/${NAME}.brief`, '--out', 'entregas', '--folder', '--types', 'svg'],
      environment(),
    );

    const code = await run(
      [
        'render',
        join('entregas', NAME, 'editaveis', `${NAME}.brief`),
        '--out',
        'de-novo',
        '--types',
        'svg',
      ],
      environment(),
    );

    expect(code, stderr()).toBe(EXIT_OK);
    for (const file of ['feed-01.svg', 'feed-02.svg']) {
      const delivered = await readFile(join(workspace, 'entregas', NAME, file));
      const again = await readFile(join(workspace, 'de-novo', file));
      expect(again.equals(delivered), file).toBe(true);
    }
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
      'feed-01.svg',
      'feed-02.svg',
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

    expect(await outFiles('entregas')).toEqual(['feed-01.svg', 'feed-02.svg', 'result.json']);
  });

  it('removes the slide a brief no longer has, and says so on stderr (ADR 0054)', async () => {
    const render = (): Promise<number> =>
      run(
        ['render', `task/${NAME}.brief`, '--out', 'entregas', '--folder', '--types', 'svg'],
        environment(),
      );
    await writeFile(
      join(workspace, 'task', `${NAME}.brief`),
      `${briefSource}
::slide
  Terceiro
`,
    );
    await render();
    expect(await outFiles('entregas', NAME)).toContain('feed-03.svg');

    // The same brief edited from three slides down to two, exported into the same folder.
    await writeFile(join(workspace, 'task', `${NAME}.brief`), briefSource);
    const code = await render();

    expect(code, stderr()).toBe(EXIT_OK);
    expect(await outFiles('entregas', NAME)).toEqual([
      'assets',
      'editaveis',
      'feed-01.svg',
      'feed-02.svg',
    ]);
    expect(stderr()).toContain("warning W_LEFTOVER_REMOVED Removed 'feed-03.svg'");
    const parsed = parseRenderResult(await resultAt('entregas', NAME, 'editaveis'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));
    expect(parsed.value.diagnostics.map((item) => item.code)).toEqual(['W_LEFTOVER_REMOVED']);
  });

  it('keeps a file the previous result.json did not list, even one named like artwork', async () => {
    // A folder Tyto has no report for: nothing in it is known to be Tyto's, so nothing goes.
    const delivery = join(workspace, 'entregas', NAME);
    await mkdir(delivery, { recursive: true });
    await writeFile(join(delivery, 'feed-03.svg'), 'put here by a person');

    await run(
      ['render', `task/${NAME}.brief`, '--out', 'entregas', '--folder', '--types', 'svg'],
      environment(),
    );

    expect(await outFiles('entregas', NAME)).toContain('feed-03.svg');
    expect(stderr()).not.toContain('W_LEFTOVER');
  });

  it('leaves what an earlier --out run wrote, because --out removes nothing', async () => {
    await writeFile(
      join(workspace, 'task', `${NAME}.brief`),
      `${briefSource}
::slide
  Terceiro
`,
    );
    await run(['render', `task/${NAME}.brief`, '--out', 'saida', '--types', 'svg'], environment());
    await writeFile(join(workspace, 'task', `${NAME}.brief`), briefSource);
    await run(['render', `task/${NAME}.brief`, '--out', 'saida', '--types', 'svg'], environment());

    // The ADR 0011 contract: its reader reconciles against result.json itself.
    expect(await outFiles('saida')).toContain('feed-03.svg');
    expect(stderr()).not.toContain('W_LEFTOVER');
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
      'feed-01.svg',
      'feed-02.svg',
      'result.json',
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

describe('tyto render, where a slide runs off the grid (TYTO-202)', () => {
  const day = (date: string): string =>
    `  Domingo ${date} | Aplicação às 08h30 & correção às 14h\n` +
    [1, 2, 3].map((exam) => `  ${String(exam)}º Simulado TX QC - Pós-edital (Juiz)\n`).join('');

  // The first slide is two days of three exams: more than the grid holds, less than the story
  // does. The second is the example's own last slide, which fits both.
  const BRIEF = `---
template: simulados-semana-ocre
formats: [grid, story]
---
::titulo
  Agenda de Simulados

::lamina
${day('26/10')}${day('27/10')}
::lamina
  Domingo 02/11 | Aplicação às 08h30 & correção às 14h
  1º Simulado Promotor MP RJ - Pós-edital
`;

  beforeEach(async () => {
    // The built-in pack is sized for `grid`, which the cartaz project does not define.
    await writeFile(
      join(workspace, 'formats.yaml'),
      'grid: { w: 1080, h: 1350, kind: grid }\nstory: { w: 1080, h: 1920, kind: story }\n',
    );
    await writeFile(join(workspace, 'task', 'simulados.brief'), BRIEF);
  });

  it('warns on stderr, naming the slide and the format, on the lamina’s line', async () => {
    const code = await run(
      ['render', 'task/simulados.brief', '--out', 'task/out', '--types', 'svg'],
      environment(),
    );

    // A warning, not a failure: every frame is still written.
    expect(code, stderr()).toBe(EXIT_OK);
    expect(await outFiles('task', 'out')).toEqual([
      'grid-01.svg',
      'grid-02.svg',
      'result.json',
      'story-01.svg',
      'story-02.svg',
    ]);
    const warnings = stderr()
      .split('\n')
      .filter((line) => line.includes('W_TEMPLATE_OVERFLOW'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /simulados\.brief:8:1: warning W_TEMPLATE_OVERFLOW Artwork 'lamina-1' does not fit format 'grid': its content runs \d+px past/,
    );

    // Only the overflow is this card's. The simulados draw in CircularXX, a face licensed to a
    // machine and never shipped (ADR 0037), so a machine without it — CI's runner — also reports
    // one W_FONT_SUBSTITUTED per weight. Those are about the machine, not the brief.
    const parsed = parseRenderResult(await resultAt('task', 'out'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));
    const overflows = parsed.value.diagnostics.filter(
      (item) => item.code === 'W_TEMPLATE_OVERFLOW',
    );
    expect(overflows).toHaveLength(1);
    expect(overflows[0]?.message).toMatch(/^Artwork 'lamina-1' does not fit format 'grid':/);
    // On the first `::lamina`, the directive the slide came from.
    expect(overflows[0]?.range?.start).toBe(BRIEF.indexOf('::lamina'));
  });
});
