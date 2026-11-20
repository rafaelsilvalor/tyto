import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { openSession } from './mcp/session.js';
import { launchPluginProcess } from './plugins/plugin-process.js';
import { run } from './program.js';

/**
 * A plugin's `image-decoder`, from `tyto plugin install` to `tyto render`, `tyto watch` and
 * `tyto mcp` (TYTO-742, ADR 0223) — against a real temp disk and the real confined plugin
 * process, which reads the cited file through its one-call token in parts.
 *
 * The plugin decodes `.fake` files: JSON naming a PNG per layer, which this file writes, so no
 * binary is checked in. It reports every decode to a server of this test's own through
 * `host.fetch`, so "the second render decodes nothing" is a count this file reads.
 */

const PLUGIN = 'fake-decoder';

/** One PNG chunk: length, type, data, and the CRC of type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A PNG of one colour. */
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

const COMPOSITE = solidPng(2, 2, [12, 35, 64]);
const ARTE = solidPng(3, 1, [255, 89, 0]);

/** The `.fake` file: a PNG per layer, the composite under `''`. */
const FAKE = JSON.stringify({
  '': COMPOSITE.toString('base64'),
  arte: ARTE.toString('base64'),
});

/** Plain JavaScript with no imports, as `tyto plugin new --code` writes it. */
function pluginCode(base: string): string {
  return `
const BASE = ${JSON.stringify(base)};
const PAPER = { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } };

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
  return { format: context.format, size: context.size, background: PAPER, children };
}

/** The whole file, in parts of 7 bytes, so a decode crosses the channel many times. */
async function readAll(host, file) {
  const parts = [];
  let offset = 0;
  for (;;) {
    const part = await host.decoding.read(file.token, { offset, length: 7 });
    if (part.length === 0) break;
    parts.push(...part);
    offset += part.length;
  }
  return new TextDecoder().decode(new Uint8Array(parts));
}

export function activate(host) {
  host.registerTemplatePack({ id: '${PLUGIN}', templates: [], directory: 'templates', build });
  host.registerImageDecoder({
    id: 'fake-images',
    extensions: ['.fake'],
    decode: async (file, request) => {
      await host.fetch(BASE + '/decoded/' + encodeURIComponent(file.name + '#' + (request.layer ?? '')));
      const layers = JSON.parse(await readAll(host, file));
      const picked = layers[request.layer ?? ''];
      if (picked === undefined) {
        return { ok: false, error: [{ code: 'E_PLUGIN_CALL', severity: 'error', message: 'no layer ' + request.layer }] };
      }
      return { ok: true, value: { bytes: Uint8Array.from(atob(picked), (c) => c.charCodeAt(0)) }, diagnostics: [] };
    },
  });
}
`;
}

let workspace: string;
let home: string;
let errors: string[];
let server: Server;
/** Every decode the plugin made, as the path it reported. */
let requests: string[];

function environment(cwd = workspace): CliEnvironment {
  return {
    console: { out: () => undefined, err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd,
    home,
    launch: launchPluginProcess,
    rasterizer: () => {
      throw new Error('these renders are svg and never raster');
    },
  };
}

const stderr = (): string => errors.join('');

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-plugin-decoders-'));
  home = join(workspace, 'home', '.tyto');
  errors = [];
  requests = [];
  server = createServer((request, response) => {
    requests.push(decodeURIComponent(request.url ?? ''));
    response.writeHead(200).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  await install(base);
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await rm(workspace, { recursive: true, force: true });
});

async function install(base: string): Promise<void> {
  const folder = join(workspace, 'sources', PLUGIN);
  await mkdir(join(folder, 'dist'), { recursive: true });
  await writeFile(join(folder, 'dist', 'index.js'), pluginCode(base));
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack', 'image-decoder'],
      permissions: ['net:127.0.0.1'],
    }),
  );
  await mkdir(join(folder, 'templates', 'arte'), { recursive: true });
  await writeFile(
    join(folder, 'templates', 'arte', 'manifest.yaml'),
    'name: arte\nversion: 1.0.0\nformats: [grid]\nslots:\n  logo: { type: image }\n',
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

/** A brief of the plugin's template in `folder`, with `art.fake` and `art.other` beside it. */
async function brief(folder: string, logo: string, name = 'arte'): Promise<string> {
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'art.fake'), FAKE);
  await writeFile(join(folder, 'art.other'), FAKE);
  await writeFile(join(folder, 'formats.yaml'), FORMATS);
  const path = join(folder, `${name}.brief`);
  await writeFile(path, `---\ntemplate: arte\nlogo: ${logo}\n---\n`);
  return path;
}

async function render(path: string, out: string, extra: readonly string[] = []): Promise<Rendered> {
  const formats = join(workspace, 'formats.yaml');
  await writeFile(formats, FORMATS);
  const code = await run(
    ['render', path, '--out', out, '--formats-file', formats, '--types', 'svg', ...extra],
    environment(),
  );
  const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8')) as {
    diagnostics: Diagnostic[];
  };
  const [file] = (await readdir(out)).filter((name) => name.endsWith('.svg'));
  const svg = file === undefined ? '' : await readFile(join(out, file), 'utf8');
  return { code, svg, diagnostics: result.diagnostics };
}

const codes = (rendered: { diagnostics: readonly Diagnostic[] }): string[] =>
  rendered.diagnostics.map(({ code }) => code);
const embeds = (svg: string, png: Buffer): boolean => svg.includes(png.toString('base64'));

/** The line of `path` a diagnostic's range starts on. */
async function lineOf(path: string, found: Diagnostic | undefined): Promise<string> {
  const source = await readFile(path, 'utf8');
  const start = found?.range?.start ?? -1;
  const line = source.slice(source.lastIndexOf('\n', start) + 1);
  return line.slice(0, line.indexOf('\n'));
}

// Each case starts a plugin's process more than once, which a loaded machine can hold past
// Vitest's 5 s default.
const SLOW = 60_000;

describe('a plugin decodes a cited file for tyto render, once (ADR 0223)', () => {
  it(
    'draws the layer a fragment names, and the second render decodes nothing',
    async () => {
      const path = await brief(join(workspace, 'loose'), 'art.fake#arte');

      const cold = await render(path, join(workspace, 'out-cold'));
      expect(cold.code, stderr()).toBe(EXIT_OK);
      expect(codes(cold)).toEqual([]);
      expect(requests).toEqual(['/decoded/art.fake#arte']);
      expect(embeds(cold.svg, ARTE)).toBe(true);
      expect(embeds(cold.svg, COMPOSITE)).toBe(false);
      const cached = await readdir(join(home, 'cache', 'decoded', PLUGIN));
      expect(cached).toHaveLength(1);

      const warm = await render(path, join(workspace, 'out-warm'));
      expect(warm.code, stderr()).toBe(EXIT_OK);
      expect(requests).toHaveLength(1);
      expect(embeds(warm.svg, ARTE)).toBe(true);
    },
    SLOW,
  );

  it(
    'says a plugin is needed, at the brief line, for a kind no installed plugin decodes',
    async () => {
      const path = await brief(join(workspace, 'loose'), 'art.other');

      const failed = await render(path, join(workspace, 'out'));
      expect(failed.code).toBe(EXIT_DIAGNOSTICS);
      expect(requests).toEqual([]);
      const missing = failed.diagnostics.find(({ code }) => code === 'E_ASSET_DECODER_MISSING');
      expect(missing?.message).toContain("'.other'");
      expect(await lineOf(path, missing)).toBe('logo: art.other');
    },
    SLOW,
  );

  it(
    "says the plugin's own message when the decode fails",
    async () => {
      const path = await brief(join(workspace, 'loose'), 'art.fake#nada');

      const failed = await render(path, join(workspace, 'out'));
      expect(failed.code).toBe(EXIT_DIAGNOSTICS);
      const said = failed.diagnostics.find(({ code }) => code === 'E_ASSET_DECODE_FAILED');
      expect(said?.message).toContain('no layer nada');
      expect(await lineOf(path, said)).toBe('logo: art.fake#nada');
    },
    SLOW,
  );
});

describe('where a run may decode (ADR 0223, decision 8)', () => {
  async function restricted(): Promise<string> {
    const project = join(workspace, 'project');
    await mkdir(join(project, '.tyto'), { recursive: true });
    await writeFile(join(project, '.tyto', 'project.json'), '{}\n');
    return brief(project, 'art.fake');
  }

  it(
    'decodes nothing for a restricted folder, says to trust it, and decodes under --trust',
    async () => {
      const path = await restricted();
      const failed = await render(path, join(workspace, 'out-1'));
      expect(failed.code).toBe(EXIT_DIAGNOSTICS);
      expect(requests).toEqual([]);
      const said = failed.diagnostics.find(({ code }) => code === 'E_ASSET_DECODE_FAILED');
      expect(said?.message).toContain('trust the folder to decode');

      const trusted = await render(path, join(workspace, 'out-2'), ['--trust']);
      expect(trusted.code, stderr()).toBe(EXIT_OK);
      expect(requests).toEqual(['/decoded/art.fake#']);
      expect(embeds(trusted.svg, COMPOSITE)).toBe(true);
    },
    SLOW,
  );

  it(
    'decodes under tyto watch, which fetches nothing',
    async () => {
      const root = join(workspace, 'queue');
      await brief(join(root, 'inbox', 'task-1'), 'art.fake', 'brief');
      const formats = join(workspace, 'formats.yaml');
      await writeFile(formats, FORMATS);
      const code = await run(
        ['watch', root, '--once', '--formats-file', formats, '--types', 'svg'],
        environment(),
      );
      expect(code, stderr()).toBe(EXIT_OK);
      expect(requests).toEqual(['/decoded/art.fake#']);
      const result = JSON.parse(
        await readFile(join(root, 'outbox', 'task-1', 'out', 'result.json'), 'utf8'),
      ) as { diagnostics: Diagnostic[] };
      expect(codes(result)).toEqual([]);
    },
    SLOW,
  );

  it(
    'decodes for tyto mcp in a trusted workspace, the file confined to its folder',
    async () => {
      const project = join(workspace, 'project');
      await mkdir(join(project, '.tyto'), { recursive: true });
      await writeFile(join(project, '.tyto', 'project.json'), '{}\n');
      expect(await run(['trust', 'add', project], environment()), stderr()).toBe(EXIT_OK);
      await brief(project, 'art.fake#arte');

      const session = await openSession(environment(project));
      try {
        expect(session.trust).toBe('trusted');
        const answer = await session.checkBrief({ path: 'arte.brief' });
        expect(answer.diagnostics.map(({ code }) => code)).toEqual([]);
        expect(answer.status).toBe('ok');
        expect(requests).toEqual(['/decoded/art.fake#arte']);
      } finally {
        await session.close();
      }
    },
    SLOW,
  );
});
