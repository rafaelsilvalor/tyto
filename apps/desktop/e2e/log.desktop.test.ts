import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The log, from a failure in a real window to a line on a real disk (TYTO-132).
 *
 * **The only place the composition root is provable.** `src/main/index.ts` has no unit test by
 * design — it is the one file that names Electron — so "the log was built, the handler was
 * wired, and the renderer's failure reaches the file" is a claim that exists nowhere else.
 * `src/main/log.test.ts` proves the writing, `src/renderer/report-errors.test.ts` proves the
 * reporting, and neither can say the two are connected.
 *
 * The version is read off `apps/desktop/package.json` rather than written down, which is what
 * TYTO-135 established: a test that hardcodes a version is a test that has to be edited on
 * every release, and it was.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
  version: string;
};

/** The brief the window holds, so the log can be checked for not containing it. */
const SECRET_BRIEF = '::titulo Campanha confidencial do cliente';

let app: ElectronApplication;
let page: Page;
let scratch: string;
let logsDirectory: string;

const logText = (): string => {
  const file = join(logsDirectory, 'tyto.log');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

/** Polls, because the write is main's and the dispatch was the renderer's. */
const waitForLog = async (contains: string): Promise<string> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const text = logText();
    if (text.includes(contains)) return text;
    await page.waitForTimeout(100);
  }
  return logText();
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'tyto-log-e2e-'));
  const userData = join(scratch, 'userData');
  logsDirectory = join(userData, 'logs');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
});

afterAll(async () => {
  await app?.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe('a failure in the window', () => {
  it('reaches a file, naming what broke, the version and the platform', async () => {
    await page.click('#editor .cm-content');
    await page.keyboard.type(SECRET_BRIEF);

    await page.evaluate(() => {
      window.dispatchEvent(
        new ErrorEvent('error', {
          error: new Error('deliberate failure from the end-to-end suite'),
          message: 'deliberate failure from the end-to-end suite',
        }),
      );
    });

    const text = await waitForLog('deliberate failure');

    expect(text).toContain('deliberate failure from the end-to-end suite');
    expect(text).toContain('ERROR');
    // Read from the manifest, not written down: TYTO-135 is the card that learned this.
    expect(text).toContain(manifest.version);
    expect(text).toContain(process.platform);
  });

  it('keeps one failure to one line, however deep the stack was', async () => {
    const entries = logText().split('\n').filter(Boolean);

    // Every line starts with a timestamp. A stack spread over nine lines would give nine
    // entries that do not, and a file that cannot be counted has no ceiling that means
    // anything.
    for (const entry of entries) {
      expect(entry, entry.slice(0, 60)).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    }
    expect(entries.length).toBeGreaterThan(0);
  });

  it('carries no word of the brief the window had open', () => {
    // The criterion the card puts most weight on, and it is mechanical rather than careful:
    // `log:write` caps the message at 200 and the detail at 4000, and the preload refuses
    // anything longer before it is sent.
    //
    // **Guarded against passing on an empty file**, which is what it would do if the reporting
    // were never installed — measured, by removing that line and watching this case stay green
    // while the other three went red. `src/renderer/report-errors.test.ts` is where the caps
    // themselves are driven.
    expect(logText()).not.toBe('');
    expect(logText()).not.toContain('Campanha confidencial');
  });

  it('puts the file in a folder that holds nothing else about the person', () => {
    // The menu item opens this folder, and a beta tester is invited to send what is in it.
    // `userData` itself holds the credential store and the list of every path they ever
    // opened; `logs/` is the only folder in this app safe to hand over whole.
    expect(readdirSync(logsDirectory).every((name) => name.startsWith('tyto.log'))).toBe(true);
  });
});
