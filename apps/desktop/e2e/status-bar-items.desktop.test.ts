import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * Which status bar items show is the `statusBarItems` setting (TYTO-301, ADR 0091), applied on
 * save like `theme` and `iconStrokeWidth`: removing an item hides it, the list orders each
 * side, and a bad entry is a diagnostic at that entry while the rest still apply. The unit
 * tests hold the rules; this file holds that a save reaches the bar of a running window.
 *
 * Keys go through Playwright's page, never through the operating system.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

/** ADR 0076's order, which is the setting's default. */
const DEFAULT_ORDER = [
  'leftArea',
  'commandBar',
  'vimMode',
  'cursorPosition',
  'tabKind',
  'template',
  'problems',
  'queue',
  'plugins',
  'export',
  'settings',
  'bottomArea',
  'rightArea',
];

let app: ElectronApplication;
let page: Page;
let scratch: string;

/** The ids drawn on each side of the bar, in order, once per item. */
const drawn = async (): Promise<{ start: string[]; end: string[] }> =>
  page.evaluate(() => {
    const side = (selector: string): string[] => [
      ...new Set(
        [...document.querySelectorAll<HTMLElement>(`tyto-status-bar ${selector} [data-item]`)].map(
          (element) => element.dataset['item'] ?? '',
        ),
      ),
    ];
    return {
      start: side('.status-bar__side:not(.status-bar__side--end)'),
      end: side('.status-bar__side--end'),
    };
  });

const problems = async (): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map(
      (row) =>
        `${row.querySelector('.problems__code')?.textContent ?? ''}@${row.querySelector('.problems__where')?.textContent ?? ''}`,
    ),
  );

async function openSettings(): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.command-bar__input', { state: 'visible' });
  await page.keyboard.type('settings.open');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tabs__tab')].some((tab) =>
      (tab.textContent ?? '').includes('settings.json'),
    ),
  );
}

/** Replaces the tab's text, as a person typing over it would. */
async function replaceText(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
  // A completion list opened by the last line would cover the next click.
  await page.keyboard.press('Escape');
}

async function saveSettings(text: string): Promise<void> {
  await replaceText(text);
  await page.keyboard.press('Control+s');
}

const showTab = async (settings: boolean): Promise<void> => {
  const tabs = page.locator('.tabs__tab');
  await (
    settings
      ? tabs.filter({ hasText: 'settings.json' })
      : tabs.filter({ hasNotText: 'settings.json' })
  )
    .first()
    .click();
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-status-bar-items-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('tyto-status-bar [data-item]');
  // A brief that names a template, so the template item has something to show.
  await replaceText('---\ntemplate: promo-curso\n---\n');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the statusBarItems setting', () => {
  it('draws today’s bar, in ADR 0076’s order, while settings.json says nothing', async () => {
    await expect.poll(async () => (await drawn()).end, { timeout: 15_000 }).toContain('template');
    const { start, end } = await drawn();
    const shown = [...start, ...end];

    expect(shown).toEqual(DEFAULT_ORDER.filter((id) => shown.includes(id)));
    for (const id of ['commandBar', 'cursorPosition', 'tabKind', 'problems', 'settings']) {
      expect(shown).toContain(id);
    }
  });

  it('carries the key commented out, with every id, in a new settings.json', async () => {
    await openSettings();
    // From the disk, not from `.cm-content`, which holds only the lines in the viewport: on
    // CI's smaller window the last ids are not rendered.
    const text = readFileSync(join(scratch, 'user-data', 'settings.json'), 'utf8');

    expect(text).toContain('// "statusBarItems": [');
    for (const id of DEFAULT_ORDER) expect(text).toContain(`"${id}"`);
  });

  it('hides what the list leaves out and orders each side by it, on save', async () => {
    await saveSettings(
      '{\n  "statusBarItems": ["settings", "problems", "commandBar", "tabKind", "queue"]\n}\n',
    );

    await expect
      .poll(drawn, { timeout: 15_000 })
      .toEqual({ start: ['commandBar'], end: ['settings', 'problems', 'tabKind', 'queue'] });

    // The brief names a template, and the list does not: it stays hidden there too.
    await showTab(false);
    await expect
      .poll(drawn, { timeout: 15_000 })
      .toEqual({ start: ['commandBar'], end: ['settings', 'problems', 'tabKind', 'queue'] });
    expect(await page.$('tyto-status-bar .status-bar__template')).toBeNull();
  });

  it('points at a bad entry and still applies the rest', async () => {
    await showTab(true);
    await saveSettings('{\n  "statusBarItems": ["clock", "template", "problems"]\n}\n');

    await expect.poll(problems, { timeout: 15_000 }).toContain('W_SETTING_ENTRY_INVALID@2:22');
    // The settings tab has no template to show; the problems button is what remains.
    await expect.poll(drawn, { timeout: 15_000 }).toEqual({ start: [], end: ['problems'] });

    await showTab(false);
    await expect
      .poll(drawn, { timeout: 15_000 })
      .toEqual({ start: [], end: ['template', 'problems'] });
  });
});
