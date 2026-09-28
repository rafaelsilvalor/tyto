import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type Diagnostic, type Diagnostics, diagnostic } from '@tyto/core';
import { PLUGIN_MANIFEST_FILE } from '@tyto/io';
import {
  PLUGIN_API_VERSION,
  type PluginManifest,
  type PluginCrash,
  type PluginOrigin,
  type PluginState,
  checkInstallable,
  validatePluginManifest,
  withPluginEntry,
} from '@tyto/plugin-api';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK, type ExitCode } from './exit.js';
import { type InstalledPlugins, readInstalledPlugins, writeCrash } from './plugins/external.js';
import { fetchPlugin } from './plugins/fetch.js';
import { BUILT_IN_MANIFESTS } from './plugins/index.js';
import { formatDiagnostics, json } from './report.js';

/**
 * `tyto plugin list|install|remove|disable|enable` — the lifecycle in `docs/plugin-api.md`.
 *
 * **Listing reads; it does not run.** `list` validates every manifest through the same
 * schema a loaded plugin's goes through and checks every installed one against the engine
 * and its approval, and imports none of their code: listing what is installed must not be
 * the command that executes it. So `--active` means *would be activated* — enabled, and
 * passing every check that reads no code. A plugin whose ids collide is only found out when
 * it is activated, and a render names it then (`W_PLUGIN_SKIPPED`).
 *
 * `crashed` is the one status that is history rather than a verdict: a plugin whose worker
 * ended unasked on an earlier run, which a render still activates (ADR 0041).
 */

export interface PluginListOptions {
  readonly json: boolean;
  /** Only what a render would activate: no disabled plugin, no refused one; crashed ones stay. */
  readonly active?: boolean;
}

export interface PluginInstallOptions {
  /** Approve the permissions without asking — for a script, where nobody can answer. */
  readonly yes: boolean;
}

type PluginStatus = 'enabled' | 'disabled' | 'refused' | 'crashed';

/** One row of the listing. A refused folder may have no manifest to show. */
interface ListedPlugin {
  readonly name: string;
  readonly manifest?: PluginManifest;
  readonly origin: PluginOrigin;
  readonly status: PluginStatus;
  readonly crashed?: PluginCrash;
}

/** Left-pads to a common width so the columns line up without a table library. */
function column(values: readonly string[]): (value: string) => string {
  const width = Math.max(0, ...values.map((value) => value.length));
  return (value) => value.padEnd(width);
}

function formatList(plugins: readonly ListedPlugin[]): string {
  if (plugins.length === 0) return '';
  const versionOf = (plugin: ListedPlugin): string => plugin.manifest?.version ?? '-';
  const name = column(plugins.map((plugin) => plugin.name));
  const version = column(plugins.map(versionOf));
  const origin = column(plugins.map((plugin) => plugin.origin));
  const status = column(plugins.map((plugin) => plugin.status));

  return `${plugins
    .map(
      (plugin) =>
        `${name(plugin.name)}  ${version(versionOf(plugin))}  ${origin(plugin.origin)}  ` +
        `${status(plugin.status)}  ${plugin.manifest?.contributes.join(', ') ?? ''}`.trimEnd(),
    )
    .join('\n')}\n`;
}

function document(plugins: readonly ListedPlugin[]): unknown {
  return {
    status: 'ok',
    plugins: plugins.map((plugin) => ({
      name: plugin.name,
      version: plugin.manifest?.version ?? null,
      engine: plugin.manifest?.engine ?? null,
      contributes: plugin.manifest?.contributes ?? [],
      permissions: plugin.manifest?.permissions ?? [],
      origin: plugin.origin,
      status: plugin.status,
      crashed: plugin.crashed ?? null,
    })),
  };
}

function reportProblems(
  problems: Diagnostics,
  options: { readonly json: boolean },
  environment: CliEnvironment,
): void {
  if (options.json) environment.console.out(json({ status: 'error', plugins: [] }));
  environment.console.err(formatDiagnostics(problems));
}

function builtInManifests(): { manifests: PluginManifest[]; problems: Diagnostic[] } {
  const manifests: PluginManifest[] = [];
  const problems: Diagnostic[] = [];
  for (const manifest of BUILT_IN_MANIFESTS) {
    const validated = validatePluginManifest(manifest);
    if (validated.ok) {
      manifests.push(validated.value);
    } else {
      problems.push(...validated.error);
    }
  }
  return { manifests, problems };
}

export async function pluginListCommand(
  options: PluginListOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const builtIns = builtInManifests();
  if (builtIns.problems.length > 0) {
    // Exit 2, not 1. A diagnostic about a brief is something the caller can fix and retry;
    // a built-in shipping a manifest that does not validate is this repository's own bug,
    // and ADR 0011 reserves the retryable code for the first kind.
    reportProblems(builtIns.problems, options, environment);
    return EXIT_INTERNAL;
  }

  const listed: ListedPlugin[] = builtIns.manifests.map((manifest) => ({
    name: manifest.name,
    manifest,
    origin: 'built-in',
    status: 'enabled',
  }));

  const refusals: Diagnostic[] = [];
  if (environment.home !== undefined) {
    const installed = await readInstalledPlugins(environment.home);
    refusals.push(...installed.stateProblems);
    // History, read only here: nothing that decides whether a plugin loads reads it.
    const history = await installed.store.readCrashes();
    if (!history.ok) refusals.push(...history.error);
    const crashes = history.ok ? history.value.crashes : {};
    for (const installedEntry of installed.entries) {
      const crashed = crashes[installedEntry.folder];
      const entry = { ...installedEntry, ...(crashed === undefined ? {} : { crashed }) };
      const status: PluginStatus =
        entry.problems.length > 0
          ? 'refused'
          : !entry.enabled
            ? 'disabled'
            : entry.crashed === undefined
              ? 'enabled'
              : 'crashed';
      if (status === 'refused') refusals.push(...entry.problems);
      if (status === 'crashed' && entry.crashed !== undefined) {
        refusals.push(diagnostic('W_PLUGIN_CRASHED', { plugin: entry.folder, ...entry.crashed }));
      }
      listed.push({
        name: entry.folder,
        ...(entry.manifest === undefined ? {} : { manifest: entry.manifest }),
        ...(entry.crashed === undefined ? {} : { crashed: entry.crashed }),
        origin: 'external',
        status,
      });
    }
  }

  // A crashed plugin is still activated, so it is still active.
  const shown =
    options.active === true
      ? listed.filter((plugin) => plugin.status === 'enabled' || plugin.status === 'crashed')
      : listed;
  environment.console.out(options.json ? json(document(shown)) : formatList(shown));
  // Said, not hidden: a listing that shows `refused` or `crashed` owes the reason.
  if (refusals.length > 0 && options.active !== true) {
    environment.console.err(formatDiagnostics(refusals));
  }
  return EXIT_OK;
}

/* ------------------------------------------------------------------ the write half -- */

/** A plugin command needs a folder to work on; a test that gave none gets a clear refusal. */
function homeOf(environment: CliEnvironment): string {
  if (environment.home === undefined) {
    throw new TypeError(
      'This environment names no home folder for plugins, so there is nowhere to install ' +
        'one. defaultEnvironment() sets ~/.tyto.',
    );
  }
  return environment.home;
}

/** Reads the state, or reports why it cannot be read and answers nothing. */
function stateOf(
  installed: InstalledPlugins,
  environment: CliEnvironment,
): PluginState | undefined {
  if (installed.state !== undefined) return installed.state;
  environment.console.err(formatDiagnostics(installed.stateProblems));
  return undefined;
}

function fail(problems: Diagnostics, environment: CliEnvironment): ExitCode {
  environment.console.err(formatDiagnostics(problems));
  return EXIT_DIAGNOSTICS;
}

/**
 * The text the person approves. It names every permission, and it says plainly what the
 * plugin's process is and is not (ADR 0049): confined to its own folder by Node's permission
 * model, and not confined on the network, where `net:` permissions filter `host.fetch` only
 * (ADR 0042).
 */
function permissionPrompt(manifest: PluginManifest, source: string): string {
  const permissions =
    manifest.permissions.length === 0
      ? '  (none)\n'
      : manifest.permissions.map((permission) => `  - ${permission}\n`).join('');
  return (
    `${manifest.name} ${manifest.version} from ${source}\n` +
    `contributes: ${manifest.contributes.join(', ')}\n` +
    `permissions:\n${permissions}` +
    'Each plugin runs in a process of its own, so a crash stops the plugin and not Tyto.\n' +
    "Node's permission model confines that process to the plugin's own folder: it cannot\n" +
    'read your other files, write anywhere, or start programs. It is not confined on the\n' +
    'network: net: permissions filter host.fetch only, and a plugin that opens its own\n' +
    'connection is not stopped. credentials: permissions filter host.credentials.\n' +
    fontNotice(manifest.permissions)
  );
}

/**
 * `font:<family>` in words, only for a plugin that asks for one (ADR 0048): approving it sends
 * the file of a face installed on this computer, which can be licensed to the person and not
 * to the plugin's author, into the plugin's process.
 */
function fontNotice(permissions: readonly string[]): string {
  const families = permissions
    .filter((permission) => permission.startsWith('font:'))
    .map((permission) => permission.slice('font:'.length));
  if (families.length === 0) return '';
  return (
    `font: permissions send its code templates the files of ${families.join(', ')} as\n` +
    'installed on this computer, which may be licensed to you and not to its author.\n'
  );
}

export async function pluginInstallCommand(
  spec: string,
  options: PluginInstallOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const home = homeOf(environment);
  const installed = await readInstalledPlugins(home);
  const state = stateOf(installed, environment);
  if (state === undefined) return EXIT_DIAGNOSTICS;

  const fetched = await fetchPlugin(spec, environment.cwd);
  if (!fetched.ok) return fail(fetched.error, environment);

  try {
    const manifestPath = join(fetched.value.directory, PLUGIN_MANIFEST_FILE);
    let manifestSource: string;
    try {
      manifestSource = await readFile(manifestPath, 'utf8');
    } catch {
      return fail(
        [
          diagnostic('E_PLUGIN_FETCH', {
            source: spec,
            problem: `it has no ${PLUGIN_MANIFEST_FILE}`,
          }),
        ],
        environment,
      );
    }

    const checked = checkInstallable(manifestSource, manifestPath, PLUGIN_API_VERSION);
    if (!checked.ok) return fail(checked.error, environment);
    const manifest = checked.value;

    // A built-in's name is never available. An installed plugin's is: installing it again
    // is how an update lands, and how new permissions get approved.
    const builtIn = builtInManifests().manifests.some((item) => item.name === manifest.name);
    if (builtIn) {
      return fail(
        [diagnostic('E_PLUGIN_NAME_TAKEN', { plugin: manifest.name, origin: 'built-in' })],
        environment,
      );
    }

    environment.console.err(permissionPrompt(manifest, spec));
    if (!options.yes) {
      if (environment.confirm === undefined) {
        environment.console.err('Nobody is at a terminal to answer; run again with --yes.\n');
        return EXIT_DIAGNOSTICS;
      }
      if (!(await environment.confirm('Install it? [y/N] '))) {
        environment.console.err('Not installed.\n');
        return EXIT_DIAGNOSTICS;
      }
    }

    const added = await installed.store.add(manifest.name, fetched.value.directory);
    if (!added.ok) return fail(added.error, environment);
    await installed.store.writeState(
      withPluginEntry(state, manifest.name, {
        enabled: true,
        permissions: manifest.permissions,
        source: spec,
      }),
    );
    // A new install is new code: the old one's crash is not its history.
    await writeCrash(installed.store, manifest.name, undefined);
    environment.console.out(`Installed ${manifest.name} ${manifest.version}.\n`);
    return EXIT_OK;
  } finally {
    await fetched.value.cleanup();
  }
}

type StateChange = 'remove' | 'disable' | 'enable';

const DONE: Record<StateChange, string> = {
  remove: 'Removed',
  disable: 'Disabled',
  enable: 'Enabled',
};

/** `remove`, `disable` and `enable`: one entry of the state, and for `remove` its folder. */
export async function pluginStateCommand(
  change: StateChange,
  name: string,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const installed = await readInstalledPlugins(homeOf(environment));
  const state = stateOf(installed, environment);
  if (state === undefined) return EXIT_DIAGNOSTICS;

  const entry = state.plugins[name];
  const folder = installed.entries.some((item) => item.folder === name);
  // A folder with no entry can still be removed — that is how somebody cleans up a folder
  // copied in by hand — but it cannot be enabled, because nobody approved it.
  if (entry === undefined && !(change === 'remove' && folder)) {
    return fail([diagnostic('E_PLUGIN_NOT_INSTALLED', { plugin: name })], environment);
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

  environment.console.out(`${DONE[change]} ${name}.\n`);
  return EXIT_OK;
}
