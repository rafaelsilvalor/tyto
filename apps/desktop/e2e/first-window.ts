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
export function firstWindow(app: ElectronApplication): Promise<Page> {
  return app.firstWindow({ timeout: FIRST_WINDOW_TIMEOUT_MS });
}
