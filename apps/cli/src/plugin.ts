import type { Diagnostic } from '@tyto/core';
import { type PluginManifest, type PluginOrigin, validatePluginManifest } from '@tyto/plugin-api';

import type { CliEnvironment } from './environment.js';
import { EXIT_INTERNAL, EXIT_OK, type ExitCode } from './exit.js';
import { BUILT_IN_MANIFESTS } from './plugins/index.js';
import { formatDiagnostics, json } from './report.js';

/**
 * `tyto plugin list` — the read half of the lifecycle in `docs/plugin-api.md`.
 *
 * `install`, `disable` and `remove` are the loader's (E11.1) and are not here: there is
 * nothing to install yet, and a command that could only ever answer "nothing" would be a
 * promise rather than a feature. What `list` can answer today is the honest one — every
 * built-in, its version, the extension points it contributes to, and where it came from.
 *
 * **It validates rather than trusts.** Each manifest goes through the same
 * `validatePluginManifest` a loaded plugin's file will, so a built-in whose
 * `tyto-plugin.json` stopped matching the schema is reported here instead of surfacing as
 * a `TypeError` on the next render.
 */

export interface PluginListOptions {
  readonly json: boolean;
}

/** One row of the listing: a validated manifest plus the one thing it cannot say itself. */
interface ListedPlugin {
  readonly manifest: PluginManifest;
  readonly origin: PluginOrigin;
}

interface PluginListDocument {
  readonly status: 'ok';
  readonly plugins: readonly {
    readonly name: string;
    readonly version: string;
    readonly engine: string;
    readonly contributes: readonly string[];
    readonly permissions: readonly string[];
    readonly origin: PluginOrigin;
  }[];
}

/** Left-pads to a common width so the columns line up without a table library. */
function column(values: readonly string[]): (value: string) => string {
  const width = Math.max(0, ...values.map((value) => value.length));
  return (value) => value.padEnd(width);
}

function formatList(plugins: readonly ListedPlugin[]): string {
  const name = column(plugins.map((plugin) => plugin.manifest.name));
  const version = column(plugins.map((plugin) => plugin.manifest.version));
  const origin = column(plugins.map((plugin) => plugin.origin));

  return `${plugins
    .map(
      (plugin) =>
        `${name(plugin.manifest.name)}  ${version(plugin.manifest.version)}  ` +
        `${origin(plugin.origin)}  ${plugin.manifest.contributes.join(', ')}`,
    )
    .join('\n')}\n`;
}

function document(plugins: readonly ListedPlugin[]): PluginListDocument {
  return {
    status: 'ok',
    plugins: plugins.map((plugin) => ({
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      engine: plugin.manifest.engine,
      contributes: plugin.manifest.contributes,
      permissions: plugin.manifest.permissions,
      origin: plugin.origin,
    })),
  };
}

export function pluginListCommand(
  options: PluginListOptions,
  environment: CliEnvironment,
): ExitCode {
  const listed: ListedPlugin[] = [];
  const problems: Diagnostic[] = [];

  for (const manifest of BUILT_IN_MANIFESTS) {
    const validated = validatePluginManifest(manifest);
    if (validated.ok) {
      listed.push({ manifest: validated.value, origin: 'built-in' });
    } else {
      problems.push(...validated.error);
    }
  }

  if (problems.length > 0) {
    // Exit 2, not 1. A diagnostic about a brief is something the caller can fix and retry;
    // a built-in shipping a manifest that does not validate is this repository's own bug,
    // and ADR 0011 reserves the retryable code for the first kind.
    if (options.json) {
      environment.console.out(json({ status: 'error', plugins: [] }));
    }
    environment.console.err(formatDiagnostics(problems));
    return EXIT_INTERNAL;
  }

  environment.console.out(options.json ? json(document(listed)) : formatList(listed));
  return EXIT_OK;
}
