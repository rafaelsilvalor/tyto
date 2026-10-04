import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * An installed brand kit in the window (TYTO-223, ADR 0063).
 *
 * `kit-plugin` contributes a kit for an invented `test-brand` — a triangle and a signature —
 * and two code templates, one of that brand and one of `other-brand`; each draws the logo it
 * was handed as a path and prints the signature it was handed. `kit-rival` offers the same
 * brand again, so the merge has something to say. Both are installed by the real `tyto
 * plugin install` into this launch's `TYTO_HOME`, and the preview and the export are asked
 * through the preload, the door the renderer uses.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');

for (const file of [built, cli]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

const TRIANGLE = 'M0 100 L50 0 L100 100 Z';
const SIGNATURE = '@test-brand';
const KIT = {
  'test-brand': {
    logo: { box: { w: 100, h: 100 }, d: TRIANGLE, fillRule: 'nonzero' },
    signature: SIGNATURE,
  },
};

/** Plain JavaScript with no imports: the IR by hand, as `tyto plugin new --code` writes it. */
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

let scratch: string;
let home: string;
let app: ElectronApplication;
let page: Page;

function install(folder: string): void {
  const installed = spawnSync(process.execPath, [cli, 'plugin', 'install', folder, '--yes'], {
    env: { ...process.env, TYTO_HOME: home },
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(`install failed: ${installed.stderr}`);
}

/** A plugin with a kit and, optionally, code templates by name and brand. */
function plugin(name: string, templates: Readonly<Record<string, string>>): string {
  const folder = join(scratch, 'sources', name);
  const named = Object.entries(templates);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: [...(named.length > 0 ? ['template-pack'] : []), 'brand-kit'],
      permissions: [],
    }),
  );
  const pack =
    named.length > 0
      ? `  host.registerTemplatePack({ id: '${name}', templates: [], directory: 'templates', build });\n`
      : '';
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `${TEMPLATE_CODE}\nexport function activate(host) {\n${pack}` +
      `  host.registerBrandKit({ id: '${name}', brands: ${JSON.stringify(KIT)} });\n}\n`,
  );
  for (const [template, brand] of named) {
    mkdirSync(join(folder, 'templates', template), { recursive: true });
    writeFileSync(
      join(folder, 'templates', template, 'manifest.yaml'),
      `name: ${template}\nversion: 1.0.0\nbrand: ${brand}\nformats: [grid-1x1]\nslots: {}\n`,
    );
  }
  return folder;
}

const briefFor = (template: string): string =>
  ['---', `template: ${template}`, 'formats: [grid-1x1]', '---', ''].join('\n');

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;

function call<T>(channel: string, request: unknown): Promise<T> {
  return page.evaluate(
    ([name, body]) => (window as unknown as { tyto: Bridge }).tyto[name as string]!(body),
    [channel, request] as const,
  ) as Promise<T>;
}

interface Diagnostic {
  readonly code: string;
  readonly message: string;
}

interface PreviewAnswer {
  readonly frames: readonly { readonly html: string }[];
  readonly diagnostics: readonly Diagnostic[];
}

const preview = (template: string): Promise<PreviewAnswer> =>
  call<PreviewAnswer>('brief:preview', {
    requestId: 1,
    documentId: 'e2e',
    brief: briefFor(template),
  });

/** Exports `template` as svg into a folder of its own; answers the svg and the run's diagnostics. */
async function exported(
  template: string,
): Promise<{ svg: string; diagnostics: readonly Diagnostic[] }> {
  const directory = join(scratch, `out-${template}`);
  mkdirSync(directory, { recursive: true });
  const { exportId } = await call<{ exportId: string }>('export:start', {
    documentId: 'e2e',
    brief: briefFor(template),
    directory,
    outputs: [{ kind: 'svg' }],
  });
  const started = Date.now();
  for (;;) {
    const { progress } = await call<{
      progress?: { status: string; failure?: string; diagnostics: readonly Diagnostic[] };
    }>('export:progress', { exportId });
    if (progress !== undefined && progress.status !== 'running') {
      if (progress.failure !== undefined) throw new Error(progress.failure);
      const [file] = readdirSync(directory).filter((name) => name.endsWith('.svg'));
      const svg = file === undefined ? '' : readFileSync(join(directory, file), 'utf8');
      return { svg, diagnostics: progress.diagnostics };
    }
    if (Date.now() - started > 60_000) throw new Error('the export never finished');
    await new Promise((settle) => setTimeout(settle, 100));
  }
}

const codes = (diagnostics: readonly Diagnostic[]): string[] =>
  diagnostics.map((item) => item.code);

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-brand-kit-'));
  home = join(scratch, 'tyto-home');
  install(plugin('kit-plugin', { 'kit-own': 'test-brand', 'kit-other': 'other-brand' }));
  // The same kit again, so whichever plugin the merge keeps draws the same thing and the
  // warning is the only difference.
  install(plugin('kit-rival', {}));

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await app.firstWindow();
  // Something the script builds, never the markup it shipped with (TYTO-154, TYTO-175).
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  // The plugins start after the window opens (ADR 0044); the picker is asked again once
  // they have, and the kit is in the window's host by then too.
  await page.waitForFunction(
    () => {
      const picker = document.getElementById('template') as HTMLSelectElement | null;
      const values = picker === null ? [] : [...picker.options].map((option) => option.value);
      return values.includes('kit-own') && values.includes('kit-other');
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('an installed brand kit in the window', () => {
  it('previews a template of test-brand with the kit’s logo and signature', async () => {
    const answer = await preview('kit-own');

    expect(answer.frames).toHaveLength(1);
    expect(answer.frames[0]?.html).toContain(TRIANGLE);
    expect(answer.frames[0]?.html).toContain(SIGNATURE);
  }, 60_000);

  it('previews a template of another brand with the empty kit', async () => {
    const answer = await preview('kit-other');

    expect(answer.frames).toHaveLength(1);
    expect(answer.frames[0]?.html).not.toContain(TRIANGLE);
    expect(answer.frames[0]?.html).not.toContain(SIGNATURE);
    expect(answer.frames[0]?.html).toContain('no-signature');
  }, 60_000);

  it('exports a template of test-brand with the kit, and another brand without it', async () => {
    const own = await exported('kit-own');
    const other = await exported('kit-other');

    expect(own.svg).toContain(TRIANGLE);
    expect(own.svg).toContain(SIGNATURE);
    expect(other.svg).not.toContain(TRIANGLE);
    expect(other.svg).toContain('no-signature');
  }, 120_000);

  it('says in the preview and in the export that a second plugin offered the same brand', async () => {
    const previewed = await preview('kit-own');
    const exportedRun = await exported('kit-own');

    for (const diagnostics of [previewed.diagnostics, exportedRun.diagnostics]) {
      expect(codes(diagnostics)).toEqual(['W_BRAND_KIT_SHADOWED']);
      expect(diagnostics[0]?.message).toContain("'test-brand'");
      expect(diagnostics[0]?.message).toContain("'kit-plugin'");
      expect(diagnostics[0]?.message).toContain("'kit-rival'");
    }
  }, 120_000);
});
