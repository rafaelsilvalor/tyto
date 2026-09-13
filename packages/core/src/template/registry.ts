import { type TemplateManifest, parseManifest } from './manifest.js';
import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
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
  /** Which root it came from, by index — what tells a shadow apart from a duplicate. */
  readonly root: number;
}

/**
 * Walks each root in turn, reading one `manifest.yaml` per subfolder.
 *
 * A folder without a manifest is not a template and is skipped in silence — `.git` and
 * `node_modules` are folders too. A folder *with* a manifest that does not parse is a
 * failure, because the file is the author saying this was meant to be a template.
 *
 * **Roots are a search path in precedence order: earlier wins** (ADR 0020). The CLI passes
 * the project's `--templates <dir>` before the built-in pack, so a user's own
 * `promo-curso` is the one that renders. The two collisions are different problems and are
 * reported differently:
 *
 * - Two folders in **one** root is `E_TEMPLATE_DUPLICATE`, a failure on the second, because
 *   directory order is not an order anybody chose and picking between them would be
 *   arbitrary.
 * - The same name in a **later** root is `W_TEMPLATE_SHADOWED`, a warning on the `ok`
 *   branch (ADR 0013), because that order is the one this function was handed.
 *
 * `Err` is reserved for having no registry at all rather than an incomplete one: a single
 * root that cannot be read, or every root of several. One unreadable root beside a readable
 * one is a failure on that root — a project with no `templates/` folder still renders from
 * the pack, and is still told the folder it named is not there.
 */
export async function loadTemplateRegistry(
  fileSystem: FileSystem,
  roots: string | readonly string[],
): Promise<Result<TemplateRegistry, Diagnostics>> {
  // De-duplicated, because a root listed twice would shadow itself: every template in it
  // would be reported as hidden by the copy of itself in the earlier position. That is not
  // hypothetical — `--templates <the pack's own folder>` is the documented way the built-in
  // templates were used before ADR 0020, and it still has to work.
  //
  // Exact string equality, because this package is pure and path normalisation is a
  // filesystem's opinion: `C:\x` and `c:/x` are the same folder on Windows and this cannot
  // know it. Callers resolve to absolute paths, which is what makes the comparison enough.
  const search = [...new Set(typeof roots === 'string' ? [roots] : roots)];

  const entries = new Map<string, Entry>();
  const failures: TemplateFailure[] = [];
  const warnings: Diagnostic[] = [];
  const unreadable: Diagnostics[] = [];

  for (const [index, root] of search.entries()) {
    let rootEntries: readonly { name: string; isDirectory: boolean }[];
    try {
      rootEntries = await fileSystem.readDirectory(root);
    } catch (cause) {
      const diagnostics = readFailure(root, cause);
      unreadable.push(diagnostics);
      failures.push({ directory: root, diagnostics });
      continue;
    }

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
        if (existing.root === index) {
          // Same root. First folder wins, so which template `--template promo-curso` means
          // does not depend on the order the filesystem happened to list them in.
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
        } else {
          // An earlier root already has this name, and that order was chosen rather than
          // observed. Nothing is wrong; the run gets the more specific template and is told
          // which one it did not get.
          warnings.push(
            diagnostic('W_TEMPLATE_SHADOWED', {
              name: parsed.value.name,
              shadowed: directory,
              used: existing.directory,
            }),
          );
        }
        continue;
      }

      entries.set(parsed.value.name, { manifest: parsed.value, directory, root: index });
    }
  }

  // Every root unreadable means there is no registry to return, which is what `Err` is for.
  // An empty search path is not that: it is a wiring bug, and an `Err` carrying no
  // diagnostic would be the least useful way to report one.
  if (unreadable.length > 0 && unreadable.length === search.length) {
    return err(unreadable.flat());
  }

  const sorted = [...entries.values()].sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name),
  );

  return ok(
    {
      list: () => sorted.map((entry) => entry.manifest),
      get: (name) => entries.get(name)?.manifest,
      formatsOf: (name) => entries.get(name)?.manifest.formats,
      directoryOf: (name) => entries.get(name)?.directory,
      failures,
    },
    warnings,
  );
}
