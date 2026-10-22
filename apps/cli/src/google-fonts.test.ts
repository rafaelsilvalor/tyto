import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { USER_AGENT } from '@tyto/google-fonts';
import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { GOOGLE_FONTS_BASE, GOOGLE_FONTS_SWITCH } from './google-fonts.js';
import { run } from './program.js';

/**
 * A template's missing face, from Google Fonts on first use (TYTO-281, ADR 0120) — through the
 * real CLI, a real installed plugin for the templates, and a server of this file's own standing
 * in for Google through `TYTO_GOOGLE_FONTS_BASE`. **Every request it receives is one the CLI
 * made**, so each count below is measured; no request reaches Google (`vitest.no-google.setup.ts`).
 *
 * Two templates, one face each: Syne Mono, which Google serves (the fixture is Google's own
 * file, subset; `__fixtures__/google-fonts/LICENSE.md`), and Tyto Licensed Sans, an invented
 * family standing for a licensed one. Not CircularXX: the maintainer's machine has it
 * installed, so there nothing would be missing — measured on 2026-10-22.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FACE_FILE = join(HERE, '__fixtures__', 'google-fonts', 'SyneMono-Regular.ttf');
const ALTERNATIVES = ['Inter', 'Manrope', 'DM Sans'];

/** Plain JavaScript with no imports: one line of text in `family`, as `tyto plugin new --code` writes. */
const TEMPLATE_CODE = `
const INK = { kind: 'solid', color: { r: 17, g: 17, b: 17, a: 1 } };
const PAPER = { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } };
const FAMILY = { 'tipo-google': ['Syne Mono', 400], 'tipo-licenciado': ['Tyto Licensed Sans', 500] };

function build(template, context) {
  const name = typeof template === 'string' ? template : template.name ?? template.manifest.name;
  const [family, weight] = FAMILY[name];
  return {
    format: context.format, size: context.size, background: PAPER,
    children: [{
      transform: { x: 20, y: 20, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
      opacity: 1, blend: 'normal', visible: true, clip: false, effects: [], kind: 'text',
      id: context.idPrefix + '.copy', box: { w: 260 },
      runs: [{ kind: 'text', text: 'Words that wrap where the face decides they wrap',
        font: { family, source: 'system' }, size: 20, weight, style: 'normal', color: INK }],
      align: 'left', valign: 'top', lineHeight: 1.2, letterSpacing: 0, overflow: 'grow',
    }],
  };
}

export function activate(host) {
  host.registerTemplatePack({ id: 'tipos', templates: [], directory: 'templates', build });
}
`;

let workspace: string;
let home: string;
let errors: string[];
let server: Server;
let base: string;
/** Every request the server received: its path and the `User-Agent` it came with. */
let requests: { readonly path: string; readonly agent: string | undefined }[];
let face: Buffer;
/** Flipped by a test to make the server answer like a network that is down. */
let down: boolean;

function environment(variables: Record<string, string> = { [GOOGLE_FONTS_BASE]: base }) {
  return {
    console: { out: () => undefined, err: (text: string) => errors.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    home,
    variables,
    rasterizer: () => {
      throw new Error('these renders are svg and never raster');
    },
  } satisfies CliEnvironment;
}

const stderr = (): string => errors.join('');

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-google-fonts-'));
  home = join(workspace, 'home', '.tyto');
  errors = [];
  requests = [];
  down = false;
  face = await readFile(FACE_FILE);
  server = createServer((request, response) => {
    const path = request.url ?? '';
    requests.push({ path, agent: request.headers['user-agent'] });
    if (down) {
      response.writeHead(503).end();
    } else if (path === '/css2?family=Syne+Mono:wght@400') {
      response
        .writeHead(200, { 'content-type': 'text/css' })
        .end(
          `@font-face {\n  font-family: 'Syne Mono';\n  font-style: normal;\n  font-weight: 400;\n  src: url(${base}/s/synemono/v16/test.ttf) format('truetype');\n}\n`,
        );
    } else if (path === '/s/synemono/v16/test.ttf') {
      response.writeHead(200, { 'content-type': 'font/ttf' }).end(face);
    } else {
      response.writeHead(400).end();
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
  const folder = join(workspace, 'sources', 'tipos');
  await mkdir(join(folder, 'dist'), { recursive: true });
  await writeFile(join(folder, 'dist', 'index.js'), TEMPLATE_CODE);
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'tipos',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack'],
      permissions: [],
    }),
  );
  const manifest = (name: string, extra: string): string =>
    `name: ${name}\nversion: 1.0.0\nformats: [grid]\nslots: {}\n${extra}`;
  await mkdir(join(folder, 'templates', 'tipo-google'), { recursive: true });
  await writeFile(
    join(folder, 'templates', 'tipo-google', 'manifest.yaml'),
    manifest('tipo-google', ''),
  );
  await mkdir(join(folder, 'templates', 'tipo-licenciado'), { recursive: true });
  await writeFile(
    join(folder, 'templates', 'tipo-licenciado', 'manifest.yaml'),
    manifest(
      'tipo-licenciado',
      `fonts:\n  Tyto Licensed Sans: { alternatives: [${ALTERNATIVES.join(', ')}] }\n`,
    ),
  );
  expect(await run(['plugin', 'install', folder, '--yes'], environment({})), stderr()).toBe(
    EXIT_OK,
  );
}

interface Diagnostic {
  readonly code: string;
  readonly message: string;
}

interface Rendered {
  readonly code: number;
  readonly svg: string;
  readonly diagnostics: readonly Diagnostic[];
}

async function render(
  template: string,
  out: string,
  options: {
    readonly variables?: Record<string, string>;
    readonly extra?: readonly string[];
    readonly folder?: string;
  } = {},
): Promise<Rendered> {
  const folder = options.folder ?? join(workspace, 'loose');
  await mkdir(folder, { recursive: true });
  const brief = join(folder, `${template}.brief`);
  await writeFile(brief, `---\ntemplate: ${template}\n---\n`);
  const formats = join(workspace, 'formats.yaml');
  await writeFile(formats, 'grid: { w: 300, h: 300, kind: grid, label: Grid }\n');
  const code = await run(
    [
      'render',
      brief,
      '--out',
      out,
      '--formats-file',
      formats,
      '--types',
      'svg',
      ...(options.extra ?? []),
    ],
    environment(options.variables),
  );
  const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8')) as {
    diagnostics: Diagnostic[];
  };
  const [file] = (await readdir(out)).filter((name) => name.endsWith('.svg'));
  const svg = file === undefined ? '' : await readFile(join(out, file), 'utf8');
  return { code, svg, diagnostics: result.diagnostics };
}

const codes = (rendered: Rendered): string[] => rendered.diagnostics.map(({ code }) => code);

// Each render starts the templates' plugin process, which a loaded machine can hold past 5 s.
const SLOW = 60_000;

describe('a family Google Fonts serves', () => {
  it(
    'is fetched once, drawn, and read from the cache by the next render',
    async () => {
      const first = await render('tipo-google', join(workspace, 'out-1'));
      expect(first.code, stderr()).toBe(EXIT_OK);
      expect(requests.map(({ path }) => path)).toEqual([
        '/css2?family=Syne+Mono:wght@400',
        '/s/synemono/v16/test.ttf',
      ]);
      // Named, never a browser's: a browser is answered with WOFF2, which the library cannot read.
      expect(requests.every(({ agent }) => agent === USER_AGENT)).toBe(true);
      expect(codes(first)).toEqual([]);
      expect(first.svg).toContain(face.toString('base64'));

      const second = await render('tipo-google', join(workspace, 'out-2'));
      expect(requests).toHaveLength(2);
      expect(second.svg).toBe(first.svg);
    },
    SLOW,
  );

  it(
    'says why when the network is down, and draws the substitute it names',
    async () => {
      down = true;
      const failed = await render('tipo-google', join(workspace, 'out'));
      expect(failed.code, stderr()).toBe(EXIT_OK);
      expect(codes(failed).sort()).toEqual(['W_FONT_SOURCE_FAILED', 'W_FONT_SUBSTITUTED']);
      expect(
        failed.diagnostics.find(({ code }) => code === 'W_FONT_SOURCE_FAILED')?.message,
      ).toContain('Google Fonts answered 503');
    },
    SLOW,
  );
});

describe('a family nobody can supply', () => {
  it(
    'is never asked for, and one line names it, the substitute and the alternatives',
    async () => {
      const rendered = await render('tipo-licenciado', join(workspace, 'out'));
      expect(rendered.code, stderr()).toBe(EXIT_OK);
      expect(requests).toEqual([]);
      expect(codes(rendered)).toEqual(['W_FONT_UNAVAILABLE']);
      const message = rendered.diagnostics[0]?.message ?? '';
      expect(message).toContain(
        "Font 'Tyto Licensed Sans 500 normal' is not installed on this machine",
      );
      expect(message).toContain("Drawn in 'Source Sans 3");
      expect(message).toContain(`Free fonts of the same kind: ${ALTERNATIVES.join(', ')}.`);
    },
    SLOW,
  );
});

describe('turned off (ADR 0120)', () => {
  it.each([
    ['TYTO_GOOGLE_FONTS=off', { variables: { [GOOGLE_FONTS_SWITCH]: 'off' } }],
    ['--no-google-fonts', { extra: ['--no-google-fonts'] }],
  ] as const)(
    'by %s: asks nothing, and says W_FONT_SUBSTITUTED exactly as before',
    async (_how, how) => {
      const options = {
        ...how,
        variables: { [GOOGLE_FONTS_BASE]: base, ...('variables' in how ? how.variables : {}) },
      };
      const google = await render('tipo-google', join(workspace, 'out-1'), options);
      const licensed = await render('tipo-licenciado', join(workspace, 'out-2'), options);
      expect(requests).toEqual([]);
      expect(codes(google)).toEqual(['W_FONT_SUBSTITUTED']);
      expect(codes(licensed)).toEqual(['W_FONT_SUBSTITUTED']);
    },
    SLOW,
  );
});

describe('where the plugin connects (ADR 0120)', () => {
  it(
    'is never a project file’s to say: a section naming a server is ignored',
    async () => {
      const project = join(workspace, 'project');
      await mkdir(join(project, '.tyto'), { recursive: true });
      await writeFile(
        join(project, '.tyto', 'project.json'),
        // Under `plugins`, where a section is read from (ADR 0112): a key at the top was a
        // section that never reached the plugin, and this case passed with the hole open.
        JSON.stringify({ plugins: { 'google-fonts': { base, [GOOGLE_FONTS_BASE]: base } } }),
      );
      // Trusted, so the section reaches the plugin; the environment names no server.
      const rendered = await render('tipo-google', join(workspace, 'out'), {
        folder: project,
        variables: {},
        extra: ['--trust'],
      });
      expect(requests).toEqual([]);
      expect(
        rendered.diagnostics.find(({ code }) => code === 'W_FONT_SOURCE_FAILED')?.message,
      ).toContain('fonts.googleapis.com');
    },
    SLOW,
  );
});
