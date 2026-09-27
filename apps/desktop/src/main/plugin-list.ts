import { homedir } from 'node:os';
import { join } from 'node:path';

import { htmlExporterManifest } from '@tyto/export-html';
import { svgExporterManifest } from '@tyto/export-svg';
import {
  type InstalledPlugin,
  PLUGIN_API_VERSION,
  type PluginStore,
  checkStoredPlugin,
  validatePluginManifest,
} from '@tyto/plugin-api';

import type { IpcResponse } from '../../shared/ipc.js';

/**
 * What the plugins screen lists: the built-ins this app activated and what `tyto plugin
 * install` put under `~/.tyto` (TYTO-47, `docs/plugin-api.md` Lifecycle).
 *
 * **The same list the CLI prints, read the same way.** Every installed folder goes through
 * `checkStoredPlugin` — manifest, engine, approval — and none of its code is imported:
 * listing must not be the thing that runs a plugin. The desktop does not activate installed
 * plugins at all yet; that is the desktop half of TYTO-48, where activation happens in a
 * `utilityProcess` and never in main.
 */

export type PluginRow = IpcResponse<'plugins:list'>['plugins'][number];

/**
 * `~/.tyto`, or wherever `TYTO_HOME` points (`docs/plugin-api.md`).
 *
 * One variable both apps read, so the CLI and the window always agree about which plugins
 * are installed — and so an end-to-end suite can point the window at a folder of its own
 * instead of at somebody's real one.
 */
export function tytoHome(environment: NodeJS.ProcessEnv = process.env): string {
  const named = environment['TYTO_HOME'];
  return named !== undefined && named !== '' ? named : join(homedir(), '.tyto');
}

/**
 * The two exporters, which this app activates per export rather than at startup
 * (`src/main/export.ts`), so the startup host's `registry.plugins()` never holds them.
 *
 * Listed anyway, because they are built-ins this app runs, and a screen that left them out
 * would say the desktop has fewer plugins than `tyto plugin list` — for the same app code.
 * Validated through the schema like every other manifest, and a failure throws: a manifest
 * this repository ships is a wiring bug, not something a person can fix.
 */
export function exporterBuiltIns(): readonly InstalledPlugin[] {
  return [htmlExporterManifest, svgExporterManifest].map((document) => {
    const validated = validatePluginManifest(document);
    if (!validated.ok) {
      throw new TypeError(
        `A built-in exporter ships a tyto-plugin.json the schema refuses: ${validated.error
          .map((item) => item.message)
          .join(' ')}`,
      );
    }
    return { manifest: validated.value, origin: 'built-in' };
  });
}

export async function listPlugins(
  builtIns: readonly InstalledPlugin[],
  store: PluginStore,
): Promise<readonly PluginRow[]> {
  const rows: PluginRow[] = builtIns.map(({ manifest }) => ({
    name: manifest.name,
    version: manifest.version,
    origin: 'built-in',
    status: 'enabled',
    contributes: [...manifest.contributes],
    permissions: [...manifest.permissions],
    problems: [],
  }));

  const [state, stored] = await Promise.all([store.readState(), store.list()]);

  for (const plugin of stored) {
    if (!state.ok) {
      // A state file nobody can read approves nothing, so every folder is refused by it.
      rows.push({
        name: plugin.folder,
        version: null,
        origin: 'external',
        status: 'refused',
        contributes: [],
        permissions: [],
        problems: state.error.map((problem) => problem.message),
      });
      continue;
    }

    const checked = checkStoredPlugin(plugin, state.value, PLUGIN_API_VERSION);
    if (!checked.ok) {
      rows.push({
        name: plugin.folder,
        version: null,
        origin: 'external',
        status: 'refused',
        contributes: [],
        permissions: [],
        problems: checked.error.map((problem) => problem.message),
      });
      continue;
    }

    const manifest = checked.value;
    rows.push({
      name: manifest.name,
      version: manifest.version,
      origin: 'external',
      status: state.value.plugins[plugin.folder]?.enabled === true ? 'enabled' : 'disabled',
      contributes: [...manifest.contributes],
      permissions: [...manifest.permissions],
      problems: [],
    });
  }

  return rows;
}
