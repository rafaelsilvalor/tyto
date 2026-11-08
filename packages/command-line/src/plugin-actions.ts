import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import { PLUGIN_MANIFEST_FILE } from '@tyto/io';
import {
  PLUGIN_API_VERSION,
  type PluginManifest,
  checkInstallable,
  validatePluginManifest,
  withPluginEntry,
} from '@tyto/plugin-api';

import { readInstalledPlugins, writeCrash } from './plugins/external.js';
import { type PluginSourceKind, fetchPlugin } from './plugins/fetch.js';
import { BUILT_IN_MANIFESTS } from './plugins/index.js';

/**
 * Installing a plugin and changing one that is installed, as steps that answer a `Result`
 * and print nothing (TYTO-373).
 *
 * `tyto plugin install|remove|disable|enable` wraps them with its terminal: the permission
 * prompt, the `[y/N]`, the exit code. The window's plugins screen wraps the same steps with a
 * native box, so the validation, the refusals and what lands in `plugins.json` are one
 * implementation behind both apps, as ADR 0044 made the loader one.
 *
 * **Nothing is copied before somebody approves.** `approve` is asked after the manifest has
 * passed every check and before the store is touched; any answer but `true` installs nothing.
 */

/** The names no install may take: the built-ins', which ship inside Tyto. */
export function builtInPluginNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const manifest of BUILT_IN_MANIFESTS) {
    const validated = validatePluginManifest(manifest);
    if (validated.ok) names.add(validated.value.name);
  }
  return names;
}

export interface InstallPluginOptions {
  /** The folder holding `plugins/` and `plugins.json`: `TYTO_HOME`. */
  readonly home: string;
  /** What a relative `source` is relative to. */
  readonly cwd: string;
  /** `environment.shellRefusal`: set, a source that would need a shell is refused with it. */
  readonly shellRefusal?: string;
  /**
   * Asked once the manifest passed every check, with the manifest and the source as given.
   * Only `true` installs; a dismissed box or a closed terminal must answer `false`.
   */
  readonly approve: (manifest: PluginManifest, source: string) => Promise<boolean>;
}

export type InstallPluginAnswer =
  | {
      readonly status: 'installed';
      readonly manifest: PluginManifest;
      readonly kind: PluginSourceKind;
    }
  | {
      readonly status: 'declined';
      readonly manifest: PluginManifest;
      readonly kind: PluginSourceKind;
    };

/**
 * Fetches `source` (a folder, a `.tgz` archive, a git URL or an npm spec), checks its
 * manifest against this Tyto, asks `approve`, and only then copies it into `home` and records
 * exactly the permissions that were shown. Installing a name already installed is how an
 * update lands, and how new permissions get approved; a built-in's name is never available.
 */
export async function installPlugin(
  source: string,
  options: InstallPluginOptions,
): Promise<Result<InstallPluginAnswer, Diagnostics>> {
  const installed = await readInstalledPlugins(options.home);
  const state = installed.state;
  if (state === undefined) return err(installed.stateProblems);

  const fetched = await fetchPlugin(
    source,
    options.cwd,
    options.shellRefusal === undefined ? {} : { shellRefusal: options.shellRefusal },
  );
  if (!fetched.ok) return fetched;
  const { kind } = fetched.value;

  try {
    const manifestPath = join(fetched.value.directory, PLUGIN_MANIFEST_FILE);
    let manifestSource: string;
    try {
      manifestSource = await readFile(manifestPath, 'utf8');
    } catch {
      return err([
        diagnostic('E_PLUGIN_FETCH', { source, problem: `it has no ${PLUGIN_MANIFEST_FILE}` }),
      ]);
    }

    const checked = checkInstallable(manifestSource, manifestPath, PLUGIN_API_VERSION);
    if (!checked.ok) return checked;
    const manifest = checked.value;

    if (builtInPluginNames().has(manifest.name)) {
      return err([
        diagnostic('E_PLUGIN_NAME_TAKEN', { plugin: manifest.name, origin: 'built-in' }),
      ]);
    }

    // Strictly `true`: an approval box that resolves with nothing has not approved anything.
    if ((await options.approve(manifest, source)) !== true) {
      return ok({ status: 'declined', manifest, kind });
    }

    const added = await installed.store.add(manifest.name, fetched.value.directory);
    if (!added.ok) return added;
    await installed.store.writeState(
      withPluginEntry(state, manifest.name, {
        enabled: true,
        permissions: manifest.permissions,
        source,
      }),
    );
    // A new install is new code: the old one's crash is not its history.
    await writeCrash(installed.store, manifest.name, undefined);
    return ok({ status: 'installed', manifest, kind });
  } finally {
    await fetched.value.cleanup();
  }
}

export type PluginStateChange = 'remove' | 'disable' | 'enable';

/**
 * `remove`, `disable` and `enable`: one entry of `plugins.json`, and for `remove` its folder.
 * Takes effect the next time plugins are started; nothing running is stopped here.
 */
export async function changePluginState(
  change: PluginStateChange,
  name: string,
  options: { readonly home: string },
): Promise<Result<{ readonly change: PluginStateChange; readonly name: string }, Diagnostics>> {
  const installed = await readInstalledPlugins(options.home);
  const state = installed.state;
  if (state === undefined) return err(installed.stateProblems);

  const entry = state.plugins[name];
  const folder = installed.entries.some((item) => item.folder === name);
  // A folder with no entry can still be removed — that is how somebody cleans up a folder
  // copied in by hand — but it cannot be enabled, because nobody approved it.
  if (entry === undefined && !(change === 'remove' && folder)) {
    return err([diagnostic('E_PLUGIN_NOT_INSTALLED', { plugin: name })]);
  }

  if (change === 'remove') {
    await installed.store.remove(name);
    await installed.store.writeState(withPluginEntry(state, name, undefined));
  } else if (entry !== undefined) {
    await installed.store.writeState(
      withPluginEntry(state, name, { ...entry, enabled: change === 'enable' }),
    );
  }
  // Enabling and removing clear a recorded crash: somebody looked, and chose.
  if (change !== 'disable') await writeCrash(installed.store, name, undefined);
  return ok({ change, name });
}
