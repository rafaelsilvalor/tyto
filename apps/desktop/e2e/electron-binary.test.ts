import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  OVERRIDE_VARIABLE,
  electronExecutableName,
  resolveElectronBinary,
} from './electron-binary.js';

const dist = mkdtempSync(join(tmpdir(), 'tyto-electron-dist-'));
afterAll(() => rmSync(dist, { recursive: true, force: true }));

const unused = (): never => {
  throw new Error('require(electron) must not run when the override is set');
};

describe('electronExecutableName', () => {
  it('names the binary the way Electron install.js writes path.txt', () => {
    expect(electronExecutableName('win32')).toBe('electron.exe');
    expect(electronExecutableName('linux')).toBe('electron');
    expect(electronExecutableName('darwin')).toBe('Electron.app/Contents/MacOS/Electron');
  });

  it('refuses a platform Electron has no build for', () => {
    expect(() => electronExecutableName('aix')).toThrow(/aix/u);
  });
});

describe('resolveElectronBinary with ELECTRON_OVERRIDE_DIST_PATH', () => {
  it.each([
    ['win32', 'electron.exe'],
    ['linux', 'electron'],
    ['darwin', 'Electron.app/Contents/MacOS/Electron'],
  ])('joins the folder with the %s executable name', (platform, name) => {
    expect(resolveElectronBinary({ [OVERRIDE_VARIABLE]: dist }, platform, unused)).toBe(
      join(dist, name),
    );
  });

  it('fails naming the variable and the folder when the folder does not exist', () => {
    const missing = join(dist, 'not-here');
    expect(() => resolveElectronBinary({ [OVERRIDE_VARIABLE]: missing }, 'win32', unused)).toThrow(
      `${OVERRIDE_VARIABLE} points at ${missing}, which does not exist`,
    );
  });
});

describe('resolveElectronBinary without the override', () => {
  it.each([{}, { [OVERRIDE_VARIABLE]: '' }])('asks require(electron) once', (environment) => {
    const requireElectron = vi.fn(() => '/from/require');
    expect(resolveElectronBinary(environment, 'win32', requireElectron)).toBe('/from/require');
    expect(requireElectron).toHaveBeenCalledTimes(1);
  });
});
