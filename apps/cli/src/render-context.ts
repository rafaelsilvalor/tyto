import {
  type AssetRef,
  type Diagnostics,
  type FileSystem,
  type FormatCatalogue,
  type Result,
  type TemplateRegistry,
  diagnostic,
  err,
  loadFormats,
  loadTemplateRegistry,
  ok,
} from '@tyto/core';
import { type ExportResources, fileTemplateAssets, nodeFileSystem } from '@tyto/io';
import { TEMPLATE_FILE, type TemplateSource, markupTemplateSource } from '@tyto/pipeline';

import { registerOrigin } from './report.js';

/**
 * The parts of a render that do not change between briefs: the template registry, the
 * project's formats, and the filesystem they were read through.
 *
 * Loaded once and reused, because `tyto watch` renders a folder of tasks against one
 * project and re-reading every manifest per task would make the second render slower than
 * the first for no reason.
 */

export interface RenderContextOptions {
  /** The folder holding one subfolder per template. Absolute. */
  readonly templatesDirectory: string;
  /** The project's `formats.yaml`. Absolute. */
  readonly formatsFile: string;
}

export interface RenderContext {
  readonly fileSystem: FileSystem;
  readonly registry: TemplateRegistry;
  readonly formats: FormatCatalogue;
  /** For `result.json`'s `tyto.templates`: which templates, at which versions, were here. */
  readonly templateVersions: readonly { readonly name: string; readonly version: string }[];
}

/**
 * Reads the project once.
 *
 * A registry `failure` — a folder whose manifest does not parse — is surfaced rather than
 * swallowed: the other templates still work (that is why the registry keeps them separate
 * from an `Err`), but an author whose template silently vanished from `--template` deserves
 * to be told which folder and why. They ride along as warnings-shaped errors, which is what
 * they are: the run may still succeed using a different template.
 */
export async function loadRenderContext(
  options: RenderContextOptions,
): Promise<Result<RenderContext, Diagnostics>> {
  const fileSystem = nodeFileSystem();

  const formats = await loadFormats(fileSystem, options.formatsFile);
  if (!formats.ok) return err(formats.error);

  const registry = await loadTemplateRegistry(fileSystem, options.templatesDirectory);
  if (!registry.ok) return err(registry.error);

  const problems = [
    ...formats.warnings,
    ...registry.warnings,
    ...registry.value.failures.flatMap((failure) => failure.diagnostics),
  ];

  return ok(
    {
      fileSystem,
      registry: registry.value,
      formats: formats.value,
      templateVersions: registry.value
        .list()
        .map((entry) => ({ name: entry.name, version: entry.version })),
    },
    problems,
  );
}

export interface TemplateWiring {
  readonly source: TemplateSource;
  /**
   * The bytes of the `src=` files of whichever template the job ends up loading.
   *
   * Late-bound on purpose. Which template a brief uses is known only after its frontmatter
   * is parsed, which happens **inside** the job, and `JobPorts.resources` has to be handed
   * over before the job starts. The lookup below is therefore empty when the job receives
   * it and filled by the time anything calls it: `runJob` runs its template stage before
   * its render stage, and only the render stage asks an exporter for bytes.
   *
   * This is the same ordering problem `packages/io/src/file-resources.ts` records and
   * TYTO-62 exists to fix properly. Here it is exploitable rather than merely painful,
   * because only one template is ever loaded per job.
   */
  readonly resources: ExportResources;
}

/**
 * A `TemplateSource` that reads the chosen template's own folder for its `src=` files.
 *
 * `markupTemplateSource` leaves this to whoever composes it, because resolving a
 * template's assets means reading a folder eagerly and deciding what counts as one —
 * which is a composition root's call and not a stage's.
 */
export function templateWiring(context: RenderContext): TemplateWiring {
  const loaded: ExportResources[] = [];

  const asset = (ref: AssetRef): string | undefined => {
    for (const resources of loaded) {
      const found = resources.html?.asset?.(ref);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const source: TemplateSource = {
    async load(name) {
      const directory = context.registry.directoryOf(name);
      if (directory === undefined) {
        // Unknown to the registry. Delegated rather than answered here, so the
        // `E_UNKNOWN_TEMPLATE` an author reads is the one wording, with its "available"
        // list, wherever it came from.
        return markupTemplateSource(context.fileSystem, context.registry).load(name);
      }

      const { assets, resources } = await fileTemplateAssets({ base: directory });
      loaded.push(resources);

      const result = await markupTemplateSource(context.fileSystem, context.registry, {
        assets,
      }).load(name);

      // The template file is the source these ranges index, not the brief. Recorded here
      // because this is the only place that knows both.
      const problems = result.ok ? result.warnings : result.error;
      if (problems.length > 0) {
        const path = context.fileSystem.join(directory, TEMPLATE_FILE);
        const source = await context.fileSystem.readFile(path).catch(() => undefined);
        if (source !== undefined) registerOrigin(problems, { path, source });
      }

      return result;
    },
  };

  return { source, resources: { html: { asset }, svg: { asset } } };
}

/** Reads a file the user named on the command line, as a diagnostic rather than a throw. */
export function readFailure(path: string, cause: unknown): Diagnostics {
  return [
    diagnostic('E_INPUT_READ', {
      path,
      problem: cause instanceof Error ? cause.message : String(cause),
    }),
  ];
}
