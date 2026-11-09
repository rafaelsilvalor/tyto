import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { probe } from '../scripts/verify.js';
import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { readPortFile } from './port-file.js';

/**
 * The verification probe against a real window (TYTO-651, ADR 0178).
 *
 * **The port is Playwright's own.** `_electron.launch` passes `--remote-debugging-port=0`, so the
 * app this suite starts listens the way a person's Tyto does in verification mode, and Chromium
 * writes the number into `DevToolsActivePort` in the data folder. The probe connects to it as a
 * second client, beside the suite's, exactly as an agent would beside the person.
 *
 * What needs the window is here: that the probe finds the window among the targets, reads its
 * tabs and text, captures a real PNG, and reaches `plugins:list` through the bridge. The readers'
 * logic and the badge are tested in jsdom (`e2e/verify-probe.test.ts`, `status-bar.test.ts`).
 * The suite's window is headless, so it draws no badge: that is asserted too, because every
 * other suite and the manual's screenshots run the same way.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139). `--lang=en`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
if (!existsSync(built)) {
  throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
}

let scratch: string;
let app: ElectronApplication | undefined;
let page: Page;
let port: number;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-verification-'));
  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--lang=en'],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  const lines = readPortFile(join(userData, 'DevToolsActivePort'));
  if (lines === undefined) throw new Error('Chromium wrote no DevToolsActivePort');
  port = Number(lines[0]);
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

const read = (command: 'tabs' | 'text' | 'plugins' | 'screenshot') =>
  probe({ command, port, out: join(scratch, 'shots'), fresh: false, timeoutMs: 10_000 });

describe('the verification probe on a running window', () => {
  it('lists the open tabs, the one in front marked', async () => {
    const tabs = (await read('tabs')).split('\n');
    expect(tabs.length).toBeGreaterThan(0);
    // One in front per tab group: the editor's and, when it is open, the preview's.
    expect(tabs.filter((tab) => tab.startsWith('*')).length).toBeGreaterThan(0);
  });

  it("reads the window's visible text, the status bar included", async () => {
    const text = await read('text');
    expect(text).toContain(await page.locator('.status-bar__kind').innerText());
  });

  it('captures the window as a PNG', async () => {
    const file = await read('screenshot');
    const bytes = readFileSync(file);
    expect([...bytes.subarray(1, 4)].map((byte) => String.fromCharCode(byte)).join('')).toBe('PNG');
    process.stdout.write(
      `verification probe screenshot: ${file} (${String(bytes.length)} bytes)\n`,
    );
  });

  it('reads the plugins list through the bridge', async () => {
    expect(await read('plugins')).not.toMatch(/^the window has no/u);
  });

  it('draws no badge in a headless window, where nobody is there to see it', async () => {
    expect(await page.locator('.status-bar__verification').count()).toBe(0);
  });
});
