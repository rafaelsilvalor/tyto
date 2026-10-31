import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { switchingFolder } from './folder-switch.js';
import { firstWindow } from './first-window.js';
import { SHOWN_PREVIEW, previewPart, previewSrcdoc } from './preview-pane.js';

/**
 * An image from the explorer in the preview, in the real window (TYTO-366, ADR 0124): a click on
 * a PNG and on an SVG shows each with its bar line and leaves the focus in the explorer, a
 * `.brief` still opens as text, a file over the ceiling says so, and a deleted image gives the
 * following preview back to the brief.
 *
 * **An SVG is a picture, never a document**, and the three layers that make it one are measured
 * against a local server that counts what reaches it: the hostile SVG below asks for an image and
 * runs a script that fetches, and in the preview neither arrives (0 of 2). The control is the
 * same file opened in a window of its own with no sandbox and no CSP, where both do (2 of 2):
 * without it a 0 would prove only that the server was not reachable.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, and a folder of its own. With `TYTO_IMAGE_SHOTS`
 * set to a folder it leaves pictures of the window in both themes. One launch.
 */

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env['TYTO_IMAGE_SHOTS'];

let scratch: string;
let work: string;
let app: ElectronApplication | undefined;
let window: Page;
let server: Server;
const hits = { img: 0, script: 0 };

/** A PNG of one colour, `width` × `height`, built here so the suite needs no binary fixture. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x2a)]);
  for (let x = 0; x < width; x += 1) row.set([0x3a, 0x7b, 0xd5], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An SVG that asks for an image and runs a script that fetches, both from the counting server. */
const hostile = (port: number): string =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">' +
  `<image href="http://127.0.0.1:${String(port)}/img" width="40" height="20"/>` +
  `<script>fetch("http://127.0.0.1:${String(port)}/script")</script>` +
  '<rect width="20" height="20" fill="#3a7bd5"/></svg>';

async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

const row = (name: string) => window.locator(`.explorer__row[data-name="${name}"]`);

/** The shown preview's bar line, and the line in its stage, or `''` for each that is hidden. */
const lines = (): Promise<{ info: string; notice: string }> =>
  window.evaluate((pane) => {
    const read = (part: string): string => {
      const node = document.querySelector<HTMLElement>(`${pane} [data-preview-${part}]`);
      return node === null || node.hidden ? '' : (node.textContent ?? '');
    };
    return { info: read('info'), notice: read('notice') };
  }, SHOWN_PREVIEW);

const tabNames = (): Promise<string[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__label')].map((tab) => tab.textContent ?? ''),
  );

/** Screenshots in both schemes, when asked for; the window is left light. */
async function shoot(name: string): Promise<void> {
  if (shots === undefined || app === undefined) return;
  mkdirSync(shots, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await app.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source;
    }, scheme);
    // scheme: the screenshot in each theme Rafael approves by looking; main is told too.
    await window.emulateMedia({ colorScheme: scheme });
    await window.waitForTimeout(300);
    await window.screenshot({ path: join(shots, `${name}-${scheme}.png`) });
  }
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'system';
  });
  await window.emulateMedia({ colorScheme: null });
}

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/img') hits.img += 1;
    if (request.url === '/script') hits.script += 1;
    response.writeHead(200, { 'access-control-allow-origin': '*' });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  scratch = mkdtempSync(join(tmpdir(), 'tyto-explorer-image-e2e-'));
  work = join(scratch, 'promo');
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'capa.brief'), '---\ntemplate: promo-curso\n---\n::titulo Capa\n');
  writeFileSync(join(work, 'logo.png'), png(120, 63));
  writeFileSync(
    join(work, 'vetor.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><circle cx="10" cy="10" r="8" fill="#e0533d"/></svg>',
  );
  writeFileSync(join(work, 'hostil.svg'), hostile(port));
  const big = Buffer.alloc(40 * 1024 * 1024);
  big.set(png(1, 1));
  writeFileSync(join(work, 'enorme.png'), big);

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, work);
  await switchingFolder(window, () => run('workspace.openFolder'));
  await row('logo.png').waitFor({ timeout: 15_000 });
}, 180_000);

afterAll(async () => {
  if (app !== undefined) await closeApp(app);
  await new Promise((resolve) => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
});

describe('an image from the explorer in the preview (TYTO-366)', () => {
  it('shows a PNG with its name, pixel size and file size, the focus left in the tree', async () => {
    const bytes = statSync(join(work, 'logo.png')).size;
    // The window refuses a preview until it has read the last session, as a split is.
    await expect
      .poll(
        async () => {
          await row('logo.png').click();
          return (await lines()).info;
        },
        { timeout: 15_000 },
      )
      .toBe(`logo.png · 120 × 63 px · ${String(bytes)} B`);

    expect(await previewSrcdoc(window)).toMatch(/<img alt="" src="data:image\/png;base64,/u);
    expect(await tabNames()).toContain('logo.png');
    const focus = await window.evaluate(
      () => document.activeElement?.closest('tyto-explorer-panel') !== null,
    );
    expect(focus).toBe(true);
    // The brief's furniture is hidden; the zoom and the lock stay.
    const hidden = await window.evaluate(
      (pane) =>
        ['formats', 'modes', 'strip-toggle', 'strip', 'zoom-group', 'lock'].map(
          (part) => document.querySelector<HTMLElement>(`${pane} [data-preview-${part}]`)?.hidden,
        ),
      SHOWN_PREVIEW,
    );
    expect(hidden).toEqual([true, true, true, true, false, false]);
    // Fit never enlarges: 120 px wide in a stage far wider is drawn at 100%.
    expect(await window.textContent(previewPart('zoom-level'))).toBe('100%');
    const ratio = await window.evaluate(() => globalThis.devicePixelRatio);
    process.stdout.write(`[TYTO-366] devicePixelRatio of the shots: ${String(ratio)}\n`);
    await shoot('image-png');
  }, 60_000);

  it('shows an SVG with no size of its own at its viewBox, marked scalable', async () => {
    await row('vetor.svg').click();
    await expect.poll(async () => (await lines()).info).toMatch(/^vetor\.svg · 40 × 20 px \(/u);

    // What Chromium itself answers for such an SVG, printed for the pull request.
    const natural = await window.evaluate(async (pane) => {
      const srcdoc = document.querySelector(`${pane} [data-preview-frame]`)?.getAttribute('srcdoc');
      const source = /src="([^"]+)"/u.exec(srcdoc ?? '')?.[1] ?? '';
      const image = new Image();
      image.src = source;
      await image.decode();
      return `${String(image.naturalWidth)} × ${String(image.naturalHeight)}`;
    }, SHOWN_PREVIEW);
    process.stdout.write(
      `[TYTO-366] Chromium naturalWidth × naturalHeight, viewBox-only SVG: ${natural}\n`,
    );
    await shoot('image-svg');
  }, 60_000);

  it('says an image over the ceiling is too large, and draws nothing', async () => {
    await row('enorme.png').click();
    await expect
      .poll(async () => (await lines()).notice, { timeout: 10_000 })
      .toBe('This image is 40 MB, over the 32 MB the preview shows.');
    expect(await window.locator(previewPart('paper')).isHidden()).toBe(true);
    // Nothing to zoom: the zoom, Fit and the level are hidden; Lock stays.
    expect(await window.locator(previewPart('zoom-group')).isHidden()).toBe(true);
    expect(await window.locator(previewPart('lock')).isVisible()).toBe(true);
    await shoot('image-too-large');
  }, 60_000);

  it('draws a hostile SVG as a picture: neither its image nor its script reaches anything', async () => {
    await row('hostil.svg').click();
    await expect.poll(async () => (await lines()).info).toMatch(/^hostil\.svg · 40 × 20 px/u);
    await window.waitForTimeout(1500);
    expect(hits).toEqual({ img: 0, script: 0 });
  }, 60_000);

  it('the control: the same file as a document with no sandbox and no CSP reaches both', async () => {
    await app?.evaluate(
      async ({ BrowserWindow }, file) => {
        const probe = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
        await probe.loadFile(file);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        probe.destroy();
      },
      join(work, 'hostil.svg'),
    );
    await expect.poll(() => ({ ...hits }), { timeout: 10_000 }).toEqual({ img: 1, script: 1 });
  }, 60_000);

  it('opens a brief as text, and an image deleted gives the preview back to that brief', async () => {
    await row('logo.png').click();
    await expect.poll(async () => (await lines()).info).toMatch(/^logo\.png/u);

    await row('capa.brief').click();
    await expect.poll(tabNames, { timeout: 10_000 }).toContain('capa.brief');

    await row('vetor.svg').click();
    await expect.poll(async () => (await lines()).info).toMatch(/^vetor\.svg/u);
    rmSync(join(work, 'vetor.svg'));
    // The watcher's settle, then main's `gone`: the following preview follows the brief again.
    await expect
      .poll(
        () =>
          window.evaluate(
            () => document.querySelector('[data-tab-kind="preview"] .tabs__label')?.textContent,
          ),
        { timeout: 10_000 },
      )
      .toMatch(/capa\.brief/u);
    expect((await lines()).info).toBe('');
  }, 60_000);
});
