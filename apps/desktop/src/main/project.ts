import {
  type Diagnostic,
  type FileSystem,
  type FormatCatalogue,
  type TemplateFailure,
  type TemplateRegistry,
  type TemplateConfigurations,
  type TemplateRoot,
  loadFormats,
  loadTemplateRegistry,
  NO_TEMPLATE_CONFIGURATIONS,
  resolveTemplateConfigurations,
} from '@tyto/core';
import type { InstalledCodePack } from '@tyto/io';

import { type FetchedTemplates, located } from './plugin-files.js';

/**
 * Which folders this app searches for templates, and the one thing in main that is rebuilt
 * when that answer changes (TYTO-122).
 *
 * **The card called the reload "the real size driver", and it was right about the problem
 * and wrong about the shape.** `createPreviewService`, `createExportService` and
 * `createTemplateCatalogue` are each built once at startup, so the card assumed the folder
 * could only change by rebuilding all three. Measured instead: both services already read
 * the registry and the format catalogue *inside* their per-call function — nothing about
 * them is bound at construction except a `const` in an enclosing scope. Moving that read one
 * level in, to `sources.current()`, makes all three see a new folder with no rebuild, no
 * second lifetime and no old instance left holding a stale registry.
 *
 * That matters beyond tidiness. `registerIpcHandlers` captures its dependency object once;
 * a design that swapped the services would have needed a forwarding shim for every channel
 * that names one, and a run already in flight could have had its registry changed underneath
 * it. Here the snapshot is a value: a caller reads it once and keeps reading the same one.
 *
 * **The plugin host is deliberately not part of this.** `activateBuiltIns` registers the
 * *built-in pack* through the extension point, and the card's own "Why this is not TYTO-47"
 * says a chosen folder is deliberately not a plugin. So the host keeps answering "what did
 * the composition root register", which is `app:info`'s documented job.
 */

/** Everything one read of the folders produced, as one value nothing can change under you. */
export interface ProjectSnapshot {
  /**
   * In search order, earlier wins: the chosen folder, the workspace's template folders, the
   * built-in pack, the packs the plugin files fetched (the project's, then the machine's), then
   * the packs of installed plugins (ADR 0046, ADR 0151 decision 7) — the CLI's order.
   */
  readonly roots: readonly string[];
  /** Absent when every root was unreadable, which is a window that opens and says so. */
  readonly registry: TemplateRegistry | undefined;
  /** Absent when no `formats.yaml` could be read at all — the built-in pack's included. */
  readonly formats: FormatCatalogue | undefined;
  /** What the reads had to say, replayed on every preview rather than thrown. */
  readonly diagnostics: readonly Diagnostic[];
  /** Folders that meant to be a template and could not be read as one. */
  readonly failures: readonly TemplateFailure[];
  /**
   * The chosen folder, and how many templates it contributed.
   *
   * `found: 0` on a folder that is readable and holds no `manifest.yaml` anywhere — the
   * card's "a folder that is not a template pack". It is a count and not a boolean because
   * the window says how many, and because "0" and "unreadable" are different reports: the
   * second arrives as an `E_TEMPLATE_READ` in `diagnostics`.
   */
  readonly folder: { readonly path: string; readonly found: number } | undefined;
  /** Installed packs whose code templates are built in their plugin's process (ADR 0048). */
  readonly codePacks: readonly InstalledCodePack[];
  /**
   * What the last sync of the plugin files had to say (TYTO-433): a source it could not fetch,
   * a file it could not read. About the app rather than about a brief, so the window shows it
   * among the template list's failures, with no brief open too.
   */
  readonly pluginFiles: readonly Diagnostic[];
  /**
   * The plugin files' configurations and aliases (TYTO-433), resolved against this registry: a
   * brief's `template:` is looked up here first, in the preview and the export alike.
   */
  readonly configurations: TemplateConfigurations;
}

export interface ProjectSources {
  /** The snapshot in force right now. Cheap — a property read, safe on a hot path. */
  current(): ProjectSnapshot;
  /** Reads the folders again. `undefined` goes back to the built-in pack alone. */
  reload(folder: string | undefined): Promise<ProjectSnapshot>;
  /**
   * The installed packs' folders, already checked, searched after the built-in pack.
   *
   * Handed over once the plugins have started, which is after the window opened (ADR 0044),
   * so it reads the folders again with the chosen one kept. `warnings` are the packs that
   * were refused, carried with every snapshot so the problems panel says which plugin was
   * skipped and why, the way a render's `result.json` does.
   */
  setInstalled(packs: {
    readonly directories: readonly string[];
    readonly warnings: readonly Diagnostic[];
    readonly code?: readonly InstalledCodePack[];
    /** The plugin each folder came from, so a plugin a file replaces leaves the search. */
    readonly owners?: ReadonlyMap<string, string>;
  }): Promise<ProjectSnapshot>;
  /**
   * The packs the plugin files fetched, after each sync (TYTO-433), searched after the built-in
   * pack and before the installed ones. A pack offers only the templates its file names, and
   * an installed plugin a file replaces is left out of the search (ADR 0151 decision 7).
   */
  setFetched(fetched: FetchedTemplates): Promise<ProjectSnapshot>;
  /**
   * The open workspace's template folders (TYTO-278, ADR 0113), searched after the chosen
   * folder and before the built-in pack, the order `tyto render` gives them. Empty when no
   * workspace is open. Reads the folders again with the chosen one kept.
   */
  setWorkspaceFolders(folders: readonly string[]): Promise<ProjectSnapshot>;
  /**
   * The brands the started plugins' kits offer (TYTO-471, ADR 0155), the kits the preview draws
   * with. Until it is called nothing is said about a configuration's `brand:`: before the plugins
   * start there are no kits yet, and an empty set would warn on every brand.
   */
  setKitBrands(brands: ReadonlySet<string>): Promise<ProjectSnapshot>;
}

export interface ProjectSourcesOptions {
  readonly fileSystem: FileSystem;
  /** The built-in pack's folder, resolved by the composition root (ADR 0010). */
  readonly builtIn: string;
  /** What was remembered from last time, if anything. */
  readonly folder?: string;
}

const FORMATS_FILE = 'formats.yaml';

export async function createProjectSources({
  fileSystem,
  builtIn,
  folder,
}: ProjectSourcesOptions): Promise<ProjectSources> {
  /**
   * Reads the chosen folder **on its own**, before the merged read.
   *
   * Two things the merged registry cannot tell apart: how many templates came from that
   * folder, and whether the folder itself was unreadable. Merged, a bad folder and an empty
   * one both look like "the built-in templates and nothing else" — and the card's fourth
   * criterion is that the second is reported in the problems panel while the first does not
   * take the built-in pack down with it.
   */
  const countIn = async (path: string): Promise<{ found: number; diagnostics: Diagnostic[] }> => {
    const alone = await loadTemplateRegistry(fileSystem, path);
    if (!alone.ok) return { found: 0, diagnostics: [...alone.error] };
    return { found: alone.value.list().length, diagnostics: [] };
  };

  let installed: readonly string[] = [];
  let installedOwners: ReadonlyMap<string, string> = new Map();
  let installedWarnings: readonly Diagnostic[] = [];
  let codePacks: readonly InstalledCodePack[] = [];
  let workspaceFolders: readonly string[] = [];
  let fetched: FetchedTemplates | undefined;
  let kitBrands: ReadonlySet<string> | undefined;

  const read = async (chosen: string | undefined): Promise<ProjectSnapshot> => {
    const replaced = fetched?.replaces ?? new Set<string>();
    const stillInstalled = installed.filter(
      (directory) => !replaced.has(installedOwners.get(directory) ?? ''),
    );
    const fetchedRoots: TemplateRoot[] = (fetched?.packs.directories ?? []).map((directory) => {
      const only = fetched?.only.get(directory);
      return only === undefined ? { directory } : { directory, only };
    });
    const roots = [
      ...(chosen === undefined ? [] : [chosen]),
      ...workspaceFolders,
      builtIn,
      ...fetchedRoots.map((root) => root.directory),
      ...stillInstalled,
    ];

    const probe = chosen === undefined ? undefined : await countIn(chosen);

    // Earlier wins, which is the CLI's precedence exactly (ADR 0020). `W_TEMPLATE_SHADOWED`
    // arrives in the registry's own warnings and is carried through, so the panel can say a
    // built-in template was replaced rather than leaving it silently absent.
    const registry = await loadTemplateRegistry(fileSystem, [
      ...(chosen === undefined ? [] : [chosen]),
      ...workspaceFolders,
      builtIn,
      ...fetchedRoots,
      ...stillInstalled,
    ]);

    /**
     * The chosen folder's `formats.yaml` **replaces** the built-in pack's, and falls back to
     * it when there is none.
     *
     * Replace and not merge, because `--formats-file` replaces in the CLI and a second
     * semantics for one file is how two people end up disagreeing about what a format is.
     *
     * The fallback is the part that had to be decided. `loadFormats` errs on a file that is
     * not there, and a service with no catalogue returns **zero frames for every brief** —
     * so pointing at `<chosen>/formats.yaml` unconditionally would mean that choosing any
     * folder without one breaks the whole app. That is precisely the "does not take the
     * built-in pack down with it" criterion, so: absent is silent and falls back; present
     * but broken keeps the built-in catalogue *and* reports the syntax error.
     */
    let formats = await loadFormats(fileSystem, fileSystem.join(builtIn, FORMATS_FILE));
    let formatsDiagnostics: Diagnostic[] = formats.ok
      ? [...formats.diagnostics]
      : [...formats.error];

    if (chosen !== undefined) {
      const own = await loadFormats(fileSystem, fileSystem.join(chosen, FORMATS_FILE));
      if (own.ok) {
        formats = own;
        formatsDiagnostics = [...own.diagnostics];
      } else if (!own.error.some((item) => item.code === 'E_FORMATS_READ')) {
        // There *is* a `formats.yaml` and it is wrong. Keep the built-in catalogue so the app
        // still renders, and say so — a broken file the person wrote is worth a line; a file
        // they never wrote is not.
        formatsDiagnostics = [...formatsDiagnostics, ...own.error];
      }
    }

    // Against the registry this read built, so an alias named like any template that loaded is
    // refused (ADR 0151 decision 7), and each range is placed in the file that wrote it.
    const configured =
      fetched === undefined || !registry.ok
        ? { configurations: NO_TEMPLATE_CONFIGURATIONS, diagnostics: [] }
        : await resolveTemplateConfigurations({
            ...fetched.configured,
            registry: registry.value,
            images: fetched.images,
            ...(kitBrands === undefined ? {} : { kitBrands }),
          });
    const configurationProblems = configured.diagnostics.map(({ file, diagnostic: item }) => {
      const text = file === undefined ? undefined : fetched?.texts.get(file);
      return located(item, file === undefined ? undefined : { file, text: text ?? '' });
    });

    return {
      roots,
      registry: registry.ok ? registry.value : undefined,
      formats: formats.ok ? formats.value : undefined,
      diagnostics: [
        ...installedWarnings,
        ...(registry.ok ? registry.diagnostics : registry.error),
        ...formatsDiagnostics,
        ...(probe?.diagnostics ?? []),
      ],
      failures: registry.ok ? registry.value.failures : [],
      folder: chosen === undefined ? undefined : { path: chosen, found: probe?.found ?? 0 },
      codePacks: [
        ...(fetched?.packs.code ?? []),
        ...codePacks.filter((pack) => !replaced.has(pack.plugin)),
      ],
      pluginFiles: [...(fetched?.problems ?? []), ...configurationProblems],
      configurations: configured.configurations,
    };
  };

  let snapshot = await read(folder);
  let chosenFolder = folder;

  return {
    current: () => snapshot,
    reload: async (next) => {
      chosenFolder = next;
      snapshot = await read(next);
      return snapshot;
    },
    setInstalled: async (packs) => {
      installed = [...packs.directories];
      installedOwners = packs.owners ?? new Map();
      installedWarnings = [...packs.warnings];
      codePacks = [...(packs.code ?? [])];
      snapshot = await read(chosenFolder);
      return snapshot;
    },
    setFetched: async (next) => {
      fetched = next;
      snapshot = await read(chosenFolder);
      return snapshot;
    },
    setWorkspaceFolders: async (folders) => {
      workspaceFolders = [...folders];
      snapshot = await read(chosenFolder);
      return snapshot;
    },
    setKitBrands: async (brands) => {
      kitBrands = brands;
      snapshot = await read(chosenFolder);
      return snapshot;
    },
  };
}
