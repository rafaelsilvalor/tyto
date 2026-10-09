import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { translate } from '../shared/i18n/index.js';
import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * A crash in main, watched being drawn (TYTO-144).
 *
 * **Until this suite nobody had seen the crash box appear.** TYTO-140 wired it and unit-tested
 * the `onCrash` port, but the box is modal and the suite is headless, so a real one would
 * block main in front of nobody. The seam is `quit.desktop.test.ts`'s: `app.evaluate` runs
 * with the `electron` module in scope, so `dialog.showMessageBoxSync` and `shell.openPath` are
 * replaced from inside main by recorders, and nothing in the shipped app grows a hook.
 *
 * The recorder answers `0`, the button that opens the log folder, so the same crash proves
 * the box was drawn and that its button does what it says.
 *
 * **What this does not cover is a crash during startup**: `app.evaluate` needs an app that
 * has finished starting, and making `start` throw on demand would be test code in a shipped
 * binary. `docs/architecture.md` says so where it describes the crash path.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

interface CapturedBox {
  readonly type: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
  readonly defaultId: number;
  readonly cancelId: number;
}

interface Recorded {
  readonly boxes: readonly CapturedBox[];
  readonly opened: readonly string[];
}

let app: ElectronApplication;
let page: Page;
let scratch: string;
let logsDirectory: string;

const logText = (): string => {
  const file = join(logsDirectory, 'tyto.log');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

const recorded = (): Promise<Recorded> =>
  app.evaluate(() => {
    const shared = globalThis as unknown as { tytoCrashBoxes?: unknown[]; tytoOpened?: unknown[] };
    return { boxes: shared.tytoCrashBoxes ?? [], opened: shared.tytoOpened ?? [] };
  }) as Promise<Recorded>;

/** Polls, because the crash fires on main's next tick and not inside the evaluate. */
const waitForBoxes = async (count: number): Promise<Recorded> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const now = await recorded();
    if (now.boxes.length >= count) return now;
    await page.waitForTimeout(100);
  }
  return recorded();
};

beforeAll(async () => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'tyto-crash-e2e-'));
  const userData = join(scratch, 'userData');
  logsDirectory = join(userData, 'logs');

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');

  await app.evaluate(({ dialog, shell }) => {
    const shared = globalThis as unknown as { tytoCrashBoxes?: unknown[]; tytoOpened?: unknown[] };
    shared.tytoCrashBoxes = [];
    shared.tytoOpened = [];
    dialog.showMessageBoxSync = ((first: unknown, second?: unknown): number => {
      // Either overload: `(options)` or `(window, options)`.
      const options = (second ?? first) as Record<string, unknown>;
      shared.tytoCrashBoxes?.push({
        type: options['type'],
        message: options['message'],
        detail: options['detail'],
        buttons: options['buttons'],
        defaultId: options['defaultId'],
        cancelId: options['cancelId'],
      });
      return 0;
    }) as never;
    shell.openPath = ((path: string): Promise<string> => {
      shared.tytoOpened?.push(path);
      return Promise.resolve('');
    }) as never;
  });
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('a crash in main after startup', () => {
  it('draws one box for an uncaught exception, offering the log folder first', async () => {
    await app.evaluate(() => {
      setTimeout(() => {
        throw new Error('deliberate uncaught exception from the crash suite');
      }, 0);
    });

    const { boxes, opened } = await waitForBoxes(1);

    expect(boxes).toHaveLength(1);
    const [box] = boxes;
    expect(box?.type).toBe('error');
    expect(box?.message).toBe(translate('en', 'crash.title'));
    expect(box?.buttons).toEqual([
      translate('en', 'menu.revealLogs'),
      translate('en', 'crash.close'),
    ]);
    expect(box?.defaultId).toBe(0);
    expect(box?.cancelId).toBe(1);
    expect(box?.detail).toContain('deliberate uncaught exception from the crash suite');
    expect(box?.detail).toContain(logsDirectory);
    // The recorder answered 0, so the button's work is the folder being opened — once.
    expect(opened).toEqual([logsDirectory]);
    expect(logText()).toContain('uncaught exception in main');
    expect(logText()).toContain('deliberate uncaught exception from the crash suite');
  });

  it('draws one more for a rejection nobody handled', async () => {
    await app.evaluate(() => {
      void Promise.reject(new Error('deliberate unhandled rejection from the crash suite'));
    });

    const { boxes, opened } = await waitForBoxes(2);

    expect(boxes).toHaveLength(2);
    expect(boxes[1]?.detail).toContain('deliberate unhandled rejection from the crash suite');
    expect(boxes[1]?.detail).toContain(logsDirectory);
    expect(opened).toEqual([logsDirectory, logsDirectory]);
    expect(logText()).toContain('unhandled rejection in main');
    expect(logText()).toContain('deliberate unhandled rejection from the crash suite');
  });

  it('leaves the window alive, because a reported crash is not a killed process', async () => {
    expect(page.isClosed()).toBe(false);
    expect(await page.evaluate(() => document.querySelector('#editor .cm-content') !== null)).toBe(
      true,
    );
  });
});
