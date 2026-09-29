import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * Where the window finds a brief's images (TYTO-204, ADR 0056).
 *
 * The bug this closes was only ever visible here: `tyto render` drew a delivery-shaped folder
 * and the editor, opening the same folder, reported `E_ASSET_NOT_FOUND` and drew nothing. So
 * the proof is the preview's own document and the export box's own files, with the brief
 * opened from disk the way a person opens it.
 *
 * Its own `--user-data-dir` and `TYTO_HOME`, so neither this machine's layout nor its
 * installed plugins can decide the outcome.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** A solid PNG big enough to see in the preview, built here so no binary is checked in. */
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
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from(rgb))]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const IN_ASSETS = solidPng(64, [220, 40, 40]);
const BESIDE = solidPng(64, [40, 160, 60]);

const briefFor = (image: string, title: string): string =>
  [
    '---',
    'template: promo-curso',
    'formats: [grid-1x1]',
    `imagem: ${image}`,
    '---',
    '::titulo',
    `  ${title}`,
  ].join('\n');

let app: ElectronApplication;
let window: Page;
let scratch: string;
let delivery: string;

async function answerPickers(paths: { file?: string; directory?: string }): Promise<void> {
  await app.evaluate(
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

/** Runs a command the way the command bar would, and fails loudly if it was refused. */
async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

const shown = async (): Promise<string> =>
  window.evaluate(() => document.getElementById('preview-frame')?.getAttribute('srcdoc') ?? '');

/** Opens a brief from disk and waits for a preview carrying `title`. */
async function openBrief(path: string, title: string): Promise<string> {
  await answerPickers({ file: path });
  await run('editor.open');
  await window.waitForFunction(
    (wanted) => document.querySelector('.cm-content')?.textContent?.includes(wanted) === true,
    title,
  );
  await expect.poll(() => shown(), { timeout: 15_000 }).toContain(title);
  return shown();
}

const problemsText = async (): Promise<string> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map((row) => row.textContent).join('\n'),
  );

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-assets-e2e-'));
  // The folder the maintainer tested with: briefs at the top, images in `assets/`.
  delivery = join(scratch, 'tyto-testes');
  mkdirSync(join(delivery, 'assets'), { recursive: true });
  writeFileSync(join(delivery, 'assets', 'calendario.png'), IN_ASSETS);

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await app.firstWindow();
  await window.waitForSelector('#editor .cm-content');
  await window.waitForSelector('.tabs__tab');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a brief opened from a delivery-shaped folder (ADR 0056)', () => {
  it('previews ./calendario.png from assets/, with no diagnostic', async () => {
    const path = join(delivery, 'fallback.brief');
    writeFileSync(path, briefFor('./calendario.png', 'Pelo fallback'), 'utf8');

    const html = await openBrief(path, 'Pelo fallback');

    expect(html).toContain(IN_ASSETS.toString('base64'));
    expect(await problemsText()).not.toContain('was not found');

    // For a person to look at the real window; off in CI, where nobody would.
    const shot = process.env['TYTO_ASSETS_SHOT'];
    if (shot !== undefined) await window.screenshot({ path: shot });
  }, 60_000);

  it('previews ./assets/calendario.png as written', async () => {
    const path = join(delivery, 'literal.brief');
    writeFileSync(path, briefFor('./assets/calendario.png', 'Como escrito'), 'utf8');

    const html = await openBrief(path, 'Como escrito');

    expect(html).toContain(IN_ASSETS.toString('base64'));
    expect(await problemsText()).not.toContain('was not found');
  }, 60_000);

  it('previews the one beside the brief when both exist', async () => {
    const both = join(scratch, 'ambos');
    mkdirSync(join(both, 'assets'), { recursive: true });
    writeFileSync(join(both, 'assets', 'calendario.png'), IN_ASSETS);
    writeFileSync(join(both, 'calendario.png'), BESIDE);
    const path = join(both, 'ambos.brief');
    writeFileSync(path, briefFor('./calendario.png', 'Os dois existem'), 'utf8');

    const html = await openBrief(path, 'Os dois existem');

    expect(html).toContain(BESIDE.toString('base64'));
    expect(html).not.toContain(IN_ASSETS.toString('base64'));
  }, 60_000);

  it('exports ./calendario.png from assets/ with no diagnostic in result.json', async () => {
    const path = join(delivery, 'fallback.brief');
    await openBrief(path, 'Pelo fallback');
    const out = join(scratch, 'entrega');

    await answerPickers({ directory: out });
    await run('file.export');
    await window.locator('.export__panel').waitFor({ state: 'visible' });
    await window.locator('.export__choose').click();
    await window.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="export-directory"]')?.textContent?.trim() ===
        expected,
      out,
    );
    for (const kind of ['png', 'jpeg', 'webp', 'svg']) {
      const box = window.locator(`.export__type input[value="${kind}"]`);
      if ((await box.isChecked()) !== (kind === 'svg')) await box.click();
    }
    await window.locator('.export__start').click();
    await window.waitForSelector('[data-testid="export-status"][data-state="finished"]', {
      timeout: 60_000,
    });

    const result = JSON.parse(readFileSync(join(out, 'editaveis', 'result.json'), 'utf8')) as {
      status: string;
      artifacts: { name: string }[];
      diagnostics: { code: string }[];
    };
    expect(result.diagnostics.map((item) => item.code)).not.toContain('E_ASSET_NOT_FOUND');
    expect(result.status).toBe('ok');
    const svg = readFileSync(join(out, result.artifacts[0]!.name), 'utf8');
    expect(svg).toContain(IN_ASSETS.toString('base64'));

    // The folder picked is the delivery (ADR 0057): the image the brief used in assets/, and
    // the copied brief naming that copy, so it renders again from editaveis/.
    expect(readdirSync(join(out, 'assets'))).toEqual(['calendario.png']);
    expect(readFileSync(join(out, 'assets', 'calendario.png')).equals(IN_ASSETS)).toBe(true);
    expect(readFileSync(join(out, 'editaveis', 'fallback.brief'), 'utf8')).toContain(
      'imagem: calendario.png',
    );
  }, 120_000);
});
