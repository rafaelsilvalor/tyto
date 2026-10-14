import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { SHOWN_PREVIEW, previewSrcdoc } from './preview-pane.js';

/**
 * The preview as a tab beside its brief, following the brief in front (TYTO-287, ADR 0084).
 *
 * "Follows" is Rafael's decision of 2026-10-13, over the card's "bound to one brief": the
 * preview shows whichever brief was last in front, as VS Code's Markdown preview does, and
 * "Lock" pins it to one. What needs a real window is everything around the model in
 * `editor-groups.test.ts`: the key reaching the window, the art arriving in the pane, typing
 * redrawing it, and the following and the lock as a person sees them in the strips.
 *
 * Keys go through Playwright's page and never through the operating system, and no text is
 * read off `.cm-content`, which holds only the lines on screen.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let app: ElectronApplication;
let page: Page;
let scratch: string;
let firstPath: string;
let secondPath: string;

const FIRST = ['---', 'template: promo-curso', '---', '::titulo Inverno'].join('\n');
const SECOND = ['---', 'template: promo-curso', '---', '::titulo Outono'].join('\n');

/** Each group's tab labels in tree order, the one in front starred and a locked one marked. */
const strips = async (): Promise<string[][]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group]')].map((group) =>
      [...group.querySelectorAll('.tabs__tab')].map((tab) => {
        const label = tab.querySelector('.tabs__label')?.textContent ?? '';
        const locked = tab.querySelector('.tabs__lock') === null ? '' : ' [locked]';
        return `${tab.classList.contains('tabs__tab--on') ? '*' : ''}${label}${locked}`;
      }),
    ),
  );

const focusedGroupIndex = async (): Promise<number> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group]')].findIndex((group) =>
      group.classList.contains('editor-group--focused'),
    ),
  );

/** "Preview" in English, "Prévia" in Portuguese: the window opens in the system's language. */
const PREVIEW = /^\*?(Preview|Prévia) /u;
const previewOf = (name: string): RegExp => new RegExp(`^\\*?(Preview|Prévia) ${name}`, 'u');

/** The preview tab's label in each group that shows one, in tree order. */
const previewLabels = async (): Promise<string[]> =>
  (await strips()).flat().filter((label) => PREVIEW.test(label));

/** The srcdoc of the preview shown in group `index`, read from that group's own pane. */
const srcdocIn = async (index: number): Promise<string> =>
  page.evaluate(
    ([at, pane]) =>
      document
        .querySelectorAll('[data-editor-group]')
        [at]?.querySelector(`${pane} [data-preview-frame]`)
        ?.getAttribute('srcdoc') ?? '',
    [index, SHOWN_PREVIEW] as const,
  );

const answerOpenWith = async (path: string): Promise<void> => {
  await app.evaluate(({ dialog }, open) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [open] });
  }, path);
};

/** Runs a command the way a person would: the bar, filtered by id. */
const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
};

/** Clicks a tab by its label, in whichever group it is. */
const clickTab = async (label: string): Promise<void> => {
  await page.locator('.tabs__tab .tabs__name', { hasText: label }).first().click();
  await page.waitForTimeout(300);
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'tyto-preview-tab-'));
  firstPath = join(scratch, 'inverno.brief');
  secondPath = join(scratch, 'outra.brief');
  writeFileSync(firstPath, FIRST, 'utf8');
  writeFileSync(secondPath, SECOND, 'utf8');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a fresh window', () => {
  it('opens with no preview until a person asks for one', async () => {
    // Not a first launch: the harness seeds a session (`not-a-first-launch.setup.ts`), as
    // every launch after a person's first has one. The first launch is `preview-session`'s.
    await page.waitForTimeout(1500);
    expect(await strips()).toHaveLength(1);
    expect(await previewLabels()).toEqual([]);
  });

  it('has no PREVIEW panel and no right-area button', async () => {
    const left = await page.evaluate(() => ({
      panel: document.querySelector('[data-panel="preview"], tyto-preview-panel') !== null,
      ids: document.getElementById('preview-frame') !== null,
      rightArea:
        document.querySelector('tyto-status-bar [data-command="layout.toggleDock:right"]') !== null,
    }));
    expect(left).toEqual({ panel: false, ids: false, rightArea: false });
  });
});

describe('opening it with the key', () => {
  it('Ctrl+Shift+V puts "Preview <name>" on the right with the art drawn', async () => {
    await answerOpenWith(firstPath);
    await runFromBar('editor.open');
    await expect.poll(strips).toEqual([['*inverno.brief']]);

    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+Shift+V');

    await expect
      .poll(strips, { timeout: 15_000 })
      .toEqual([['*inverno.brief'], [expect.stringMatching(previewOf('inverno.brief'))]]);
    await expect.poll(() => srcdocIn(1), { timeout: 15_000 }).toContain('Inverno');
    // The focus stays in the brief, as VS Code's "Open Preview to the Side" leaves it.
    expect(await focusedGroupIndex()).toBe(0);
  });

  it('redraws as the brief is typed', async () => {
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('Quente');
    await expect.poll(() => srcdocIn(1), { timeout: 15_000 }).toContain('InvernoQuente');
  });
});

describe('following the brief in front', () => {
  it('shows another brief once its tab comes to the front', async () => {
    await answerOpenWith(secondPath);
    await runFromBar('editor.open');
    await expect
      .poll(previewLabels, { timeout: 15_000 })
      .toEqual([expect.stringMatching(previewOf('outra.brief'))]);
    await expect.poll(() => srcdocIn(1), { timeout: 15_000 }).toContain('Outono');

    await clickTab('inverno.brief');
    await expect.poll(previewLabels).toEqual([expect.stringMatching(previewOf('inverno.brief'))]);
    await expect.poll(() => srcdocIn(1)).toContain('Inverno');
  });

  it('keeps the last brief while an app file is in front', async () => {
    await runFromBar('settings.open');
    await expect.poll(async () => (await strips())[0]?.length).toBe(3);
    expect(await previewLabels()).toEqual([expect.stringMatching(previewOf('inverno.brief'))]);
    expect(await srcdocIn(1)).toContain('Inverno');
    await clickTab('inverno.brief');
  });
});

describe('the lock', () => {
  it('keeps a locked preview on its brief while another comes to the front', async () => {
    await page.locator(`[data-editor-group] ${SHOWN_PREVIEW} [data-preview-lock]`).click();
    await expect
      .poll(previewLabels)
      .toEqual([expect.stringMatching(/^\*?(Preview|Prévia) inverno\.brief \[locked\]$/u)]);

    await clickTab('outra.brief');
    await page.waitForTimeout(500);
    expect(await previewLabels()).toEqual([
      expect.stringMatching(/^\*?(Preview|Prévia) inverno\.brief \[locked\]$/u),
    ]);
    expect(await srcdocIn(1)).toContain('Inverno');
    expect(await srcdocIn(1)).not.toContain('Outono');
  });

  it('lets the key open a following preview beside the locked one', async () => {
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+Shift+V');
    await expect
      .poll(previewLabels, { timeout: 15_000 })
      .toEqual([
        expect.stringMatching(/inverno\.brief \[locked\]$/u),
        expect.stringMatching(previewOf('outra.brief')),
      ]);
    await expect.poll(() => srcdocIn(1), { timeout: 15_000 }).toContain('Outono');
  });
});

describe('a document is found by its own tab, never by its preview', () => {
  it('opening a file the locked preview shows goes to its text', async () => {
    // Focus in the preview's group, where the locked preview of `inverno.brief` is.
    await page.locator(`[data-editor-group]:nth-child(2) ${SHOWN_PREVIEW}`).click();
    await expect.poll(focusedGroupIndex).toBe(1);

    await answerOpenWith(firstPath);
    await runFromBar('editor.open');

    await expect.poll(focusedGroupIndex).toBe(0);
    expect((await strips())[0]).toContain('*inverno.brief');
  });

  it('reads `previewSrcdoc` off the first preview on screen', async () => {
    // The helper the migrated suites use: the first shown preview in tree order.
    expect(await previewSrcdoc(page)).toBe(await srcdocIn(1));
  });
});
