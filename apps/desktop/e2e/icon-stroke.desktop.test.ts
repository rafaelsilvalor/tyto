import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The icons' stroke is the `iconStrokeWidth` setting (TYTO-288, ADR 0085), applied on save like
 * `theme`: what the window actually draws, read from the computed style of the status bar's
 * icons — a CSS width on the svg must win over anything the markup says, and only a browser can
 * say it did. A value the setting refuses is a diagnostic at the value and the default, 1.25.
 *
 * Keys go through Playwright's page, never through the operating system.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

let app: ElectronApplication;
let page: Page;
let scratch: string;

/** The stroke the problems icon's path is drawn with, and its dot's radius, as computed. */
const drawn = async (): Promise<{ stroke: number; dot: number }> =>
  page.evaluate(() => {
    const path = document.querySelector('tyto-status-bar [data-command] svg.icon path');
    const dot = document.querySelector('tyto-status-bar svg.icon .icon__dot');
    if (path === null || dot === null) throw new Error('no status bar icon on screen');
    // Chromium answers the radius as `calc(0.5px)`: the number inside is what is drawn.
    const pixels = (value: string): number => Number.parseFloat(value.replace(/^calc\(/u, ''));
    return {
      stroke: pixels(getComputedStyle(path).strokeWidth),
      dot: pixels(getComputedStyle(dot).r),
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

/** Replaces the settings tab's text and saves it, as a person typing over it would. */
async function saveSettings(text: string): Promise<void> {
  await page.click('#editor .cm-content');
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
  await page.keyboard.press('Control+s');
}

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-icon-stroke-'));
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('tyto-status-bar svg.icon');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the iconStrokeWidth setting', () => {
  it('draws the icons at 1.25 by default, the dots at 0.4 of it', async () => {
    await expect.poll(drawn, { timeout: 15_000 }).toEqual({ stroke: 1.25, dot: 0.5 });
  });

  it('draws them at 1 once settings.json says 1 and is saved, with no restart', async () => {
    await openSettings();
    await saveSettings('{\n  "iconStrokeWidth": 1\n}\n');
    await expect.poll(drawn, { timeout: 15_000 }).toEqual({ stroke: 1, dot: 0.4 });
  });

  it('refuses a value out of range at the value, and goes back to 1.25', async () => {
    await saveSettings('{\n  "iconStrokeWidth": 5\n}\n');
    await expect.poll(problems, { timeout: 15_000 }).toContain('W_SETTING_INVALID@2:22');
    await expect.poll(drawn, { timeout: 15_000 }).toEqual({ stroke: 1.25, dot: 0.5 });
  });
});
