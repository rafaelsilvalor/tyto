import type { ElectronApplication, Page } from 'playwright';

/**
 * How long a launched app may take to show its first window, for every suite (TYTO-231).
 *
 * **Why not Playwright's default.** `firstWindow()` waits 30 s unless told otherwise, and every
 * suite used to leave it at that. On a loaded development machine a start sometimes takes
 * longer: `installed-plugins` failed at 30 s in a whole `test:desktop` run beside other
 * sessions, and `panel-plugin` failed 1 run in 10 under a 12-thread CPU burner — both in a
 * hook with 270 s of its 300 s budget still unused, both green when run again.
 *
 * **Why 60 s and not the hook budget.** Four of the calls do not run in a hook but inside a
 * test (a relaunch to prove a restart, the dock's and the quit suite's `launch()` helpers),
 * and a test has 120 s (`vitest.desktop.config.ts`). 60 s doubles the default that failed and
 * still leaves a test half its budget for the launch and what follows, so a window that never
 * comes fails with Playwright's own "waiting for event \"window\"" rather than a test or hook
 * timeout that names nothing.
 *
 * **Why a hook that waits for it may not set a timeout below 180 s.** Nine launching hooks
 * used to pass their own 120 s. Inside that, the launch (30 s), this wait (60 s) and the two
 * `waitForSelector` calls most hooks make next (30 s each) add up to 150 s, so a start that was
 * slow at every step — `panel-plugin`, 1 run in 10 under the burner, after this deadline
 * existed — ended in an anonymous "Hook timed out in 120000ms" before any named wait could
 * fail. Those hooks now take the config's 300 s, and `launch-isolation.test.ts` refuses a hook
 * that calls `firstWindow(` with less than {@link MINIMUM_LAUNCH_HOOK_TIMEOUT_MS}.
 *
 * A green run never waits for this: the call returns the moment the window exists.
 */
export const FIRST_WINDOW_TIMEOUT_MS = 60_000;

/** The least a hook that waits for the first window may give itself: 150 s of steps, and slack. */
export const MINIMUM_LAUNCH_HOOK_TIMEOUT_MS = 180_000;

/**
 * The first window of `app`, waited for under {@link FIRST_WINDOW_TIMEOUT_MS}.
 *
 * `launch-isolation.test.ts` fails any suite that calls `.firstWindow(` itself. It scans only
 * `*.test.ts`, which is why the one direct call below is allowed: this file is where the rule
 * sends everybody, not a suite the rule forgot.
 */
export async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow({ timeout: FIRST_WINDOW_TIMEOUT_MS });
  answerDialogsQuietly(page);
  await page.emulateMedia({ colorScheme: null });
  return page;
}

/*
 * Why every launch hands the colour scheme back to Electron (TYTO-284).
 *
 * Playwright's `_electron` emulates `prefers-color-scheme: light` on every page it drives
 * unless told otherwise, and an emulated value outranks what Electron answers from
 * `nativeTheme`. Main does not see the emulation: on a machine whose system is dark the page
 * went light while main painted the title bar's system buttons dark. Measured on 6e2e350 with
 * `PrintWindow`, title-bar background against close-button background: #ebebec / #2f343e under
 * Playwright's default, #2f343e / #2f343e without it, and the app launched without Playwright
 * consistent in both themes. So the app was right and the tests were looking at a window no
 * person sees. `null` drops the emulation, which is what the four suites that cared already did
 * one by one; `window.desktop.test.ts` holds that the page and `nativeTheme` agree.
 *
 * A suite that wants a fixed scheme still calls `page.emulateMedia({ colorScheme: 'dark' })`
 * itself, and `launch-isolation.test.ts` asks for a `// scheme:` comment saying why.
 */

/**
 * Playwright's own answers to the page's dialogs, minus a rejection nobody can catch (TYTO-250).
 *
 * The window vetoes every unload it did not start, so that its own `window.close()` reaches the
 * quit latch (`holdPageClose`). Electron answers that veto in main, on `will-prevent-unload`,
 * before anything else hears of it — but the DevTools protocol still reports a `beforeunload`
 * dialog, Playwright answers it by default, and by then there is no dialog: "No dialog is
 * showing", unhandled, and Vitest fails the file with every assertion green — 9 errors over 4
 * passing tests in `page-close.desktop.test.ts`. A listener of our own takes over Playwright's
 * default — accept a `beforeunload`, dismiss the rest, as it does — and drops that one rejection.
 */
function answerDialogsQuietly(page: Page): void {
  page.on('dialog', (dialog) => {
    const answered = dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss();
    answered.catch(() => undefined);
  });
}
