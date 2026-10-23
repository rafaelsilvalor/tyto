import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { SHOWN_PREVIEW, openPreviewBeside, previewSrcdoc } from './preview-pane.js';

/**
 * The preview's strip of slide thumbnails, in a real window (TYTO-323, ADR 0123).
 *
 * `slide-thumbnails.test.ts` holds the order, the click, the keys, which thumbnails get a
 * document and how many navigations a keystroke costs, in jsdom. What only a window can say is
 * the rest: that a click on the seventh of ten puts slide 7 on the stage and the editor on its
 * `::lamina`, that the row lays out and scrolls, and how long a 20-slide brief takes to paint the
 * thumbnails a person can see. That last one is printed for the pull request; it asserts only a
 * ceiling a frozen window would break.
 *
 * The brief uses `guarda-teste`, the committed fixture with no `max` on its repeating slot (the
 * pack's carousels stop at 10 or 12). With `TYTO_STRIP_SHOTS` set to a folder the suite leaves
 * pictures of the window in both themes. Its own `--user-data-dir` and `TYTO_HOME`, one launch.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const TEMPLATES = join(here, '__fixtures__', 'templates');
const shots = process.env['TYTO_STRIP_SHOTS'];

const STRIP = `${SHOWN_PREVIEW} [data-preview-strip]`;
const THUMBNAIL = `${STRIP} [data-thumbnail]`;

let scratch: string;
let app: ElectronApplication;
let page: Page;

/** A brief of `count` slides, each with a word no other slide's contains: `item7fim`. */
const brief = (count: number, format = 'grid-1x1', title = 'Faixa'): string =>
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

/** Waits for the strip to hold `count` thumbnails of `format`. */
const waitForStrip = (count: number, format: string): Promise<unknown> =>
  page.waitForFunction(
    ([selector, wanted, suffix]) => {
      const cells = [...document.querySelectorAll<HTMLElement>(selector)];
      return (
        cells.length === wanted &&
        cells.every((cell) => cell.dataset['thumbnail']?.endsWith(suffix))
      );
    },
    [THUMBNAIL, count, `|${format}`] as const,
    { polling: 25, timeout: 15_000 },
  );

const labels = (): Promise<string[]> =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)].map((cell) => cell.textContent?.trim() ?? ''),
    THUMBNAIL,
  );

const selectedLabel = (): Promise<string> =>
  page.evaluate(
    (selector) =>
      document.querySelector(`${selector}[aria-selected="true"]`)?.textContent?.trim() ?? '',
    THUMBNAIL,
  );

const activeLine = (): Promise<string> =>
  page.evaluate(() => document.querySelector('#editor .cm-activeLine')?.textContent ?? '');

/** Screenshots in both schemes, when asked for; the window is left light. */
const shoot = async (name: string): Promise<void> => {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await app.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source;
    }, scheme);
    // scheme: the screenshot in each theme Rafael approves by looking; main is told too.
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots, `${name}-${scheme}.png`) });
  }
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'system';
  });
  await page.emulateMedia({ colorScheme: null });
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm build\` before \`pnpm --filter @tyto/desktop test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-preview-strip-'));
  const userData = join(scratch, 'userData');
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ templatesFolder: TEMPLATES }));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await openPreviewBeside(page);
}, 180_000);

afterAll(async () => {
  if (app !== undefined) await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the slide strip under the preview (TYTO-323)', () => {
  it('shows ten numbered thumbnails, and the seventh clicked is slide 7 on the stage', async () => {
    await type(brief(10));
    await waitForStrip(10, 'grid-1x1');

    expect(await labels()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(await page.locator(`${SHOWN_PREVIEW} [data-preview-slide]`).count()).toBe(0);

    await page.locator(THUMBNAIL).nth(6).click();

    await expect.poll(() => previewSrcdoc(page)).toContain('item7fim');
    expect(await previewSrcdoc(page)).not.toContain('item1fim<');
    expect(await selectedLabel()).toBe('7');
    // The editor follows, as it followed the Slide picker: the cursor is on slide 7's line.
    await expect.poll(activeLine).toContain('item7fim');
    await shoot('strip-ten-slides');
  });

  it('moves along the strip with the arrow keys while it has the focus', async () => {
    await page.locator(THUMBNAIL).nth(6).focus();
    await page.keyboard.press('ArrowRight');

    await expect.poll(selectedLabel).toBe('8');
    await expect.poll(() => previewSrcdoc(page)).toContain('item8fim');
    await expect
      .poll(() =>
        page.evaluate(
          () => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '',
        ),
      )
      .toBe('8');
    await page.keyboard.press('End');
    await expect.poll(selectedLabel).toBe('10');
  });

  it('keeps the last slide when the brief loses its last one, rather than going back to 1', async () => {
    await type(brief(9));
    await waitForStrip(9, 'grid-1x1');
    await expect.poll(selectedLabel).toBe('9');
  });

  it('hides and shows the strip with the bar’s button', async () => {
    const toggle = page.locator(`${SHOWN_PREVIEW} [data-preview-strip-toggle]`);
    expect(await toggle.getAttribute('aria-label')).toMatch(
      /^(Hide the slide strip|Esconder a faixa de slides)$/u,
    );

    await toggle.click();
    await expect.poll(() => page.locator(STRIP).isVisible()).toBe(false);
    expect(await toggle.getAttribute('aria-label')).toMatch(
      /^(Show the slide strip|Mostrar a faixa de slides)$/u,
    );
    await shoot('strip-hidden');

    await toggle.click();
    await expect.poll(() => page.locator(STRIP).isVisible()).toBe(true);
  });

  it('paints the visible thumbnails of a 20-slide brief, and says how long it took', async () => {
    interface Run {
      ms: number;
      first: number;
      stage: number;
      visible: number;
      documents: number;
    }
    const runs: Run[] = [];
    for (let run = 0; run < 10; run += 1) {
      const format = run % 2 === 0 ? 'story' : 'grid-1x1';
      // The clock: from the moment the answer's repaint puts the new format's thumbnails in the
      // row — the same task the answer is handled in — to the `load` of the last one on screen.
      await page.evaluate(
        ([selector, suffix]) => {
          const strip = document.querySelector(selector)!;
          const probe = { start: 0, stage: 0, loads: new Map<Element, number>() };
          (window as unknown as { stripProbe: typeof probe }).stripProbe = probe;
          // The stage's own frame, as the yardstick: the same kind of document, drawn once.
          strip.parentElement?.addEventListener(
            'load',
            (event) => {
              const frame = event.target as Element;
              if (probe.start === 0 || probe.stage !== 0) return;
              if (frame.matches('[data-preview-frame]')) probe.stage = performance.now();
            },
            true,
          );
          strip.addEventListener(
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
            const first = strip.querySelector<HTMLElement>('[data-thumbnail]');
            if (first?.dataset['thumbnail']?.endsWith(suffix) === true) {
              probe.start = performance.now();
              watch.disconnect();
            }
          });
          watch.observe(strip, { childList: true });
        },
        [STRIP, `|${format}`] as const,
      );
      await type(brief(20, format, `Faixa ${String(run)}`));
      const measured = await page
        .waitForFunction(
          ([selector, suffix]) => {
            const strip = document.querySelector(selector)!;
            const probe = (
              window as unknown as {
                stripProbe: { start: number; stage: number; loads: Map<Element, number> };
              }
            ).stripProbe;
            const cells = [...strip.querySelectorAll<HTMLElement>('[data-thumbnail]')];
            if (probe.start === 0 || cells.length !== 20) return false;
            if (!cells.every((cell) => cell.dataset['thumbnail']?.endsWith(suffix))) return false;
            const row = strip.getBoundingClientRect();
            const visible = cells.filter((cell) => {
              const box = cell.getBoundingClientRect();
              return box.right > row.left && box.left < row.right;
            });
            const times = visible.map((cell) => probe.loads.get(cell.querySelector('iframe')!));
            if (visible.length === 0 || times.some((time) => time === undefined)) return false;
            if (probe.stage === 0) return false;
            return {
              ms: Math.max(...(times as number[])) - probe.start,
              first: Math.min(...(times as number[])) - probe.start,
              stage: probe.stage - probe.start,
              visible: visible.length,
              documents: cells.filter((cell) => cell.querySelector('iframe[srcdoc]') !== null)
                .length,
            };
          },
          [STRIP, `|${format}`] as const,
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
        `${run.ms.toFixed(0)}/${run.first.toFixed(0)}/${run.stage.toFixed(0)}ms ` +
        `${String(run.visible)}vis ${String(run.documents)}doc`,
    );
    process.stdout.write(
      `[TYTO-323] strip first paint, 20 slides, ${String(runs.length)} runs: median last visible ` +
        `${median.toFixed(0)} ms, first visible ${medianOf((run) => run.first).toFixed(0)} ms, ` +
        `stage frame ${medianOf((run) => run.stage).toFixed(0)} ms; last/first/stage per run ` +
        `${JSON.stringify(each)}\n`,
    );
    // Only what a frozen window would break: the number itself is for the pull request.
    expect(median).toBeLessThan(3000);
    // And the observer did its job: only the thumbnails on screen were given a document.
    expect(Math.max(...runs.map((run) => run.documents))).toBeLessThan(20);
    await shoot('strip-twenty-slides');
  }, 60_000);
});
