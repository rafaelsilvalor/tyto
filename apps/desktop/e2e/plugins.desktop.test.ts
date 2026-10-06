import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

import { type Locale, isLocale, translate } from '../shared/i18n/index.js';

/**
 * The plugins screen in a running app (TYTO-47).
 *
 * **What the unit suites cannot say.** `plugin-list.test.ts` builds the rows and
 * `plugins-dialog.test.ts` renders them in jsdom, which does no layout; neither walks the
 * route a person takes — the File menu, `command:run`, `plugins:list` across the preload, a
 * disk read in main — and neither can tell whether the table is on screen at all.
 *
 * `TYTO_HOME` points main at a folder this suite writes, never at the machine's own `~/.tyto`,
 * and `--user-data-dir` keeps the layout and the recent list out of the real ones too.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

let scratch: string;
let home: string;
let app: ElectronApplication;
let page: Page;
/** The language the window opened in — the system's, so it differs between machines. */
let locale: Locale;

/** One installed plugin, disabled, and one folder dropped in by hand that nobody approved. */
function writeHome(): void {
  for (const name of ['pdf', 'solto']) {
    const folder = join(home, 'plugins', name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'tyto-plugin.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        engine: `>=${PLUGIN_API_VERSION}`,
        contributes: ['exporter'],
        permissions: ['net:api.example.com'],
      }),
    );
  }
  writeFileSync(
    join(home, 'plugins.json'),
    JSON.stringify({
      plugins: {
        pdf: { enabled: false, permissions: ['net:api.example.com'], source: './pdf' },
      },
    }),
  );
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-plugins-screen-'));
  home = join(scratch, 'tyto-home');
  writeHome();

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  const lang = await page.evaluate(() => document.documentElement.lang);
  locale = isLocale(lang) ? lang : 'pt-BR';

  // The File menu's item, clicked from main: the whole route a person takes.
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('plugins.show')?.click();
  });
  await page.waitForSelector('.plugins__row[data-plugin="solto"]');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

const rows = (): Promise<string[][]> =>
  page.$$eval('.plugins__row', (found) =>
    found.map((row) =>
      [...row.querySelectorAll('td')].slice(0, 4).map((cell) => cell.textContent?.trim() ?? ''),
    ),
  );

describe('the plugins screen', () => {
  it('opens from the File menu and lists the built-ins and what TYTO_HOME holds', async () => {
    const listed = await rows();
    const statusOf = (name: string): string | undefined =>
      listed.find((row) => row[0] === name)?.[3];

    // The built-ins this app activated, whatever their number, and the two folders.
    expect(
      listed.filter((row) => row[2] === translate(locale, 'plugins.origin.builtIn')).length,
    ).toBeGreaterThan(0);
    // The exporters too, which live in a per-export host and were missing on the first look.
    expect(statusOf('html')).toBe(translate(locale, 'plugins.status.enabled'));
    expect(statusOf('svg')).toBe(translate(locale, 'plugins.status.enabled'));
    expect(statusOf('pdf')).toBe(translate(locale, 'plugins.status.disabled'));
    expect(statusOf('solto')).toBe(translate(locale, 'plugins.status.refused'));
  });

  it('says where the plugins live: the folder TYTO_HOME named', async () => {
    expect(await page.textContent('.plugins__folder code')).toBe(join(home, 'plugins'));
  });

  it('shows the notice that permissions are not enforced, on screen and inside the window', async () => {
    const notice = page.locator('.plugins__notice');
    expect(await notice.textContent()).toBe(translate(locale, 'plugins.notice'));

    // Layout, which is what jsdom cannot answer: the notice and the table are drawn, inside
    // the window, with a size a person could read.
    // The window's own width: an Electron page has no Playwright viewport to ask.
    const viewport = { width: await page.evaluate(() => window.innerWidth) };
    for (const selector of ['.plugins__notice', '.plugins__table', '.plugins__close']) {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.width, selector).toBeGreaterThan(40);
      expect(box!.x + box!.width, selector).toBeLessThanOrEqual(viewport.width + 1);
    }

    await page.screenshot({ path: join(here, '..', 'out', 'plugins-screen.png') });
  });

  it('closes with its button', async () => {
    await page.click('.plugins__close');
    await page.waitForSelector('.plugins__panel', { state: 'detached' });
  });
});
