import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { SHOWN_PREVIEW, openPreviewBeside, previewSrcdoc } from './preview-pane.js';

/**
 * The preview's All slides mode, in a real window (TYTO-323, ADR 0123).
 *
 * `preview.test.ts` holds the mode's painting and the one set of iframes both modes share, and
 * `slide-thumbnails.test.ts` the grid's click and its arithmetic, in jsdom. What only a window
 * can say is the rest: that ten slides lay out as a grid in order, that a click on the seventh
 * opens it as the main slide in One slide mode, that the mode comes back after a reload and after
 * a quit, and how long the grid of a 20-slide brief takes to paint. The time is printed for the
 * pull request and asserts only a ceiling a frozen window would break.
 *
 * `TYTO_PREVIEW_SHOWN=1` also measures the strip and the grid with the window **shown**, which
 * puts a window on the screen, so it is not run by default. `TYTO_GRID_SHOTS` set to a folder
 * leaves pictures in both themes. Its own `--user-data-dir` and `TYTO_HOME`, two launches of one
 * data folder.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const TEMPLATES = join(here, '__fixtures__', 'templates');
const shots = process.env['TYTO_GRID_SHOTS'];
const measureShown = process.env['TYTO_PREVIEW_SHOWN'] === '1';
/** `TYTO_GRID_SCALE=1` forces a device scale factor, to photograph the grid at 100 % on a 125 % screen. */
const scale = process.env['TYTO_GRID_SCALE'];

const THUMBNAILS = `${SHOWN_PREVIEW} [data-preview-strip]`;
const THUMBNAIL = `${THUMBNAILS} [data-thumbnail]`;
const MODE = (mode: 'one' | 'all'): string => `${SHOWN_PREVIEW} [data-preview-mode="${mode}"]`;

let scratch: string;
let userData: string;
let app: ElectronApplication | undefined;
let page: Page;

/** A brief of `count` slides, each with a word no other slide's contains: `item7fim`. */
const brief = (count: number, format = 'grid-1x1', title = 'Grade'): string =>
  [
    '---',
    'template: guarda-teste',
    `formats: [${format}]`,
    '---',
    `::titulo ${title}`,
    ...Array.from({ length: count }, (_, at) => `::lamina item${String(at + 1)}fim`),
  ].join('\n');

/** Replaces the whole buffer. */
async function type(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}

const launch = async (): Promise<void> => {
  app = await _electron.launch({
    args: [
      '.',
      `--user-data-dir=${userData}`,
      ...(scale === undefined ? [] : [`--force-device-scale-factor=${scale}`]),
    ],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
};

/** Quits as a person does: the session is written on the way out. */
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

/** Which layout the thumbnails element is drawn in, or `hidden`. */
const layout = (): Promise<string> =>
  page.evaluate((selector) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null || element.hidden) return 'hidden';
    return element.classList.contains('thumbnails--grid') ? 'grid' : 'strip';
  }, THUMBNAILS);

const labels = (): Promise<string[]> =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)].map((cell) => cell.textContent?.trim() ?? ''),
    THUMBNAIL,
  );

const activeLine = (): Promise<string> =>
  page.evaluate(() => document.querySelector('#editor .cm-activeLine')?.textContent ?? '');

/** Rows of the grid, as the label of each cell grouped by its top edge. */
const rows = (): Promise<string[][]> =>
  page.evaluate((selector) => {
    const byTop = new Map<number, string[]>();
    for (const cell of document.querySelectorAll<HTMLElement>(selector)) {
      const top = Math.round(cell.getBoundingClientRect().top);
      byTop.set(top, [...(byTop.get(top) ?? []), cell.textContent?.trim() ?? '']);
    }
    return [...byTop.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
  }, THUMBNAIL);

/**
 * Pixels of every thumbnail's paper that show past its document, by thumbnail label (TYTO-323).
 * The seam it looks for: at 125 % a paper's light background was snapped out to a device pixel
 * its scaled document did not reach, a 1 px light line on a thumbnail's right or bottom edge. The
 * paper is painted magenta for the measure, so a bare pixel is told from an edge's ordinary
 * antialiasing by its colour: the edges of `guarda-teste`'s slides are navy, and neither they nor
 * the window around them is both redder and bluer than it is green.
 */
async function bareEdges(): Promise<Record<string, number>> {
  await page.addStyleTag({
    content: '.thumbnail__paper { background: #ff00ff !important; }',
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForTimeout(200);
  const { ratio, papers } = await page.evaluate(
    (selector) => ({
      ratio: window.devicePixelRatio,
      papers: [...document.querySelectorAll<HTMLElement>(selector)].map((cell) => {
        const box = cell.querySelector<HTMLElement>('.thumbnail__paper')!.getBoundingClientRect();
        return {
          label: cell.textContent?.trim() ?? '',
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
        };
      }),
    }),
    THUMBNAIL,
  );
  const png = PNG.sync.read(await page.screenshot());
  await page.evaluate(() => {
    for (const style of document.querySelectorAll('style')) {
      if (style.textContent?.includes('#ff00ff') === true) style.remove();
    }
  });
  const magenta = (x: number, y: number): boolean => {
    const at = (png.width * y + x) * 4;
    const [red, green, blue] = [png.data[at]!, png.data[at + 1]!, png.data[at + 2]!];
    return red - green > 40 && blue - green > 40;
  };
  const found: Record<string, number> = {};
  for (const paper of papers) {
    // Every device pixel the paper touches, one more each way for a snapped edge.
    const left = Math.floor(paper.left * ratio) - 1;
    const top = Math.floor(paper.top * ratio) - 1;
    const right = Math.ceil(paper.right * ratio);
    const bottom = Math.ceil(paper.bottom * ratio);
    // Off screen, or partly: a strip scrolled sideways has cells past the window's edge.
    if (left < 0 || top < 0 || right >= png.width || bottom >= png.height) continue;
    // Only the band of three device pixels along each edge: inside it the slide's own text is
    // drawn with subpixel antialiasing, whose fringes can be magenta-ish too (seen at 100 % on
    // "Grade", 116,68,121), and is no seam.
    const band = (x: number, y: number): boolean =>
      x - left < 3 || right - x < 3 || y - top < 3 || bottom - y < 3;
    let bare = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) if (band(x, y) && magenta(x, y)) bare += 1;
    }
    if (bare > 0) found[paper.label] = bare;
  }
  return found;
}

/** Screenshots in both schemes, when asked for; the window is left light. */
const shoot = async (name: string, clip?: string): Promise<void> => {
  if (shots === undefined || app === undefined) return;
  mkdirSync(shots, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await app.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source;
    }, scheme);
    // scheme: the screenshot in each theme Rafael approves by looking; main is told too.
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(500);
    const path = join(shots, `${name}-${scheme}.png`);
    if (clip === undefined) await page.screenshot({ path });
    else await page.locator(clip).screenshot({ path });
  }
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'system';
  });
  await page.emulateMedia({ colorScheme: null });
};

interface Run {
  ms: number;
  first: number;
  /** The longest the renderer went without running a timer while the thumbnails loaded. */
  stall: number;
  visible: number;
  documents: number;
}

/**
 * Ten runs of a 20-slide brief, alternating `story` and `grid-1x1` so every run is a new format's
 * thumbnails: from the moment the answer's repaint puts the first one in the element — the task
 * the answer is handled in — to the `load` of the last one on screen. PR 1's clock, with the
 * visibility read on both axes, since the grid scrolls down where the strip scrolls sideways.
 */
async function measure(what: string): Promise<{ median: number; runs: Run[] }> {
  const runs: Run[] = [];
  for (let run = 0; run < 10; run += 1) {
    const format = run % 2 === 0 ? 'story' : 'grid-1x1';
    await page.evaluate(
      ([selector, suffix]) => {
        const element = document.querySelector(selector)!;
        const probe = { start: 0, stall: 0, done: false, loads: new Map<Element, number>() };
        (window as unknown as { gridProbe: typeof probe }).gridProbe = probe;
        // Whether the window freezes: the longest the renderer went without running a 5 ms
        // timer, from the first thumbnail in to the last one loaded.
        let last = 0;
        const tick = (): void => {
          const now = performance.now();
          if (probe.start !== 0 && last !== 0) probe.stall = Math.max(probe.stall, now - last);
          last = probe.start === 0 ? 0 : now;
          if (!probe.done) setTimeout(tick, 5);
        };
        tick();
        element.addEventListener(
          'load',
          (event) => {
            // A new iframe loads `about:blank` the moment it is inserted; only the load of a
            // slide's document counts, and only the first one.
            const frame = event.target;
            if (!(frame instanceof HTMLIFrameElement) || !frame.hasAttribute('srcdoc')) return;
            if (!probe.loads.has(frame)) probe.loads.set(frame, performance.now());
          },
          true,
        );
        const watch = new MutationObserver(() => {
          if (probe.start !== 0) return;
          const first = element.querySelector<HTMLElement>('[data-thumbnail]');
          if (first?.dataset['thumbnail']?.endsWith(suffix) === true) {
            probe.start = performance.now();
            watch.disconnect();
          }
        });
        watch.observe(element, { childList: true });
      },
      [THUMBNAILS, `|${format}`] as const,
    );
    await type(brief(20, format, `${what} ${String(run)}`));
    const measured = await page
      .waitForFunction(
        ([selector, suffix]) => {
          const element = document.querySelector(selector)!;
          const probe = (
            window as unknown as {
              gridProbe: {
                start: number;
                stall: number;
                done: boolean;
                loads: Map<Element, number>;
              };
            }
          ).gridProbe;
          const cells = [...element.querySelectorAll<HTMLElement>('[data-thumbnail]')];
          if (probe.start === 0 || cells.length !== 20) return false;
          if (!cells.every((cell) => cell.dataset['thumbnail']?.endsWith(suffix))) return false;
          const box = element.getBoundingClientRect();
          const visible = cells.filter((cell) => {
            const at = cell.getBoundingClientRect();
            return (
              at.right > box.left &&
              at.left < box.right &&
              at.bottom > box.top &&
              at.top < box.bottom
            );
          });
          const times = visible.map((cell) => probe.loads.get(cell.querySelector('iframe')!));
          if (visible.length === 0 || times.some((time) => time === undefined)) return false;
          probe.done = true;
          return {
            stall: probe.stall,
            ms: Math.max(...(times as number[])) - probe.start,
            first: Math.min(...(times as number[])) - probe.start,
            visible: visible.length,
            documents: cells.filter((cell) => cell.querySelector('iframe[srcdoc]') !== null).length,
          };
        },
        [THUMBNAILS, `|${format}`] as const,
        { polling: 25, timeout: 15_000 },
      )
      .then((handle) => handle.jsonValue());
    runs.push(measured as Run);
  }
  const medianOf = (pick: (run: Run) => number): number => {
    const sorted = runs.map(pick).sort((a, b) => a - b);
    return (sorted[4]! + sorted[5]!) / 2;
  };
  const median = medianOf((run) => run.ms);
  const each = runs.map(
    (run) =>
      `${run.ms.toFixed(0)}/${run.first.toFixed(0)}/${run.stall.toFixed(0)}ms ` +
      `${String(run.visible)}vis ${String(run.documents)}doc`,
  );
  process.stdout.write(
    `[TYTO-323] ${what} first paint, 20 slides, ${String(runs.length)} runs: median last visible ` +
      `${median.toFixed(0)} ms, first visible ${medianOf((run) => run.first).toFixed(0)} ms, ` +
      `longest stall ${medianOf((run) => run.stall).toFixed(0)} ms; last/first/stall per run ` +
      `${JSON.stringify(each)}\n`,
  );
  return { median, runs };
}

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm build\` before \`pnpm --filter @tyto/desktop test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-preview-grid-'));
  userData = join(scratch, 'userData');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ templatesFolder: TEMPLATES }));
  await launch();
  await openPreviewBeside(page);
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the preview’s All slides mode (TYTO-323)', () => {
  it('shows the ten slides in a grid, in order and numbered, in place of the stage', async () => {
    await type(brief(10));
    await expect.poll(labels, { timeout: 15_000 }).toHaveLength(10);
    expect(await layout()).toBe('strip');
    await shoot('mode-control', `${SHOWN_PREVIEW} .preview__bar`);

    await page.locator(MODE('all')).click();

    await expect.poll(layout).toBe('grid');
    expect(await labels()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    // Read off the layout: rows top to bottom, each left to right, are 1 to 10 in order.
    const grid = await rows();
    expect(grid.length).toBeGreaterThan(1);
    expect(grid.flat()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    // Rows fill from the left: the short last row starts under slide 1, not in the middle.
    const lefts = await page.evaluate(
      (selector) =>
        Object.fromEntries(
          [...document.querySelectorAll<HTMLElement>(selector)].map((cell) => [
            cell.textContent?.trim() ?? '',
            Math.round(cell.getBoundingClientRect().left),
          ]),
        ),
      THUMBNAIL,
    );
    const lastRow = grid.at(-1)!;
    expect(lastRow.length).toBeLessThan(grid[0]!.length);
    expect(
      lastRow.map((label) => lefts[label]),
      'left edges of the last row, against the first row’s',
    ).toEqual(grid[0]!.slice(0, lastRow.length).map((label) => lefts[label]));
    expect(await bareEdges(), 'paper pixels on the grid thumbnails’ edges, by slide').toEqual({});
    expect(await page.locator(`${SHOWN_PREVIEW} [data-preview-stage]`).isVisible()).toBe(false);
    expect(await page.locator(MODE('all')).getAttribute('aria-pressed')).toBe('true');
    await shoot('grid-ten-slides');
  });

  it('draws what the person types into the grid', async () => {
    await type(brief(10).replace('item3fim', 'item3mudou'));
    await expect
      .poll(() =>
        page.evaluate(
          (selector) =>
            document
              .querySelectorAll(selector)[2]
              ?.querySelector('iframe')
              ?.getAttribute('srcdoc') ?? '',
          THUMBNAIL,
        ),
      )
      .toContain('item3mudou');
    await type(brief(10));
  });

  it('opens the seventh slide clicked as the main slide, in One slide mode', async () => {
    await page.locator(THUMBNAIL).nth(6).click();

    await expect.poll(layout).toBe('strip');
    await expect.poll(() => previewSrcdoc(page)).toContain('item7fim');
    expect(await page.locator(MODE('one')).getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator(`${THUMBNAIL}[aria-selected="true"]`).textContent()).toContain('7');
    // The editor follows, as the strip's click makes it.
    await expect.poll(activeLine).toContain('item7fim');
    // The strip draws its thumbnails through the same box, so it has no seam either.
    await page.waitForTimeout(500);
    expect(await bareEdges(), 'paper pixels on the strip thumbnails’ edges, by slide').toEqual({});
  });

  it('keeps the mode through a reload and a quit', async () => {
    await page.locator(MODE('all')).click();
    await expect.poll(layout).toBe('grid');

    await page.click('#editor .cm-content');
    await Promise.all([page.waitForEvent('load'), page.keyboard.press('Control+r')]);
    await page.waitForSelector('#editor .cm-content');
    await expect.poll(layout, { timeout: 15_000 }).toBe('grid');

    await quit();
    const session = readFileSync(join(userData, 'session.json'), 'utf8');
    expect(session).toMatch(/"mode": ?"all"/u);
    await launch();
    await expect.poll(layout, { timeout: 30_000 }).toBe('grid');
    await expect.poll(labels, { timeout: 15_000 }).toHaveLength(10);
  }, 120_000);

  it('paints the grid of a 20-slide brief, and says how long it took', async () => {
    expect(await layout()).toBe('grid');
    const { median, runs } = await measure('grid (hidden window)');
    // Only what a frozen window would break: the number itself is for the pull request.
    expect(median).toBeLessThan(3000);
    // Twenty fit the pane at the grid's height, so every one is on screen and drawn.
    expect(runs.every((run) => run.visible === run.documents)).toBe(true);
    // Scaled to fit: twenty slides in this window's pane need no scroll bar.
    const overflow = await page.evaluate((selector) => {
      const element = document.querySelector(selector)!;
      return element.scrollHeight - element.clientHeight;
    }, THUMBNAILS);
    expect(overflow, 'pixels the 20-slide grid overflows its pane by').toBeLessThanOrEqual(0);
    await shoot('grid-twenty-slides');
  }, 60_000);

  it.runIf(measureShown)(
    'paints the strip and the grid with the window shown, and says how long each took',
    async () => {
      await app!.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.showInactive();
      });
      await page.waitForTimeout(1000);
      const grid = await measure('grid (shown window)');
      await page.locator(MODE('one')).click();
      await expect.poll(layout).toBe('strip');
      const strip = await measure('strip (shown window)');
      await app!.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.hide();
      });
      expect(grid.median).toBeLessThan(3000);
      expect(strip.median).toBeLessThan(3000);
    },
    120_000,
  );
});
