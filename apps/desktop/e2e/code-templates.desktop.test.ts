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

import { buildSync } from 'esbuild';
import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * Installed code templates in a running app, built in their plugin's own process
 * (TYTO-189, ADR 0048).
 *
 * Two plugins, installed by the built CLI into this suite's own `TYTO_HOME`:
 *
 * - `agenda-plugin` is `agenda-semana`, bundled with every import inlined the way an author
 *   bundles one. Its preview and its export are compared with the in-repo template's, byte
 *   for byte, in the same window.
 * - `cartaz` is a template whose frame says where it was built: a rect 777 wide off Electron
 *   process, 111 anywhere else. It is the in-process path made observable.
 *
 * `--user-data-dir` keeps the window's settings out of the real ones, and `closeApp` answers
 * the quit question (TYTO-150).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');
const AGENDA = resolve(
  here,
  '..',
  '..',
  '..',
  'packages',
  'templates',
  'templates',
  'agenda-semana',
);

for (const file of [built, cli]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

// The example brief without its illustration: the preview is asked with no folder, so the
// file could not resolve for either template, and the comparison would be of two failures.
const AGENDA_BRIEF = readFileSync(join(AGENDA, 'examples', 'agenda.brief'), 'utf8').replace(
  /^(?:ilustracao|imagem): .*\n/mu,
  '',
);
const briefNaming = (template: string): string =>
  AGENDA_BRIEF.replace(/^template: agenda-semana$/mu, `template: ${template}`);
const CARTAZ_BRIEF = ['---', 'template: cartaz', 'formats: [feed]', '---', ''].join('\n');

let scratch: string;
let home: string;
let queueFolder: string;
let app: ElectronApplication;
let page: Page;

function install(folder: string): void {
  const installed = spawnSync(process.execPath, [cli, 'plugin', 'install', folder, '--yes'], {
    env: { ...process.env, TYTO_HOME: home },
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(`install failed: ${installed.stderr}`);
}

function writePlugin(folder: string, name: string, permissions: readonly string[]): void {
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack'],
      permissions,
    }),
  );
}

function agendaPlugin(): string {
  const folder = join(scratch, 'sources', 'agenda-plugin');
  writePlugin(folder, 'agenda-plugin', ['font:CircularXX']);
  buildSync({
    stdin: {
      contents:
        "import { build } from './template.ts';\n" +
        'export function activate(host) {\n' +
        "  host.registerTemplatePack({ id: 'agenda-plugin', templates: [], directory: 'templates', build: (template, context) => build(context) });\n" +
        '}\n',
      resolveDir: AGENDA,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: join(folder, 'dist', 'index.js'),
    logLevel: 'silent',
  });
  const template = join(folder, 'templates', 'agenda-plugin');
  mkdirSync(template, { recursive: true });
  const manifest = readFileSync(join(AGENDA, 'manifest.yaml'), 'utf8').replace(
    /^name: agenda-semana$/mu,
    'name: agenda-plugin',
  );
  writeFileSync(
    join(template, 'manifest.yaml'),
    `${manifest}faces:\n` +
      [300, 500, 900]
        .map((weight) => `  - { family: CircularXX, weight: ${String(weight)} }\n`)
        .join(''),
  );
  return folder;
}

function cartazPlugin(): string {
  const folder = join(scratch, 'sources', 'cartaz');
  writePlugin(folder, 'cartaz', []);
  const template = join(folder, 'templates', 'cartaz');
  mkdirSync(template, { recursive: true });
  writeFileSync(
    join(template, 'manifest.yaml'),
    'name: cartaz\nversion: 1.0.0\nformats: [feed]\nslots: {}\n',
  );
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerTemplatePack({
    id: 'cartaz', templates: [], directory: 'templates',
    build: (template, context) => ({
      format: context.format,
      size: context.size,
      children: [{
        id: context.idPrefix + '.onde', kind: 'rect',
        size: { w: process.versions.electron === undefined ? 777 : 111, h: 10 }, radius: [0, 0, 0, 0],
        fill: { kind: 'solid', color: { r: 255, g: 89, b: 0, a: 1 } },
        transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
        opacity: 1, blend: 'normal', visible: true, clip: false, effects: [],
      }],
    }),
  });
}
`,
  );
  return folder;
}

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;

function call<T>(channel: string, request: unknown): Promise<T> {
  return page.evaluate(
    ([name, body]) => (window as unknown as { tyto: Bridge }).tyto[name as string]!(body),
    [channel, request] as const,
  ) as Promise<T>;
}

interface PreviewAnswer {
  readonly frames: readonly { readonly html: string }[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

const preview = (brief: string): Promise<PreviewAnswer> =>
  call<PreviewAnswer>('brief:preview', { requestId: 1, documentId: 'e2e', brief });

/** Starts an export of svg into `directory` and waits for it to be over. */
async function exported(brief: string, directory: string): Promise<void> {
  const { exportId } = await call<{ exportId: string }>('export:start', {
    documentId: 'e2e',
    brief,
    directory,
    outputs: [{ kind: 'svg' }],
  });
  const started = Date.now();
  for (;;) {
    const { progress } = await call<{ progress?: { status: string; failure?: string } }>(
      'export:progress',
      { exportId },
    );
    if (progress !== undefined && progress.status !== 'running') {
      if (progress.failure !== undefined) throw new Error(progress.failure);
      return;
    }
    if (Date.now() - started > 60_000) throw new Error('the export never finished');
    await new Promise((settle) => setTimeout(settle, 100));
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

async function timed(brief: string): Promise<number> {
  const started = performance.now();
  await preview(brief);
  return performance.now() - started;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-code-templates-'));
  home = join(scratch, 'tyto-home');
  queueFolder = join(scratch, 'fila');
  mkdirSync(queueFolder);
  install(agendaPlugin());
  install(cartazPlugin());

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await app.firstWindow();
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  // The plugins start after the window opens (ADR 0044); the picker is asked again once they
  // have, and both installed code templates are in it then.
  await page.waitForFunction(
    () => {
      const picker = document.getElementById('template') as HTMLSelectElement | null;
      const values = picker === null ? [] : [...picker.options].map((option) => option.value);
      return values.includes('agenda-plugin') && values.includes('cartaz');
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('an installed code template in the window', () => {
  it("is built in its plugin's process on the bundled Node, never in Tyto's", async () => {
    const answer = await preview(CARTAZ_BRIEF);

    expect(answer.diagnostics).toEqual([]);
    expect(answer.frames).toHaveLength(1);
    expect(answer.frames[0]?.html).toContain('777');
    expect(answer.frames[0]?.html).not.toContain('111');
  }, 60_000);

  it('previews agenda-semana from its plugin exactly as the in-repo template, and times it', async () => {
    // The in-repo template first, so the main process has parsed its own faces and the first
    // plugin preview's extra is what crosses: the faces' bytes and the guest's parse.
    const firstInRepo = await timed(briefNaming('agenda-semana'));
    const first = await timed(briefNaming('agenda-plugin'));
    const plugin = await preview(briefNaming('agenda-plugin'));
    const inRepo = await preview(briefNaming('agenda-semana'));

    expect(plugin.frames.length).toBeGreaterThan(0);
    expect(plugin.frames.map((frame) => frame.html)).toEqual(
      inRepo.frames.map((frame) => frame.html),
    );
    expect(plugin.diagnostics).toEqual(inRepo.diagnostics);

    // What a person waits for, through the preload: the first preview of the plugin's
    // template carries the faces and their parse; the others do not. The in-repo template
    // beside it is the same compile without the boundary.
    const warmPlugin: number[] = [];
    const warmInRepo: number[] = [];
    const warmCartaz: number[] = [];
    for (let round = 0; round < 20; round++) {
      warmPlugin.push(await timed(briefNaming('agenda-plugin')));
      warmInRepo.push(await timed(briefNaming('agenda-semana')));
      warmCartaz.push(await timed(CARTAZ_BRIEF));
    }
    process.stdout.write(
      `MEASURE desktop preview, agenda-semana example (2 frames, 16 measurements): ` +
        `first in-repo ${firstInRepo.toFixed(1)} ms, then first through the plugin ${first.toFixed(1)} ms; ` +
        `warm median n=20: plugin ${median(warmPlugin).toFixed(1)} ms, ` +
        `in-repo ${median(warmInRepo).toFixed(1)} ms; ` +
        `cartaz (1 frame, 1 round trip, no measurement) ${median(warmCartaz).toFixed(1)} ms\n`,
    );
  }, 120_000);

  it('exports agenda-semana from its plugin byte for byte as the in-repo template', async () => {
    const fromPlugin = join(scratch, 'export-plugin');
    const fromRepo = join(scratch, 'export-repo');
    await exported(briefNaming('agenda-plugin'), fromPlugin);
    await exported(briefNaming('agenda-semana'), fromRepo);

    const svgs = (folder: string): string[] =>
      readdirSync(folder)
        .filter((name) => name.endsWith('.svg'))
        .sort();
    expect(svgs(fromPlugin).length).toBeGreaterThan(0);
    expect(svgs(fromPlugin)).toEqual(svgs(fromRepo));
    for (const name of svgs(fromRepo)) {
      expect(readFileSync(join(fromPlugin, name), 'utf8'), name).toBe(
        readFileSync(join(fromRepo, name), 'utf8'),
      );
    }
  }, 120_000);

  it('renders in the queue as PNG and nothing else (ADR 0044)', async () => {
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, queueFolder);
    mkdirSync(join(queueFolder, 'inbox', 'tarefa'), { recursive: true });
    writeFileSync(join(queueFolder, 'inbox', 'tarefa', 'brief.brief'), CARTAZ_BRIEF, 'utf8');
    await call('queue:set-folder', { choose: true });
    await call('queue:run', { taskId: 'tarefa' });

    const result = join(queueFolder, 'outbox', 'tarefa', 'out', 'result.json');
    const started = Date.now();
    while (!existsSync(result)) {
      if (Date.now() - started > 60_000) throw new Error(`${result} never appeared`);
      await new Promise((settle) => setTimeout(settle, 100));
    }
    const document = JSON.parse(readFileSync(result, 'utf8')) as {
      artifacts: { name: string }[];
      diagnostics: { code: string }[];
    };
    expect(document.diagnostics).toEqual([]);
    expect(document.artifacts.map((artifact) => artifact.name)).toEqual(['artwork-1-feed.png']);
  }, 120_000);

  it('lists the font: permission on the plugins screen', async () => {
    const { plugins } = await call<{ plugins: { name: string; permissions: string[] }[] }>(
      'plugins:list',
      {},
    );
    expect(plugins.find((row) => row.name === 'agenda-plugin')?.permissions).toEqual([
      'font:CircularXX',
    ]);
  });
});
