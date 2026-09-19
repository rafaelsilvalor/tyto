import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Quitting with unsaved text, through a real window (TYTO-123).
 *
 * **The only place this path exists.** It crosses three processes — `before-quit` in main,
 * a push through the preload, a count taken in the renderer, a dialog drawn by the OS and an
 * answer travelling back — and no unit can reach more than one leg of it. `src/main/quit.ts`
 * is unit-tested for the decision and `src/preload/bridge.test.ts` for the receive direction;
 * what neither can say is that main and the renderer are actually wired to each other.
 *
 * Three launches, because a passing quit ends the app: an app that has been told to go and went
 * cannot then be asked whether it asks when there is nothing to lose. The clean case is its
 * own describe with its own window, and so is the slow-answer case (TYTO-147), which needs a
 * window that is still there to be measured while a box is on screen.
 *
 * `dialog.showMessageBox` is replaced from main, the same seam `tabs.desktop.test.ts` uses
 * and for its reason: `app.evaluate` runs with the `electron` module in scope, so nothing
 * about the shipped app changes to make this suite possible. What is *not* copied from that
 * file is asserting on the count alone — the captured arguments are checked here, because the
 * same seam will one day carry more than one kind of box.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

interface CapturedBox {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
  readonly defaultId: number;
  readonly cancelId: number;
}

let scratch: string;

/**
 * Replaces the box, records every call, and answers the same way each time.
 *
 * The recording is what the count alone could not do: `showMessageBox` is one seam and the
 * app draws more than one question through it, so "asked once" is only meaningful next to
 * *what* was asked.
 */
const captureBoxes = async (app: ElectronApplication, confirmed: boolean): Promise<void> => {
  await app.evaluate(({ dialog }, yes) => {
    const shared = globalThis as unknown as { tytoBoxes?: unknown[] };
    shared.tytoBoxes = [];
    dialog.showMessageBox = ((options: Record<string, unknown>): Promise<unknown> => {
      shared.tytoBoxes?.push({
        message: options['message'],
        detail: options['detail'],
        buttons: options['buttons'],
        defaultId: options['defaultId'],
        cancelId: options['cancelId'],
      });
      // Index 1 confirms and index 0 cancels, which is the order `src/main/index.ts` builds
      // them in — and why cancel is both `defaultId` and `cancelId`.
      return Promise.resolve({ response: yes ? 1 : 0, checkboxChecked: false });
    }) as never;
  }, confirmed);
};

/**
 * The same seam, answering **slower than main's deadline** (TYTO-147, ADR 0031).
 *
 * The helper above answers in microseconds, which is precisely why no test in this file ever
 * saw the bug this card fixes: the box is drawn by main with `dialog.showMessageBox`, so the
 * seconds it is on screen are a person reading, and a stub that answers instantly measures a
 * question nobody was ever asked. `delayMs` is that person.
 */
const captureSlowBoxes = async (
  app: ElectronApplication,
  confirmed: boolean,
  delayMs: number,
): Promise<void> => {
  await app.evaluate(
    ({ dialog }, [yes, wait]) => {
      const shared = globalThis as unknown as { tytoBoxes?: unknown[] };
      shared.tytoBoxes = [];
      dialog.showMessageBox = ((options: Record<string, unknown>): Promise<unknown> => {
        shared.tytoBoxes?.push({
          message: options['message'],
          detail: options['detail'],
          buttons: options['buttons'],
          defaultId: options['defaultId'],
          cancelId: options['cancelId'],
        });
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ response: (yes as boolean) ? 1 : 0, checkboxChecked: false });
          }, wait as number);
        });
      }) as never;
    },
    [confirmed, delayMs] as [boolean, number],
  );
};

const boxes = async (app: ElectronApplication): Promise<CapturedBox[]> =>
  app.evaluate(
    () => (globalThis as unknown as { tytoBoxes?: CapturedBox[] }).tytoBoxes ?? [],
  ) as Promise<CapturedBox[]>;

const launch = async (name: string): Promise<{ app: ElectronApplication; page: Page }> => {
  const app = await _electron.launch({
    // Its own `userData`, for the reason `panel.desktop.test.ts` gives: `layout.json` is
    // shared otherwise, and a suite that inherited another one's panels would be measuring
    // the last run rather than the app.
    args: ['.', `--user-data-dir=${join(scratch, name)}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  return { app, page };
};

beforeAll(() => {
  if (!existsSync(built)) {
    throw new Error(
      `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
    );
  }
  scratch = mkdtempSync(join(tmpdir(), 'tyto-quit-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('quitting with unsaved text', () => {
  let app: ElectronApplication;
  let page: Page;
  let closed = false;

  beforeAll(async () => {
    ({ app, page } = await launch('dirty'));
    await page.click('#editor .cm-content');
    await page.keyboard.type('::titulo Campanha');
    // The dirty marker is derived from a comparison, not set by the keystroke (ADR 0026), so
    // waiting for it is waiting for the workspace to agree that there is something to lose.
    await page.waitForSelector('.tabs__dirty');
  });

  afterAll(async () => {
    // Guarded: the last test in this describe quits the app, and `close()` against an app
    // that has already gone reads as a timeout in whatever ran next.
    if (!closed) await app?.close();
  });

  it('asks before it goes, naming how many tabs would be lost', async () => {
    await captureBoxes(app, false);
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });
    await page.waitForTimeout(500);

    const asked = await boxes(app);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.message).toMatch(/^(Sair sem salvar\?|Quit without saving\?)$/u);
    // The count, spliced into the string the catalogue holds. One tab is dirty, so it is the
    // singular form and the `{n}` placeholder is gone.
    expect(asked[0]?.detail).toMatch(/^1 (aba|tab) /u);
    expect(asked[0]?.detail).not.toContain('{n}');
    // The safe button is the default and the escape, inherited from `confirm` rather than
    // written a second time.
    expect(asked[0]?.defaultId).toBe(0);
    expect(asked[0]?.cancelId).toBe(0);
  });

  it('honours a no by still being there', async () => {
    // The app answered the question with `false` above. If the veto had not travelled, this
    // window would be gone and `evaluate` would reject.
    expect(await page.evaluate(() => document.querySelectorAll('.tabs__tab').length)).toBe(1);
    expect(await page.evaluate(() => document.title)).toBeTruthy();
  });

  it('asks again on the next attempt, because a no is not a permanent veto', async () => {
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });
    await page.waitForTimeout(500);

    // Two boxes since `captureBoxes` reset the list, which is the proof the guard did not
    // latch on the refusal — an app that could only be asked once would be an app that can
    // never be quit without a restart.
    expect(await boxes(app)).toHaveLength(2);
  });

  it('asks for the window button too, which is the door the card is named after', async () => {
    // **Measured, not assumed.** With `mainWindow.on('close')` removed and only `before-quit`
    // left, every other case in this file still passed — `app.quit()` reaches `before-quit`
    // directly. On win32 and linux the X button destroys the renderer first and only then
    // arrives there, so the guard would have nobody to ask and the app would go silently.
    // This is the only case that fails when that hook is gone.
    await captureBoxes(app, false);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await page.waitForTimeout(500);

    expect(await boxes(app)).toHaveLength(1);
    // And the veto travelled: the window is still there to answer.
    expect(await page.evaluate(() => document.querySelectorAll('.tabs__tab').length)).toBe(1);
  });

  it('goes on a yes', async () => {
    await captureBoxes(app, true);
    const gone = app.waitForEvent('close');
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });
    await gone;
    closed = true;

    expect(closed).toBe(true);
  });
});

/**
 * The card, end to end (TYTO-147, ADR 0031).
 *
 * **A third launch, and the reason is the file's own**: the describes above end with an app
 * that has been told to go and went. This one needs a window that is still there to be
 * measured, and it needs it while a box is on screen.
 *
 * **The test that answers fast proves nothing here.** Every other case in this file replaces
 * `showMessageBox` with a resolved promise, so main's clock never got to run out — which is how
 * a guard that took a person's tabs at two seconds shipped under a green suite. This one takes
 * four seconds to answer, deliberately more than the two the deadline is set to, and looks at
 * the app in between.
 *
 * Margins are wide and nothing here asserts a stopwatch: 4 s of box, observed at 3 s. What is
 * asserted is that the window **answers** and still holds its text, because that is the claim —
 * not that anything happened at a particular instant on a CI machine under load.
 */
describe('quitting while somebody is still reading the box', () => {
  let app: ElectronApplication;
  let page: Page;

  beforeAll(async () => {
    ({ app, page } = await launch('slow'));
    await page.click('#editor .cm-content');
    await page.keyboard.type('::titulo Campanha');
    await page.waitForSelector('.tabs__dirty');
  });

  afterAll(async () => {
    // **The box has to be put back before the app can be closed at all**, and finding that out
    // is itself a measurement of the fix: with the slow stub still installed, `app.close()`
    // sat for the full 300 s hook timeout, because a dirty window now refuses the exit for as
    // long as the person takes — and this "person" answers cancel, every time, forever.
    await captureBoxes(app, true);
    await app?.close();
  });

  it('is still running, with the text intact, after the deadline has passed', async () => {
    await captureSlowBoxes(app, false, 4000);
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });

    // Past the two seconds the acknowledgement is bounded by, and still well inside the box.
    // Before this card the app was gone by now and every line below rejected against a closed
    // target — with the typed text never written anywhere.
    await page.waitForTimeout(3000);

    expect(await boxes(app)).toHaveLength(1);
    expect(await page.evaluate(() => document.querySelectorAll('.tabs__tab').length)).toBe(1);
    expect(await page.evaluate(() => document.querySelectorAll('.tabs__dirty').length)).toBe(1);
    expect(await page.evaluate(() => document.querySelector('.cm-content')?.textContent)).toContain(
      'Campanha',
    );
  });

  it('honours the answer whenever it finally arrives', async () => {
    // The box resolves at 4 s with cancel. An answer arriving that long after the question is
    // still the answer: the guard has no clock running by then, and a `no` leaves the app up
    // and unlatched.
    await page.waitForTimeout(2000);

    expect(await page.evaluate(() => document.querySelectorAll('.tabs__tab').length)).toBe(1);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  });
});

describe('quitting with nothing unsaved', () => {
  it('does not ask at all', async () => {
    const { app } = await launch('clean');
    const marker = join(scratch, 'asked.txt');

    // Recorded to **disk** and not to a global, because the app is gone by the time there is
    // anything to assert: reading `globalThis` out of a closed Electron is not a measurement,
    // it is a rejected promise. The file is the one witness that outlives the process.
    await app.evaluate(({ dialog }, file) => {
      dialog.showMessageBox = ((): Promise<unknown> => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('node:fs') as { appendFileSync: (to: string, data: string) => void };
        fs.appendFileSync(file, 'asked');
        // Answering **no**, deliberately. A window that asked anything would refuse the exit
        // and still be running, so the close below would never resolve.
        return Promise.resolve({ response: 0, checkboxChecked: false });
      }) as never;
    }, marker);

    const gone = app.waitForEvent('close');
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });
    await gone;

    expect(existsSync(marker)).toBe(false);
  });
});
