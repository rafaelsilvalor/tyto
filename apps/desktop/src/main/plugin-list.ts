import { homedir } from 'node:os';
import { join } from 'node:path';

import { htmlExporterManifest } from '@tyto/export-html';
import { svgExporterManifest } from '@tyto/export-svg';
import { diagnostic } from '@tyto/core';
import {
  type InstalledPlugin,
  type PluginStore,
  readInstalledPlugins,
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
 * process of its own, on the bundled Node since TYTO-186, and never in main.
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

  // The same reader the CLI's `plugin list` and both apps' loaders use, so the screen and
  // the command cannot disagree about which folder is refused and why.
  const [installed, history] = await Promise.all([
    readInstalledPlugins(store),
    store.readCrashes(),
  ]);
  const crashes = history.ok ? history.value.crashes : {};

  for (const entry of installed.entries) {
    const manifest = entry.manifest;
    if (manifest === undefined) {
      rows.push({
        name: entry.folder,
        version: null,
        origin: 'external',
        status: 'refused',
        contributes: [],
        permissions: [],
        problems: entry.problems.map((problem) => problem.message),
      });
      continue;
    }

    // History and not a refusal (ADR 0041): a crashed plugin is still started, so it is
    // shown as crashed, with when and why, until it is enabled or installed again.
    const crash = crashes[entry.folder];
    const crashed = entry.enabled && crash !== undefined;
    rows.push({
      name: manifest.name,
      version: manifest.version,
      origin: 'external',
      status: crashed ? 'crashed' : entry.enabled ? 'enabled' : 'disabled',
      contributes: [...manifest.contributes],
      permissions: [...manifest.permissions],
      problems: crashed
        ? [diagnostic('W_PLUGIN_CRASHED', { plugin: entry.folder, ...crash }).message]
        : [],
    });
  }

  return rows;
}
