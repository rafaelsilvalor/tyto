import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * A template that draws from its own folder agrees in the window and in `tyto render` (TYTO-176).
 *
 * Before the fix the window drew nothing for such a template — `E_TEMPLATE_MARKUP` for a
 * `<vector src="assets/…">`, `E_TEMPLATE_VALUE` for an `<image src="assets/…">` — while the CLI
 * drew it whole. So the proof is the window's PNG within the tolerance `e2e/raster.desktop.test.ts`
 * defends (0.1% of pixels, pixelmatch threshold 0.1), and the CLI's SVG embedding the same two
 * files the window's does.
 *
 * **The PNG is compared with the artwork, not with the CLI's PNG.** The CLI rasterizes through
 * Playwright's browser and the desktop job does not install one. Measured on this machine, where
 * it is installed: the two PNGs differed in 0 of 1,166,400 pixels. **And there is no text in the
 * fixture**, because ADR 0028 measured glyphs at ten times that tolerance between the two
 * rasterizers. Without text, the comparison measures the template's own files.
 *
 * The CLI is its built binary, spawned the way `e2e/export.desktop.test.ts` spawns it. Its own
 * `--user-data-dir` and `TYTO_HOME`, so neither this machine's layout nor its plugins decide.
 */

const here = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

const TOLERANCE = 0.001;
const THRESHOLD = 0.1;

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

const BACKGROUND_RGB = [224, 48, 48] as const;
const MARK_RGB = [48, 192, 96] as const;

const MANIFEST = [
  'name: selo-teste',
  'version: 1.0.0',
  'formats: [grid-1x1]',
  'slots:',
  '  titulo: { type: rich-text }',
  '',
].join('\n');

const MARKUP = [
  '<frame format="grid-1x1" bg="#000000">',
  '  <image src="assets/fundo.png" fit="cover" class="bg" />',
  '  <vector src="assets/selo.svg" class="mark" />',
  '</frame>',
  '<style>',
  '  .bg { x: 0; y: 0; w: 100%; h: 50%; }',
  '  .mark { x: 540; y: 600; w: 400; h: 400; }',
  '</style>',
  '',
].join('\n');

const MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
  '<rect width="10" height="10" fill="#30c060"/></svg>';

const BRIEF = ['---', 'template: selo-teste', '---', ''].join('\n');

let app: ElectronApplication;
let window: Page;
let scratch: string;
let templates: string;
let briefPath: string;

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

/**
 * The artwork `MARKUP` describes, pixel for pixel: black, the background over the top half,
 * the mark's square below it. Every edge falls on a whole pixel, so there is nothing to blend.
 */
function expectedArtwork(width: number, height: number): PNG {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inMark = x >= 540 && x < 940 && y >= 600 && y < 1000;
      const rgb = y < height / 2 ? BACKGROUND_RGB : inMark ? MARK_RGB : ([0, 0, 0] as const);
      const offset = (width * y + x) * 4;
      png.data[offset] = rgb[0];
      png.data[offset + 1] = rgb[1];
      png.data[offset + 2] = rgb[2];
      png.data[offset + 3] = 255;
    }
  }
  return png;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-template-assets-e2e-'));

  templates = join(scratch, 'mine');
  const template = join(templates, 'selo-teste');
  mkdirSync(join(template, 'assets'), { recursive: true });
  writeFileSync(join(template, 'manifest.yaml'), MANIFEST);
  writeFileSync(join(template, 'template.html'), MARKUP);
  writeFileSync(join(template, 'assets', 'fundo.png'), solidPng(16, BACKGROUND_RGB));
  writeFileSync(join(template, 'assets', 'selo.svg'), MARK);

  // A folder of its own with no `assets/`, so the brief-side lookup (ADR 0056) cannot be what
  // finds these files.
  const work = join(scratch, 'work');
  mkdirSync(work, { recursive: true });
  briefPath = join(work, 'selo.brief');
  writeFileSync(briefPath, BRIEF, 'utf8');

  // The CLI reads `formats.yaml` from the folder it runs in and the app reads the pack's own;
  // copied so both are asked for the same canvas (`e2e/export.desktop.test.ts`'s reason).
  const pack = join(dirname(require_.resolve('@tyto/templates/package.json')), 'templates');
  writeFileSync(join(scratch, 'formats.yaml'), readFileSync(join(pack, 'formats.yaml'), 'utf8'));

  const userData = join(scratch, 'userData');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ templatesFolder: templates }));

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  window = await app.firstWindow();
  await window.waitForSelector('#editor .cm-content');
  await window.waitForSelector('.tabs__tab');

  await answerPickers({ file: briefPath });
  await run('editor.open');
  await window.waitForFunction(
    () => document.querySelector('.tabs__label')?.textContent?.includes('selo') === true,
  );
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe("a template's own folder, in the window and the CLI (TYTO-176)", () => {
  it('previews the image and the vector with no problem listed', async () => {
    await expect.poll(() => shown(), { timeout: 15_000 }).toContain('data:image/png');
    expect(await shown()).toContain('#30c060');
    const problems = await window.evaluate(() =>
      [...document.querySelectorAll('.problems__row')].map((row) => row.textContent ?? ''),
    );
    expect(problems.filter((row) => /E_TEMPLATE|E_EXPORT/u.test(row))).toEqual([]);

    // For a person to look at: the real window, with the preview drawn.
    const shot = process.env['TYTO_E2E_SCREENSHOT'];
    if (shot !== undefined) await window.screenshot({ path: shot });
  }, 60_000);

  it('exports a PNG within the raster tolerance of the artwork, and the files `tyto render` embeds', async () => {
    const fromWindow = join(scratch, 'from-window');
    await answerPickers({ directory: fromWindow });
    await run('file.export');
    await window.locator('.export__panel').waitFor({ state: 'visible' });
    await window.locator('.export__choose').click();
    await window.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="export-directory"]')?.textContent?.trim() ===
        expected,
      fromWindow,
    );
    for (const kind of ['png', 'jpeg', 'webp', 'svg']) {
      const box = window.locator(`.export__type input[value="${kind}"]`);
      if ((await box.isChecked()) !== (kind === 'png' || kind === 'svg')) await box.click();
    }
    await window.locator('.export__start').click();
    await window.waitForSelector('[data-testid="export-status"][data-state="finished"]', {
      timeout: 60_000,
    });

    const result = JSON.parse(
      readFileSync(join(fromWindow, 'editaveis', 'result.json'), 'utf8'),
    ) as { status: string; diagnostics: { code: string }[] };
    expect(result.diagnostics.map((item) => item.code)).toEqual([]);
    expect(result.status).toBe('ok');

    // **Against the artwork the markup describes, not against the CLI's PNG.** The CLI
    // rasterizes through Playwright's browser, which the desktop job does not install (measured
    // on the first CI run: `Executable doesn't exist`). The fixture is three solid areas, so its
    // pixels are known exactly and the reference is computed here — no binary, no LFS.
    const png = PNG.sync.read(readFileSync(join(fromWindow, 'grid-1x1-01.png')));
    expect([png.width, png.height]).toEqual([1080, 1080]);
    const reference = expectedArtwork(png.width, png.height);
    const differing = pixelmatch(png.data, reference.data, undefined, png.width, png.height, {
      threshold: THRESHOLD,
    });
    process.stdout.write(
      `[TYTO-176] window png vs artwork: ${String(differing)} of ${String(png.width * png.height)} pixels differ
`,
    );
    expect(differing / (png.width * png.height)).toBeLessThanOrEqual(TOLERANCE);

    // And the CLI over the same brief, as SVG, which needs no browser. Byte for byte: both bind
    // the brief's files and the template's through `layeredExportResources` (TYTO-216), so the
    // `cover` background is cropped the same way in both. Before TYTO-215 the CLI's copy of that
    // binding dropped `assetSize` and left the crop to the reader (TYTO-60).
    const fromCli = join(scratch, 'from-cli');
    const cli = require_.resolve('@tyto/cli/dist/index.js');
    execFileSync(
      process.execPath,
      [cli, 'render', briefPath, '--out', fromCli, '--types', 'svg', '--templates', templates],
      { cwd: scratch, stdio: 'pipe' },
    );
    const background = solidPng(16, BACKGROUND_RGB).toString('base64');
    for (const folder of [fromWindow, fromCli]) {
      const svg = readFileSync(join(folder, 'grid-1x1-01.svg'), 'utf8');
      expect(svg, folder).toContain(background);
      expect(svg, folder).toContain('#30c060');
      expect(svg, folder).toContain('<clipPath');
    }
    expect(readFileSync(join(fromCli, 'grid-1x1-01.svg'), 'utf8')).toBe(
      readFileSync(join(fromWindow, 'grid-1x1-01.svg'), 'utf8'),
    );
  }, 120_000);
});
