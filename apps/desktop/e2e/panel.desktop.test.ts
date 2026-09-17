import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E9.3's two acceptance criteria, through a real window, plus the layout claim behind them.
 *
 * Both criteria are about **three things agreeing**: a click has to move a cursor in
 * CodeMirror, and picking a template has to change the frontmatter, the preview and the
 * panel together. `src/renderer/panel.test.ts` checks each piece against jsdom and a real
 * editor; what only a launched app can show is the pieces meeting — the round trip to main,
 * the registry the app actually ships, and a scroller with a height.
 *
 * The third describe is here because of what looking at the window taught. The panel was a
 * flat 168px until it was opened and measured: a clean brief reserved all of it to say
 * "nothing to report", and the preview fitted a 1080x1080 frame at **32%** instead of 44%.
 * jsdom lays nothing out, so no unit could have said so — and the two desktop cards before
 * this one each shipped three bugs of exactly that shape.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

const packDirectory = join(
  dirname(createRequire(import.meta.url).resolve('@tyto/templates/package.json')),
  'templates',
);

const CAROUSEL = readFileSync(
  join(packDirectory, 'carrossel-lista', 'examples', 'lista.brief'),
  'utf8',
);

/** Taller than any pane the app could give the editor, so "it scrolled" is a real claim. */
const PADDING = Array.from({ length: 120 }, (_, i) => `// padding ${String(i)}`).join('\n');

/**
 * Its own user-data folder, like `dock.desktop.test.ts`.
 *
 * The suites share one `app.getPath('userData')` otherwise, and `layout.json` lives in it
 * (ADR 0009) — so a suite that closes a panel closes it for whichever suite Vitest runs
 * next. That is not hypothetical: the panel suite reads `.problems__row`, the preview suite
 * closes the problems panel on purpose, and Vitest's default sequencer orders files by
 * **size**. Growing one test file by thirty lines swapped the two and left four panel tests
 * measuring a panel that was not on screen, with nothing in either diff to point at.
 */
let scratch: string;
let app: ElectronApplication;
let page: Page;

/** Replaces the whole buffer, then waits for the preview the edit asks for. */
async function type(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
  await page.waitForTimeout(900);
}

const editorScrollTop = async (): Promise<number> =>
  page.evaluate(() => Math.round(document.querySelector('#editor .cm-scroller')?.scrollTop ?? 0));

const activeLine = async (): Promise<string> =>
  page.evaluate(() => document.querySelector('#editor .cm-activeLine')?.textContent ?? '');

/**
 * Scrolls the editor to the top and waits until it is still there.
 *
 * One `scrollTo` is not enough, and the 200ms pause that used to follow it was measuring
 * nothing. `type()` leaves the cursor at the end of a buffer taller than the pane, and
 * CodeMirror's `scrollIntoView` lands on its next measuring pass rather than inside the
 * dispatch — so a scroll issued before that pass is simply undone by it, and the test's
 * own `expect(…).toBe(0)` read 2232 the first time this suite ran on a slower machine
 * (TYTO-111, `desktop-e2e.yml`'s first run). The re-issue inside the predicate is what
 * makes the loser of that race the loop rather than the assertion.
 */
const scrollEditorToTop = async (): Promise<void> => {
  await page.waitForFunction(
    () => {
      const scroller = document.querySelector('#editor .cm-scroller');
      if (scroller === null) return false;
      if (scroller.scrollTop === 0) return true;
      scroller.scrollTo(0, 0);
      return false;
    },
    undefined,
    { timeout: 5000 },
  );
};

/**
 * Waits for the editor to have scrolled, rather than sleeping and hoping.
 *
 * CodeMirror applies `scrollIntoView` on its next measuring pass, not inside the dispatch,
 * so a fixed pause is a race: 400ms was enough on the machine this was written on and not
 * enough under `TYTO_HEADLESS`. The assertion after it is still a real one — this only
 * decides *when* to read, and a scroll that never happens fails here with the timeout.
 */
const waitForScroll = async (): Promise<void> => {
  await page.waitForFunction(
    () => (document.querySelector('#editor .cm-scroller')?.scrollTop ?? 0) > 0,
    undefined,
    { timeout: 5000 },
  );
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm build\` before \`pnpm --filter @tyto/desktop test:desktop\``,
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'tyto-panel-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelector('#editor .cm-content') !== null);
  await page.setViewportSize({ width: 1360, height: 860 });
});

afterAll(async () => {
  await app?.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe('clicking a diagnostic', () => {
  it('puts the cursor on the line the diagnostic named, scrolling to it', async () => {
    // The acceptance criterion. The padding is what makes it a real test: the offending
    // line is below the fold, so "the cursor moved" and "the author can see it" are two
    // different claims and both are asserted.
    await type(
      [
        '---',
        'template: carrossel-lista',
        'formats: [feed]',
        '---',
        PADDING,
        '::nao-existe x',
      ].join('\n'),
    );

    await scrollEditorToTop();
    expect(await editorScrollTop()).toBe(0);

    // Picked by what it says, not by its position: the list is in the order the stages
    // produced it, and a brief missing a required slot reports that one first.
    const clicked = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('button.problems__row')];
      const row = rows.find((item) => item.textContent?.includes('nao-existe'));
      if (!(row instanceof HTMLButtonElement)) return false;
      row.click();
      return true;
    });
    expect(clicked).toBe(true);
    await waitForScroll();

    expect(await activeLine()).toBe('::nao-existe x');
    expect(await editorScrollTop()).toBeGreaterThan(0);
  });

  it('lists the code beside the message and says where to look', async () => {
    const row = await page.evaluate(() => {
      const first = document.querySelector('.problems__row');
      return {
        code: first?.querySelector('.problems__code')?.textContent ?? '',
        where: first?.querySelector('.problems__where')?.textContent ?? '',
        severity: first?.querySelector('.problems__dot')?.className ?? '',
      };
    });

    expect(row.code).toMatch(/^[EW]_/u);
    expect(row.where).toMatch(/^\d+:\d+$/u);
    expect(row.severity).toContain('problems__dot--error');
  });
});

describe('picking a template', () => {
  it('rewrites the frontmatter, and the preview and the panel follow', async () => {
    // The second acceptance criterion, read as what it asserts: one action, three things
    // agreeing afterwards. The picker dispatches an edit into the document, so the preview
    // refreshes through the same path typing does — there is no second code path to keep.
    await type(
      ['---', 'template: carrossel-lista', 'formats: [feed]', '---', '::slide', '  Um'].join('\n'),
    );

    await page.selectOption('#template', 'promo-curso');
    await page.waitForTimeout(900);

    const firstLines = await page.evaluate(() =>
      [...document.querySelectorAll('#editor .cm-line')]
        .slice(0, 3)
        .map((line) => line.textContent),
    );
    expect(firstLines[1]).toBe('template: promo-curso');

    // The panel is now talking about the template that was just chosen, which is the part
    // that would break if the picker had called `setValue` instead of dispatching an edit.
    const messages = await page.evaluate(() =>
      [...document.querySelectorAll('.problems__message')].map((node) => node.textContent ?? ''),
    );
    expect(messages.join(' ')).toContain('promo-curso');

    // And Ctrl+Z puts it back, because it was an ordinary edit.
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(400);
    const undone = await page.evaluate(() =>
      [...document.querySelectorAll('#editor .cm-line')]
        .slice(0, 3)
        .map((line) => line.textContent),
    );
    expect(undone[1]).toBe('template: carrossel-lista');
  });
});

describe('the artwork list', () => {
  it('scrolls the editor to the directive that made the slide', async () => {
    await type(
      [
        '---',
        'template: carrossel-lista',
        'formats: [feed]',
        '---',
        '::titulo',
        '  Como estudar',
        PADDING,
        '::item',
        '  Um',
        '::item',
        '  Dois',
        '::item',
        '  Tres',
        '::item',
        '  Quatro',
      ].join('\n'),
    );

    await scrollEditorToTop();
    // The last option, whatever the repeating slot happens to be called: the artwork id is
    // `${slot}-${n}` and the slot is the manifest's business, not this test's.
    const last = await page.evaluate(() => {
      const picker = document.getElementById('slide') as HTMLSelectElement | null;
      return picker?.options[picker.options.length - 1]?.value ?? '';
    });
    expect(last).not.toBe('');

    await page.selectOption('#slide', last);
    await waitForScroll();

    expect(await editorScrollTop()).toBeGreaterThan(0);
    expect(await activeLine()).toContain('Quatro');
  });
});

describe('the panel takes the room it needs and no more', () => {
  it('shrinks to one line for a brief with nothing wrong with it', async () => {
    // Measured, because this is the bug looking at the window found: a flat 168px panel
    // cost the preview 12 points of zoom on every clean brief.
    await type(CAROUSEL);

    const measured = await page.evaluate(() => {
      const panel = document.querySelector('.problems');
      return {
        panelHeight: Math.round(panel?.getBoundingClientRect().height ?? 0),
        rows: document.querySelectorAll('.problems__row').length,
      };
    });

    expect(measured.rows).toBe(0);
    expect(measured.panelHeight).toBeLessThan(110);
  });

  it('stops at a ceiling and scrolls, rather than pushing the footer off the window', async () => {
    const many = [
      '---',
      'template: promo-curso',
      'formats: [feed]',
      '---',
      ...Array.from({ length: 14 }, (_, i) => `::nao-existe-${String(i)} x`),
    ].join('\n');
    await type(many);

    const measured = await page.evaluate(() => {
      const panel = document.querySelector('.problems');
      const list = document.getElementById('problems-list');
      const foot = document.querySelector('.shell__foot');
      return {
        rows: document.querySelectorAll('.problems__row').length,
        panelHeight: Math.round(panel?.getBoundingClientRect().height ?? 0),
        ceiling: Math.round(window.innerHeight * 0.3),
        listScrolls: (list?.scrollHeight ?? 0) > (list?.clientHeight ?? 0) + 1,
        documentScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
        footerBottom: Math.round(foot?.getBoundingClientRect().bottom ?? 0),
        viewport: window.innerHeight,
      };
    });

    expect(measured.rows).toBeGreaterThan(10);
    expect(measured.panelHeight).toBeLessThanOrEqual(measured.ceiling + 1);
    expect(measured.listScrolls).toBe(true);
    // The window never scrolls and the footer stays on it — the overflow TYTO-40 and
    // TYTO-41 each hit once, asserted here for the pane that was most likely to bring it
    // back.
    expect(measured.documentScrolls).toBe(false);
    expect(measured.footerBottom).toBeLessThanOrEqual(measured.viewport);
  });
});
