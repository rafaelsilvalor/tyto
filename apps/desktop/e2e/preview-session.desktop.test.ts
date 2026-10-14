import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { FIRST_LAUNCH_VARIABLE } from './not-a-first-launch.setup.js';
import { SHOWN_PREVIEW } from './preview-pane.js';

/**
 * The previews across a quit and a relaunch, and the first launch (TYTO-287 PR B, ADR 0080 and
 * 0084).
 *
 * Two launches of one data folder: the first opens two briefs, a preview locked on one and the
 * following one beside it, then quits; the second has to bring both back, each with its art.
 * Then a third data folder, launched as a **real first launch** — the harness seeds a session
 * for every other suite (`not-a-first-launch.setup.ts`) — has to open the preview to the side.
 *
 * Keys go through Playwright's page and never through the operating system.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let scratch: string;
let firstPath: string;
let secondPath: string;
let app: ElectronApplication | undefined;
let page: Page;

const FIRST = ['---', 'template: promo-curso', '---', '::titulo Inverno'].join('\n');
const SECOND = ['---', 'template: promo-curso', '---', '::titulo Outono'].join('\n');

/** Quits as a person does: the session is written on the way out and nothing is asked. */
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

const launch = async (folder: string, firstLaunch = false): Promise<void> => {
  await quit();
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, folder)}`],
    cwd: join(here, '..'),
    env: {
      ...process.env,
      TYTO_HEADLESS: '1',
      TYTO_HOME: join(scratch, 'tyto-home'),
      [FIRST_LAUNCH_VARIABLE]: firstLaunch ? '1' : '0',
    },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
};

const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
};

const openFile = async (path: string): Promise<void> => {
  await app?.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, path);
  await runFromBar('editor.open');
};

/** Each group's tab labels in tree order, the one in front starred and a locked one marked. */
const strips = async (): Promise<string[][]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group]')].map((group) =>
      [...group.querySelectorAll('.tabs__tab')].map((tab) => {
        const label = tab.querySelector('.tabs__label')?.textContent ?? '';
        const locked = tab.querySelector('.tabs__lock') === null ? '' : ' [locked]';
        // "Preview" in English, "Prévia" in Portuguese: the window opens in the system's language.
        const name = label.replace(/^Prévia /u, 'Preview ');
        return `${tab.classList.contains('tabs__tab--on') ? '*' : ''}${name}${locked}`;
      }),
    ),
  );

const focusedGroupIndex = async (): Promise<number> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-editor-group]')].findIndex((group) =>
      group.classList.contains('editor-group--focused'),
    ),
  );

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

const clickTab = async (label: string): Promise<void> => {
  await page.locator('.tabs__tab .tabs__name', { hasText: label }).first().click();
  await page.waitForTimeout(300);
};

/** Presses Ctrl+Shift+V in the brief until `count` preview tabs exist. */
const previewsCome = async (count: number): Promise<void> => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await page.$$('[data-tab-kind="preview"]')).length >= count) return;
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+Shift+V');
    await page.waitForTimeout(500);
  }
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-preview-session-'));
  firstPath = join(scratch, 'inverno.brief');
  secondPath = join(scratch, 'outono.brief');
  writeFileSync(firstPath, FIRST, 'utf8');
  writeFileSync(secondPath, SECOND, 'utf8');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

/** Left: both briefs, inverno in front. Right: a preview locked on outono, the following one. */
const ARRANGED = [
  ['*inverno.brief', 'outono.brief'],
  ['Preview outono.brief [locked]', '*Preview inverno.brief'],
];

describe('a following and a locked preview', () => {
  it('are arranged beside two briefs', async () => {
    await launch('userData');
    // Not a first launch: the harness seeded a session, so the window opens with no preview.
    await page.waitForTimeout(1000);
    expect(await strips()).toHaveLength(1);

    await openFile(firstPath);
    await openFile(secondPath);
    await previewsCome(1);
    await expect.poll(() => srcdocIn(1), { timeout: 15_000 }).toContain('Outono');
    await page.locator(`[data-editor-group] ${SHOWN_PREVIEW} [data-preview-lock]`).click();
    await page.waitForTimeout(300);
    await clickTab('inverno.brief');
    await previewsCome(2);

    await expect.poll(strips, { timeout: 15_000 }).toEqual(ARRANGED);
    await expect.poll(() => srcdocIn(1), { timeout: 15_000 }).toContain('Inverno');
  });

  it('are kept in the session with no path, the locked one by its brief’s index', async () => {
    await quit();
    const session = JSON.parse(readFileSync(join(scratch, 'userData', 'session.json'), 'utf8')) as {
      tabs: { path?: string }[];
      groups: { root: { children: { tabs: Record<string, unknown>[] }[] } };
    };
    const right = session.groups.root.children[1]?.tabs ?? [];
    const lockedOn = right[0]?.['tab'] as number;
    expect(right).toEqual([{ tab: lockedOn, view: 'preview', locked: true }, { view: 'preview' }]);
    expect(session.tabs[lockedOn]?.path).toBe(secondPath);
  });

  it('come back after a relaunch, each with its art', async () => {
    await launch('userData');
    await expect.poll(strips, { timeout: 15_000 }).toEqual(ARRANGED);
    // The following preview follows again: the brief in front of the focused group.
    await expect.poll(() => srcdocIn(1), { timeout: 15_000 }).toContain('Inverno');
    await clickTab('Preview outono.brief');
    await expect.poll(() => srcdocIn(1), { timeout: 15_000 }).toContain('Outono');
  });

  it('a closed preview stays closed on the next launch', async () => {
    await page.keyboard.press('Control+w');
    await clickTab('Preview inverno.brief');
    await page.keyboard.press('Control+w');
    await expect.poll(strips).toEqual([['*inverno.brief', 'outono.brief']]);
    await launch('userData');
    await page.waitForTimeout(1500);
    expect(await strips()).toEqual([['*inverno.brief', 'outono.brief']]);
  });
});

describe('the first launch', () => {
  it('opens the following preview to the side, with the focus left in the brief', async () => {
    await launch('first-launch', true);
    await expect
      .poll(strips, { timeout: 15_000 })
      .toEqual([[expect.stringMatching(/^\*/u)], [expect.stringMatching(/^\*Preview /u)]]);
    expect(await focusedGroupIndex()).toBe(0);
  });

  it('draws what the person types', async () => {
    await page.locator('#editor .cm-content').click();
    await page.keyboard.type(FIRST);
    await expect.poll(() => srcdocIn(1), { timeout: 15_000 }).toContain('Inverno');
  });

  it('is a first launch only once', async () => {
    await launch('first-launch');
    await page.waitForTimeout(1500);
    // The typed tab came back with its preview beside it, from the session and not again.
    expect((await strips()).flat().filter((label) => label.includes('Preview'))).toHaveLength(1);
  });
});
