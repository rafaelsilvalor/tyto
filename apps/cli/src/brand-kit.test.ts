import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_OK } from './exit.js';
import { run } from './program.js';

/**
 * A brand kit, from `tyto plugin install` to `tyto render` (TYTO-223, ADR 0063) — against a
 * real temp disk and the real, confined plugin process.
 *
 * One installed plugin contributes a kit for `test-brand` and two code templates: one of
 * that brand and one of `other-brand`. Each template draws the logo it was handed as a path
 * and prints the signature it was handed, so the SVG says what crossed. The brands and the
 * triangle are invented.
 */

const TRIANGLE = 'M0 100 L50 0 L100 100 Z';
const SIGNATURE = '@test-brand';

let workspace: string;
let home: string;
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: { out: () => undefined, err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    home,
    rasterizer: () => {
      throw new Error('these renders are svg and never raster');
    },
  };
}

const stderr = (): string => errors.join('');

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-brand-kit-'));
  home = join(workspace, 'home', '.tyto');
  errors = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/**
 * Plain JavaScript with no imports, as `tyto plugin new --code` writes it: the IR by hand.
 * The logo is drawn only when the kit has one, and the signature reads `no-signature`
 * otherwise, so an empty kit is visible in the output too.
 */
const TEMPLATE_CODE = `
const INK = { kind: 'solid', color: { r: 17, g: 17, b: 17, a: 1 } };
const PAPER = { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } };
const FONT = { family: 'Source Sans 3', source: 'bundled' };

function node(kind, x, y, fields) {
  return {
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
    opacity: 1, blend: 'normal', visible: true, clip: false, effects: [], kind, ...fields,
  };
}

function build(template, context) {
  const { logo, signature } = context.brand;
  const children = [];
  if (logo !== undefined) {
    children.push(node('vector', 40, 40, {
      id: context.idPrefix + '.logo',
      geometry: { kind: 'path', d: logo.d, fillRule: logo.fillRule },
      size: logo.box,
      fill: INK,
    }));
  }
  children.push(node('text', 40, 200, {
    id: context.idPrefix + '.signature',
    box: { w: 400 },
    runs: [{ kind: 'text', text: signature ?? 'no-signature', font: FONT, size: 32,
      weight: 700, style: 'normal', color: INK }],
    align: 'left', valign: 'top', lineHeight: 1.2, letterSpacing: 0, overflow: 'grow',
  }));
  return { format: context.format, size: context.size, background: PAPER, children };
}
`;

interface PluginOptions {
  readonly name: string;
  /** The kit's brands, as the plugin registers them; absent registers no kit. */
  readonly brands?: Readonly<Record<string, unknown>>;
  /** Code templates by name, each with the brand its manifest names. */
  readonly templates?: Readonly<Record<string, string>>;
}

async function plugin(options: PluginOptions): Promise<string> {
  const folder = join(workspace, 'sources', options.name);
  const templates = Object.entries(options.templates ?? {});
  const contributes = [
    ...(templates.length > 0 ? ['template-pack'] : []),
    ...(options.brands === undefined ? [] : ['brand-kit']),
  ];
  const registrations = [
    ...(templates.length > 0
      ? [
          `host.registerTemplatePack({ id: '${options.name}', templates: [], directory: 'templates', build });`,
        ]
      : []),
    ...(options.brands === undefined
      ? []
      : [
          `host.registerBrandKit({ id: '${options.name}', brands: ${JSON.stringify(options.brands)} });`,
        ]),
  ];
  await mkdir(join(folder, 'dist'), { recursive: true });
  await writeFile(
    join(folder, 'dist', 'index.js'),
    `${TEMPLATE_CODE}\nexport function activate(host) {\n  ${registrations.join('\n  ')}\n}\n`,
  );
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: options.name,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes,
      permissions: [],
    }),
  );
  for (const [template, brand] of templates) {
    await mkdir(join(folder, 'templates', template), { recursive: true });
    await writeFile(
      join(folder, 'templates', template, 'manifest.yaml'),
      `name: ${template}\nversion: 1.0.0\nbrand: ${brand}\nformats: [grid]\nslots: {}\n`,
    );
  }
  return folder;
}

async function install(folder: string): Promise<void> {
  expect(await run(['plugin', 'install', folder, '--yes'], environment()), stderr()).toBe(EXIT_OK);
}

interface Rendered {
  readonly code: number;
  readonly svg: string;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

async function render(template: string): Promise<Rendered> {
  const project = join(workspace, `project-${template}`);
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, 'formats.yaml'),
    'grid: { w: 600, h: 400, kind: grid, label: Grid }\n',
  );
  const brief = join(project, 'kit.brief');
  await writeFile(brief, `---\ntemplate: ${template}\n---\n`);
  const out = join(project, 'out');
  const code = await run(
    [
      'render',
      brief,
      '--out',
      out,
      '--formats-file',
      join(project, 'formats.yaml'),
      '--types',
      'svg',
    ],
    environment(),
  );
  const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8')) as {
    diagnostics: { code: string; message: string }[];
  };
  const [file] = (await readdir(out)).filter((name) => name.endsWith('.svg'));
  const svg = file === undefined ? '' : await readFile(join(out, file), 'utf8');
  return { code, svg, diagnostics: result.diagnostics };
}

describe('an installed brand kit reaches tyto render', () => {
  // Each case starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('hands a template of test-brand the kit’s logo and signature', async () => {
    await install(
      await plugin({
        name: 'kit-plugin',
        brands: {
          'test-brand': {
            logo: { box: { w: 100, h: 100 }, d: TRIANGLE, fillRule: 'nonzero' },
            signature: SIGNATURE,
          },
        },
        templates: { 'kit-own': 'test-brand', 'kit-other': 'other-brand' },
      }),
    );

    const own = await render('kit-own');

    expect(own.code, stderr()).toBe(EXIT_OK);
    expect(own.diagnostics).toEqual([]);
    expect(own.svg).toContain(TRIANGLE);
    expect(own.svg).toContain(SIGNATURE);
  }, 60_000);

  it('hands a template of another brand the empty kit', async () => {
    await install(
      await plugin({
        name: 'kit-plugin',
        brands: {
          'test-brand': {
            logo: { box: { w: 100, h: 100 }, d: TRIANGLE, fillRule: 'nonzero' },
            signature: SIGNATURE,
          },
        },
        templates: { 'kit-own': 'test-brand', 'kit-other': 'other-brand' },
      }),
    );

    const other = await render('kit-other');

    expect(other.code, stderr()).toBe(EXIT_OK);
    expect(other.svg).not.toContain(TRIANGLE);
    expect(other.svg).not.toContain(SIGNATURE);
    expect(other.svg).toContain('no-signature');
  }, 60_000);

  it('says in result.json which plugin’s kit was hidden when two offer one brand', async () => {
    await install(
      await plugin({
        name: 'kit-plugin',
        brands: { 'test-brand': { signature: SIGNATURE } },
        templates: { 'kit-own': 'test-brand' },
      }),
    );
    await install(
      await plugin({ name: 'kit-rival', brands: { 'test-brand': { signature: '@rival' } } }),
    );

    const own = await render('kit-own');
    const shadowed = own.diagnostics.filter((item) => item.code === 'W_BRAND_KIT_SHADOWED');

    expect(own.code, stderr()).toBe(EXIT_OK);
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0]?.message).toContain("'test-brand'");
    expect(shadowed[0]?.message).toContain("'kit-plugin'");
    expect(shadowed[0]?.message).toContain("'kit-rival'");
    // Whichever plugin the warning says was used is the one whose signature was drawn.
    const used = /by the one from '([^']+)'/u.exec(shadowed[0]?.message ?? '')?.[1];
    expect(own.svg).toContain(used === 'kit-rival' ? '@rival' : SIGNATURE);
  }, 60_000);
});
