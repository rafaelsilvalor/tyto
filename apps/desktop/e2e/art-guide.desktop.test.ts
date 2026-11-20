import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { switchingFolder } from './folder-switch.js';
import { firstWindow } from './first-window.js';
import { SHOWN_PREVIEW, openPreviewBeside, previewSrcdoc } from './preview-pane.js';

/**
 * The external-art guide in the window's main process, and the preview that follows the art
 * painted from it (TYTO-741, ADR 0222).
 *
 * The guide is written by the real `tyto guide`, run in main as the command panel runs it, and
 * the folder is a fresh one the window has not trusted, so it is written and shown in its
 * folder, never opened (ADR 0111). Opening and showing a file are stand-ins swapped in through
 * `app.evaluate` for `shell.openPath` and `shell.showItemInFolder`, so no program starts.
 *
 * Then the card's done-when: a PNG saved where the brief reads it back shows in the preview
 * with no keystroke, because `explorer:changed` names the file and the brief's last preview
 * asked for one of that name. Before it is saved, the preview draws the art's box: the control.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** A solid PNG, built here so no binary is checked in. */
function solidPng(size: number, rgb: readonly [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from(rgb))]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PAINTED = solidPng(48, [30, 90, 200]);
const BRIEF = [
  '---',
  'template: arte-teste',
  'formats: [grid-1x1]',
  'fundo: grafico.png',
  '---',
  '::titulo',
  '  Capa pintada',
].join('\n');

let app: ElectronApplication;
let window: Page;
let scratch: string;
let work: string;
let documentId: string;

type Bridge = Record<string, (request: unknown) => Promise<unknown>>;

/** A call on the window's own bridge, with the contract's checks on both sides. */
const call = <T>(channel: string, request: unknown): Promise<T> =>
  window.evaluate(([name, body]) => (globalThis as unknown as { tyto: Bridge }).tyto[name]!(body), [
    channel,
    request,
  ] as const) as Promise<T>;

async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

const answerPicker = (path: string): Promise<void> =>
  app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, path);

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-art-guide-e2e-'));
  work = join(scratch, 'arte');
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'capa.brief'), BRIEF, 'utf8');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
  await app.evaluate(({ shell }) => {
    const store = globalThis as { opened?: string[]; revealed?: string[] };
    store.opened = [];
    store.revealed = [];
    shell.openPath = (path: string) => {
      store.opened?.push(path);
      return Promise.resolve('');
    };
    shell.showItemInFolder = (path: string) => {
      store.revealed?.push(path);
    };
  });
  await answerPicker(work);
  await switchingFolder(window, () => run('workspace.openFolder'));
  await openPreviewBeside(window);

  await answerPicker(join(work, 'capa.brief'));
  await run('editor.open');
  await window.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute('srcdoc')?.includes('Capa pintada'),
    `${SHOWN_PREVIEW} [data-preview-frame]`,
    { timeout: 15_000 },
  );
  // The tab main holds the file for: asking main to open the same file answers that tab.
  const opened = await call<{ documentId: string | null }>('file:open', { documentId: 'probe' });
  documentId = opened.documentId ?? '';
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the external-art guide from the window (TYTO-741)', () => {
  it('lists the guide tyto guide would write, beside the cited file', async () => {
    expect(documentId).not.toBe('');
    const answer = await call<{ ok: boolean; guides: { name: string; exists: boolean }[] }>(
      'guide:candidates',
      { documentId },
    );
    expect(answer.ok).toBe(true);
    expect(answer.guides.map(({ name, exists }) => ({ name, exists }))).toEqual([
      { name: 'grafico.guide.psd', exists: false },
    ]);
  });

  it('refuses an unsaved brief, then writes the guide and shows it in a folder not trusted', async () => {
    const write = { documentId, only: ['grafico.guide.psd'], overwrite: false };
    expect(await call('guide:write', { ...write, unsaved: true })).toEqual({
      outcome: 'refused',
      reason: 'unsaved',
    });

    const answer = await call<{ outcome: string; written: string[]; open: string }>('guide:write', {
      ...write,
      unsaved: false,
    });
    const guide = join(work, 'assets', 'grafico.guide.psd');
    expect(answer).toMatchObject({
      outcome: 'written',
      written: [join('assets', 'grafico.guide.psd')],
      open: 'restricted',
    });
    expect(readFileSync(guide).subarray(0, 4).toString('latin1')).toBe('8BPS');
    const seen = await app.evaluate(() => {
      const store = globalThis as { opened?: string[]; revealed?: string[] };
      return { opened: store.opened ?? [], revealed: store.revealed ?? [] };
    });
    expect(seen).toEqual({ opened: [], revealed: [guide] });
  }, 60_000);

  it('draws the PNG painted from the guide as soon as it is saved, with no keystroke', async () => {
    const encoded = PAINTED.toString('base64');
    // The control: no art yet, so the preview draws the box and not the picture.
    expect(await previewSrcdoc(window)).not.toContain(encoded);
    expect(existsSync(join(work, 'assets', 'grafico.png'))).toBe(false);

    writeFileSync(join(work, 'assets', 'grafico.png'), PAINTED);

    await expect.poll(() => previewSrcdoc(window), { timeout: 15_000 }).toContain(encoded);
  }, 30_000);
});
