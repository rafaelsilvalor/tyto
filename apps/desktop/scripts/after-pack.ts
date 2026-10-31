import { chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * electron-builder's `afterPack` hook: makes node-pty's prebuilt `spawn-helper` executable in
 * the packed macOS app (TYTO-510, ADR 0164).
 *
 * node-pty's tarball installs `prebuilds/darwin-*\/spawn-helper` as `-rw-r--r--`, measured on
 * both Mac runners, and the packaged copy keeps that mode. node-pty runs it to start every
 * shell, so without the execute bit the terminal answers `posix_spawnp failed.` and nothing
 * else. A hook rather than a CI step because every packaging path runs it: `test:package`,
 * `desktop.yml`'s gate and installers, and a tag's release.
 *
 * It runs before signing and before the fuses are flipped. On macOS electron-builder calls it
 * for the x64 slice, the arm64 slice and the joined universal app, and each gets the bit.
 * Windows and Linux carry no `spawn-helper`, so there it does nothing.
 */
export interface PackContext {
  appOutDir: string;
  electronPlatformName: string;
  packager: { appInfo: { productFilename: string } };
}

/** The two calls the hook makes, injectable so a test can read the modes on any platform. */
export interface HookFileSystem {
  readdir: (path: string) => Promise<string[]>;
  chmod: (path: string, mode: number) => Promise<void>;
}

const nodeFileSystem: HookFileSystem = { readdir, chmod };

/**
 * Sets `0o755` on every `prebuilds/darwin-*\/spawn-helper` in the packed app and answers the
 * paths it set. Throws when a macOS app carries none: that package would have a terminal that
 * cannot start a shell, and the packaging should fail rather than ship it.
 */
export async function makeSpawnHelperExecutable(
  context: PackContext,
  fileSystem: HookFileSystem = nodeFileSystem,
): Promise<string[]> {
  if (context.electronPlatformName !== 'darwin') return [];
  const prebuilds = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds',
  );
  const helpers = (await fileSystem.readdir(prebuilds))
    .filter((folder) => folder.startsWith('darwin-'))
    .map((folder) => join(prebuilds, folder, 'spawn-helper'));
  if (helpers.length === 0) {
    throw new Error(`no node-pty darwin prebuilds under ${prebuilds}`);
  }
  for (const helper of helpers) await fileSystem.chmod(helper, 0o755);
  return helpers;
}

export default async function afterPack(context: PackContext): Promise<void> {
  await makeSpawnHelperExecutable(context);
}
