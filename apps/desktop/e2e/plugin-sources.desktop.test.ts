import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { openPreviewBeside, previewSrcdoc } from './preview-pane.js';
import { waitForWindowTemplates } from './window-templates.js';

/**
 * An installed plugin's images and faces in the window (TYTO-280, ADR 0119).
 *
 * The rule under test lives in the renderer — which compile is a save, an open from disk, a
 * restored draft or a keystroke — so only the real window can prove it. A plugin installed by
 * the real `tyto plugin install` serves `test:<name>` images and the face Tyto Fixture Mono
 * from a server of this file's own, reached through `host.fetch`: **every request the server
 * receives is a fetch the window made**, so each count below is measured.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139). The face is PR B's fixture, read from
 * the CLI's folder rather than copied, with its licence beside it there.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');
const FACE_FILE = resolve(
  here,
  '..',
  '..',
  'cli',
  'src',
  '__fixtures__',
  'plugin-sources',
  'TytoFixtureMono-Regular.ttf',
);

for (const file of [built, cli, FACE_FILE]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

/** One PNG chunk: length, type, data, and the CRC of type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A square PNG of one colour, written here so no binary is checked in. */
function solidPng(size: number, [red, green, blue]: readonly number[]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(size * 3, Buffer.from([red ?? 0, green ?? 0, blue ?? 0])),
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LOGO = solidPng(64, [12, 35, 64]);
const PLUGIN = 'sources-plugin';

/** Plain JavaScript with no imports, as `tyto plugin new --code` writes it. */
const pluginCode = (base: string): string => `
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
    children.push(node('image', 40, 40, {
      id: context.idPrefix + '.logo', asset: logo.value.asset, size: { w: 240, h: 240 },
      fit: 'contain', position: { x: 0.5, y: 0.5 },
    }));
  }
  children.push(node('text', 40, 320, {
    id: context.idPrefix + '.copy',
    box: { w: 520 },
    runs: [{ kind: 'text', text: 'Wide words wrap where the measured face decides they wrap',
      font: FACE, size: 36, weight: 400, style: 'normal', color: INK }],
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

let scratch: string;
let home: string;
let app: ElectronApplication | undefined;
let page: Page;
let server: Server;
/** Every request the server received, as its path: one per fetch the window made. */
const requests: string[] = [];
const face = readFileSync(FACE_FILE);

const briefFor = (reference: string): string =>
  ['---', 'template: fontes', 'formats: [grid-1x1]', `logo: ${reference}`, '---', ''].join('\n');

function install(base: string): void {
  const folder = join(scratch, 'sources', PLUGIN);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(join(folder, 'dist', 'index.js'), pluginCode(base));
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack', 'asset-source', 'font-source'],
      permissions: ['net:127.0.0.1'],
    }),
  );
  mkdirSync(join(folder, 'templates', 'fontes'), { recursive: true });
  writeFileSync(
    join(folder, 'templates', 'fontes', 'manifest.yaml'),
    'name: fontes\nversion: 1.0.0\nformats: [grid-1x1]\nslots:\n  logo: { type: image }\n',
  );
  const installed = spawnSync(process.execPath, [cli, 'plugin', 'install', folder, '--yes'], {
    env: { ...process.env, TYTO_HOME: home },
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(`install failed: ${installed.stderr}`);
}

const launch = async (): Promise<void> => {
  const running = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  app = running;
  page = await firstWindow(running);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  await openPreviewBeside(page);
  // The plugins start after the window opens (ADR 0044); its sources are in the window's host
  // once its template is.
  await waitForWindowTemplates(page, ['fontes'], 60_000);
};

/** Quits as a person does, so hot exit keeps the drafts (ADR 0080). */
const quit = async (): Promise<void> => {
  const running = app;
  if (running === undefined) return;
  const gone = running.waitForEvent('close');
  await running.evaluate(({ app: electronApp }) => {
    electronApp.quit();
  });
  await gone;
  app = undefined;
};

/** Runs a command the way the command bar would, and fails loudly if it was refused. */
async function run(commandId: string): Promise<void> {
  const ran = await page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

async function open(path: string): Promise<void> {
  await app?.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, path);
  await run('editor.open');
}

/** Replaces the tab's whole text, as one edit — a keystroke compile, never a save. */
async function replaceText(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
}

const problems = async (): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map((row) => row.textContent).join('\n'),
  );

/** Waits for the preview's problems to mention `text`: the compile it belongs to answered. */
async function problemsSay(text: string): Promise<void> {
  await expect.poll(problems, { timeout: 20_000 }).toContain(text);
}

/** For a person to look at the real window; off in CI, where nobody would. */
async function shot(name: string): Promise<void> {
  const folder = process.env['TYTO_PLUGIN_SOURCES_SHOTS'];
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-plugin-sources-e2e-'));
  home = join(scratch, 'tyto-home');
  server = createServer((request, response) => {
    const path = request.url ?? '';
    requests.push(path);
    if (path === '/font') response.writeHead(200).end(face);
    else if (path === '/image/logo') response.writeHead(200).end(LOGO);
    else response.writeHead(500).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  install(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
  await launch();
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(scratch, { recursive: true, force: true });
});

describe("an installed plugin's image and face in the window (ADR 0119)", () => {
  it('fetches both when a brief is opened from disk, and the face reaches the preview', async () => {
    const path = join(scratch, 'aberto.brief');
    writeFileSync(path, briefFor('test:logo'), 'utf8');

    await open(path);
    await expect
      .poll(() => previewSrcdoc(page), { timeout: 30_000 })
      .toContain(LOGO.toString('base64'));
    expect([...requests].sort()).toEqual(['/font', '/image/logo']);
    // Arrived mid-session, measured and embedded in the same preview (ADR 0117).
    const cold = await previewSrcdoc(page);
    expect(cold).toContain(face.toString('base64'));
    await shot('preview-fetched');

    // A save of the same text compiles warm, against the cached face, and asks nobody. The
    // cold preview compiled twice; had it compiled once, its lines would have broken against
    // the substitute and this one would not match it.
    await run('editor.save');
    await page.waitForTimeout(1_500);
    expect(requests).toHaveLength(2);
    expect(await previewSrcdoc(page)).toBe(cold);
  }, 60_000);

  it('asks nothing while typing, and asks once on the save after', async () => {
    await replaceText(briefFor('test:outro'));
    await problemsSay('save it to fetch');
    expect(requests).toHaveLength(2);

    await run('editor.save');
    await problemsSay('Tyto asks again after a restart');
    expect(requests.slice(2)).toEqual(['/image/outro']);

    // A failure is remembered for the process: the next save asks nobody (ADR 0119).
    await run('editor.save');
    await page.waitForTimeout(1_500);
    expect(requests).toHaveLength(3);
  }, 60_000);

  it('does not fetch a restored hot-exit draft, and fetches it on its first save', async () => {
    await replaceText(briefFor('test:rascunho'));
    await problemsSay('save it to fetch');
    await quit();

    await launch();
    await expect
      .poll(() => page.evaluate(() => document.querySelector('#editor .cm-content')?.textContent))
      .toContain('test:rascunho');
    await problemsSay('save it to fetch');
    expect(requests.filter((path) => path.includes('rascunho'))).toEqual([]);

    await run('editor.save');
    await expect
      .poll(() => requests.filter((path) => path.includes('rascunho')), { timeout: 20_000 })
      .toEqual(['/image/rascunho']);
  }, 120_000);

  it('fetches nothing for a restricted folder, and says to trust it', async () => {
    const work = join(scratch, 'pasta');
    mkdirSync(join(work, '.tyto'), { recursive: true });
    writeFileSync(join(work, '.tyto', 'project.json'), '{}\n');
    const path = join(work, 'restrito.brief');
    writeFileSync(path, briefFor('test:restrito'), 'utf8');
    await app?.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, work);
    await run('workspace.openFolder');
    await open(path);

    // The command and not the banner: a folder that left nothing out shows no banner.
    await problemsSay('trust it with Workspace: Manage Trust');
    expect(requests.filter((item) => item.includes('restrito'))).toEqual([]);
    await shot('restricted-folder');
  }, 60_000);
});
