import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build as bundle } from 'esbuild';
import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { run } from './program.js';

/**
 * An installed code template, from `tyto plugin install` to `tyto render` (TYTO-189,
 * ADR 0048) — against a real temp disk and the real, confined plugin process.
 *
 * The template is `banner-roxo`, the built-in pack's code template, which draws its
 * background from its own folder (TYTO-478), bundled the way a plugin author bundles one: every import inlined into `dist/index.js`,
 * `@tyto/*` included, so the installed folder runs on its own. The folder lives under the
 * system's temp directory, where no `node_modules` is above it; the one test that leaves a
 * `@tyto` package external is the proof that nothing else is resolving it.
 *
 * The claim is the card's acceptance criterion: the plugin's render of the example brief
 * is the in-repo render, byte for byte.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(HERE, '..', '..', '..', 'packages', 'templates', 'templates');
const BANNER = join(PACK, 'banner-roxo');
const FORMATS = join(PACK, 'formats.yaml');
const NAME = 'banner-plugin';

let workspace: string;
let home: string;
let errors: string[];

function environment(cwd: string = workspace): CliEnvironment {
  return {
    console: { out: () => undefined, err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd,
    home,
    rasterizer: () => {
      throw new Error('these renders are svg and never raster');
    },
  };
}

const stderr = (): string => errors.join('');

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-code-template-'));
  home = join(workspace, 'home', '.tyto');
  errors = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/**
 * The plugin's folder: its manifest, the bundle, and the template's folder with the
 * manifest renamed, its faces declared and its backgrounds beside it — and no `template.ts`,
 * which a pack may not hold.
 */
async function packedBanner(options: { readonly external?: readonly string[] } = {}) {
  const folder = join(workspace, NAME);
  await bundle({
    stdin: {
      contents: `import { build } from './template.ts';
export function activate(host) {
  host.registerTemplatePack({
    id: '${NAME}',
    templates: [],
    directory: 'templates',
    build: (template, context) => build(context),
  });
}
`,
      resolveDir: BANNER,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: join(folder, 'dist', 'index.js'),
    external: [...(options.external ?? [])],
    logLevel: 'silent',
  });
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: NAME,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack'],
      permissions: ['font:CircularXX'],
    }),
  );
  const template = join(folder, 'templates', NAME);
  await mkdir(template, { recursive: true });
  await cp(join(BANNER, 'assets'), join(template, 'assets'), { recursive: true });
  const manifest = (await readFile(join(BANNER, 'manifest.yaml'), 'utf8')).replace(
    /^name: banner-roxo$/mu,
    `name: ${NAME}`,
  );
  await writeFile(
    join(template, 'manifest.yaml'),
    `${manifest}faces:\n` +
      [400, 700]
        .map((weight) => `  - { family: CircularXX, weight: ${String(weight)} }\n`)
        .join(''),
  );
  return folder;
}

/** An example brief, in a folder of its own, naming `template`. */
async function briefFor(template: string, into: string): Promise<string> {
  await cp(join(BANNER, 'examples'), into, { recursive: true });
  const path = join(into, 'agencia.brief');
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/^template: banner-roxo$/mu, `template: ${template}`));
  return path;
}

interface Rendered {
  readonly code: number;
  readonly files: ReadonlyMap<string, string>;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

async function render(brief: string, out: string): Promise<Rendered> {
  const code = await run(
    ['render', brief, '--out', out, '--formats-file', FORMATS, '--types', 'svg'],
    environment(),
  );
  const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8')) as {
    diagnostics: { code: string; message: string }[];
  };
  const files = new Map<string, string>();
  for (const name of await readdir(out)) {
    if (name.endsWith('.svg')) files.set(name, await readFile(join(out, name), 'utf8'));
  }
  return { code, files, diagnostics: result.diagnostics };
}

describe('tyto plugin new --code', () => {
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('scaffolds a code template that installs and renders with nothing edited', async () => {
    expect(
      await run(['plugin', 'new', 'meu-codigo', '--code', '--out', 'sources'], environment()),
      stderr(),
    ).toBe(EXIT_OK);
    const folder = join(workspace, 'sources', 'meu-codigo');
    const template = join(folder, 'templates', 'meu-codigo');
    expect((await readdir(template)).sort()).toEqual(['examples', 'manifest.yaml']);

    expect(await run(['plugin', 'install', folder, '--yes'], environment()), stderr()).toBe(
      EXIT_OK,
    );
    const out = join(workspace, 'out');
    const code = await run(
      [
        'render',
        join(template, 'examples', 'meu-codigo.brief'),
        '--out',
        out,
        '--formats-file',
        join(folder, 'templates', 'formats.yaml'),
        '--types',
        'svg',
      ],
      environment(),
    );
    const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8')) as {
      diagnostics: unknown[];
    };

    expect(code, stderr()).toBe(EXIT_OK);
    expect(result.diagnostics).toEqual([]);
    const svg = await readFile(join(out, 'grid-01.svg'), 'utf8');
    // Three lines of 72 px at 1.2, measured in the plugin's process: the band is 259.2 + 80
    // tall. Unmeasured, it would be one line's 86.4 + 80.
    expect(svg.match(/<text /gu)).toHaveLength(3);
    expect(svg).toContain('V339.2 H0');
  }, 60_000);
});

/** A 1×1 PNG, and a different one, so the file the template drew is told from another. */
const BG_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);
const OUTSIDE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * A code template's `build` that draws `assets/bg.png` from its own folder full-bleed, and a
 * rect named after what `../outside.png` and an absolute path answered, so the render says.
 */
function ownFolderEntry(name: string, absolute: string): string {
  return `function node(kind, id, w, h, fields) {
  return {
    id, kind, size: { w, h },
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
    opacity: 1, blend: 'normal', visible: true, clip: false, effects: [], ...fields,
  };
}
function build(template, context) {
  const { w, h } = context.size;
  const bg = context.files.image('assets/bg.png');
  const escaped = [context.files.image('../outside.png'), context.files.image(${JSON.stringify(absolute)})];
  const children = [
    node('rect', context.idPrefix + '.escaped-' + escaped.filter((ref) => ref !== undefined).length, 1, 1, {
      radius: [0, 0, 0, 0],
      fill: { kind: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } },
    }),
  ];
  if (bg !== undefined) {
    children.unshift(node('image', context.idPrefix + '.bg', w, h, { asset: bg, fit: 'cover' }));
  }
  return { format: context.format, size: context.size, children };
}
export function activate(host) {
  host.registerTemplatePack({ id: '${name}', templates: [], directory: 'templates', build });
}
`;
}

describe("an installed code template's own folder (TYTO-478)", () => {
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('draws a picture from its folder in tyto render, and nothing from outside it', async () => {
    expect(
      await run(['plugin', 'new', 'fundo', '--code', '--out', 'sources'], environment()),
      stderr(),
    ).toBe(EXIT_OK);
    const folder = join(workspace, 'sources', 'fundo');
    const template = join(folder, 'templates', 'fundo');
    const outside = join(folder, 'templates', 'outside.png');
    await mkdir(join(template, 'assets'), { recursive: true });
    await writeFile(join(template, 'assets', 'bg.png'), BG_PNG);
    await writeFile(outside, OUTSIDE_PNG);
    await writeFile(join(folder, 'dist', 'index.js'), ownFolderEntry('fundo', outside));
    expect(await run(['plugin', 'install', folder, '--yes'], environment()), stderr()).toBe(
      EXIT_OK,
    );

    const out = join(workspace, 'out');
    const code = await run(
      [
        'render',
        join(template, 'examples', 'fundo.brief'),
        '--out',
        out,
        '--formats-file',
        join(folder, 'templates', 'formats.yaml'),
        '--types',
        'svg',
      ],
      environment(),
    );
    const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8')) as {
      diagnostics: unknown[];
    };

    expect(code, stderr()).toBe(EXIT_OK);
    expect(result.diagnostics).toEqual([]);
    const svg = await readFile(join(out, 'grid-01.svg'), 'utf8');
    // The bytes the host read from the installed folder, embedded; none from outside it.
    expect(svg).toContain(`data:image/png;base64,${BG_PNG.toString('base64')}`);
    expect(svg).not.toContain(OUTSIDE_PNG.toString('base64'));
    expect(svg).toContain('escaped-0');
  }, 60_000);
});

describe('banner-roxo, packed as a plugin', () => {
  // Starts a plugin's worker thread and bundles a template, which a full `pnpm check` can
  // hold past Vitest's 5 s.
  it('renders from tyto render exactly as the in-repo template does', async () => {
    const plugin = await packedBanner();
    expect(await run(['plugin', 'install', plugin, '--yes'], environment()), stderr()).toBe(
      EXIT_OK,
    );

    const inRepo = await render(
      await briefFor('banner-roxo', join(workspace, 'in-repo')),
      join(workspace, 'out-in-repo'),
    );
    const installed = await render(
      await briefFor(NAME, join(workspace, 'installed')),
      join(workspace, 'out-installed'),
    );

    expect(inRepo.code, stderr()).toBe(EXIT_OK);
    expect(installed.code, stderr()).toBe(EXIT_OK);
    expect(installed.diagnostics).toEqual(inRepo.diagnostics);
    expect([...installed.files.keys()]).toEqual([...inRepo.files.keys()]);
    expect(installed.files.size).toBeGreaterThan(0);
    for (const [name, svg] of inRepo.files) {
      expect(installed.files.get(name), name).toBe(svg);
    }
  }, 120_000);

  // The primary proof that the installed folder runs on its own: leave one `@tyto` package
  // out of the bundle and the plugin cannot even activate, because nothing above the temp
  // folder has a `node_modules` to find it in.
  it('does not activate when a @tyto package is left out of its bundle', async () => {
    const plugin = await packedBanner({ external: ['@tyto/house-style'] });
    expect(await run(['plugin', 'install', plugin, '--yes'], environment()), stderr()).toBe(
      EXIT_OK,
    );

    const installed = await render(
      await briefFor(NAME, join(workspace, 'installed')),
      join(workspace, 'out-installed'),
    );

    const codes = installed.diagnostics.map((item) => item.code);
    expect(codes).toContain('W_PLUGIN_SKIPPED');
    expect(codes).toContain('E_UNKNOWN_TEMPLATE');
    expect(
      installed.diagnostics.find((item) => item.code === 'W_PLUGIN_SKIPPED')?.message,
    ).toContain('@tyto/house-style');
  }, 120_000);
});
