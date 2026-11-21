import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { switchingFolder } from './folder-switch.js';
import { firstWindow } from './first-window.js';
import { openPreviewBeside, previewSrcdoc } from './preview-pane.js';
import { waitForWindowTemplates } from './window-templates.js';

/**
 * A file a plugin decodes, in the window (TYTO-742, ADR 0223).
 *
 * A stand-in `image-decoder` for `.fake`, installed by the real `tyto plugin install` and run in
 * its own process, reads the cited file through the one-call token (`host.decoding.read`, in
 * parts) and answers the bytes it read: the `.fake` file holds a PNG, so **what the preview
 * embeds is what the plugin read through main's token table**, nothing a cache or a stand-in
 * made up. The layer after `#` is asked for and recorded by the plugin, which answers it alike.
 *
 * The folder is a fresh one the window has not trusted, so the first compile decodes nothing and
 * says to trust it (ADR 0111, ADR 0223 decision 8); trusting it through the window's bridge and
 * saving draws the picture. Then the redraw: the file rewritten with another picture redraws the preview with no keystroke,
 * because the preview's `references` name `capa.fake`, the file the layer is drawn from, and
 * `explorer:changed` names it (TYTO-741's redraw). And an extension no plugin decodes is
 * `E_ASSET_DECODER_MISSING` on the brief's line, the file being there.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');

for (const file of [built, cli]) {
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

const FIRST = solidPng(48, [30, 90, 200]);
const REPAINTED = solidPng(64, [200, 60, 30]);
const PLUGIN = 'decoder-plugin';

/** Plain JavaScript with no imports, as `tyto plugin new --code` writes it. */
const pluginCode = `
const PAPER = { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } };

function node(kind, x, y, fields) {
  return {
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
    opacity: 1, blend: 'normal', visible: true, clip: false, effects: [], kind, ...fields,
  };
}

function build(template, context) {
  const children = [];
  const art = context.slots.arte;
  if (art !== undefined && art.value.kind === 'image') {
    children.push(node('image', 40, 40, {
      id: context.idPrefix + '.arte', asset: art.value.asset, size: { w: 240, h: 240 },
      fit: 'contain', position: { x: 0.5, y: 0.5 },
    }));
  }
  return { format: context.format, size: context.size, background: PAPER, children };
}

// Read in parts until a short one, as a decoder of a large file does (ADR 0212's part rules).
async function readWhole(host, file) {
  const parts = [];
  let offset = 0;
  for (;;) {
    const part = await host.decoding.read(file.token, { offset, length: 16 });
    parts.push(part);
    offset += part.length;
    if (part.length < 16) break;
  }
  const whole = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
}

export function activate(host) {
  host.registerTemplatePack({ id: '${PLUGIN}', templates: [], directory: 'templates', build });
  host.registerImageDecoder({
    id: 'fake',
    extensions: ['.fake'],
    decode: async (file, request) => {
      if (request.layer !== 'arte') {
        return { ok: false, error: [{ code: 'E_PLUGIN', severity: 'error',
          message: 'no layer ' + String(request.layer) }], diagnostics: [] };
      }
      return { ok: true, value: { bytes: await readWhole(host, file) }, diagnostics: [] };
    },
  });
}
`;

let scratch: string;
let home: string;
let work: string;
let app: ElectronApplication | undefined;
let page: Page;

const briefFor = (reference: string): string =>
  ['---', 'template: decodificado', 'formats: [grid-1x1]', `arte: ${reference}`, '---', ''].join(
    '\n',
  );

function install(): void {
  const folder = join(scratch, 'sources', PLUGIN);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(join(folder, 'dist', 'index.js'), pluginCode);
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack', 'image-decoder'],
      permissions: [],
    }),
  );
  mkdirSync(join(folder, 'templates', 'decodificado'), { recursive: true });
  writeFileSync(
    join(folder, 'templates', 'decodificado', 'manifest.yaml'),
    'name: decodificado\nversion: 1.0.0\nformats: [grid-1x1]\nslots:\n  arte: { type: image }\n',
  );
  const installed = spawnSync(process.execPath, [cli, 'plugin', 'install', folder, '--yes'], {
    env: { ...process.env, TYTO_HOME: home },
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(`install failed: ${installed.stderr}`);
}

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

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;

/** A call on the window's own bridge, with the contract's checks on both sides. */
const call = <T>(channel: string, request: unknown): Promise<T> =>
  page.evaluate(([name, body]) => (globalThis as unknown as { tyto: Bridge }).tyto[name]!(body), [
    channel,
    request,
  ] as const) as Promise<T>;

const answerPicker = (path: string): Promise<void> =>
  (app as ElectronApplication).evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, path);

/** Replaces the tab's whole text, as one edit. */
async function replaceText(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
}

const problems = async (): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map((row) => row.textContent).join('\n'),
  );

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-decoded-assets-e2e-'));
  home = join(scratch, 'tyto-home');
  work = join(scratch, 'arte');
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'capa.fake'), FIRST);
  writeFileSync(join(work, 'capa.brief'), briefFor('capa.fake#arte'), 'utf8');
  install();

  const running = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  app = running;
  page = await firstWindow(running);
  await page.waitForSelector('#editor .cm-content');
  await openPreviewBeside(page);
  // The plugins start after the window opens (ADR 0044); its decoder is in the window's host
  // once its template is.
  await waitForWindowTemplates(page, ['decodificado'], 30_000);
  // The folder open, so its watcher names a rewritten file (TYTO-741's redraw).
  await answerPicker(work);
  await switchingFolder(page, () => run('workspace.openFolder'));
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a file an installed plugin decodes, in the window (ADR 0223)', () => {
  it('draws the layer, and redraws when the cited file is repainted', async () => {
    await answerPicker(join(work, 'capa.brief'));
    await run('editor.open');
    // A folder the window has not trusted decodes nothing new, and says so (ADR 0111).
    await expect
      .poll(problems, { timeout: 20_000 })
      .toContain('trust it with Workspace: Manage Trust to decode');
    expect(await previewSrcdoc(page)).not.toContain(FIRST.toString('base64'));

    await call('workspace:trust', { trusted: true, source: 'folder' });
    await run('editor.save');
    await expect
      .poll(() => previewSrcdoc(page), { timeout: 20_000 })
      .toContain(FIRST.toString('base64'));
    // The control at the same wait: the repainted picture is not there yet.
    expect(await previewSrcdoc(page)).not.toContain(REPAINTED.toString('base64'));

    // No keystroke: the watcher names `capa.fake`, which the preview said it drew from.
    writeFileSync(join(work, 'capa.fake'), REPAINTED);
    await expect
      .poll(() => previewSrcdoc(page), { timeout: 20_000 })
      .toContain(REPAINTED.toString('base64'));
    expect(await previewSrcdoc(page)).not.toContain(FIRST.toString('base64'));
  }, 50_000);

  it('says a plugin is needed for an extension none decodes, on the line', async () => {
    writeFileSync(join(work, 'capa.other'), FIRST);
    await replaceText(briefFor('capa.other#arte'));
    await expect
      .poll(problems, { timeout: 20_000 })
      .toContain("install a plugin that decodes '.other' files");
    // The problem's row names the brief's fourth line, the one citing the file.
    const where = await page.evaluate(() =>
      [...document.querySelectorAll('.problems__row')]
        .filter(
          (row) => row.querySelector('.problems__code')?.textContent === 'E_ASSET_DECODER_MISSING',
        )
        .map((row) => row.querySelector('.problems__where')?.textContent),
    );
    expect(where).toEqual(['4:1']);
  }, 30_000);
});
