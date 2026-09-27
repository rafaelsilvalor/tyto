import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import type { Diagnostics, Result } from '@tyto/core';
import { ok } from '@tyto/core';
import {
  EMPTY_PLUGIN_CRASHES,
  EMPTY_PLUGIN_STATE,
  type PluginCrashes,
  type PluginState,
  type PluginStore,
  type StoredPlugin,
  parsePluginCrashes,
  parsePluginState,
  serializePluginCrashes,
  serializePluginState,
} from '@tyto/plugin-api';

/**
 * `@tyto/plugin-api`'s `PluginStore`, on a disk (`docs/plugin-api.md`, Lifecycle).
 *
 * ```
 * <home>/
 *   plugins.json          what install approved, per plugin
 *   crashes.json          when a plugin's process last ended unasked (ADR 0041)
 *   plugins/<name>/       tyto-plugin.json, dist/index.js, whatever else it ships
 * ```
 *
 * `<home>` is `~/.tyto` for both apps — the composition root decides, and a test hands a
 * temp folder. **The state file sits beside the folder rather than inside it**, so that
 * every entry of `plugins/` is a plugin and a listing never has to know one name to skip.
 */

export const PLUGINS_DIR = 'plugins';
export const PLUGIN_STATE_FILE = 'plugins.json';
export const PLUGIN_CRASHES_FILE = 'crashes.json';
export const PLUGIN_MANIFEST_FILE = 'tyto-plugin.json';

function isMissing(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    if (isMissing(cause)) return undefined;
    throw cause;
  }
}

/** Written beside itself and renamed, so a crash mid-write leaves the old file whole. */
async function writeAtomically(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.writing`;
  await writeFile(staging, text, 'utf8');
  await rename(staging, path);
}

export function fsPluginStore(home: string): PluginStore {
  const pluginsDirectory = join(home, PLUGINS_DIR);
  const statePath = join(home, PLUGIN_STATE_FILE);
  const crashesPath = join(home, PLUGIN_CRASHES_FILE);

  return {
    async list(): Promise<readonly StoredPlugin[]> {
      let entries;
      try {
        entries = await readdir(pluginsDirectory, { withFileTypes: true });
      } catch (cause) {
        // Nothing installed yet is the common case, not a failure.
        if (isMissing(cause)) return [];
        throw cause;
      }

      const folders = entries
        // A dot-folder is an install in progress (see `add`), never a plugin: a plugin name
        // cannot start with a dot.
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

      return Promise.all(
        folders.map(async (folder) => ({
          folder,
          manifestSource: await readIfPresent(join(pluginsDirectory, folder, PLUGIN_MANIFEST_FILE)),
        })),
      );
    },

    async readState(): Promise<Result<PluginState, Diagnostics>> {
      const source = await readIfPresent(statePath);
      return source === undefined ? ok(EMPTY_PLUGIN_STATE) : parsePluginState(source, statePath);
    },

    async writeState(state: PluginState): Promise<void> {
      await writeAtomically(statePath, serializePluginState(state));
    },

    async readCrashes(): Promise<Result<PluginCrashes, Diagnostics>> {
      const source = await readIfPresent(crashesPath);
      return source === undefined
        ? ok(EMPTY_PLUGIN_CRASHES)
        : parsePluginCrashes(source, crashesPath);
    },

    async writeCrashes(crashes: PluginCrashes): Promise<void> {
      await writeAtomically(crashesPath, serializePluginCrashes(crashes));
    },

    async add(name: string, from: string): Promise<void> {
      const target = join(pluginsDirectory, name);
      // Copied beside the target and swapped in, so an install that dies halfway leaves the
      // previous version whole rather than half of each.
      const staging = join(pluginsDirectory, `.${name}.installing`);
      await rm(staging, { recursive: true, force: true });
      await mkdir(pluginsDirectory, { recursive: true });
      await cp(from, staging, {
        recursive: true,
        // A fetched git checkout carries its history; nothing loads it and it is most of
        // the bytes.
        filter: (source) => !relative(from, source).split(/[\\/]/u).includes('.git'),
      });
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
    },

    async remove(name: string): Promise<void> {
      await rm(join(pluginsDirectory, name), { recursive: true, force: true });
    },

    directoryOf(name: string): string {
      return join(pluginsDirectory, name);
    },
  };
}
