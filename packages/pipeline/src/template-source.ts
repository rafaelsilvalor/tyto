import {
  type Diagnostics,
  type FileSystem,
  type Result,
  type Template,
  type TemplateRegistry,
  diagnostic,
  err,
} from '@tyto/core';
import { type TemplateAssets, compileTemplate } from '@tyto/template-lang';

/**
 * Where a job gets the template *function*.
 *
 * `TemplateRegistry` in `core` answers what a template *declares* — it reads manifests and
 * never executes anything, which is what lets a picker list templates and a brief be
 * validated before any output is asked for. But `compile` needs a `Template`: a manifest
 * **and** a build function. Nothing in `core` can produce one, because producing one means
 * reading a `template.html` off a disk or importing a `template.ts`, and `core` is pure.
 *
 * So it is a port, and the job takes it injected. The gap is worth naming: the card lists
 * `TemplateRegistry`, `Rasterizer` and `FileSystem` as the ports a job needs, and those
 * three are not enough to reach `compile`.
 */
export interface TemplateSource {
  load(name: string): Promise<Result<Template, Diagnostics>>;
}

/**
 * The slots a template's body draws, when the template knows.
 *
 * `compileTemplate` returns an `HtmlTemplate`, which carries them; a `template.ts` is a
 * plain `Template` and does not, because knowing would mean reading its code. The job
 * hands them to `resolve` as `renderedSlots` when they exist and passes nothing when they
 * do not, which is the difference between W_UNUSED_SLOT being accurate and being guessed.
 */
export function renderedSlotsOf(template: Template): readonly string[] | undefined {
  const candidate = template as Partial<{ readonly renderedSlots: readonly string[] }>;
  return Array.isArray(candidate.renderedSlots) ? candidate.renderedSlots : undefined;
}

/** The file a markup template lives in (`docs/template-authoring.md`). */
export const TEMPLATE_FILE = 'template.html';

export interface MarkupTemplateSourceOptions {
  /**
   * The files beside `template.html` that its `src=` attributes name.
   *
   * Left to the caller because resolving them means reading a folder eagerly and deciding
   * what counts as an asset, which is the template pack's business (E4.4) and the CLI's
   * (E6.3). A template with no `src` needs none, and one that has them without this gets
   * the diagnostic `template-lang` already writes for an unresolved path.
   */
  readonly assets?: TemplateAssets;
}

/**
 * A `TemplateSource` that reads `template.html` through the `FileSystem` port and compiles
 * it with `template-lang` (ADR 0005).
 *
 * Only the markup path. A `template.ts` is code, and running code that arrived from a
 * folder is the plugin host's job with its permissions and its isolation (ADR 0007, E7.1)
 * — not something a render job should do on the way past.
 */
export function markupTemplateSource(
  fileSystem: FileSystem,
  registry: TemplateRegistry,
  options: MarkupTemplateSourceOptions = {},
): TemplateSource {
  return {
    async load(name: string): Promise<Result<Template, Diagnostics>> {
      const manifest = registry.get(name);
      const directory = registry.directoryOf(name);

      if (manifest === undefined || directory === undefined) {
        return err([
          diagnostic('E_UNKNOWN_TEMPLATE', {
            template: name,
            available: registry
              .list()
              .map((entry) => entry.name)
              .join(', '),
          }),
        ]);
      }

      const path = fileSystem.join(directory, TEMPLATE_FILE);
      let source: string;
      try {
        source = await fileSystem.readFile(path);
      } catch (cause) {
        return err([
          diagnostic('E_TEMPLATE_READ', {
            path,
            problem: cause instanceof Error ? cause.message : String(cause),
          }),
        ]);
      }

      return compileTemplate(
        source,
        options.assets === undefined ? { manifest } : { manifest, assets: options.assets },
      );
    },
  };
}
