import { isAbsolute, resolve } from 'node:path';

import { fsTrustStore } from '@tyto/io';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { formatDiagnostics } from './report.js';

/**
 * `tyto trust remove <folder>` — take back an approval (ADR 0111).
 *
 * Only the removing half lives on the command line in this card. Granting is the window's
 * (the banner on an open folder) or a hand edit of `trust.json`; a run that needs a folder
 * trusted without either passes `--trust`, which is never written down (ADR 0112).
 */
export async function trustRemoveCommand(
  folder: string,
  environment: CliEnvironment,
): Promise<ExitCode> {
  if (environment.home === undefined) {
    throw new TypeError(
      'This environment names no home folder, so there is no trust.json to edit. ' +
        'defaultEnvironment() sets ~/.tyto.',
    );
  }
  const path = isAbsolute(folder) ? folder : resolve(environment.cwd, folder);
  const removed = await fsTrustStore({ home: environment.home }).revoke(path);
  if (!removed.ok) {
    environment.console.err(formatDiagnostics(removed.error));
    return EXIT_DIAGNOSTICS;
  }
  environment.console.out(
    removed.value
      ? `No longer trusted: ${path}. It opens restricted from its next run.\n`
      : `Not trusted, so nothing to remove: ${path}.\n`,
  );
  return EXIT_OK;
}
