import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';

/**
 * A bundled code template's own backgrounds, in the window's preview and export, agreeing
 * with `tyto render` (TYTO-210, owning the checks TYTO-214 deferred).
 *
 * `banner-roxo` is the first bundled template that reads its folder through `context.files`
 * (ADR 0062): one PNG per format, `assets/bg-<format>.png`. TYTO-214 wired the reader in the
 * CLI and in the window, but no bundled template used it, so neither the built window nor a
 * look at it could be checked there.
 *
 * **What is compared, and why not the PNGs with each other.** The CLI rasterizes through
 * Playwright's browser, which the desktop job does not install (`e2e/template-assets`'s
 * reason), and the banner has text, which ADR 0028 measured differing between rasterizers.
 * So:
 *
 * - the preview embeds the background's own bytes;
 * - the window's SVG for every format is **byte for byte** the CLI's SVG of the same brief,
 *   and embeds that format's background;
 * - the window's PNG for every format draws that format's background: outside the text's box,
 *   every pixel is the background composited on white, within the raster tolerance.
 *
 * CI has no CircularXX and draws the substitute in both programs, so nothing here depends on
 * a glyph's size. Its own `--user-data-dir` and `TYTO_HOME`; `closeApp` answers the quit
 * question (TYTO-150).
 */

const here = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = require_.resolve('@tyto/cli/dist/index.js');
const BANNER = resolve(here, '..', '..', '..', 'packages', 'templates', 'templates', 'banner-roxo');

for (const file of [built, cli]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

/** The three formats, their canvas, and the box `banner-roxo/template.ts` sets the text in. */
const FORMATS = {
  banner: { w: 1200, h: 628, text: { x: 260, y: 332, w: 680, h: 200 } },
  'banner-1x1': { w: 600, h: 600, text: { x: 30, y: 210, w: 540, h: 180 } },
  'banner-345x146': { w: 345, h: 146, text: { x: 129, y: 40, w: 196, h: 66 } },
} as const;
type Format = keyof typeof FORMATS;
const FORMAT_IDS = Object.keys(FORMATS) as Format[];

/** Per channel, how far a pixel may stray from the background (antialiasing, colour space). */
const CHANNEL_TOLERANCE = 8;
/** The share of pixels outside the text box that may stray further: the raster tolerance. */
const TOLERANCE = 0.001;

const background = (format: Format): Buffer =>
  readFileSync(join(BANNER, 'assets', `bg-${format}.png`));

let app: ElectronApplication;
let window: Page;
let scratch: string;
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

/** The background PNG composited on white, the paper the template lays under it. */
function onWhite(format: Format): PNG {
  const png = PNG.sync.read(background(format));
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const alpha = png.data[offset + 3]! / 255;
    for (let channel = 0; channel < 3; channel++) {
      png.data[offset + channel] = Math.round(
        png.data[offset + channel]! * alpha + 255 * (1 - alpha),
      );
    }
    png.data[offset + 3] = 255;
  }
  return png;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-banner-e2e-'));
  const work = join(scratch, 'work');
  mkdirSync(work, { recursive: true });
  briefPath = join(work, 'banner.brief');
  writeFileSync(
    briefPath,
    readFileSync(join(BANNER, 'examples', 'prefeitura.brief'), 'utf8').replace(/\r\n/gu, '\n'),
    'utf8',
  );

  // The CLI reads `formats.yaml` from the folder it runs in and the app reads the pack's own;
  // copied so both are asked for the same canvases.
  const pack = dirname(BANNER);
  writeFileSync(join(scratch, 'formats.yaml'), readFileSync(join(pack, 'formats.yaml'), 'utf8'));

  const userData = join(scratch, 'userData');
  mkdirSync(userData, { recursive: true });
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
    () => document.querySelector('.tabs__label')?.textContent?.includes('banner') === true,
  );
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe("banner-roxo's backgrounds in the window and the CLI (TYTO-210)", () => {
  it('previews the 1200×628 over its own background, with no problem listed', async () => {
    const own = background('banner').toString('base64');
    await expect.poll(() => shown(), { timeout: 15_000 }).toContain(own);
    expect(await shown()).toContain('Prefeitura');
    const problems = await window.evaluate(() =>
      [...document.querySelectorAll('.problems__row')].map((row) => row.textContent ?? ''),
    );
    expect(problems.filter((row) => /E_|W_TEMPLATE/u.test(row))).toEqual([]);

    // For a person to look at: the real window, with the preview drawn.
    const shot = process.env['TYTO_E2E_SCREENSHOT'];
    if (shot !== undefined) await window.screenshot({ path: shot });
  }, 60_000);

  it('exports every format over its own background, and the same SVG `tyto render` writes', async () => {
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
      timeout: 90_000,
    });

    const result = JSON.parse(
      readFileSync(join(fromWindow, 'editaveis', 'result.json'), 'utf8'),
    ) as { status: string; diagnostics: { code: string }[] };
    // CI has no CircularXX, so there every Casa render says it drew the substitute
    // (W_FONT_SUBSTITUTED); that is the machine, not the template. Anything else is not.
    expect(
      result.diagnostics.map((item) => item.code).filter((code) => code !== 'W_FONT_SUBSTITUTED'),
    ).toEqual([]);
    expect(result.status).toBe('ok');

    const fromCli = join(scratch, 'from-cli');
    execFileSync(process.execPath, [cli, 'render', briefPath, '--out', fromCli, '--types', 'svg'], {
      cwd: scratch,
      stdio: 'pipe',
    });

    for (const format of FORMAT_IDS) {
      const { w, h, text } = FORMATS[format];

      // The SVG: its own background, and byte for byte what the CLI wrote.
      const svg = readFileSync(join(fromWindow, `${format}-01.svg`), 'utf8');
      expect(svg, format).toContain(background(format).toString('base64'));
      for (const other of FORMAT_IDS.filter((id) => id !== format)) {
        expect(svg, `${format} holds ${other}'s background`).not.toContain(
          background(other).toString('base64'),
        );
      }
      expect(readFileSync(join(fromCli, `${format}-01.svg`), 'utf8'), format).toBe(svg);

      // The PNG: outside the text's box, the background itself.
      const png = PNG.sync.read(readFileSync(join(fromWindow, `${format}-01.png`)));
      expect([png.width, png.height], format).toEqual([w, h]);
      const reference = onWhite(format);
      let outside = 0;
      let differing = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const inText = x >= text.x && x < text.x + text.w && y >= text.y && y < text.y + text.h;
          if (inText) continue;
          outside++;
          const offset = (w * y + x) * 4;
          for (let channel = 0; channel < 3; channel++) {
            const delta = Math.abs(png.data[offset + channel]! - reference.data[offset + channel]!);
            if (delta > CHANNEL_TOLERANCE) {
              differing++;
              break;
            }
          }
        }
      }
      process.stdout.write(
        `[TYTO-210] ${format} window png vs background outside the text: ${String(differing)} of ${String(outside)} pixels differ\n`,
      );
      expect(differing / outside, format).toBeLessThanOrEqual(TOLERANCE);
    }
  }, 180_000);
});
