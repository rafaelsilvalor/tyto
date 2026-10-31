import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeSpawnHelperExecutable, type HookFileSystem, type PackContext } from './after-pack.js';

function context(electronPlatformName: string): PackContext {
  return {
    appOutDir: join('release', 'mac-universal'),
    electronPlatformName,
    packager: { appInfo: { productFilename: 'Tyto' } },
  };
}

/** A file system that answers `folders` for any directory and records every chmod. */
function recording(folders: string[]): HookFileSystem & { modes: [string, number][] } {
  const modes: [string, number][] = [];
  return {
    modes,
    readdir: async () => folders,
    chmod: async (path, mode) => {
      modes.push([path, mode]);
    },
  };
}

const prebuilds = join(
  'release',
  'mac-universal',
  'Tyto.app',
  'Contents',
  'Resources',
  'app.asar.unpacked',
  'node_modules',
  'node-pty',
  'prebuilds',
);

describe('the afterPack hook (TYTO-510)', () => {
  it("sets 0o755 on each darwin prebuild's spawn-helper in the packed app", async () => {
    const fileSystem = recording(['darwin-arm64', 'darwin-x64']);

    await makeSpawnHelperExecutable(context('darwin'), fileSystem);

    expect(fileSystem.modes).toEqual([
      [join(prebuilds, 'darwin-arm64', 'spawn-helper'), 0o755],
      [join(prebuilds, 'darwin-x64', 'spawn-helper'), 0o755],
    ]);
  });

  it('touches nothing on Windows and Linux, which carry no spawn-helper', async () => {
    for (const platform of ['win32', 'linux']) {
      const fileSystem = recording(['darwin-arm64']);
      expect(await makeSpawnHelperExecutable(context(platform), fileSystem)).toEqual([]);
      expect(fileSystem.modes).toEqual([]);
    }
  });

  it('fails the packaging when a macOS app carries no darwin prebuild', async () => {
    await expect(makeSpawnHelperExecutable(context('darwin'), recording([]))).rejects.toThrow(
      /no node-pty darwin prebuilds/u,
    );
  });
});
