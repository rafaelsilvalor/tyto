import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { launchPluginProcess } from './plugins/plugin-process.js';
import { run } from './program.js';
import { WATCH_NEVER_FETCHES } from './sources.js';

/**
 * A plugin's images and faces, from `tyto plugin install` to `tyto render` and `tyto watch`
 * (TYTO-280, ADR 0117, ADR 0118) — against a real temp disk, the real confined plugin
 * process, and a server of this test's own that the plugin reaches through `host.fetch`.
 *
 * The server is what counts: every request it receives is a fetch the plugin made, so "the
 * second render fetches nothing" is a number this file reads, not something it infers from
 * the output. The plugin serves `test:<name>` images and one face, Tyto Fixture Mono, which
 * no machine has installed (`__fixtures__/plugin-sources/LICENSE.md`). It also ships the
 * template that draws both, so the brief needs nothing on disk but itself.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_FACE = join(HERE, '__fixtures__', 'plugin-sources', 'TytoFixtureMono-Regular.ttf');
const PACK_FORMATS = resolve(
  HERE,
  '..',
  '..',
  '..',
  'packages',
  'templates',
  'templates',
  'formats.yaml',
);
const PLUGIN = 'sources-plugin';

/** One PNG chunk: length, type, data, and the CRC of type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A PNG of one colour, written here so no binary is checked in. */
function solidPng(width: number, height: number, [red, green, blue]: readonly number[]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const pixel = [red ?? 0, green ?? 0, blue ?? 0];
  const row = Buffer.from([0, ...Array.from({ length: width }, () => pixel).flat()]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** What the server answers for `test:logo`, and a different picture to perturb the cache with. */
const LOGO = solidPng(2, 2, [12, 35, 64]);
const OTHER = solidPng(3, 1, [255, 89, 0]);

/**
 * Plain JavaScript with no imports, as `tyto plugin new --code` writes it. The text is long
 * enough, in a box narrow enough, that where its lines break depends on the face it is
 * measured with: the fixture is monospaced, the substitute is Source Sans 3.
 */
function pluginCode(base: string): string {
  return `
const BASE = ${JSON.stringify(base)};
const INK = { kind: 'solid', color: { r: 17, g: 17, b: 17, a: 1 } };
const PAPER = { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } };
const FACE = { family: 'Tyto Fixture Mono', source: 'system' };

function node(kind, x, y, fields) {
  return {
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
    opacity: 1, blend: 'normal', visible: true, clip: false, effects: [], kind, ...fields,
  };
}

function build(template, context) {
  const children = [];
  const logo = context.slots.logo;
  if (logo !== undefined && logo.value.kind === 'image') {
    children.push(node('image', 20, 20, {
      id: context.idPrefix + '.logo', asset: logo.value.asset, size: { w: 100, h: 100 },
      fit: 'contain', position: { x: 0.5, y: 0.5 },
    }));
  }
  children.push(node('text', 20, 140, {
    id: context.idPrefix + '.copy',
    box: { w: 260 },
    runs: [{ kind: 'text', text: 'Wide words wrap where the measured face decides they wrap, and nowhere else',
      font: FACE, size: 20, weight: 400, style: 'normal', color: INK }],
    align: 'left', valign: 'top', lineHeight: 1.2, letterSpacing: 0, overflow: 'grow',
  }));
  return { format: context.format, size: context.size, background: PAPER, children };
}

async function get(host, path) {
  const response = await host.fetch(BASE + path);
  if (!response.ok) throw new Error('the server answered ' + String(response.status));
  return new Uint8Array(response.body);
}

export function activate(host) {
  host.registerTemplatePack({ id: '${PLUGIN}', templates: [], directory: 'templates', build });
  host.registerAssetSource({
    id: 'test-images',
    schemes: ['test'],
    fetch: async (reference) => ({
      ok: true,
      value: { bytes: await get(host, '/image/' + encodeURIComponent(reference.slice('test:'.length))), mime: 'image/png' },
      diagnostics: [],
    }),
  });
  host.registerFontSource({
    id: 'test-fonts',
    families: ['Tyto Fixture Mono'],
    fetch: async () => ({ ok: true, value: await get(host, '/font'), diagnostics: [] }),
  });
}
`;
}

let workspace: string;
let home: string;
let errors: string[];
let server: Server;
let base: string;
/** Every request the server received, as its path: one per fetch the plugin made. */
let requests: string[];
let face: Buffer;
/** Flipped by a test to make the server refuse the face. */
let refuseFace: boolean;

function environment(tytoHome = home): CliEnvironment {
  return {
    console: { out: () => undefined, err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    home: tytoHome,
    launch: launchPluginProcess,
    rasterizer: () => {
      throw new Error('these renders are svg and never raster');
    },
  };
}

const stderr = (): string => errors.join('');

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-plugin-sources-'));
  home = join(workspace, 'home', '.tyto');
  errors = [];
  requests = [];
  refuseFace = false;
  face = await readFile(FIXTURE_FACE);
  server = createServer((request, response) => {
    const path = request.url ?? '';
    requests.push(path);
    if (path === '/font' && !refuseFace) {
      response.writeHead(200, { 'content-type': 'font/ttf' }).end(face);
    } else if (path === '/image/logo') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(LOGO);
    } else {
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  await install();
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await rm(workspace, { recursive: true, force: true });
});

async function install(): Promise<void> {
  const folder = join(workspace, 'sources', PLUGIN);
  await mkdir(join(folder, 'dist'), { recursive: true });
  await writeFile(join(folder, 'dist', 'index.js'), pluginCode(base));
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack', 'asset-source', 'font-source'],
      permissions: ['net:127.0.0.1'],
    }),
  );
  await mkdir(join(folder, 'templates', 'fontes'), { recursive: true });
  await writeFile(
    join(folder, 'templates', 'fontes', 'manifest.yaml'),
    'name: fontes\nversion: 1.0.0\nformats: [grid]\nslots:\n  logo: { type: image }\n',
  );
  expect(await run(['plugin', 'install', folder, '--yes'], environment()), stderr()).toBe(EXIT_OK);
}

interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly range?: { readonly start: number; readonly end: number };
}

interface Rendered {
  readonly code: number;
  readonly svg: string;
  readonly diagnostics: readonly Diagnostic[];
}

const FORMATS = 'grid: { w: 300, h: 400, kind: grid, label: Grid }\n';

/** A brief of the plugin's template, in `folder` (made if missing), naming `logo`. */
async function brief(folder: string, logo: string, name = 'fontes'): Promise<string> {
  await mkdir(folder, { recursive: true });
  const path = join(folder, `${name}.brief`);
  await writeFile(path, `---\ntemplate: fontes\nlogo: ${logo}\n---\n`);
  return path;
}

async function render(
  path: string,
  out: string,
  extra: readonly string[] = [],
  tytoHome = home,
): Promise<Rendered> {
  const formats = join(workspace, 'formats.yaml');
  await writeFile(formats, FORMATS);
  const code = await run(
    ['render', path, '--out', out, '--formats-file', formats, '--types', 'svg', ...extra],
    environment(tytoHome),
  );
  const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8')) as {
    diagnostics: Diagnostic[];
  };
  const [file] = (await readdir(out)).filter((name) => name.endsWith('.svg'));
  const svg = file === undefined ? '' : await readFile(join(out, file), 'utf8');
  return { code, svg, diagnostics: result.diagnostics };
}

const codes = (rendered: Rendered): string[] => rendered.diagnostics.map(({ code }) => code);
const embeds = (svg: string, png: Buffer): boolean => svg.includes(png.toString('base64'));

/** The cached image's file: the only one in the plugin's cache folder that is not a face. */
async function cachedImage(): Promise<string> {
  const folder = join(home, 'cache', 'sources', PLUGIN);
  const [file] = (await readdir(folder)).filter((name) => name.endsWith('.png'));
  if (file === undefined) throw new Error(`no cached image in ${folder}`);
  return join(folder, file);
}

// Each case starts a plugin's process more than once, which a loaded machine can hold past
// Vitest's 5 s default.
const SLOW = 60_000;

describe("a plugin's image and face reach tyto render, once", () => {
  it(
    'renders a brief with nothing on disk, and the second render fetches nothing',
    async () => {
      const path = await brief(join(workspace, 'loose'), 'test:logo');

      const cold = await render(path, join(workspace, 'out-cold'));
      expect(cold.code, stderr()).toBe(EXIT_OK);
      expect([...requests].sort()).toEqual(['/font', '/image/logo']);
      expect(codes(cold)).toEqual([]);
      expect(embeds(cold.svg, LOGO)).toBe(true);

      const warm = await render(path, join(workspace, 'out-warm'));
      expect(warm.code, stderr()).toBe(EXIT_OK);
      expect(requests).toHaveLength(2);
      expect(codes(warm)).toEqual([]);
      // The cold render compiled twice, the second time against the fetched face, so its
      // lines broke where the warm render's do. A single compile would have broken them
      // against the substitute.
      expect(cold.svg).toBe(warm.svg);
    },
    SLOW,
  );

  it(
    'says which plugin failed and where, when a fetch fails',
    async () => {
      const path = await brief(join(workspace, 'loose'), 'test:broken');
      refuseFace = true;

      const failed = await render(path, join(workspace, 'out'));
      expect(failed.code).toBe(EXIT_DIAGNOSTICS);
      const image = failed.diagnostics.find(({ code }) => code === 'E_ASSET_SOURCE_FAILED');
      expect(image?.message).toContain(PLUGIN);
      expect(image?.message).toContain('the server answered 500');
      // The range is the slot the brief set, as for any image it names.
      const source = await readFile(path, 'utf8');
      expect(image?.range).toBeDefined();
      const line = source.slice(source.lastIndexOf('\n', image?.range?.start) + 1);
      expect(line.slice(0, line.indexOf('\n'))).toBe('logo: test:broken');
      // The face is a warning beside the substitution, never a silent substitute.
      expect(codes(failed)).toEqual(
        expect.arrayContaining(['W_FONT_SOURCE_FAILED', 'W_FONT_SUBSTITUTED']),
      );
    },
    SLOW,
  );

  it(
    'draws a locally installed face over the one the plugin cached',
    async () => {
      // Cached first, so the cache holds the family the project installs below.
      await render(await brief(join(workspace, 'loose'), 'test:logo'), join(workspace, 'out-1'));
      expect(requests).toHaveLength(2);

      // The same face with four bytes more: still a font, and told apart by what is embedded.
      const project = join(workspace, 'project');
      await mkdir(join(project, '.tyto'), { recursive: true });
      await mkdir(join(project, 'fonts'), { recursive: true });
      await writeFile(join(project, '.tyto', 'project.json'), '{ "fonts": ["fonts"] }\n');
      const local = Buffer.concat([face, Buffer.alloc(4)]);
      await writeFile(join(project, 'fonts', 'TytoFixtureMono-Regular.ttf'), local);

      const rendered = await render(await brief(project, 'test:logo'), join(workspace, 'out-2'), [
        '--trust',
      ]);
      expect(rendered.code, stderr()).toBe(EXIT_OK);
      expect(requests).toHaveLength(2);
      expect(rendered.svg).toContain(local.toString('base64'));
    },
    SLOW,
  );

  it(
    'draws a changed cache entry as it is, and fetches a deleted one again',
    async () => {
      const path = await brief(join(workspace, 'loose'), 'test:logo');
      await render(path, join(workspace, 'out-1'));
      expect(requests).toHaveLength(2);

      // Kept until deleted (ADR 0117): an entry is never compared with its source.
      const entry = await cachedImage();
      await writeFile(entry, OTHER);
      const changed = await render(path, join(workspace, 'out-2'));
      expect(requests).toHaveLength(2);
      expect(embeds(changed.svg, OTHER)).toBe(true);

      await rm(entry);
      const refetched = await render(path, join(workspace, 'out-3'));
      expect(requests.slice(2)).toEqual(['/image/logo']);
      expect(embeds(refetched.svg, LOGO)).toBe(true);
    },
    SLOW,
  );
});

describe('where a run may fetch (ADR 0118)', () => {
  async function restricted(): Promise<string> {
    const project = join(workspace, 'project');
    await mkdir(join(project, '.tyto'), { recursive: true });
    await writeFile(join(project, '.tyto', 'project.json'), '{}\n');
    return brief(project, 'test:logo');
  }

  it(
    'fetches nothing for a restricted folder, and says to trust it',
    async () => {
      const failed = await render(await restricted(), join(workspace, 'out'));
      expect(requests).toEqual([]);
      expect(failed.code).toBe(EXIT_DIAGNOSTICS);
      const image = failed.diagnostics.find(({ code }) => code === 'E_ASSET_SOURCE_FAILED');
      expect(image?.message).toContain('trust the folder to fetch');
      expect(codes(failed)).toContain('W_FONT_SOURCE_FAILED');
    },
    SLOW,
  );

  it(
    'fetches for the same folder under --trust',
    async () => {
      const trusted = await render(await restricted(), join(workspace, 'out'), ['--trust']);
      expect(trusted.code, stderr()).toBe(EXIT_OK);
      expect([...requests].sort()).toEqual(['/font', '/image/logo']);
    },
    SLOW,
  );

  it(
    'never fetches under tyto watch, says to render once, and draws what that render cached',
    async () => {
      const root = join(workspace, 'queue');
      const task = join(root, 'inbox', 'task-1');
      await brief(task, 'test:logo', 'brief');
      const formats = join(workspace, 'formats.yaml');
      await writeFile(formats, FORMATS);
      const watch = (): Promise<number> =>
        run(['watch', root, '--once', '--formats-file', formats, '--types', 'svg'], environment());
      const resultOf = async (): Promise<{ diagnostics: Diagnostic[] }> =>
        JSON.parse(
          await readFile(join(root, 'outbox', 'task-1', 'out', 'result.json'), 'utf8'),
        ) as { diagnostics: Diagnostic[] };

      await watch();
      expect(requests).toEqual([]);
      const missed = (await resultOf()).diagnostics.find(
        ({ code }) => code === 'E_ASSET_SOURCE_FAILED',
      );
      expect(missed?.message).toContain(WATCH_NEVER_FETCHES);
      expect(missed?.message).not.toContain('trust the folder');

      // The cache is this machine's, so one `tyto render` of the same reference fills it.
      await render(await brief(join(workspace, 'loose'), 'test:logo'), join(workspace, 'out'));
      expect(requests).toHaveLength(2);
      await brief(join(root, 'inbox', 'task-1'), 'test:logo', 'brief');
      await watch();
      expect(requests).toHaveLength(2);
      expect((await resultOf()).diagnostics.map(({ code }) => code)).toEqual([]);
    },
    SLOW,
  );
});

describe('a --folder render of a fetched image (ADR 0118, ADR 0157)', () => {
  /**
   * A built-in template, so the plugin here only supplies the image. `promo-curso` has an
   * optional image slot.
   */
  const PROMO = [
    '---',
    'template: promo-curso',
    'formats: [grid-1x1]',
    'imagem: test:logo',
    '---',
    '',
    '::titulo',
    '  TESTE',
    '',
  ].join('\n');

  it(
    'draws it, and writes the artwork alone: no assets/ copy since TYTO-490',
    async () => {
      const folder = join(workspace, 'loose');
      await mkdir(folder, { recursive: true });
      const path = join(folder, 'entrega.brief');
      await writeFile(path, PROMO);
      const out = join(workspace, 'delivered');

      const code = await run(
        [
          'render',
          path,
          '--out',
          out,
          '--folder',
          '--formats-file',
          PACK_FORMATS,
          '--types',
          'svg',
        ],
        environment(home),
      );

      expect(code, stderr()).toBe(EXIT_OK);
      expect(requests).toContain('/image/logo');
      // The fetched image is in the artwork, and nowhere else in the folder (ADR 0157).
      const written = await readdir(join(out, 'entrega'));
      expect(written).toEqual(['grid-1x1-01.svg']);
      const svg = await readFile(join(out, 'entrega', 'grid-1x1-01.svg'), 'utf8');
      expect(embeds(svg, LOGO)).toBe(true);
    },
    SLOW,
  );
});
