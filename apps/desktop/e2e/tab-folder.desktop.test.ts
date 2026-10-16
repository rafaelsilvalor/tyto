import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pathLabelOf } from '../src/main/path-label.js';
import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * A tab's path on hover, VS Code's way, through real launches of one data folder (TYTO-288,
 * ADR 0086).
 *
 * The first launch points Electron's home directory at the scratch folder, so the path a tab
 * shows is `~` plus a path this suite chose, on every runner. It opens a brief, a preview of it,
 * an untitled tab and `settings.json`, and reads each tab's `title` — the native tooltip, which
 * a screenshot does not draw, so the attribute is the instrument. The second launch keeps the
 * real home directory and finds the restored brief still showing its path, worked out again
 * by main and not read back from `session.json`. And the window still cannot open a path it
 * made up, the one it was shown included (ADR 0010).
 *
 * With `TYTO_TAB_FOLDER_SHOTS` set to a folder, the suite leaves a screenshot of each tab
 * hovered, in Tyto Light and Tyto Dark.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const shots = process.env['TYTO_TAB_FOLDER_SHOTS'];

const BRIEF = ['---', 'template: promo-curso', '---', '::titulo Inverno'].join('\n');
const UNTITLED = /^(Sem título|Untitled)$/u;
const PREVIEW = /^(Preview|Prévia) campanha\.brief$/u;

let scratch: string;
let briefPath: string;
let app: ElectronApplication | undefined;
let page: Page;

const launch = async (): Promise<void> => {
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'userData')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
};

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

/** Runs a command the way a person would: the bar, filtered by id. */
const runFromBar = async (id: string): Promise<void> => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type(id);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
};

/** Every tab's label and the `title` its name button carries, `null` when it has none. */
const tooltips = async (): Promise<{ label: string; title: string | null }[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.tabs__tab .tabs__name')].map((node) => ({
      label: node.querySelector('.tabs__label')?.textContent ?? '',
      title: node.getAttribute('title'),
    })),
  );

const titleOf = async (label: RegExp): Promise<string | null | undefined> =>
  (await tooltips()).find((tab) => label.test(tab.label))?.title;

/** Hovers a tab and, when asked for, leaves it in both themes; the window is left light. */
const shoot = async (label: RegExp, name: string): Promise<void> => {
  await page.locator('.tabs__tab .tabs__label', { hasText: label }).first().hover();
  if (shots === undefined) return;
  mkdirSync(shots, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await app?.evaluate(({ nativeTheme }, source) => {
      nativeTheme.themeSource = source;
    }, scheme);
    // scheme: the screenshot in each theme Rafael approves by looking; main is told too.
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, `${name}-${scheme}.png`) });
  }
  await app?.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'light';
  });
  // scheme: back to the light window the rest of this file reads.
  await page.emulateMedia({ colorScheme: 'light' });
};

beforeAll(() => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-tab-folder-'));
  mkdirSync(join(scratch, 'briefs'));
  briefPath = join(scratch, 'briefs', 'campanha.brief');
  writeFileSync(briefPath, BRIEF, 'utf8');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the path on hover', () => {
  it('shows a saved brief’s path, with the home directory as ~', async () => {
    await launch();
    // Electron's own path table, the one main reads at every open: no hook in the app.
    await app?.evaluate(({ app: electronApp }, home) => {
      electronApp.setPath('home', home);
    }, scratch);
    await app?.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, briefPath);
    await runFromBar('editor.open');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tabs__label')].some(
        (node) => node.textContent === 'campanha.brief',
      ),
    );

    expect(await titleOf(/^campanha\.brief$/u)).toBe(`~${sep}briefs${sep}campanha.brief`);
    await shoot(/^campanha\.brief$/u, 'brief-tab-hover');
  });

  it('shows the path of the brief a preview tab shows', async () => {
    await runFromBar('preview.openToSide');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tabs__label')].some((node) =>
        /^(Preview|Prévia) /u.test(node.textContent ?? ''),
      ),
    );

    expect(await titleOf(PREVIEW)).toBe(`~${sep}briefs${sep}campanha.brief`);
    await shoot(PREVIEW, 'preview-tab-hover');
  });

  it('shows none for a tab in no file', async () => {
    await page.locator('.tabs__tab .tabs__name', { hasText: 'campanha.brief' }).first().click();
    await runFromBar('document.new');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tabs__label')].some((node) =>
        /^(Sem título|Untitled)$/u.test(node.textContent ?? ''),
      ),
    );

    expect(await titleOf(UNTITLED)).toBeNull();
  });

  it('shows the path of the app’s own files too', async () => {
    await runFromBar('settings.open');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tabs__label')].some(
        (node) => node.textContent === 'settings.json',
      ),
    );

    expect(await titleOf(/^settings\.json$/u)).toBe(`~${sep}userData${sep}settings.json`);
    await shoot(/^settings\.json$/u, 'settings-tab-hover');
  });

  it('cannot open a path it was only shown, nor one it made up', async () => {
    const shown = (await titleOf(/^campanha\.brief$/u)) ?? '';
    const answers = await page.evaluate(
      async (paths) => {
        const bridge = (
          window as unknown as {
            tyto: Record<string, (request: unknown) => Promise<{ document: unknown }>>;
          }
        ).tyto;
        const asked = [];
        for (const path of paths) {
          asked.push((await bridge['file:reopen']?.({ documentId: 'probe', path }))?.document);
        }
        return asked;
      },
      [
        shown,
        `${shown.slice(0, shown.lastIndexOf(sep))}${sep}outro.brief`,
        join(scratch, 'briefs', 'outro.brief'),
      ],
    );

    expect(answers).toEqual([null, null, null]);
  });

  it('shows the path again after a relaunch, worked out by main and not stored', async () => {
    await quit();
    const session = readFileSync(join(scratch, 'userData', 'session.json'), 'utf8');
    expect(session).not.toContain('pathLabel');

    // The second launch keeps the real home directory, so the label is the one main writes for
    // this path on this machine — which is not the one the first launch showed.
    await launch();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.tabs__label')].some(
          (node) => node.textContent === 'campanha.brief',
        ),
      null,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(500);

    expect(await titleOf(/^campanha\.brief$/u)).toBe(pathLabelOf(briefPath, homedir()));
    expect(await titleOf(PREVIEW)).toBe(pathLabelOf(briefPath, homedir()));
    expect(await titleOf(/^settings\.json$/u)).toBe(
      pathLabelOf(join(scratch, 'userData', 'settings.json'), homedir()),
    );
  });
});
