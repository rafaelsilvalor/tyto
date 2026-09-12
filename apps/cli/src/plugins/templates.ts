import type { TemplateManifest } from '@tyto/core';
import type { Plugin } from '@tyto/plugin-api';

/**
 * The `template-pack` extension point's built-in.
 *
 * **It registers nothing today.** TYTO-25 shipped the folders — `promo-curso` and
 * `carrossel-lista` are real templates under `packages/templates/templates/` — and
 * deliberately stopped short of registering them. What is missing is a decision, not code:
 * how a published package's directory is located at runtime, and what happens when a
 * built-in pack and a `--templates <dir>` both offer the same name. That spans this app,
 * `pipeline` and `templates`, so it wants an ADR.
 *
 * What a project renders with today still comes from `--templates <dir>` through
 * `loadTemplateRegistry`, which is a folder on a disk and not a pack — and the built-in
 * folders work that way too, which is how the contract test drives them.
 */

export interface TemplatePackOptions {
  readonly id?: string;
  readonly templates?: readonly TemplateManifest[];
  readonly directory?: string;
}

export function templatePackPlugin(options: TemplatePackOptions = {}): Plugin {
  const id = options.id ?? 'built-in-templates';

  return {
    id,
    activate: (host) =>
      host.registerTemplatePack({
        id,
        templates: options.templates ?? [],
        ...(options.directory === undefined ? {} : { directory: options.directory }),
      }),
  };
}
