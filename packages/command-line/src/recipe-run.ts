import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

import { type Diagnostics, hasErrors } from '@tyto/core';
import {
  type RecipeFetch,
  type RecipePlace,
  type RunHeld,
  type RunnerCell,
  createRecipeRunner,
} from '@tyto/io';
import type { RecipeContributions } from '@tyto/plugin-api';
import { type CellValue, type JsonValue, type Plan, type Table, systemClock } from '@tyto/recipe';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK, type ExitCode } from './exit.js';
import type { RecipeParams, SectionOverrides } from './options.js';
import { leftOutPluginFiles, syncPluginFiles } from './plugin-files.js';
import {
  activateBuiltIns,
  activateInstalled,
  loadInstalledPlugins,
  pluginCapabilities,
  withoutRefused,
} from './plugins/index.js';
import { environmentRecipeCredentials } from './recipe-credentials.js';
import { loadRenderContext } from './render-context.js';
import { displayPath, installedOption } from './render.js';
import {
  type LocatedDiagnostic,
  diagnosticsDocument,
  formatDiagnostics,
  json,
  registerUnplaced,
} from './report.js';
import { projectSections } from './sources.js';
import { workspaceOfFolder } from './workspace.js';

/**
 * `tyto recipe run` (TYTO-673): a recipe run from the terminal through the shared runner in
 * `@tyto/io` (ADR 0188), in the workspace that holds the file, with that folder's trust.
 *
 * **Without `--apply` it plans only.** The run is a save's, never a Run's, so no `remember`
 * write is committed and `apply auto` stays a plan (ADR 0140, ADR 0170, TYTO-650): what it
 * prints is what the notebook would show, every cell, every row count and every operation of
 * every plan, and `--json` the whole of it with no cut, payloads and row provenance included.
 * It is not `tyto mcp`'s `run_recipe`, which cuts its answer to an agent's context and leaves
 * the payloads out (ADR 0185): the person typing this owns what the plugins answered.
 *
 * In a restricted folder the command typed is the approval a Run is in the notebook (ADR 0148),
 * as a typed `--section` is (ADR 0147): every cell runs, its data files stay refused and its
 * sections withheld, and the runner commits no state and applies nothing there.
 *
 * **`--apply` applies every plan once, as a click on Apply does**, and only in a trusted folder:
 * the run is a Run, so `apply auto` applies its plans itself and a run whose plans hold no
 * operation commits its `remember` writes; every plan still applicable is then applied in cell
 * order. It is the only way the CLI lends `call` a `send` (ADR 0193 decision 5), with the
 * credentials read from the environment (`recipe-credentials.ts`).
 *
 * Exit codes are ADR 0011's: 1 when a cell failed, an operation failed or any diagnostic is an
 * error, and for a bad command line; 2 for an internal failure.
 */

export interface RecipeRunCommandOptions {
  readonly json?: boolean;
  readonly apply?: boolean;
  readonly param?: RecipeParams;
  readonly section?: SectionOverrides;
}

/** What a test hands in place of the installed plugins' verbs and the platform's `fetch`. */
export interface RecipeRunPorts {
  readonly contributions?: RecipeContributions;
  readonly fetch?: RecipeFetch;
}

/** One cell as `--json` prints it: everything the runner answered, nothing cut. */
export interface RecipeRunCellDocument {
  readonly index: number;
  readonly line: number;
  readonly status: RunnerCell['status'];
  readonly diagnostics: readonly LocatedDiagnostic[];
  readonly table?: {
    readonly columns: readonly { readonly name: string; readonly type: string }[];
    readonly rows: readonly {
      readonly key: string;
      readonly values: Readonly<Record<string, CellValue>>;
      readonly provenance: Table['rows'][number]['provenance'];
    }[];
    readonly total: number;
  };
  readonly plan?: {
    readonly id: number | null;
    readonly applicable: boolean;
    readonly target: string;
    readonly count: number;
    readonly operations: readonly {
      readonly write: string;
      readonly rowKey?: string;
      readonly description: string;
      readonly payload?: JsonValue;
    }[];
  };
  readonly applied?: {
    readonly at: string;
    readonly operations: readonly {
      readonly rowKey?: string;
      readonly status: 'applied' | 'failed' | 'skipped';
      readonly reason?: string;
    }[];
  };
}

export interface RecipeRunDocument {
  readonly recipe: string;
  /** The workspace that holds the recipe and its trust; `null` in no workspace. */
  readonly workspace: { readonly folder: string; readonly trust: 'trusted' | 'restricted' } | null;
  /** Whether `--apply` was given: plans were applied, not only shown. */
  readonly apply: boolean;
  readonly status: 'ok' | 'error';
  readonly held?: RunHeld;
  /** The workspace's and the whole file's: a syntax error, a parameter without a value. */
  readonly diagnostics: readonly LocatedDiagnostic[];
  readonly cells: readonly RecipeRunCellDocument[];
}

export async function recipeRunCommand(
  file: string,
  options: RecipeRunCommandOptions,
  environment: CliEnvironment,
  ports: RecipeRunPorts = {},
): Promise<ExitCode> {
  const { cwd, console } = environment;
  const shown = (path: string): string => displayPath(cwd, path);
  const path = resolve(cwd, file);
  const shownRecipe = shown(path);
  const apply = options.apply === true;

  if (extname(path).toLowerCase() !== '.recipe') {
    console.err(`error: tyto recipe run runs a .recipe file, and ${shownRecipe} is not one\n`);
    return EXIT_DIAGNOSTICS;
  }
  const home = environment.home;
  if (home === undefined) {
    console.err(
      "error: tyto recipe run needs a Tyto home folder (TYTO_HOME), where a recipe's state lives\n",
    );
    return EXIT_INTERNAL;
  }
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.err(`error: cannot read ${shownRecipe}: ${reason}\n`);
    return EXIT_DIAGNOSTICS;
  }

  const workspace = await workspaceOfFolder(dirname(path), {}, environment, shown);
  const workspaceDiagnostics = workspace?.diagnostics ?? [];
  const trust = workspace?.loaded.trust;
  const folder = workspace?.loaded.folder;

  // ADR 0170: a plan is applied only where the folder was trusted. Refused before any plugin
  // starts and any cell runs, so nothing a restricted folder asks for is fetched for nothing.
  if (apply && trust !== 'trusted') {
    if (workspaceDiagnostics.length > 0) console.err(formatDiagnostics(workspaceDiagnostics));
    const where =
      folder === undefined
        ? 'is in no workspace'
        : `is in ${shown(folder)}, a workspace folder nobody trusted`;
    console.err(
      `error: --apply applies a recipe's plans only in a trusted workspace folder, and ${shownRecipe} ${where}; ` +
        'run it without --apply to see its plans, or trust the folder with `tyto trust add` first\n',
    );
    return EXIT_DIAGNOSTICS;
  }

  // As `tyto render` and `tyto mcp` do: the plugin files first, never moving a pinned ref and
  // never asking, and a restricted folder's own plugin files left out with the reason on stderr.
  const pluginFilesWorkspace =
    workspace === undefined
      ? undefined
      : { folder: workspace.loaded.folder, trusted: workspace.loaded.trust === 'trusted' };
  const pluginFiles = await syncPluginFiles(
    {
      home,
      ...(pluginFilesWorkspace === undefined ? {} : { workspace: pluginFilesWorkspace }),
      update: false,
      fetches: true,
      approval: 'never',
    },
    environment,
  );
  registerUnplaced(pluginFiles.diagnostics);
  const leftOut = await leftOutPluginFiles(pluginFilesWorkspace, 'loaded', environment);
  if (leftOut !== '') console.err(leftOut);
  const loaded = await loadInstalledPlugins(home, {
    launch: environment.launch,
    copies: pluginFiles.copies,
    capabilities: pluginCapabilities(environment.variables, {
      hostName: 'tyto recipe run',
      home,
      workspace:
        workspace === undefined
          ? { trust: 'restricted' }
          : { folder: workspace.loaded.folder, trust: workspace.loaded.trust },
    }),
  });

  try {
    const context = await loadRenderContext({
      templatesDirectory: resolve(cwd, 'templates'),
      projectTemplatesDirectories: workspace?.loaded.project.templates ?? [],
      formatsFile: resolve(cwd, 'formats.yaml'),
      templatesDirectoryIsDefault: true,
      formatsFileIsDefault: true,
      ...installedOption(environment, loaded, pluginFiles),
    });
    if (!context.ok) {
      const failed = [...workspaceDiagnostics, ...pluginFiles.diagnostics, ...context.error];
      printFailure(failed, options, environment);
      return EXIT_DIAGNOSTICS;
    }
    const { registry, configurations, refusedPlugins } = context.value;
    const contributions =
      ports.contributions ??
      (() => {
        const host = activateBuiltIns();
        activateInstalled(host, withoutRefused(loaded, refusedPlugins));
        return host.registry;
      })();
    const sections = projectSections(workspace?.loaded, options.section ?? {});
    const place: RecipePlace =
      folder === undefined || trust === undefined ? { trust: 'none' } : { trust, folder };

    const runner = createRecipeRunner({
      contributions,
      placeOf: () => Promise.resolve(place),
      // The runner hands a section on only in a trusted folder (ADR 0147, ADR 0111).
      sectionFor: (_directory, plugin) => sections[plugin],
      home,
      clock: () => systemClock,
      templates: (name) =>
        Promise.resolve(registry.get(configurations.select(name)?.template ?? name)),
      // TYTO-671, ADR 0193 decision 5: `call` sends only under `--apply`, which runs only in a
      // trusted folder; the list is the trusted workspace's, the credentials the environment's.
      calls: {
        hostsFor: () => (trust === 'trusted' ? workspace?.loaded.project.callHosts : undefined),
        credentials: environmentRecipeCredentials(environment.variables ?? {}),
        sends: apply,
        ...(ports.fetch === undefined ? {} : { fetch: ports.fetch }),
      },
    });

    const answer = await runner.run({
      documentId: path,
      text,
      path,
      fresh: true,
      // `saved` runs every cell, sources included, and is not a Run: no state is committed and
      // `apply auto` stays a plan (TYTO-650). `--apply` is a Run; so is any run in a restricted
      // folder, where the runner commits and applies nothing and a save would run no cell.
      saved: true,
      explicit: apply || trust === 'restricted',
      ...(options.param === undefined ? {} : { params: options.param }),
    });

    const cells: RunnerCell[] = [...answer.cells];
    if (apply) {
      for (const [at, cell] of cells.entries()) {
        if (cell.applicable !== true || cell.planId === undefined) continue;
        const after = await runner.apply({
          documentId: path,
          index: cell.index,
          planId: cell.planId,
          path,
        });
        if (after !== undefined) cells[at] = after;
      }
    }

    const primary = { primary: { path: shownRecipe, source: text } };
    const whole: Diagnostics = [
      ...workspaceDiagnostics,
      ...pluginFiles.diagnostics,
      ...answer.diagnostics,
    ];
    const failed =
      hasErrors(whole) ||
      cells.some(
        (cell) =>
          cell.status === 'failed' ||
          hasErrors(cell.diagnostics) ||
          cell.applied?.operations.some((operation) => operation.status === 'failed') === true,
      );

    if (options.json === true) {
      const document: RecipeRunDocument = {
        recipe: shownRecipe,
        workspace:
          folder === undefined || trust === undefined ? null : { folder: shown(folder), trust },
        apply,
        status: failed ? 'error' : 'ok',
        ...(answer.held === undefined ? {} : { held: answer.held }),
        diagnostics: diagnosticsDocument(whole, primary).diagnostics,
        cells: cells.map((cell) => cellDocument(cell, primary)),
      };
      console.out(json(document));
    } else {
      console.out(cells.map((cell) => cellText(cell)).join(''));
      if (answer.held !== undefined) console.out(heldText(answer.held));
      const every = [...whole, ...cells.flatMap((cell) => cell.diagnostics)];
      if (every.length > 0) console.err(formatDiagnostics(every, primary));
    }
    return failed ? EXIT_DIAGNOSTICS : EXIT_OK;
  } finally {
    await loaded.close();
  }
}

function printFailure(
  diagnostics: Diagnostics,
  options: RecipeRunCommandOptions,
  environment: CliEnvironment,
): void {
  if (options.json === true) {
    environment.console.out(json(diagnosticsDocument(diagnostics)));
  } else {
    environment.console.err(formatDiagnostics(diagnostics));
  }
}

function cellDocument(
  cell: RunnerCell,
  scope: { readonly primary: { readonly path: string; readonly source: string } },
): RecipeRunCellDocument {
  return {
    index: cell.index,
    line: cell.line,
    status: cell.status,
    diagnostics: diagnosticsDocument(cell.diagnostics, scope).diagnostics,
    ...(cell.table === undefined ? {} : { table: tableDocument(cell.table) }),
    ...(cell.plan === undefined ? {} : { plan: planDocument(cell.plan, cell) }),
    ...(cell.applied === undefined
      ? {}
      : {
          applied: {
            at: cell.applied.at,
            operations: cell.applied.operations.map((operation) => ({
              ...(operation.rowKey === undefined ? {} : { rowKey: operation.rowKey }),
              status: operation.status,
              ...(operation.reason === undefined ? {} : { reason: operation.reason }),
            })),
          },
        }),
  };
}

function tableDocument(table: Table): NonNullable<RecipeRunCellDocument['table']> {
  return {
    columns: table.columns.map((column) => ({ name: column.name, type: column.type })),
    rows: table.rows.map((row) => ({
      key: row.key,
      values: row.values,
      provenance: row.provenance,
    })),
    total: table.rows.length,
  };
}

function planDocument(plan: Plan, cell: RunnerCell): NonNullable<RecipeRunCellDocument['plan']> {
  return {
    id: cell.planId ?? null,
    applicable: cell.applicable === true,
    target: plan.target,
    count: plan.count,
    operations: plan.operations.map((operation) => ({
      write: operation.write,
      ...(operation.rowKey === undefined ? {} : { rowKey: operation.rowKey }),
      description: operation.description,
      ...(operation.payload === undefined ? {} : { payload: operation.payload }),
    })),
  };
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/**
 * One cell as a person reads it: its line, its status and row count, then every operation of
 * its plan, one per line, and how its Apply went. The rows themselves are `--json`'s.
 */
function cellText(cell: RunnerCell): string {
  const rows = cell.table === undefined ? '' : `, ${plural(cell.table.rows.length, 'row', 'rows')}`;
  const lines = [
    `cell ${String(cell.index + 1)} (line ${String(cell.line)}): ${cell.status}${rows}`,
  ];
  if (cell.plan !== undefined) {
    lines.push(
      `  plan: ${plural(cell.plan.count, 'operation', 'operations')} on ${cell.plan.target}`,
    );
    for (const operation of cell.plan.operations) {
      const row = operation.rowKey === undefined ? '' : ` ${operation.rowKey}`;
      lines.push(`    ${operation.write}${row}: ${operation.description}`);
    }
  }
  if (cell.applied !== undefined) {
    const count = (status: 'applied' | 'failed' | 'skipped'): number =>
      cell.applied?.operations.filter((operation) => operation.status === status).length ?? 0;
    lines.push(
      `  applied at ${cell.applied.at}: ${String(count('applied'))} applied, ` +
        `${String(count('failed'))} failed, ${String(count('skipped'))} skipped`,
    );
    for (const operation of cell.applied.operations) {
      if (operation.status === 'applied') continue;
      const row = operation.rowKey === undefined ? '' : ` ${operation.rowKey}`;
      lines.push(`    ${operation.status}${row}: ${operation.reason ?? ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function heldText(held: RunHeld): string {
  switch (held) {
    case 'apply':
      return 'held: this recipe applies by itself, and only in a trusted folder; its plans were only shown\n';
    case 'restricted':
      return 'held: the folder is restricted, and no cell ran\n';
    case 'source':
      return 'held: a cell that fetches did not run\n';
  }
}
