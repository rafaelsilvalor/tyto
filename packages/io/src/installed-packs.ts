import { access, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { type Diagnostic, diagnostic } from '@tyto/core';
import { type InProcessHost, type LoadedPlugins, skippedPluginWarnings } from '@tyto/plugin-api';

/**
 * The template packs installed plugins contribute, as folders the registry can search
 * (TYTO-50, ADR 0046).
 *
 * A pack's `directory` is a string written by the plugin's own thread, so it is read here
 * as a claim and checked before any folder is searched:
 *
 * - **It is relative to the plugin's installed folder, and it stays inside it.** An absolute
 *   path, a `..` that climbs out, and a symbolic link that points out are refused alike; the
 *   last is why both ends are compared after `realpath`. Nothing is decoded, so `%2e%2e` is
 *   a folder name and not a way up — one that does not exist is refused as missing.
 * - **Every template in it is markup.** A folder holding a `template.ts`, or no
 *   `template.html`, is refused by name. Nothing loads code from a folder today (ADR 0007),
 *   so this rule states a boundary rather than closing an open door: the day a code template
 *   can come from a folder, one shipped by a plugin would run in Tyto's own process and not
 *   behind the plugin's thread (ADR 0041).
 *
 * Here and not in `@tyto/plugin-api`, because the check reads a disk and that package is pure
 * (ADR 0010); the CLI and the desktop both call it, so the rule has one text.
 *
 * A refusal refuses the plugin, not only its pack: `W_PLUGIN_SKIPPED` says the plugin was
 * skipped, and it would be false if the same plugin's exporter then drew the frames.
 */

const MANIFEST_FILE = 'manifest.yaml';
const MARKUP_FILE = 'template.html';
const CODE_FILE = 'template.ts';

export interface InstalledPacks {
  /** Searched after the built-in pack, in the order the plugins were loaded. */
  readonly directories: readonly string[];
  /** One `W_PLUGIN_SKIPPED` per reason a plugin's pack was refused. */
  readonly warnings: readonly Diagnostic[];
  /** The plugins whose pack was refused, which no task may activate either. */
  readonly refused: ReadonlySet<string>;
}

export const NO_INSTALLED_PACKS: InstalledPacks = {
  directories: [],
  warnings: [],
  refused: new Set(),
};

/**
 * Activates each installed plugin into `host` and checks the packs it registered.
 *
 * One plugin at a time, so each pack is attributed to the plugin that registered it — the
 * registry keys on contribution ids and does not say whose they are. A plugin that fails to
 * activate here is not reported here: every task activates it again and reports it there,
 * and saying it twice would be one problem read as two.
 */
export async function installedPacks(
  host: InProcessHost,
  loaded: LoadedPlugins,
  folderOf: (plugin: string) => string,
): Promise<InstalledPacks> {
  const directories: string[] = [];
  const warnings: Diagnostic[] = [];
  const refused = new Set<string>();

  for (const plugin of loaded.plugins) {
    const before = new Set(host.registry.templatePacks().map((pack) => pack.id));
    if (!host.tryActivate(plugin, 'external').ok) continue;

    const packs = host.registry.templatePacks().filter((pack) => !before.has(pack.id));
    const checked: string[] = [];
    const problems: Diagnostic[] = [];
    for (const pack of packs) {
      if (pack.directory === undefined) continue;
      const inside = await directoryInside(folderOf(plugin.id), pack.directory, plugin.id);
      if (typeof inside !== 'string') {
        problems.push(inside);
        continue;
      }
      const code = await codeTemplates(inside, plugin.id);
      if (code.length > 0) {
        problems.push(...code);
        continue;
      }
      checked.push(inside);
    }

    if (problems.length > 0) {
      host.disposePlugin(plugin.id);
      refused.add(plugin.id);
      warnings.push(...skippedPluginWarnings(plugin.id, problems));
    } else {
      directories.push(...checked);
    }
  }

  return { directories, warnings, refused };
}

/** The loaded plugins minus the refused ones, closing all of them as before. */
export function withoutRefused(loaded: LoadedPlugins, refused: ReadonlySet<string>): LoadedPlugins {
  if (refused.size === 0) return loaded;
  return {
    plugins: loaded.plugins.filter((plugin) => !refused.has(plugin.id)),
    warnings: loaded.warnings,
    close: () => loaded.close(),
  };
}

function isWithin(root: string, path: string): boolean {
  const between = relative(root, path);
  return (
    between === '' || (!isAbsolute(between) && between !== '..' && !between.startsWith(`..${sep}`))
  );
}

/** The pack's folder as an absolute real path inside the plugin's, or why it is not one. */
async function directoryInside(
  pluginFolder: string,
  directory: string,
  plugin: string,
): Promise<string | Diagnostic> {
  const refuse = (problem: string): Diagnostic =>
    diagnostic('E_PLUGIN_PACK_DIRECTORY', { plugin, directory, problem });

  // Both separators and a drive letter, whichever platform this is: a pack is one folder
  // copied between machines, and `C:\x` must not become a relative name on Linux.
  if (isAbsolute(directory) || /^[a-zA-Z]:/u.test(directory) || /^[/\\]/u.test(directory)) {
    return refuse('it is an absolute path rather than one relative to the plugin folder');
  }
  const joined = resolve(pluginFolder, directory);
  if (!isWithin(pluginFolder, joined)) return refuse('it leads out of the plugin folder');

  let real: string;
  let realRoot: string;
  try {
    [real, realRoot] = await Promise.all([realpath(joined), realpath(pluginFolder)]);
  } catch {
    return refuse('there is no such folder in the plugin');
  }
  if (!isWithin(realRoot, real)) return refuse('a link in it leads out of the plugin folder');
  return real;
}

/** A `template-pack` from a plugin carries markup templates only (ADR 0046). */
async function codeTemplates(directory: string, plugin: string): Promise<Diagnostic[]> {
  const exists = (path: string): Promise<boolean> =>
    access(path).then(
      () => true,
      () => false,
    );

  const problems: Diagnostic[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // Unreadable is the registry's to report, with its own wording, when it searches here.
    return problems;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = join(directory, entry.name);
    if (!(await exists(join(folder, MANIFEST_FILE)))) continue;
    if ((await exists(join(folder, CODE_FILE))) || !(await exists(join(folder, MARKUP_FILE)))) {
      problems.push(diagnostic('E_PLUGIN_PACK_CODE', { plugin, template: entry.name }));
    }
  }
  return problems;
}
