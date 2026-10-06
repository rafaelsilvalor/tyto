import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Puts the Electron binary on disk once, before any suite launches it (TYTO-235).
 *
 * `pnpm install` downloads nothing for `electron`: its `index.js` fetches and unzips the
 * binary on the first `require('electron')`, which in this suite is the first launch.
 * With one file at a time that is harmless. With three workers on CI, the first three
 * files each found `dist/electron` missing at the same moment, each started the download,
 * and one spawned the executable while another was still writing it — `electron.launch:
 * spawn ETXTBSY` in exactly those three files, every other file green.
 *
 * A global setup runs in the main process before any worker starts, so the download
 * happens here, once. The require is synchronous all the way down — `index.js` runs
 * `install.js` through `spawnSync`, and that child exits only after the unzip — and the
 * check below is what makes that a measured fact rather than a read one: the setup fails,
 * with its own message, unless the path it was handed is an executable file.
 */
export default function ensureElectronBinary(): void {
  const require = createRequire(import.meta.url);
  const binary = require('electron') as unknown;
  if (typeof binary !== 'string') {
    throw new Error(
      `electron-binary.global-setup: require('electron') returned ${typeof binary}, not a path`,
    );
  }
  try {
    accessSync(binary, constants.X_OK);
  } catch (cause) {
    throw new Error(
      `electron-binary.global-setup: the Electron binary is not an executable file at ${binary}`,
      { cause },
    );
  }
}
