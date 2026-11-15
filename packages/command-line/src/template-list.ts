import { resolve } from 'node:path';

import type { Diagnostics } from '@tyto/core';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import type { RenderContext, TemplateOrigin } from './render-context.js';
import { displayPath } from './render.js';
import { formatDiagnostics, json } from './report.js';
import { templatesInReach } from './templates-in-reach.js';
import { workspaceOfFolder } from './workspace.js';

/**
 * `tyto template list [folder]` — every template a render in that folder can use (TYTO-728):
 * its name, where it came from, and the formats it renders.
 *
 * Read from `templatesInReach`, the steps `tyto render` resolves `template:` through, so a name
 * this prints is one a render there accepts and a name it leaves out is one a render refuses.
 * An alias is a row of its own, as a brief writes it (ADR 0151), with the template it reaches.
 * A configuration that restricts its formats (ADR 0155) lists only those, as a render offers.
 *
 * A restricted folder lists what a restricted render can use: its plugin files are neither
 * fetched nor loaded, and stderr says they were left out. `--trust` trusts it for this run.
 */

export interface TemplateListOptions {
  /** A folder inside the workspace a render would run in; the cwd when absent. */
  readonly folder?: string;
  readonly json: boolean;
  /** As on `tyto render`: the workspace trusted for this run only, never written down. */
  readonly trust?: boolean;
}

/** One row: a template, or an alias of one. */
export interface ListedTemplate {
  readonly name: string;
  readonly origin: TemplateOrigin['kind'];
  /** The plugin, when `origin` is `plugin`. */
  readonly plugin?: string;
  readonly formats: readonly string[];
  /** The template an alias reaches. */
  readonly aliasOf?: string;
}

/** The rows, in name order: what a render in the context can resolve `template:` to. */
export function listedTemplates(context: RenderContext): readonly ListedTemplate[] {
  const { registry, configurations } = context;
  const row = (name: string, template: string, aliasOf?: string): ListedTemplate[] => {
    const manifest = registry.get(template);
    const origin = context.originOf(template);
    if (manifest === undefined || origin === undefined) return [];
    const restriction = configurations.select(name)?.formats;
    const formats =
      restriction === undefined
        ? manifest.formats
        : manifest.formats.filter((format) => restriction.includes(format));
    return [
      {
        name,
        origin: origin.kind,
        ...(origin.kind === 'plugin' ? { plugin: origin.plugin } : {}),
        formats: [...formats],
        ...(aliasOf === undefined ? {} : { aliasOf }),
      },
    ];
  };
  return [
    ...registry.list().flatMap((manifest) => row(manifest.name, manifest.name)),
    ...configurations
      .aliases()
      .flatMap((alias) => row(alias.alias, alias.template, alias.template)),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

/** Left-pads to a common width so the columns line up without a table library. */
function column(values: readonly string[]): (value: string) => string {
  const width = Math.max(0, ...values.map((value) => value.length));
  return (value) => value.padEnd(width);
}

function formatRows(rows: readonly ListedTemplate[]): string {
  if (rows.length === 0) return '';
  const nameOf = (row: ListedTemplate): string =>
    row.aliasOf === undefined ? row.name : `${row.name} → ${row.aliasOf}`;
  const originOf = (row: ListedTemplate): string =>
    row.plugin === undefined ? row.origin : `plugin ${row.plugin}`;
  const name = column(rows.map(nameOf));
  const origin = column(rows.map(originOf));
  return `${rows
    .map((row) =>
      `${name(nameOf(row))}  ${origin(originOf(row))}  ${row.formats.join(', ')}`.trimEnd(),
    )
    .join('\n')}\n`;
}

export async function templateListCommand(
  options: TemplateListOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const { cwd } = environment;
  const shown = (path: string): string => displayPath(cwd, path);
  const folder = resolve(cwd, options.folder ?? '.');
  const workspace = await workspaceOfFolder(
    folder,
    options.trust === true ? { trust: true } : {},
    environment,
    shown,
  );
  const reach = await templatesInReach(
    { workspace, hostName: 'tyto template list', folder, leftOutAs: 'listed' },
    environment,
  );
  try {
    const { context, pluginFiles } = reach;
    const said: Diagnostics = [...(workspace?.diagnostics ?? []), ...pluginFiles.diagnostics];
    if (!context.ok) {
      environment.console.err(formatDiagnostics([...said, ...context.error]));
      return EXIT_DIAGNOSTICS;
    }
    const rows = listedTemplates(context.value);
    environment.console.out(options.json ? json({ templates: rows }) : formatRows(rows));
    // On stderr in both modes: `--json`'s stdout is one document. Said, not hidden: a template
    // missing from the list owes the reason, as a render would print it.
    if (reach.leftOut !== '') environment.console.err(reach.leftOut);
    const problems = [...said, ...context.diagnostics];
    if (problems.length > 0) environment.console.err(formatDiagnostics(problems));
    return EXIT_OK;
  } finally {
    await reach.plugins.close();
  }
}
