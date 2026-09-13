import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { TemplateManifest } from '@tyto/core';
import type { Plugin, TemplatePack } from '@tyto/plugin-api';
import { BUILT_IN_TEMPLATES_DIRECTORY } from '@tyto/templates';

import manifest from './built-in-templates.tyto-plugin.json';

/**
 * The `template-pack` extension point's built-in (ADR 0020).
 *
 * TYTO-25 shipped the folders — `promo-curso` and `carrossel-lista` under
 * `packages/templates/templates/` — and deliberately stopped short of registering them,
 * because two questions had no obvious default: how a pure package's folder is located at
 * runtime, and what happens when a built-in pack and a `--templates <dir>` both offer the
 * same name. ADR 0020 answers both; this file is the first half of the answer.
 *
 * **Resolving a path is Node work, and this is the composition root** (ADR 0010).
 * `@tyto/templates` stays pure and owns only the name of its subfolder; the resolver runs
 * here, from the package's own `package.json`, which is what makes the path right in a
 * workspace (through the symlink), in a published install, and inside an Electron `asar`,
 * where Electron patches both the resolver and `fs`.
 */

export interface TemplatePackOptions {
  /** The manifests the registry already read out of {@link directory}. */
  readonly templates?: readonly TemplateManifest[];
  /** Overrides the resolved built-in folder. For a test with a pack of its own. */
  readonly directory?: string;
}

/**
 * Where `@tyto/templates` put its folder, on this machine, right now.
 *
 * Assembled from the package's own `package.json` rather than from a guess about where
 * `node_modules` is: the guess is wrong in a pnpm workspace, wrong again in an `asar`, and
 * wrong in a way that only shows up on somebody else's install.
 *
 * Throws when the package is not installed at all, which is an internal failure (exit 2)
 * and not a diagnostic about anybody's brief — nothing a caller typed could cause it.
 */
export function builtInTemplatesDirectory(): string {
  const packageJson = createRequire(import.meta.url).resolve('@tyto/templates/package.json');
  return join(dirname(packageJson), BUILT_IN_TEMPLATES_DIRECTORY);
}

/**
 * The pack, as the extension point takes it.
 *
 * `templates` arrives already read, because reading manifests is the registry's job and
 * doing it twice would be two answers to one question. The contribution carries the
 * `directory` too: a manifest says what a template declares, and rendering still has to
 * find `template.html` and the `src=` files beside it.
 */
export function templatePackPlugin(options: TemplatePackOptions = {}): Plugin {
  const id = manifest.name;
  const directory = options.directory ?? builtInTemplatesDirectory();

  return {
    id,
    manifest,
    activate: (host) =>
      host.registerTemplatePack({
        id,
        templates: options.templates ?? [],
        directory,
      }),
  };
}

/** The directories a list of packs contributes, in registration order. */
export function packDirectories(packs: readonly TemplatePack[]): readonly string[] {
  return packs
    .map((pack) => pack.directory)
    .filter((value): value is string => value !== undefined);
}
