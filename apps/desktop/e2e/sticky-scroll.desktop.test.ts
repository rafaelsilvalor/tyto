import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Sticky scroll through the real window (TYTO-295, ADR 0094): a long `::lamina` scrolled with
 * the wheel keeps its head line pinned at the scroller's top, the row slides up with the block's
 * last line and is gone past it, a click on it goes to the directive, the find panel pushes it
 * down, `"stickyScroll": false` takes it away on save, vim's `k` scrolls rather than hiding the
 * caret under it, and the template mode's nested elements stack two rows.
 *
 * Always the wheel, never `scrollTop`: a scroll set from code lands on a fraction of a pixel and
 * is not what a person does (TYTO-119). Positions are read from the gutter's line numbers and
 * the rows' boxes, never from `.cm-content`'s text.
 *
 * With `TYTO_STICKY_SCROLL_SHOTS` set to a folder, the suite leaves pictures in Tyto Light and
 * Tyto Dark: the row pinned, the push-up, the find panel open and the template mode's stack.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_STICKY_SCROLL_SHOTS'];

const pack = join(
  dirname(createRequire(import.meta.url).resolve('@tyto/templates/package.json')),
  'templates',
);

/** The `::lamina` opens on line 6 and its last body line is line 86; then 60 top-level lines. */
const LAMINA_LINE = 6;
const LAST_BODY_LINE = 86;
const BRIEF = [
  '---',
  'template: agenda-semana',
  '---',
  '::titulo',
  '  AGENDA DA SEMANA',
  '::lamina',
  ...Array.from(
    { length: 80 },
    (_, index) => `  ${String(index + 1)}/09 - 14:00 | Aula ${String(index + 1)}`,
  ),
  '',
  ...Array.from({ length: 60 }, (_, index) => `// nota ${String(index + 1)}`),
].join('\n');

/** Three levels of elements, each long enough to scroll inside. */
const MARKUP = [
  '<div class="page">',
  '  <section class="lista">',
  ...Array.from({ length: 60 }, (_, index) => `    <p>item ${String(index + 1)}</p>`),
  '  </section>',
  '</div>',
].join('\n');

let app: ElectronApplication;
let page: Page;
let scratch: string;
let settingsFile: string;

const BRIEF_PANE = '#editor .cm-editor';
const MARKUP_PANE = '[data-buffer="markup"] .cm-editor';

interface Row {
  readonly line: number;
  readonly text: string;
  readonly top: number;
  readonly bottom: number;
  /** A point on the row's text, for a click. */
  readonly x: number;
}

interface Geometry {
  readonly scrollerTop: number;
  readonly rows: readonly Row[];
}

/** The pinned rows and where the scroller starts, on screen. */
const geometry = (pane = BRIEF_PANE): Promise<Geometry> =>
  page.evaluate((selector) => {
    const editor = document.querySelector(selector)!;
    const scroller = editor.querySelector('.cm-scroller')!.getBoundingClientRect();
    const rows = [...editor.querySelectorAll<HTMLElement>('.cm-sticky-line')].map((row) => {
      const box = row.getBoundingClientRect();
      return {
        line: Number(row.dataset['line']),
        text: row.querySelector('.cm-sticky-text')?.textContent ?? '',
        top: box.top,
        bottom: box.bottom,
        x: (row.querySelector('.cm-sticky-text')?.getBoundingClientRect().left ?? box.left) + 20,
      };
    });
    return { scrollerTop: scroller.top, rows };
  }, pane);

/** The on-screen box of line `line`'s number in the gutter, or `null` when it is not drawn. */
const lineBox = (
  line: number,
  pane = BRIEF_PANE,
): Promise<{ top: number; bottom: number; right: number } | null> =>
  page.evaluate(
    ([selector, wanted]) => {
      const number = [
        ...document.querySelectorAll<HTMLElement>(`${selector} .cm-lineNumbers .cm-gutterElement`),
      ].find((element) => element.textContent === wanted);
      if (number === undefined) return null;
      const box = number.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, right: box.right };
    },
    [pane, String(line)] as const,
  );

const scrollTop = (pane = BRIEF_PANE): Promise<number> =>
  page.evaluate((selector) => document.querySelector(`${selector} .cm-scroller`)!.scrollTop, pane);

/** Wheels `dy` pixels over the pane and waits until the scroller stops moving. */
async function wheel(dy: number, pane = BRIEF_PANE): Promise<void> {
  const box = await page.evaluate((selector) => {
    const rect = document.querySelector(`${selector} .cm-scroller`)!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, pane);
  await page.mouse.move(box.x, box.y);
  const { before, limit } = await page.evaluate((selector) => {
    const scroller = document.querySelector(`${selector} .cm-scroller`)!;
    return { before: scroller.scrollTop, limit: scroller.scrollHeight - scroller.clientHeight };
  }, pane);
  const expected = Math.min(Math.max(before + dy, 0), limit);
  await page.mouse.wheel(0, dy);
  // Where a wheel lands is known in advance; wait for it. The wheel is handled when the next
  // input arrives (measured: every read lagged one wheel behind), so each wait nudges the
  // pointer by a pixel, which carries no scroll of its own.
  let nudge = 1;
  await expect
    .poll(
      async () => {
        const now = await scrollTop(pane);
        if (Math.abs(now - expected) <= 1) return true;
        nudge = -nudge;
        await page.mouse.move(box.x + nudge, box.y);
        return false;
      },
      { timeout: 10_000, interval: 80 },
    )
    .toBe(true);
}

/** Wheels the pane so that `line` is the first line under the scroller's top edge. */
async function scrollLineToTop(line: number, pane = BRIEF_PANE): Promise<void> {
  await wheel(-100_000, pane);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const { scrollerTop } = await geometry(pane);
    const box = await lineBox(line, pane);
    if (box !== null && Math.abs(box.top - scrollerTop) <= 1) return;
    // A line not drawn yet is further down: move most of a screen and look again.
    await wheel(box === null ? 300 : box.top - scrollerTop, pane);
  }
  throw new Error(`line ${String(line)} never reached the top of the pane`);
}

const position = (): Promise<string> =>
  page.evaluate(
    () => document.querySelector('tyto-status-bar .status-bar__position')?.textContent ?? '',
  );

const layerCount = (pane = BRIEF_PANE): Promise<number> =>
  page.evaluate(
    (selector) => document.querySelectorAll(`${selector} .cm-sticky-scroll`).length,
    pane,
  );

/** Writes `settings.json`, which main applies as any writer's save. */
function saveSettings(settings: Record<string, unknown>): void {
  writeFileSync(
    settingsFile,
    `${JSON.stringify({ templatesFolder: join(scratch, 'mine'), ...settings }, null, 2)}\n`,
    'utf8',
  );
}

/** A picture of the pane, when pictures were asked for. */
async function shoot(name: string, pane = BRIEF_PANE): Promise<void> {
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  const clip = await page.evaluate((selector) => {
    const box = document.querySelector(selector)!.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      width: Math.min(box.width, 900),
      height: Math.min(box.height, 420),
    };
  }, pane);
  await page.screenshot({ path: join(shots, `${name}.png`), clip });
}

/** Waits until the window's body is painted `rgb` — the theme answer has landed. */
const themeApplied = (theme: 'tyto-light' | 'tyto-dark'): Promise<unknown> =>
  page.waitForFunction(
    (dark) => {
      const [red] = /\d+/u.exec(getComputedStyle(document.body).backgroundColor) ?? ['255'];
      return dark ? Number(red) < 128 : Number(red) >= 128;
    },
    theme === 'tyto-dark',
    { polling: 50, timeout: 15_000 },
  );

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-sticky-scroll-'));
  cpSync(join(pack, 'promo-curso'), join(scratch, 'mine', 'promo-curso'), { recursive: true });
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  settingsFile = join(userData, 'settings.json');
  saveSettings({ theme: 'tyto-light' });
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(BRIEF);
  await page.keyboard.press('Control+Home');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('sticky scroll in a brief', () => {
  it('pins ::lamina at the scroller top while the top is inside its body', async () => {
    await scrollLineToTop(40);
    await expect
      .poll(async () => (await geometry()).rows.map((row) => [row.line, row.text]), {
        timeout: 10_000,
      })
      .toEqual([[LAMINA_LINE, '::lamina']]);
    const { scrollerTop, rows } = await geometry();
    expect(Math.abs(rows[0]!.top - scrollerTop)).toBeLessThanOrEqual(1);
  });

  it('pins nothing with the head line itself at the top', async () => {
    await scrollLineToTop(LAMINA_LINE);
    await expect.poll(async () => (await geometry()).rows.length, { timeout: 10_000 }).toBe(0);
  });

  it("slides the row up with the block's last line, and drops it past the block", async () => {
    await scrollLineToTop(LAST_BODY_LINE - 1);
    const last = await lineBox(LAST_BODY_LINE);
    const { scrollerTop } = await geometry();
    // The last body line's bottom 8 px under the scroller's top: the row is pushed up with it.
    await wheel(last!.bottom - scrollerTop - 8);
    await expect
      .poll(
        async () => {
          const now = await geometry();
          const box = await lineBox(LAST_BODY_LINE);
          const row = now.rows[0];
          return row === undefined || box === null
            ? 'none'
            : {
                pushed: row.top < now.scrollerTop - 1,
                sameBottom: Math.abs(row.bottom - box.bottom) <= 1,
              };
        },
        { timeout: 10_000 },
      )
      .toEqual({ pushed: true, sameBottom: true });
    await scrollLineToTop(LAST_BODY_LINE + 2);
    await expect.poll(async () => (await geometry()).rows.length, { timeout: 10_000 }).toBe(0);
  });

  it('puts the caret on the directive when the row is clicked', async () => {
    await scrollLineToTop(50);
    await expect.poll(async () => (await geometry()).rows.length, { timeout: 10_000 }).toBe(1);
    const row = (await geometry()).rows[0]!;
    await page.mouse.click(row.x, (row.top + row.bottom) / 2);
    await expect.poll(position, { timeout: 5_000 }).toMatch(/^(Ln|Lin) 6, Col 1$/u);
    // Scrolled to it: the directive is on screen, and so nothing is pinned.
    await expect.poll(async () => (await geometry()).rows.length, { timeout: 10_000 }).toBe(0);
  });

  it('sits under the find panel when it is open', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+f');
    await page.waitForSelector('#editor .cm-search');
    await scrollLineToTop(30);
    await expect.poll(async () => (await geometry()).rows.length, { timeout: 10_000 }).toBe(1);
    const { scrollerTop, rows } = await geometry();
    const panelBottom = await page.evaluate(
      () => document.querySelector('#editor .cm-panels-top')!.getBoundingClientRect().bottom,
    );
    expect(Math.abs(rows[0]!.top - scrollerTop)).toBeLessThanOrEqual(1);
    expect(rows[0]!.top).toBeGreaterThanOrEqual(panelBottom - 1);
    await shoot('find-panel-tyto-light');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#editor .cm-search') === null);
  });

  it('takes the row away when stickyScroll is saved false, and back when true', async () => {
    saveSettings({ theme: 'tyto-light', stickyScroll: false });
    await expect.poll(() => layerCount(), { timeout: 15_000 }).toBe(0);
    await scrollLineToTop(45);
    expect((await geometry()).rows).toEqual([]);
    saveSettings({ theme: 'tyto-light', stickyScroll: true });
    await expect.poll(async () => (await geometry()).rows.length, { timeout: 15_000 }).toBe(1);
  });
});

describe.runIf(shots !== undefined)('pictures of the brief', () => {
  for (const theme of ['tyto-light', 'tyto-dark'] as const) {
    it(`leaves the pinned row, the push-up and the find panel in ${theme}`, async () => {
      saveSettings({ theme });
      await themeApplied(theme);
      await scrollLineToTop(40);
      await expect.poll(async () => (await geometry()).rows.length, { timeout: 10_000 }).toBe(1);
      await shoot(`pinned-${theme}`);
      await scrollLineToTop(LAST_BODY_LINE - 1);
      const last = await lineBox(LAST_BODY_LINE);
      await wheel(last!.bottom - (await geometry()).scrollerTop - 8);
      await page.waitForTimeout(150);
      await shoot(`push-up-${theme}`);
      await page.click('#editor .cm-content');
      await page.keyboard.press('Control+f');
      await page.waitForSelector('#editor .cm-search');
      await scrollLineToTop(30);
      await page.waitForTimeout(150);
      await shoot(`find-panel-${theme}`);
      await page.keyboard.press('Escape');
    });
  }
  it('goes back to Tyto Light', async () => {
    saveSettings({ theme: 'tyto-light' });
    await themeApplied('tyto-light');
  });
});

describe('sticky scroll with vim', () => {
  it('scrolls on k from the first line under the row instead of hiding the caret', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('editor.toggleVim');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForSelector('tyto-status-bar .status-bar__vim');

    await scrollLineToTop(20);
    await expect.poll(async () => (await geometry()).rows.length, { timeout: 10_000 }).toBe(1);
    // Line 21 is the first one the row does not cover: put the caret there with the mouse.
    const under = (await lineBox(21))!;
    await page.mouse.click(under.right + 80, (under.top + under.bottom) / 2);
    await expect.poll(position, { timeout: 5_000 }).toMatch(/^(Ln|Lin) 21, /u);
    await page.keyboard.press('k');
    await expect.poll(position, { timeout: 5_000 }).toMatch(/^(Ln|Lin) 20, /u);
    await expect
      .poll(
        async () => {
          const { rows } = await geometry();
          const caretLine = await lineBox(20);
          return rows.length === 1 && caretLine !== null && caretLine.top >= rows[0]!.bottom - 1;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  });
});

describe('sticky scroll in the template mode', () => {
  it('stacks the two elements the top is inside', async () => {
    const folder = join(scratch, 'mine', 'promo-curso');
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = (() =>
        Promise.resolve({ canceled: false, filePaths: [chosen] })) as never;
    }, folder);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('command:run', { id: 'template.edit' });
    });
    await page.waitForSelector('tyto-template-mode[open]');
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-buffer-tab="markup"]')?.click();
    });
    await page.click('[data-buffer="markup"] .cm-content');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(MARKUP);

    await scrollLineToTop(30, MARKUP_PANE);
    await expect
      .poll(async () => (await geometry(MARKUP_PANE)).rows.map((row) => [row.line, row.text]), {
        timeout: 10_000,
      })
      .toEqual([
        [1, '<div class="page">'],
        [2, '  <section class="lista">'],
      ]);
    const { scrollerTop, rows } = await geometry(MARKUP_PANE);
    expect(Math.abs(rows[0]!.top - scrollerTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(rows[1]!.top - rows[0]!.bottom)).toBeLessThanOrEqual(1);
    // What is painted there is the markup's own row, not the brief's from behind the mode.
    const painted = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x!, y!)?.closest('[data-buffer]')?.getAttribute('data-buffer'),
      [rows[0]!.x, (rows[0]!.top + rows[0]!.bottom) / 2],
    );
    expect(painted).toBe('markup');
    for (const theme of ['tyto-light', 'tyto-dark'] as const) {
      if (shots === undefined) break;
      saveSettings({ theme });
      await themeApplied(theme);
      await page.waitForTimeout(150);
      await shoot(`template-stack-${theme}`, MARKUP_PANE);
    }
  });
});
