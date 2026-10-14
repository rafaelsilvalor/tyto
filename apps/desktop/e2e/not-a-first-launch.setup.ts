import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { _electron } from 'playwright';

/**
 * Every suite's window is a second launch unless the suite asks for a first one (TYTO-287).
 *
 * **Why.** A first launch opens the preview to the side (ADR 0084 decision 8), and every suite
 * launches into a scratch `--user-data-dir` with no `session.json` — so every suite would be a
 * first launch. PR A measured what that costs: twelve suites with nothing to do with the preview
 * went red, counting groups, tabs or focus. The product rule stays as it is; the harness puts
 * the suites where a person is on every launch after their first.
 *
 * **How.** `_electron.launch` is wrapped once per test file (`setupFiles` in
 * `vitest.desktop.config.ts`). Before the app starts, it writes into the launch's
 * `--user-data-dir` the session a build that keeps groups writes for a window with nothing to
 * keep — no tabs, one empty group — **only when there is no `session.json` there yet**: a
 * relaunch into the same folder reads what the app itself wrote, and a suite that seeds its own
 * file, or puts a folder where the file goes, keeps it.
 *
 * **Why the harness and not the app.** The seam is test-side by construction: nothing in the
 * app reads a variable or a switch to skip the first launch, so the packaged app has no way to
 * be told to skip it. A suite that needs a real first launch passes
 * {@link FIRST_LAUNCH_VARIABLE} in its launch `env`, which only this wrapper reads.
 */

/** In a launch's `env`, `'1'` leaves the folder as it is: the app sees a real first launch. */
export const FIRST_LAUNCH_VARIABLE = 'TYTO_E2E_FIRST_LAUNCH';

/** The session `src/main/session.ts` writes for a window with nothing to keep (`NO_GROUPS`). */
const SECOND_LAUNCH_SESSION = {
  version: 1,
  tabs: [],
  active: 0,
  groups: { root: { tabs: [], active: 0 }, focused: 0 },
};

const USER_DATA_SWITCH = '--user-data-dir=';

type LaunchOptions = NonNullable<Parameters<typeof _electron.launch>[0]>;

/** The folder a launch names with `--user-data-dir=`, or undefined for one that names none. */
const userDataOf = (options: LaunchOptions | undefined): string | undefined =>
  options?.args
    ?.find((argument) => argument.startsWith(USER_DATA_SWITCH))
    ?.slice(USER_DATA_SWITCH.length);

function seedSecondLaunch(options: LaunchOptions | undefined): void {
  if (options?.env?.[FIRST_LAUNCH_VARIABLE] === '1') return;
  const userData = userDataOf(options);
  // A launch with no folder of its own is refused by `launch-isolation.test.ts` anyway, and the
  // real data folder is never written by a test.
  if (userData === undefined) return;
  const session = join(userData, 'session.json');
  if (existsSync(session)) return;
  mkdirSync(userData, { recursive: true });
  writeFileSync(session, JSON.stringify(SECOND_LAUNCH_SESSION), 'utf8');
}

// Once per process: Vitest runs this file before every test file, and Playwright is loaded by
// Node itself, so a worker that runs several files sees the same `_electron` each time.
const WRAPPED = Symbol.for('tyto.e2e.notAFirstLaunch');
const target = _electron as typeof _electron & { [WRAPPED]?: true };
if (target[WRAPPED] !== true) {
  const launch = _electron.launch.bind(_electron);
  target.launch = async (options) => {
    seedSecondLaunch(options);
    return launch(options);
  };
  target[WRAPPED] = true;
}
