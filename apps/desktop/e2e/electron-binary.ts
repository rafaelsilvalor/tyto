import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the e2e global setup finds the Electron binary (TYTO-327).
 *
 * `ELECTRON_OVERRIDE_DIST_PATH` is how a worktree with no Electron of its own reuses the main
 * checkout's `dist` folder. Electron's own `index.js` honours it by joining the folder with the
 * name it reads from `path.txt` — and falling back to `'electron'` when there is no `path.txt`,
 * which is exactly the case of a worktree that never downloaded the binary. On Windows that
 * fallback names `…/dist/electron`, with no `.exe`, and the setup's executable check refuses it.
 * So with the override set, the name comes from the platform, the way Electron's `install.js`
 * writes `path.txt` (`getPlatformPath`), and `path.txt` is not read at all.
 */

/** The executable's path inside Electron's `dist` folder, as `install.js` names it. */
export function electronExecutableName(platform: NodeJS.Platform | string): string {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error(`electron-binary: Electron builds are not available on platform ${platform}`);
  }
}

export const OVERRIDE_VARIABLE = 'ELECTRON_OVERRIDE_DIST_PATH';

/**
 * The binary the suites will launch. Without the override this is `require('electron')`, as
 * before — which also downloads the binary the first time (TYTO-235), and is the only path CI
 * takes. With it, a folder that does not exist fails here, naming the variable, instead of as
 * an executable check on a path nobody typed.
 */
export function resolveElectronBinary(
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform | string,
  requireElectron: () => unknown,
): unknown {
  const override = environment[OVERRIDE_VARIABLE];
  if (override === undefined || override === '') return requireElectron();
  if (!existsSync(override)) {
    throw new Error(`${OVERRIDE_VARIABLE} points at ${override}, which does not exist`);
  }
  return join(override, electronExecutableName(platform));
}
