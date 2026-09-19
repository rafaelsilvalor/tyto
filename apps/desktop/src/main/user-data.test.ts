import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRODUCT_NAME, chooseUserDataPath } from './user-data.js';

/**
 * The path two versions of the app are kept apart by (TYTO-150, ADR 0032).
 *
 * The composition root is where this is decided, so this is where it is proven — with the
 * product name and the version as inputs rather than as a folder somebody looks at after a
 * launch. What cannot be asserted here is the *moment* the path is set, and that moment is
 * load-bearing: `setPath` after `app.whenReady()` leaves Chromium's `Local State` behind in
 * the folder it had already opened. `index.ts` carries the measurement and does it at module
 * scope.
 */

const here = dirname(fileURLToPath(import.meta.url));
const builderConfig = join(here, '..', '..', 'electron-builder.yml');

describe('chooseUserDataPath', () => {
  it('puts every version in its own folder under one product root', () => {
    expect(
      chooseUserDataPath({
        appData: join('C:', 'Users', 'someone', 'AppData', 'Roaming'),
        version: '0.3.0',
        explicitUserDataDir: undefined,
      }),
    ).toBe(join('C:', 'Users', 'someone', 'AppData', 'Roaming', 'Tyto', '0.3.0'));
  });

  it('separates two versions on one machine, which is the whole of the card', () => {
    const appData = join('home', 'someone', '.config');
    const older = chooseUserDataPath({ appData, version: '0.3.0', explicitUserDataDir: undefined });
    const newer = chooseUserDataPath({ appData, version: '0.4.0', explicitUserDataDir: undefined });

    expect(older).not.toBe(newer);
    // Siblings under one root a person can find and delete whole, and not two unrelated
    // folders — that is what makes "import from the version before" a directory listing.
    expect(dirname(older ?? '')).toBe(dirname(newer ?? ''));
    expect(dirname(older ?? '')).toBe(join(appData, PRODUCT_NAME));
  });

  it('takes the full version, so a patch release starts clean', () => {
    const path = chooseUserDataPath({
      appData: join('home', 'someone', '.config'),
      version: '0.3.1',
      explicitUserDataDir: undefined,
    });

    expect(path?.endsWith(`${sep}0.3.1`)).toBe(true);
  });

  it('leaves a folder named on the command line alone', () => {
    // The fourteen end-to-end suites that pass `--user-data-dir` are this assertion. Electron
    // has already applied the switch, so the only correct answer is to set nothing.
    expect(
      chooseUserDataPath({
        appData: join('C:', 'Users', 'someone', 'AppData', 'Roaming'),
        version: '0.3.0',
        explicitUserDataDir: join('scratch', 'userData'),
      }),
    ).toBeUndefined();
  });
});

describe('the product root', () => {
  it('is the name electron-builder ships the app under', () => {
    // The drift this catches is the one that already happened: `app.getName()` answers with
    // the package name (`@tyto/desktop`), electron-builder ships `productName: Tyto`, and the
    // 0.3.0 release body named a third thing. Read rather than trusted, because a rename in
    // `electron-builder.yml` alone would otherwise move everybody's data folder in silence.
    const declared = /^productName:\s*(\S+)\s*$/m.exec(readFileSync(builderConfig, 'utf8'));

    expect(declared?.[1]).toBe(PRODUCT_NAME);
  });

  it('is not the package name, which is what put the data in the wrong place', () => {
    const packageName = JSON.parse(
      readFileSync(join(here, '..', '..', 'package.json'), 'utf8'),
    ) as { name: string };

    expect(packageName.name).toBe('@tyto/desktop');
    expect(PRODUCT_NAME).not.toBe(packageName.name);
  });
});
