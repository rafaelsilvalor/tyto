import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * A story in the preview panel is drawn at its full height (TYTO-177).
 *
 * TYTO-44 left a row saying the panel drew a 1080×1920 story cut at 1080 px, with the rest
 * showing the transparency checkerboard. **It did not reproduce on `main`**: 0 of 24 readings
 * idle and 1 of 18 under CPU load, and that one was a capture taken before the first paint,
 * blank from the top. The panel was never on the path that suspect named. It is not a capture
 * (ADR 0033). It is a `sandbox=""` iframe at the frame's own size under a CSS scale, so no
 * offscreen window and no display clip is involved. This suite is the guard the card asked
 * for, so that a clip, if one ever comes, turns something red.
 *
 * **It was real, and it was not a clip** (TYTO-219). In a shown window the story stopped at
 * 1080 px because the iframe was still showing the grid-1x1 document: a fresh iframe keeps the
 * first of two `srcdoc` assignments when the second lands before the first one's `load`, and a
 * hidden window loads fast enough that the story click never landed in that gap. So the suite
 * now runs twice, hidden and shown. The rule that fixes it is `showDocument` in `preview.ts`,
 * and its deterministic test is in `preview.test.ts`.
 *
 * **Two claims, because jsdom can check neither and each one alone misses a way to fail.**
 * The layout box is the format's size, which a `max-height` or a stale size would break. The
 * pixels are painted, which is what a person sees. A frame laid out at 1920 and rastered only
 * to 1080 passes the first claim and fails the second.
 *
 * **Waiting for the paint, never sleeping.** A capture taken before the first paint is
 * checkerboard from the top down, which is the one false red this suite measured while it was
 * being written. So every check polls until the paper is painted, and a real clip never
 * heals, so polling cannot hide one. The pixel read is `webContents.capturePage` with a
 * one-pixel-wide rectangle down the paper's right edge. The artwork's text stops at x=1000
 * there, so that column holds only the frame's own fills, and any exact checkerboard colour
 * in it means the frame was not drawn.
 *
 * It has its own `--user-data-dir` and `TYTO_HOME`, so this machine's saved layout cannot
 * choose which panels are open.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

const packDirectory = join(
  dirname(createRequire(import.meta.url).resolve('@tyto/templates/package.json')),
  'templates',
);

/**
 * **A committed fixture, not a template of the pack** (TYTO-217): the pack's test templates are
 * throwaway and will be deleted, and this guard has to outlive them. It draws nothing right of
 * x=1000 on a dark solid fill, which is what the right-edge column read below relies on, and the
 * window finds it through this launch's own `settings.json`.
 */
const TEMPLATES = join(here, '__fixtures__', 'templates');
const EXAMPLE = join(TEMPLATES, 'guarda-teste', 'examples', 'guarda.brief');

/** A format's size, read from `formats.yaml`, the one place a size is written. */
function formatSize(format: string): { width: number; height: number } {
  const text = readFileSync(join(packDirectory, 'formats.yaml'), 'utf8');
  const match = new RegExp(`^${format}: \\{ w: (\\d+), h: (\\d+)`, 'm').exec(text);
  if (match === null) throw new Error(`${format} is not in formats.yaml`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** The two squares of `.preview__paper`'s checkerboard in `shell.css`. */
const CHECKER: readonly (readonly [number, number, number])[] = [
  [255, 255, 255],
  [217, 217, 224],
];

let scratch: string;
let app: ElectronApplication;
let page: Page;

interface Drawn {
  /** The iframe's own layout box, before the scale. */
  readonly box: { width: number; height: number };
  /** Captured rows of the visible paper that are checkerboard at its right edge. */
  readonly checker: number;
  /** Captured rows read, in device pixels, which is the capture's unit and not CSS's. */
  readonly rows: number;
}

/** What the panel has on screen right now: its layout box and its pixels. */
async function drawn(): Promise<Drawn> {
  const geometry = await page.evaluate(() => {
    const frame = document.getElementById('preview-frame') as HTMLIFrameElement;
    const stage = document.querySelector('.preview__stage')!;
    const outer = stage.getBoundingClientRect();
    const paper = document.getElementById('preview-paper')!.getBoundingClientRect();
    // The stage's client box and not its border box: at 50% it has scroll bars, and a column
    // read off its right edge was reading the vertical bar. That kept the check green over a
    // clipped frame until it was perturbed.
    const view = {
      top: outer.top + stage.clientTop,
      right: outer.left + stage.clientLeft + stage.clientWidth,
      bottom: outer.top + stage.clientTop + stage.clientHeight,
    };
    return {
      box: { width: frame.offsetWidth, height: frame.offsetHeight },
      // Only the part of the paper the stage shows: at 50% the rest is scrolled away.
      x: Math.round(Math.min(view.right, paper.right) - 6),
      top: Math.ceil(Math.max(view.top, paper.top)),
      bottom: Math.floor(Math.min(view.bottom, paper.bottom)),
    };
  });
  const cssRows = geometry.bottom - geometry.top;
  if (cssRows <= 0) return { box: geometry.box, checker: 0, rows: 0 };

  const { checker, rows } = await app.evaluate(
    async ({ BrowserWindow }, { region, squares }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) return { checker: -1, rows: 0 };
      const image = await window.webContents.capturePage(region);
      const bitmap = image.toBitmap();
      const { height } = image.getSize();
      if (height === 0) return { checker: -1, rows: 0 };
      const stride = bitmap.length / height;
      let count = 0;
      for (let row = 0; row < height; row += 1) {
        // BGRA.
        const blue = bitmap[row * stride];
        const green = bitmap[row * stride + 1];
        const red = bitmap[row * stride + 2];
        if (squares.some(([r, g, b]) => r === red && g === green && b === blue)) count += 1;
      }
      return { checker: count, rows: height };
    },
    {
      region: { x: geometry.x, y: geometry.top, width: 1, height: cssRows },
      squares: CHECKER,
    },
  );
  return { box: geometry.box, checker, rows };
}

/** Polls until the frame is laid out at `size` and painted, and returns the last reading. */
async function waitForDrawn(size: { width: number; height: number }): Promise<Drawn> {
  let last: Drawn | undefined;
  let readings = 0;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    last = await drawn();
    readings += 1;
    const laidOut = last.box.width === size.width && last.box.height === size.height;
    if (laidOut && last.rows > 0 && last.checker === 0) break;
    await page.waitForTimeout(100);
  }
  // Printed, not logged: the default reporter hides a passing test's console, and the number
  // of readings is how a slow first paint shows up in a green CI log.
  process.stdout.write(
    `preview-height: ${JSON.stringify(last)} after ${String(readings)} readings\n`,
  );
  if (last === undefined) throw new Error('the panel was never read');
  return last;
}

async function selectFormat(format: string): Promise<void> {
  await page.click(`.preview__tab[data-format="${format}"]`);
  await page.waitForFunction(
    (name) =>
      document
        .querySelector(`.preview__tab[data-format="${name}"]`)
        ?.getAttribute('aria-selected') === 'true',
    format,
  );
}

async function setZoom(target: string): Promise<void> {
  const level = page.locator('#zoom-level');
  for (let step = 0; step < ZOOM_CLICKS && (await level.textContent()) !== target; step += 1) {
    const now = Number.parseFloat((await level.textContent()) ?? '0');
    await page.click(now < Number.parseFloat(target) ? '#zoom-in' : '#zoom-out');
  }
  expect(await level.textContent()).toBe(target);
}

/** More than the number of steps in `ZOOM_STEPS`, so a missing step fails instead of looping. */
const ZOOM_CLICKS = 10;

/**
 * The suite's environment, shown or hidden.
 *
 * **Both, because the two windows load at different speeds** (TYTO-219). A fresh iframe keeps
 * the first of two `srcdoc` assignments when the second lands before the first one's `load`,
 * and only a shown window was slow enough for the story click to land in that gap: 2 of 2
 * runs red shown with the fix reverted, and the hidden half green in both. The hidden run stays because it is what every
 * other suite does and what TYTO-177 measured. CI shows the window on the `xvfb-run` display
 * that `desktop-e2e.yml` already wraps `test:desktop` in.
 */
function launchEnvironment(shown: boolean): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[name] = value;
  }
  // Deleted rather than set to something else: `show` is `TYTO_HEADLESS !== '1'`, and a run
  // started from a shell that exported it must still get a shown window here.
  if (shown) delete environment['TYTO_HEADLESS'];
  else environment['TYTO_HEADLESS'] = '1';
  return environment;
}

describe.each([
  { window: 'hidden', shown: false },
  { window: 'shown', shown: true },
])('in a $window window', ({ shown }) => {
  beforeAll(async () => {
    if (!existsSync(built)) {
      throw new Error(
        `${built} is missing — run \`pnpm build\` before \`pnpm --filter @tyto/desktop test:desktop\``,
      );
    }

    scratch = mkdtempSync(join(tmpdir(), 'tyto-preview-height-'));
    const userData = join(scratch, 'userData');
    mkdirSync(userData, { recursive: true });
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ templatesFolder: TEMPLATES }));
    app = await _electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      cwd: join(here, '..'),
      env: { ...launchEnvironment(shown), TYTO_HOME: join(scratch, 'tyto-home') },
    });
    page = await firstWindow(app);
    await page.waitForFunction(() => document.querySelector('#editor .cm-content') !== null);
    await page.click('#editor .cm-content');
    await page.keyboard.insertText(readFileSync(EXAMPLE, 'utf8'));
    await page.waitForSelector('.preview__tab[data-format="story"]', { timeout: 15_000 });
  });

  afterAll(async () => {
    await closeApp(app);
    rmSync(scratch, { recursive: true, force: true });
  });

  describe('a story in the preview panel', () => {
    const story = formatSize('story');

    it('is laid out and painted at its full height when fitted', async () => {
      await selectFormat('story');
      const result = await waitForDrawn(story);

      expect(result.box).toEqual(story);
      expect(result.checker).toBe(0);
    });

    it('is painted to its last row at 50%, scrolled to the bottom', async () => {
      // At 50% the story is 960 px tall in a stage much shorter than that. The bottom of the
      // frame is exactly what a 1080 px clip would lose.
      await setZoom('50%');
      // The scroll has to come after the paper is 50% tall. Scrolled before that, it lands on a
      // stage with nothing to scroll, and the check reads the top of the frame. That is how the
      // first draft of this test stayed green with the bottom 840 px clipped away.
      await page.waitForFunction(
        (height) => document.getElementById('preview-paper')?.offsetHeight === height,
        Math.round(story.height * 0.5),
      );
      await page.evaluate(() => {
        const stage = document.querySelector('.preview__stage')!;
        stage.scrollTop = stage.scrollHeight;
      });
      await page.waitForFunction(() => {
        const stage = document.querySelector('.preview__stage')!;
        const outer = stage.getBoundingClientRect();
        const paper = document.getElementById('preview-paper')!.getBoundingClientRect();
        return (
          paper.top < outer.top && paper.bottom <= outer.top + stage.clientTop + stage.clientHeight
        );
      });
      const result = await waitForDrawn(story);

      expect(result.box).toEqual(story);
      expect(result.checker).toBe(0);
    });

    it('keeps its full height after a square frame was on screen', async () => {
      // One iframe serves every format, and it is resized in place. grid-1x1 first, so the
      // story arrives in an element that was 1080 px tall a moment ago.
      await page.click('#zoom-fit');
      await selectFormat('grid-1x1');
      await waitForDrawn(formatSize('grid-1x1'));

      await selectFormat('story');
      const result = await waitForDrawn(story);

      expect(result.box).toEqual(story);
      expect(result.checker).toBe(0);
    });
  });
});
