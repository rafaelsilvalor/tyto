import { type Diagnostic, type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';

import { satisfiesEngine } from './engine.js';
import { type PluginManifest, parsePluginManifest } from './manifest.js';
import type { PluginCrashes } from './crashes.js';
import type { PluginState } from './state.js';

/**
 * The half of the loader that reads no disk (E11.1, `docs/plugin-api.md` Lifecycle).
 *
 * Everything a plugin can be refused for before a line of its code runs is decided here,
 * from strings: its manifest, the engine it asks for, and whether what it asks for now is
 * what somebody approved. The app that composes this reads the folders and imports the
 * code; this package stays pure (ADR 0010), and the rules are the same in both hosts.
 */

/** One folder under `plugins/`, as the app found it. */
export interface StoredPlugin {
  /** The folder's name, which install made the plugin's name. */
  readonly folder: string;
  /** Its `tyto-plugin.json`, or `undefined` when the folder has none. */
  readonly manifestSource: string | undefined;
}

/**
 * Where installed plugins live, as the loader asks it (`docs/plugin-api.md`, Lifecycle).
 *
 * A port, declared here because the loader's rules are what consume it and they are pure;
 * the folder under `~/.tyto/` is `fsPluginStore` in `@tyto/io`, composed by each app. A
 * test answers from a `Map`.
 *
 * Every method rejects on a failure the operating system reports — a disk that is full, a
 * folder somebody locked — the category `core`'s `FileSystem` port rejects on too. What the
 * loader can be *told* about (a manifest, an approval) comes back as data.
 */
export interface PluginStore {
  /** Every folder under `plugins/`, in name order, with its manifest if it has one. */
  list(): Promise<readonly StoredPlugin[]>;
  /** The approval state; an absent file is {@link EMPTY_PLUGIN_STATE}, not an error. */
  readState(): Promise<Result<PluginState, Diagnostics>>;
  writeState(state: PluginState): Promise<void>;
  /**
   * The crash history; an absent file is {@link EMPTY_PLUGIN_CRASHES}, not an error.
   *
   * Apart from the state on purpose (ADR 0041): only `plugin list` reads it, and nothing
   * that decides whether a plugin loads.
   */
  readCrashes(): Promise<Result<PluginCrashes, Diagnostics>>;
  writeCrashes(crashes: PluginCrashes): Promise<void>;
  /**
   * Copies a folder in as `plugins/<name>/`, replacing whatever was there.
   *
   * Replacing, because the caller has already decided — `install` refuses a name that is
   * taken before it gets this far, and reinstalling to approve new permissions is the one
   * case where somebody asked for the old files to go.
   *
   * A folder it will not copy — a link in it that leads outside it — is an `Err` naming the
   * file, and nothing is replaced (TYTO-50). That is a person's folder being refused, which
   * ADR 0011 makes exit 1, not a failure of the program.
   */
  add(name: string, from: string): Promise<Result<void, Diagnostics>>;
  remove(name: string): Promise<void>;
  /** The folder a plugin's files are in, for the host that imports its code. */
  directoryOf(name: string): string;
  /**
   * Every link in an installed plugin's folder that leads outside it, or nowhere, as
   * `E_PLUGIN_LINK`; empty when there is none. Asked before the plugin's process starts,
   * because the permission model follows a link out of the folder it granted (ADR 0049).
   */
  linksLeaving(name: string): Promise<Diagnostics>;
}

function refused(plugin: string, problem: string): Result<never, Diagnostics> {
  return err([diagnostic('E_PLUGIN_ACTIVATE', { plugin, problem })]);
}

/**
 * A manifest somebody wants to install, against the engine this host provides.
 *
 * The engine is checked **here, at install**, rather than only when the plugin loads: a
 * plugin nobody can activate is one install should not have copied, and the message names
 * both numbers so the person knows which of the two to change.
 */
export function checkInstallable(
  manifestSource: string,
  path: string,
  engineVersion: string,
): Result<PluginManifest, Diagnostics> {
  const parsed = parsePluginManifest(manifestSource, path);
  if (!parsed.ok) return parsed;

  const manifest = parsed.value;
  if (!satisfiesEngine(manifest.engine, engineVersion)) {
    return err([
      diagnostic('E_PLUGIN_ENGINE', {
        plugin: manifest.name,
        range: manifest.engine,
        version: engineVersion,
      }),
    ]);
  }
  return ok(manifest);
}

/**
 * An installed folder, before its code is imported.
 *
 * Checked again at every load, not only at install, because both sides move: a new Tyto
 * can leave a plugin's engine range behind, and a plugin updated in place can start asking
 * for a permission nobody granted. Neither is a reason to run it.
 */
export function checkStoredPlugin(
  stored: StoredPlugin,
  state: PluginState,
  engineVersion: string,
): Result<PluginManifest, Diagnostics> {
  const { folder } = stored;
  if (stored.manifestSource === undefined) {
    return refused(folder, 'its folder has no tyto-plugin.json');
  }

  const checked = checkInstallable(
    stored.manifestSource,
    `${folder}/tyto-plugin.json`,
    engineVersion,
  );
  if (!checked.ok) return checked;

  const manifest = checked.value;
  if (manifest.name !== folder) {
    return refused(
      folder,
      `it is installed as '${folder}' and its tyto-plugin.json names '${manifest.name}'`,
    );
  }

  const entry = state.plugins[folder];
  if (entry === undefined) {
    // A folder copied in by hand. Nobody was shown its permissions, so nobody approved them.
    return refused(folder, 'its folder is here and tyto plugin install never recorded it');
  }

  const unapproved = manifest.permissions.filter(
    (permission) => !entry.permissions.includes(permission),
  );
  if (unapproved.length > 0) {
    return err([
      diagnostic('E_PLUGIN_PERMISSIONS_CHANGED', {
        plugin: folder,
        permissions: unapproved.map((permission) => `'${permission}'`).join(', '),
      }),
    ]);
  }

  return ok(manifest);
}

/**
 * Why a plugin did not load, as a render reports it.
 *
 * Each refusal is an error where somebody asked for the plugin by name — `install`,
 * `enable` — and a warning on a render, because the brief is not what is wrong and the run
 * goes on without it (ADR 0040). The original message rides along whole, so the warning
 * still says *which* id collided and with whom.
 */
export function skippedPluginWarnings(plugin: string, reasons: Diagnostics): Diagnostic[] {
  return reasons.map((reason) =>
    diagnostic('W_PLUGIN_SKIPPED', { plugin, reason: reason.message }),
  );
}
