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
 * The window's flow is driven as a person drives it (TYTO-741's fourth pull request): the command,
 * the dialog's checkboxes, the line inserted for a slot the brief names no file for and undone in
 * one step, and the "save first" box, answered through a stand-in for `dialog.showMessageBox`.
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

/** The guide dialog while it is open. */
const GUIDE_DIALOG = 'tyto-guide-dialog[open]';

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

  it('refuses an unsaved brief on the bridge', async () => {
    expect(
      await call('guide:write', {
        documentId,
        only: ['grafico.guide.psd'],
        overwrite: false,
        unsaved: true,
      }),
    ).toEqual({ outcome: 'refused', reason: 'unsaved' });
  });

  it('writes the checked guide from the command, saving first, and shows it in its folder', async () => {
    // The native boxes: "save first?" answered yes, and every question kept for the assertions.
    await app.evaluate(({ dialog }) => {
      const store = globalThis as { asked?: string[] };
      store.asked = [];
      dialog.showMessageBox = ((...args: unknown[]) => {
        const box = args.find((arg) => typeof arg === 'object' && arg !== null && 'message' in arg);
        store.asked?.push((box as { message: string }).message);
        return Promise.resolve({ response: 1, checkboxChecked: false });
      }) as typeof dialog.showMessageBox;
    });
    const row = (name: string): string => `${GUIDE_DIALOG} tr[data-guide="${name}"]`;
    const checked = (name: string): Promise<boolean> =>
      window.$eval(`${row(name)} .guide__check`, (box) => (box as HTMLInputElement).checked);
    const buffer = (): Promise<string> =>
      window.$eval('#editor .cm-content', (content) => content.textContent ?? '');

    await run('guide.generate');
    await window.waitForSelector(row('grafico.guide.psd'));
    // Missing, so checked; `imagem` is cited by no line yet, so it is offered one.
    expect(await checked('grafico.guide.psd')).toBe(true);
    const offer = `${GUIDE_DIALOG} .guide__uncited li[data-slot="imagem"]`;
    expect(await window.textContent(`${offer} code`)).toBe('imagem: imagem.png');

    // The line goes into the buffer as one change: one undo takes it out, and the command lists
    // the slot as uncited again.
    await window.click(`${offer} .guide__insert`);
    await window.waitForSelector(row('imagem.guide.psd'));
    expect(await buffer()).toContain('imagem: imagem.png');
    await run('editor.undo');
    await expect.poll(buffer).not.toContain('imagem: imagem.png');
    await run('guide.generate');
    await window.waitForSelector(`${offer} .guide__insert`);
    await window.click(`${offer} .guide__insert`);
    await window.waitForSelector(row('imagem.guide.psd'));
    expect(await checked('imagem.guide.psd')).toBe(true);

    // Only the checked guide is written: `imagem`'s is unchecked by hand.
    await window.click(`${row('imagem.guide.psd')} .guide__check`);
    await window.click(`${GUIDE_DIALOG} .guide__write`);
    await window.waitForSelector(`${GUIDE_DIALOG} .guide__result`, { timeout: 30_000 });

    const guide = join(work, 'assets', 'grafico.guide.psd');
    expect(await window.textContent(`${GUIDE_DIALOG} .guide__written`)).toContain(
      join('assets', 'grafico.guide.psd'),
    );
    // The fresh folder is not trusted: shown in its folder, never opened (ADR 0111).
    expect(await window.getAttribute(`${GUIDE_DIALOG} .guide__opened`, 'data-open')).toBe(
      'restricted',
    );
    expect(readFileSync(guide).subarray(0, 4).toString('latin1')).toBe('8BPS');
    expect(existsSync(join(work, 'assets', 'imagem.guide.psd'))).toBe(false);
    // The brief was saved first, with the inserted line, and the box asked before it.
    expect(readFileSync(join(work, 'capa.brief'), 'utf8')).toContain('imagem: imagem.png');
    const seen = await app.evaluate(() => {
      const store = globalThis as { opened?: string[]; revealed?: string[]; asked?: string[] };
      return { opened: store.opened ?? [], revealed: store.revealed ?? [], asked: store.asked };
    });
    expect(seen).toEqual({ opened: [], revealed: [guide], asked: ['Save the brief first?'] });

    await window.click(`${GUIDE_DIALOG} .guide__close`);
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
