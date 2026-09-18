import {
  type Diagnostic,
  type FileSystem,
  type FormatCatalogue,
  type TemplateFailure,
  type TemplateRegistry,
  loadFormats,
  loadTemplateRegistry,
} from '@tyto/core';

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
  /** In search order, earlier wins. The chosen folder first, the built-in pack last. */
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
}

export interface ProjectSources {
  /** The snapshot in force right now. Cheap — a property read, safe on a hot path. */
  current(): ProjectSnapshot;
  /** Reads the folders again. `undefined` goes back to the built-in pack alone. */
  reload(folder: string | undefined): Promise<ProjectSnapshot>;
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

  const read = async (chosen: string | undefined): Promise<ProjectSnapshot> => {
    const roots = chosen === undefined ? [builtIn] : [chosen, builtIn];

    const probe = chosen === undefined ? undefined : await countIn(chosen);

    // Earlier wins, which is the CLI's precedence exactly (ADR 0020). `W_TEMPLATE_SHADOWED`
    // arrives in the registry's own warnings and is carried through, so the panel can say a
    // built-in template was replaced rather than leaving it silently absent.
    const registry = await loadTemplateRegistry(fileSystem, roots);

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

    return {
      roots,
      registry: registry.ok ? registry.value : undefined,
      formats: formats.ok ? formats.value : undefined,
      diagnostics: [
        ...(registry.ok ? registry.diagnostics : registry.error),
        ...formatsDiagnostics,
        ...(probe?.diagnostics ?? []),
      ],
      failures: registry.ok ? registry.value.failures : [],
      folder: chosen === undefined ? undefined : { path: chosen, found: probe?.found ?? 0 },
    };
  };

  let snapshot = await read(folder);

  return {
    current: () => snapshot,
    reload: async (next) => {
      snapshot = await read(next);
      return snapshot;
    },
  };
}
