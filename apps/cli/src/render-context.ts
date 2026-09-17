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
import { createPluginHost } from '@tyto/plugin-api';
import { TEMPLATE_FILE, type TemplateSource, markupTemplateSource } from '@tyto/pipeline';

import {
  builtInTemplatesDirectory,
  packDirectories,
  templatePackPlugin,
} from './plugins/templates.js';
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
  /** The folder holding one subfolder per template. Absolute. Searched first. */
  readonly templatesDirectory: string;
  /** The project's `formats.yaml`. Absolute. */
  readonly formatsFile: string;
  /**
   * Where the built-in pack lives, when it is not where `@tyto/templates` put it.
   *
   * For a test that wants a pack it built itself. Left out, the real one is resolved.
   */
  readonly builtInTemplatesDirectory?: string;
  /**
   * True when `templatesDirectory` is the default rather than a folder somebody named.
   *
   * It decides one thing: whether the folder not existing is worth saying. A project with
   * no `templates/` of its own now renders from the built-in pack (ADR 0020), so reporting
   * a folder the user never mentioned would be noise on every such run. A folder they did
   * type and do not have is still a mistake worth reading about.
   */
  readonly templatesDirectoryIsDefault?: boolean;
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

  // The built-in pack, through the extension point rather than past it (ADR 0007). What
  // the registry searches below is what the host holds: a pack registered and never read
  // would be an extension point nobody could tell was broken.
  //
  // The host's lifetime is the project's, not the render's. `activateBuiltIns` builds one
  // per task because an exporter binds the bytes of the folder it is rendering; a template
  // pack has no such tie, and re-reading its manifests per task would make the second
  // render slower than the first for nothing.
  const packDirectory = options.builtInTemplatesDirectory ?? builtInTemplatesDirectory();
  const pack = await loadTemplateRegistry(fileSystem, packDirectory);

  const host = createPluginHost();
  host.activate(
    templatePackPlugin({
      directory: packDirectory,
      // Read from the pack's own folder, and not filtered out of the merged registry
      // below. A pack declares what it ships; what survives a merge it was an input to is
      // a different question with a different answer.
      templates: pack.ok ? pack.value.list() : [],
    }),
  );

  // Project first: a folder the user pointed at is a more specific statement of intent
  // than a package that came along with the program, so their `promo-curso` is the one
  // that renders and the built-in is reported as shadowed (ADR 0020).
  const registry = await loadTemplateRegistry(fileSystem, [
    options.templatesDirectory,
    ...packDirectories(host.registry.templatePacks()),
  ]);
  if (!registry.ok) return err(registry.error);

  // A failure on the default `templates/` folder is dropped, and only that one: the user
  // never named it, the pack answered anyway, and every run in a project without one would
  // otherwise open with a complaint about a folder nobody asked for.
  const silenced =
    options.templatesDirectoryIsDefault === true ? options.templatesDirectory : undefined;

  const problems = [
    ...formats.diagnostics,
    ...registry.diagnostics,
    ...registry.value.failures
      .filter((failure) => failure.directory !== silenced)
      .flatMap((failure) => failure.diagnostics),
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
      const problems = result.ok ? result.diagnostics : result.error;
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
