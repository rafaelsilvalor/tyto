import { access, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { type Diagnostic, diagnostic } from '@tyto/core';
import {
  type InProcessHost,
  type IsolatedPackBuild,
  type LoadedPlugins,
  type TemplatePack,
  skippedPluginWarnings,
  validatePluginManifest,
} from '@tyto/plugin-api';

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
 * - **Every template in it runs as markup or in the plugin's process.** A folder with a
 *   `template.html` is markup. One without it is a code template, and only a pack that
 *   registered `build` can draw one: its code is bundled into the plugin's `dist/` and runs
 *   in the plugin's process (ADR 0048). A `template.ts` in the folder is refused by name,
 *   because Tyto imports nothing from a folder (ADR 0007), and a source file there would
 *   read as a template that runs when none of it does.
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

/** A checked pack whose code templates are built in its plugin's process (ADR 0048). */
export interface InstalledCodePack {
  readonly plugin: string;
  /** The pack's folder, a real path; each code template is a folder directly inside it. */
  readonly directory: string;
  /** The host's proxy of the plugin's `build`. */
  readonly build: IsolatedPackBuild;
  /** The manifest's permissions, which the loader already held to what was approved. */
  readonly permissions: readonly string[];
}

export interface InstalledPacks {
  /** Searched after the built-in pack, in the order the plugins were loaded. */
  readonly directories: readonly string[];
  /** The packs among them that registered `build`. */
  readonly code: readonly InstalledCodePack[];
  /** One `W_PLUGIN_SKIPPED` per reason a plugin's pack was refused. */
  readonly warnings: readonly Diagnostic[];
  /** The plugins whose pack was refused, which no task may activate either. */
  readonly refused: ReadonlySet<string>;
}

export const NO_INSTALLED_PACKS: InstalledPacks = {
  directories: [],
  code: [],
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
  const code: InstalledCodePack[] = [];
  const warnings: Diagnostic[] = [];
  const refused = new Set<string>();

  for (const plugin of loaded.plugins) {
    const before = new Set(host.registry.templatePacks().map((pack) => pack.id));
    if (!host.tryActivate(plugin, 'external').ok) continue;

    const packs = host.registry.templatePacks().filter((pack) => !before.has(pack.id));
    const checked: string[] = [];
    const built: InstalledCodePack[] = [];
    const problems: Diagnostic[] = [];
    const validated = validatePluginManifest(plugin.manifest);
    const permissions = validated.ok ? validated.value.permissions : [];
    for (const pack of packs) {
      if (pack.directory === undefined) continue;
      const inside = await directoryInside(folderOf(plugin.id), pack.directory, plugin.id);
      if (typeof inside !== 'string') {
        problems.push(inside);
        continue;
      }
      const refusals = await unrunnableTemplates(inside, pack, plugin.id);
      if (refusals.length > 0) {
        problems.push(...refusals);
        continue;
      }
      checked.push(inside);
      if (pack.build !== undefined) {
        // The proxy `connectIsolatedPlugin` put there, whose calling convention is the
        // wire's and not the plugin's (`IsolatedPackBuild`).
        const build = pack.build as unknown as IsolatedPackBuild;
        built.push({ plugin: plugin.id, directory: inside, build, permissions });
      }
    }

    if (problems.length > 0) {
      host.disposePlugin(plugin.id);
      refused.add(plugin.id);
      warnings.push(...skippedPluginWarnings(plugin.id, problems));
    } else {
      directories.push(...checked);
      code.push(...built);
    }
  }

  return { directories, code, warnings, refused };
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

/**
 * The templates of a pack that nothing could run the way ADR 0048 allows: a `template.ts`,
 * which Tyto never imports, and a folder with no `template.html` in a pack with no `build`.
 */
async function unrunnableTemplates(
  directory: string,
  pack: TemplatePack,
  plugin: string,
): Promise<Diagnostic[]> {
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
    const refuse = (problem: string): void => {
      problems.push(diagnostic('E_PLUGIN_PACK_CODE', { plugin, template: entry.name, problem }));
    };
    if (await exists(join(folder, CODE_FILE))) {
      refuse(
        `its folder holds a ${CODE_FILE}, which Tyto never imports: a code template ships ` +
          "built into the plugin's dist/ and is drawn by the pack's build function",
      );
    } else if (!(await exists(join(folder, MARKUP_FILE))) && pack.build === undefined) {
      refuse(`it has no ${MARKUP_FILE}, and the pack registers no build function to draw it`);
    }
  }
  return problems;
}
