import { type TemplateManifest, parseManifest } from './manifest.js';
import { diagnostic } from '../diagnostics/diagnostic.js';
import type { FileSystem } from '../ports/file-system.js';
import { type Diagnostics, type Result, err, ok } from '../result/result.js';

/**
 * Template discovery by folder, reading manifests and nothing else.
 *
 * The registry answers "what templates are there and what does each one declare" without
 * importing a line of template code. That is the point: the desktop app lists templates in
 * a picker and the CLI validates a brief long before anything is rendered, and neither
 * moment should be able to run a third party's `template.ts`. Executing a template is
 * `compile`'s job (E4.2), behind `defineTemplate`, and it happens once the user has asked
 * for output.
 *
 * Pure: the filesystem arrives as a port (ADR 0010).
 */

const MANIFEST_FILE = 'manifest.yaml';

/** A folder that meant to be a template — it has a manifest — and could not be read as one. */
export interface TemplateFailure {
  readonly directory: string;
  readonly diagnostics: Diagnostics;
}

export interface TemplateRegistry {
  /** In manifest-name order, so a picker and a `--help` list agree. */
  list(): readonly TemplateManifest[];
  get(name: string): TemplateManifest | undefined;
  formatsOf(name: string): readonly string[] | undefined;
  /** Where the template lives, which is what an asset path in it is relative to. */
  directoryOf(name: string): string | undefined;
  /**
   * One entry per folder whose manifest could not be read. A broken template is not a
   * broken registry: the other templates still render, and a caller that wants to surface
   * the failures reads them here rather than losing the working ones to an `Err`.
   */
  readonly failures: readonly TemplateFailure[];
}

function readFailure(path: string, cause: unknown): Diagnostics {
  return [
    diagnostic('E_TEMPLATE_READ', {
      path,
      problem: cause instanceof Error ? cause.message : String(cause),
    }),
  ];
}

interface Entry {
  readonly manifest: TemplateManifest;
  readonly directory: string;
}

/**
 * Walks `root`, reading one `manifest.yaml` per subfolder.
 *
 * A folder without a manifest is not a template and is skipped in silence — `.git` and
 * `node_modules` are folders too. A folder *with* a manifest that does not parse is a
 * failure, because the file is the author saying this was meant to be a template.
 *
 * `Err` is reserved for the root itself being unreadable, which is the one case where
 * there is no registry to return rather than an incomplete one.
 */
export async function loadTemplateRegistry(
  fileSystem: FileSystem,
  root: string,
): Promise<Result<TemplateRegistry, Diagnostics>> {
  let rootEntries: readonly { name: string; isDirectory: boolean }[];
  try {
    rootEntries = await fileSystem.readDirectory(root);
  } catch (cause) {
    return err(readFailure(root, cause));
  }

  const entries = new Map<string, Entry>();
  const failures: TemplateFailure[] = [];

  for (const candidate of rootEntries) {
    if (!candidate.isDirectory) continue;
    const directory = fileSystem.join(root, candidate.name);

    let contents: readonly { name: string; isDirectory: boolean }[];
    try {
      contents = await fileSystem.readDirectory(directory);
    } catch (cause) {
      failures.push({ directory, diagnostics: readFailure(directory, cause) });
      continue;
    }
    if (!contents.some((item) => item.name === MANIFEST_FILE && !item.isDirectory)) continue;

    const manifestPath = fileSystem.join(directory, MANIFEST_FILE);
    let source: string;
    try {
      source = await fileSystem.readFile(manifestPath);
    } catch (cause) {
      failures.push({ directory, diagnostics: readFailure(manifestPath, cause) });
      continue;
    }

    const parsed = parseManifest(source, manifestPath);
    if (!parsed.ok) {
      failures.push({ directory, diagnostics: parsed.error });
      continue;
    }

    const existing = entries.get(parsed.value.name);
    if (existing !== undefined) {
      // First folder wins, so which template `--template promo-curso` means does not
      // depend on the order the filesystem happened to list them in.
      failures.push({
        directory,
        diagnostics: [
          diagnostic('E_TEMPLATE_DUPLICATE', {
            name: parsed.value.name,
            first: existing.directory,
            second: directory,
          }),
        ],
      });
      continue;
    }

    entries.set(parsed.value.name, { manifest: parsed.value, directory });
  }

  const sorted = [...entries.values()].sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name),
  );

  return ok({
    list: () => sorted.map((entry) => entry.manifest),
    get: (name) => entries.get(name)?.manifest,
    formatsOf: (name) => entries.get(name)?.manifest.formats,
    directoryOf: (name) => entries.get(name)?.directory,
    failures,
  });
}
