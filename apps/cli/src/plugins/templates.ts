import type { TemplateManifest } from '@tyto/core';
import type { Plugin } from '@tyto/plugin-api';

/**
 * The `template-pack` extension point's built-in.
 *
 * **It registers nothing today.** `@tyto/templates` is an empty stub — epic E4 has not
 * shipped `promo-curso` or `carrossel-lista` yet (TYTO-25) — so there is no built-in pack
 * to contribute. The module exists anyway, because the alternative is discovering at E4
 * that nobody ever checked whether a pack can be registered at all.
 *
 * What a project actually renders with today comes from `--templates <dir>` through
 * `loadTemplateRegistry`, which is a folder on a disk and not a pack. Merging the two is
 * E4.4's problem, not this card's.
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
