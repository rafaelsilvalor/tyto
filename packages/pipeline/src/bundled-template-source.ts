import {
  type Diagnostics,
  type FileSystem,
  type Result,
  type Template,
  type TemplateBuild,
  type TemplateRegistry,
  defineTemplate,
  diagnostic,
  err,
  ok,
} from '@tyto/core';

import { TEMPLATE_FILE, type TemplateSource } from './template-source.js';

/**
 * The other half of ADR 0005: a template whose body is code rather than markup.
 *
 * ## What this is not
 *
 * It is **not** a loader. Nothing here reads a path, imports a module or executes anything
 * a scan discovered. Running code that arrived in a folder is the plugin host's job, with
 * its permissions and its isolation (ADR 0007), and `markupTemplateSource` says so where
 * it refuses the same thing.
 *
 * What this serves is code the build already holds: a first-party template compiled and
 * shipped with the application, exactly like the built-in pack. The caller hands over the
 * functions; this pairs each with the manifest the registry already parsed.
 *
 * ## Why the manifest is not the module's to declare
 *
 * The registry answers what templates exist and what each declares **without importing a
 * line of template code**, so a picker can list templates nobody asked to run. A manifest
 * written in TypeScript would make opening that picker execute every template on the
 * machine. So the YAML stays the only manifest and the module contributes only its
 * `build`; the two meet here, which is the first place that has both.
 */

/** The build functions an application ships, by the manifest name each one draws. */
export type BundledTemplates = Readonly<Record<string, TemplateBuild>>;

export interface BundledTemplateSourceOptions {
  /** Where the manifests come from; a bundled name still declares itself in YAML. */
  readonly registry: TemplateRegistry;
  readonly fileSystem: FileSystem;
  readonly bundled: BundledTemplates;
  /** Where a name this source does not hold goes, unchanged. */
  readonly markup: TemplateSource;
}

/**
 * A source that serves bundled code and delegates everything else.
 *
 * Delegation rather than a second `E_UNKNOWN_TEMPLATE`: an unknown name should read the
 * same way whichever route was asked first, with the same "available" list, so only one
 * place words it.
 */
export function bundledTemplateSource(options: BundledTemplateSourceOptions): TemplateSource {
  return {
    async load(name: string): Promise<Result<Template, Diagnostics>> {
      const build = options.bundled[name];
      if (build === undefined) return options.markup.load(name);

      const manifest = options.registry.get(name);
      // Shipped code for a name no manifest declares. The markup route owns the wording
      // for a name nobody declared, and it is the same failure whoever noticed it.
      if (manifest === undefined) return options.markup.load(name);

      const directory = options.registry.directoryOf(name);
      if (directory !== undefined && (await hasMarkup(options.fileSystem, directory))) {
        return err([diagnostic('E_TEMPLATE_AMBIGUOUS', { name, file: TEMPLATE_FILE, directory })]);
      }

      return ok(defineTemplate(manifest, build));
    },
  };
}

/**
 * Whether the folder holds a markup body too.
 *
 * An unreadable folder answers "no" rather than throwing. The registry got a manifest out
 * of this directory moments ago, so a read failing here is a race or a permission change
 * mid-render; refusing to build over it would replace a template that works with an error
 * about a file the author does not have.
 */
async function hasMarkup(fileSystem: FileSystem, directory: string): Promise<boolean> {
  try {
    const entries = await fileSystem.readDirectory(directory);
    return entries.some((entry) => !entry.isDirectory && entry.name === TEMPLATE_FILE);
  } catch {
    return false;
  }
}
