import { type Diagnostic, type Diagnostics, diagnostic } from '@tyto/core';
import {
  type PluginManifest,
  type PluginCrash,
  type PluginOrigin,
  PROCESS_PERMISSION,
  validatePluginManifest,
} from '@tyto/plugin-api';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK, type ExitCode } from './exit.js';
import { type PluginStateChange, changePluginState, installPlugin } from './plugin-actions.js';
import { readInstalledPlugins } from './plugins/external.js';
import { type ListedPluginFiles, listPluginFiles } from './plugin-files-list.js';
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
  /** A folder inside the workspace whose plugin files count; the cwd when absent. */
  readonly folder?: string;
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

const NO_LISTED_PLUGIN_FILES: ListedPluginFiles = {
  sources: [],
  aliases: [],
  leftOut: '',
  diagnostics: [],
};

/**
 * The plugin files' sources, then their aliases, each under a heading so a reader can tell
 * them from the installed plugins above. Nothing at all when the files name nothing.
 */
function formatPluginFiles(files: ListedPluginFiles): string {
  const lines: string[] = [];
  if (files.sources.length > 0) {
    const pluginOf = (source: ListedPluginFiles['sources'][number]): string => source.plugin ?? '-';
    const commitOf = (source: ListedPluginFiles['sources'][number]): string =>
      source.commit?.slice(0, 12) ?? '-';
    const plugin = column(files.sources.map(pluginOf));
    const scope = column(files.sources.map((source) => source.scope));
    const git = column(files.sources.map((source) => source.git));
    const ref = column(files.sources.map((source) => source.ref));
    const commit = column(files.sources.map(commitOf));
    const status = column(files.sources.map((source) => source.status));
    lines.push(
      '',
      'plugin files:',
      ...files.sources.map(
        (source) =>
          `${plugin(pluginOf(source))}  ${scope(source.scope)}  ${git(source.git)}  ` +
          `${ref(source.ref)}  ${commit(commitOf(source))}  ${status(source.status)}  ${source.file}`,
      ),
    );
  }
  if (files.aliases.length > 0) {
    const named = files.aliases.map(
      (alias) => `${alias.alias} → ${alias.template} (${alias.configuration})`,
    );
    const name = column(named);
    lines.push(
      '',
      'aliases:',
      ...files.aliases.map((alias, index) => `${name(named[index] ?? '')}  ${alias.file}`),
    );
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function document(plugins: readonly ListedPlugin[], files: ListedPluginFiles): unknown {
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
    pluginFiles: files.sources.map((source) => ({
      plugin: source.plugin ?? null,
      scope: source.scope,
      file: source.file,
      git: source.git,
      ref: source.ref,
      commit: source.commit ?? null,
      status: source.status,
    })),
    aliases: files.aliases,
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

export function builtInManifests(): { manifests: PluginManifest[]; problems: Diagnostic[] } {
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
  let files = NO_LISTED_PLUGIN_FILES;
  if (environment.home !== undefined) {
    files = await listPluginFiles(options.folder ?? '.', environment.home, environment);
    refusals.push(...files.diagnostics);
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
  // `--active` keeps the copies a render would load, as it keeps the installed plugins.
  const shownFiles =
    options.active === true
      ? { ...files, sources: files.sources.filter((source) => source.status === 'approved') }
      : files;
  environment.console.out(
    options.json
      ? json(document(shown, shownFiles))
      : `${formatList(shown)}${formatPluginFiles(shownFiles)}`,
  );
  if (files.leftOut !== '') environment.console.err(files.leftOut);
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
export function permissionPrompt(manifest: PluginManifest, source: string): string {
  const permissions =
    manifest.permissions.length === 0
      ? '  (none)\n'
      : manifest.permissions.map((permission) => `  - ${permissionLine(permission)}\n`).join('');
  return (
    `${manifest.name} ${manifest.version} from ${source}\n` +
    `contributes: ${manifest.contributes.join(', ')}\n` +
    `permissions:\n${permissions}` +
    'Each plugin runs in a process of its own, so a crash stops the plugin and not Tyto.\n' +
    "Node's permission model confines that process to the plugin's own folder: it cannot\n" +
    'read your other files, write anywhere, or start programs itself. It is not confined on the\n' +
    'network: net: permissions filter host.fetch only, and a plugin that opens its own\n' +
    'connection is not stopped. credentials: permissions filter host.credentials.\n' +
    workspaceNotice(manifest.permissions) +
    fontNotice(manifest.permissions) +
    processNotice(manifest.permissions)
  );
}

/** One permission as the list shows it; `process:<name>` says what it does (ADR 0182). */
function permissionLine(permission: string): string {
  if (!permission.startsWith(PROCESS_PERMISSION)) return permission;
  const program = permission.slice(PROCESS_PERMISSION.length);
  return `${permission}: start the program ${program} on your computer`;
}

/**
 * `process:<name>` in words, only for a plugin that asks for one (ADR 0182): Tyto, not the
 * plugin, starts that one program from the person's PATH, and the program is not confined.
 */
function processNotice(permissions: readonly string[]): string {
  const programs = permissions
    .filter((permission) => permission.startsWith(PROCESS_PERMISSION))
    .map((permission) => permission.slice(PROCESS_PERMISSION.length));
  if (programs.length === 0) return '';
  const named = programs.map((program) => `\`${program}\``);
  const last = named.pop() ?? '';
  const either = named.length === 0 ? last : `${named.join(', ')} or ${last}`;
  const those =
    named.length === 0
      ? 'That program runs with your rights and is'
      : 'Those programs run with your rights and are';
  return (
    `It may ask Tyto to start ${either}, found on your PATH, in the folder open in Tyto,\n` +
    'and never while that folder is restricted. Tyto starts no other program for it.\n' +
    `${those} not confined to the folder.\n`
  );
}

/**
 * `workspace:read` and `workspace:write` in words, only for a plugin that asks for either
 * (ADR 0138): the plugin's process still reads no file of its own, but Tyto reads and writes
 * the open folder's files on its behalf, confined to that folder, never inside `.tyto/`, and
 * not at all while the folder is restricted.
 */
function workspaceNotice(permissions: readonly string[]): string {
  const reads = permissions.includes('workspace:read');
  const writes = permissions.includes('workspace:write');
  if (!reads && !writes) return '';
  const verbs = reads && writes ? 'read and write' : reads ? 'read' : 'write';
  return (
    `workspace: permissions let Tyto ${verbs} files for it in the folder open in Tyto:\n` +
    'never outside that folder or inside its .tyto/, and nothing while it is restricted.\n'
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
  const { confirm } = environment;
  let nobodyToAsk = false;
  const answer = await installPlugin(spec, {
    home: homeOf(environment),
    cwd: environment.cwd,
    ...(environment.shellRefusal === undefined ? {} : { shellRefusal: environment.shellRefusal }),
    approve: async (manifest, source) => {
      environment.console.err(permissionPrompt(manifest, source));
      if (options.yes) return true;
      if (confirm === undefined) {
        nobodyToAsk = true;
        return false;
      }
      return confirm('Install it? [y/N] ');
    },
  });
  if (!answer.ok) return fail(answer.error, environment);

  const { manifest } = answer.value;
  if (answer.value.status === 'declined') {
    environment.console.err(
      nobodyToAsk
        ? 'Nobody is at a terminal to answer; run again with --yes.\n'
        : 'Not installed.\n',
    );
    return EXIT_DIAGNOSTICS;
  }
  environment.console.out(`Installed ${manifest.name} ${manifest.version}.\n`);
  return EXIT_OK;
}

const DONE: Record<PluginStateChange, string> = {
  remove: 'Removed',
  disable: 'Disabled',
  enable: 'Enabled',
};

/** `remove`, `disable` and `enable`: one entry of the state, and for `remove` its folder. */
export async function pluginStateCommand(
  change: PluginStateChange,
  name: string,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const changed = await changePluginState(change, name, { home: homeOf(environment) });
  if (!changed.ok) return fail(changed.error, environment);
  environment.console.out(`${DONE[change]} ${name}.\n`);
  return EXIT_OK;
}
