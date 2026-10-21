import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { openPreviewBeside, previewSrcdoc } from './preview-pane.js';

/**
 * A workspace folder in the real window (TYTO-278, ADR 0113): File ▸ Open Folder through main's
 * picker, a brief inside it drawing a template and an image from the folders its
 * `.tyto/project.json` names, the export dialog pointing at its output folder, a key that
 * leads outside listed in the problems panel, and the folder back after a relaunch.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`. The picker is answered from main, never by the
 * window: no channel takes a path.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** A solid 8×8 PNG, built here so no binary is checked in (as `assets.desktop.test.ts`). */
function solidPng(rgb: readonly [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(8, 0);
  header.writeUInt32BE(8, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(8 * 3, Buffer.from(rgb))]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 8 }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LOGO = solidPng([30, 90, 200]);

let scratch: string;
let work: string;
let app: ElectronApplication | undefined;
let window: Page;

async function launch(): Promise<void> {
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
  await window.waitForSelector('.tabs__tab');
}

/** Answers main's next pickers: a folder for a folder picker, a file for a file picker. */
async function answerPickers(paths: { file?: string; directory?: string }): Promise<void> {
  await app?.evaluate(
    ({ dialog }, chosen) => {
      dialog.showOpenDialog = (options?: unknown) => {
        const properties = (options as { properties?: string[] } | undefined)?.properties ?? [];
        const wanted = properties.includes('openDirectory') ? chosen.directory : chosen.file;
        return Promise.resolve(
          wanted === null
            ? { canceled: true, filePaths: [] }
            : { canceled: false, filePaths: [wanted] },
        );
      };
    },
    { file: paths.file ?? null, directory: paths.directory ?? null },
  );
}

async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

const problemsText = async (): Promise<string> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map((row) => row.textContent).join('\n'),
  );

async function openBrief(path: string, title: string): Promise<void> {
  await answerPickers({ file: path });
  await run('editor.open');
  await expect.poll(() => previewSrcdoc(window), { timeout: 15_000 }).toContain(title);
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-workspace-e2e-'));
  work = join(scratch, 'promo');
  mkdirSync(join(work, '.tyto'), { recursive: true });
  mkdirSync(join(work, 'art'), { recursive: true });
  mkdirSync(join(work, 'briefs'), { recursive: true });
  writeFileSync(join(work, 'art', 'logo.png'), LOGO);
  cpSync(
    join(here, '__fixtures__', 'templates', 'guarda-teste'),
    join(work, 'tpl', 'guarda-teste'),
    { recursive: true },
  );
  // Restricted, as every folder starts: `fonts` leads outside and is left out, the rest holds.
  writeFileSync(
    join(work, '.tyto', 'project.json'),
    '{\n  "templates": ["tpl"],\n  "assets": ["art"],\n  "fonts": ["../elsewhere"],\n  "output": "exports"\n}\n',
  );
  writeFileSync(
    join(work, 'briefs', 'logo.brief'),
    [
      '---',
      'template: promo-curso',
      'formats: [grid-1x1]',
      'imagem: logo.png',
      '---',
      '::titulo',
      '  Da pasta do projeto',
    ].join('\n'),
  );
  writeFileSync(
    join(work, 'briefs', 'guarda.brief'),
    [
      '---',
      'template: guarda-teste',
      'formats: [grid-1x1]',
      '---',
      '::titulo',
      '  Template do projeto',
      '::lamina',
      '  Um',
    ].join('\n'),
  );
  await launch();
  await openPreviewBeside(window);
});

afterAll(async () => {
  if (app !== undefined) await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a workspace folder in the window (TYTO-278)', () => {
  it('opens through main, and a brief inside draws from the declared folders', async () => {
    await answerPickers({ directory: work });
    await run('workspace.openFolder');
    await expect.poll(problemsText, { timeout: 10_000 }).toContain('W_PROJECT_PATH_OUTSIDE');
    expect(await problemsText()).toContain('project.json:4:');

    await openBrief(join(work, 'briefs', 'logo.brief'), 'Da pasta do projeto');
    expect(await previewSrcdoc(window)).toContain(LOGO.toString('base64'));
    // The titles name the folder between the file and the app (Rafael, 2026-10-21).
    expect(await window.title()).toBe('logo.brief — promo — Tyto');

    await openBrief(join(work, 'briefs', 'guarda.brief'), 'Template do projeto');
    expect(await problemsText()).not.toContain('E_UNKNOWN_TEMPLATE');
  }, 60_000);

  it("points the export dialog at the folder's output folder", async () => {
    await run('file.export');
    await window.locator('.export__panel').waitFor({ state: 'visible' });
    await window.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="export-directory"]')?.textContent?.trim() ===
        expected,
      join(work, 'exports'),
    );
    await window.keyboard.press('Escape');
  }, 30_000);

  it('comes back after a relaunch, and goes when it is closed', async () => {
    await closeApp(app!);
    app = undefined;
    await launch();
    await openPreviewBeside(window);
    await expect.poll(problemsText, { timeout: 15_000 }).toContain('W_PROJECT_PATH_OUTSIDE');
    await expect
      .poll(() => previewSrcdoc(window), { timeout: 15_000 })
      .toContain('Template do projeto');

    await run('workspace.closeFolder');
    await expect.poll(problemsText, { timeout: 10_000 }).not.toContain('W_PROJECT_PATH_OUTSIDE');
    await expect.poll(problemsText, { timeout: 10_000 }).toContain('E_UNKNOWN_TEMPLATE');
  }, 60_000);
});
