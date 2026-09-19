import { join } from 'node:path';

/**
 * Where this app's data lives, decided once so that two versions on one machine cannot
 * read each other's (TYTO-150, ADR 0032).
 *
 * **No Electron import**, like `quit.ts` and `credentials.ts` before it (ADR 0010): the three
 * things this decision needs — the platform's app-data root, the running version, and whether
 * somebody named a folder on the command line — arrive as strings, and the composition root is
 * the only place that knows how to ask Electron for them. That is what lets the path be
 * asserted in a unit test instead of inferred from a launched binary.
 */

/**
 * The product root every version's folder sits inside.
 *
 * **A literal, and deliberately not `app.getName()`.** `getName()` answers with the *package*
 * name, and this package is called `@tyto/desktop`; electron-builder ships the app under
 * `productName: Tyto`. Those two disagreeing is what put the 0.3.0 portable's data in
 * `%APPDATA%\@tyto\desktop` while `docs/releases/desktop-v0.3.0.md` sent testers to
 * `%APPDATA%\Tyto\logs` — measured by reading `package.json` out of the shipped `app.asar`,
 * which answers `@tyto/desktop`, and that was TYTO-149's open question. Naming the root here
 * settles it in the direction a person can read, and `user-data.test.ts` fails if this string
 * and `electron-builder.yml` ever drift apart.
 *
 * Renaming the package would otherwise have moved everybody's settings, which is not a
 * consequence a `package.json` edit should be able to have.
 */
export const PRODUCT_NAME = 'Tyto';

/** What the composition root knows, expressed as values. */
export interface UserDataInputs {
  /** `app.getPath('appData')` — `%APPDATA%`, `~/Library/Application Support`, `~/.config`. */
  readonly appData: string;
  /** `app.getVersion()`, the full version: a beta tester's `0.3.1` is not their `0.3.0`. */
  readonly version: string;
  /**
   * The value of `--user-data-dir` when the process was launched with it, else `undefined`.
   *
   * Electron has already applied the switch by the time anything here runs, so this is not a
   * path to compose with — it is the one case where the answer is *leave it alone*.
   */
  readonly explicitUserDataDir: string | undefined;
}

/**
 * The folder to move `userData` to, or `undefined` when it must not be moved.
 *
 * **`undefined` is the end-to-end suites.** Fourteen of them launch the app with
 * `--user-data-dir` pointing at a scratch folder, which is how "restart and the list is still
 * there" means what it says and how one suite's layout cannot reach another's. Overwriting a
 * folder somebody named on the command line would take that isolation away silently — the
 * suites would still pass for a while, sharing one folder, and the day they stopped the reason
 * would be in a file none of them mention.
 *
 * Honouring the switch is also just what the switch means. It is Chromium's own, not a seam
 * this app invented, and a program that ignores it is lying to whoever typed it.
 */
export function chooseUserDataPath(inputs: UserDataInputs): string | undefined {
  if (inputs.explicitUserDataDir !== undefined) return undefined;
  return join(inputs.appData, PRODUCT_NAME, inputs.version);
}
