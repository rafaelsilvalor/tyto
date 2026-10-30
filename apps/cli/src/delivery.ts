import { resolve } from 'node:path';

import {
  type Diagnostic,
  type Diagnostics,
  type Result,
  briefSkeleton,
  builtInDelivery,
  diagnostic,
  err,
  ok,
  planDelivery,
  skeletonText,
} from '@tyto/core';
import { createDelivery } from '@tyto/io';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { NO_PLUGIN_FILES, syncPluginFiles } from './plugin-files.js';
import { loadInstalledPlugins, pluginCapabilities } from './plugins/index.js';
import { loadRenderContext } from './render-context.js';
import { displayPath, installedOption } from './render.js';
import { formatDiagnostics, registerUnplaced } from './report.js';
import { type BriefWorkspace, workspaceOfFolder } from './workspace.js';

/**
 * `tyto delivery new <name> [--template <name>]` — makes one delivery: a folder per piece of
 * work, named after its ticket, with `assets/`, `editaveis/` and the brief in `editaveis/`
 * (TYTO-489, ADR 0157 decision 5).
 *
 * The layout is the workspace's `delivery` key, found by walking up from the current folder as
 * `tyto render` finds a brief's. Outside any workspace the built-in layout is used, with the
 * current folder as the parent and as what the delivery must stay inside (ADR 0157 §3).
 *
 * The brief is the named template's skeleton, the text "New brief from template…" writes in
 * the window (TYTO-440): a configuration's own `brief.skeleton`, else one computed from the
 * manifest with the configuration's formats. With no template the brief is empty, and the
 * window offers the "/" menu on it.
 */

export interface DeliveryNewOptions {
  readonly template?: string;
  /**
   * `--trust`, as on `tyto render`: the workspace and its work profile trusted for this run
   * only. A restricted folder's plugin files are neither fetched nor loaded (ADR 0111), so this
   * is what lets `--template` reach a template or configuration they bring.
   */
  readonly trust?: boolean;
}

export async function deliveryNewCommand(
  name: string,
  options: DeliveryNewOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const { cwd } = environment;
  const shown = (path: string): string => displayPath(cwd, path);
  const workspace = await workspaceOfFolder(cwd, options, environment, shown);
  const root = workspace?.loaded.folder ?? resolve(cwd);
  const layout = workspace?.loaded.project.delivery ?? builtInDelivery(root);
  const reported: Diagnostic[] = [...(workspace?.diagnostics ?? [])];
  const fail = (problems: Diagnostics): ExitCode => {
    registerUnplaced(problems);
    environment.console.err(formatDiagnostics([...reported, ...problems]));
    return EXIT_DIAGNOSTICS;
  };

  // The name before anything slower: a name that cannot be a folder's needs no template.
  const plan = planDelivery(layout, name);
  if (!plan.ok) return fail(plan.error);

  let brief = '';
  if (options.template !== undefined) {
    const skeleton = await skeletonOf(options.template, workspace, environment);
    if (!skeleton.ok) return fail(skeleton.error);
    reported.push(...skeleton.diagnostics);
    brief = skeleton.value;
  }

  const made = await createDelivery(plan.value, { root, brief, shown });
  if (!made.ok) return fail(made.error);

  if (reported.length > 0) environment.console.err(formatDiagnostics(reported));
  // The brief's path on stdout, alone, so a shell can open it: `code $(tyto delivery new …)`.
  environment.console.out(`${shown(plan.value.brief)}\n`);
  return EXIT_OK;
}

/**
 * The text of a new brief for `template`, from the registry a render would use: the project's
 * template folders, the built-in pack and installed plugins, with the plugin files'
 * configurations and aliases. Never moves a pinned ref and never asks, as a render does not.
 */
async function skeletonOf(
  template: string,
  workspace: BriefWorkspace | undefined,
  environment: CliEnvironment,
): Promise<Result<string, Diagnostics>> {
  const { cwd } = environment;
  const pluginFilesWorkspace =
    workspace === undefined
      ? undefined
      : { folder: workspace.loaded.folder, trusted: workspace.loaded.trust === 'trusted' };
  const pluginFiles =
    environment.home === undefined
      ? NO_PLUGIN_FILES
      : await syncPluginFiles(
          {
            home: environment.home,
            ...(pluginFilesWorkspace === undefined ? {} : { workspace: pluginFilesWorkspace }),
            update: false,
            fetches: true,
            approval: 'never',
          },
          environment,
        );
  registerUnplaced(pluginFiles.diagnostics);
  const loaded = await loadInstalledPlugins(environment.home, {
    copies: pluginFiles.copies,
    capabilities: pluginCapabilities(environment.variables, {
      hostName: 'tyto delivery new',
      ...(environment.home === undefined ? {} : { home: environment.home }),
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
    if (!context.ok) return err([...pluginFiles.diagnostics, ...context.error]);

    // An alias reaches the template it configures; a bare name reaches its entry's default.
    const selection = context.value.configurations.select(template);
    const manifest = context.value.registry.get(selection?.template ?? template);
    if (manifest === undefined) {
      const available = context.value.registry.list().map((entry) => entry.name);
      return err([diagnostic('E_UNKNOWN_TEMPLATE', { template, available: available.join(', ') })]);
    }
    // A configuration that restricts its formats offers only those (ADR 0155), as the window's
    // template list does before it writes a skeleton.
    const restriction = selection?.formats;
    const formats =
      restriction === undefined
        ? manifest.formats
        : manifest.formats.filter((format) => restriction.includes(format));
    const brief = selection?.brief;
    const text = skeletonText(
      briefSkeleton({
        name: template,
        formats,
        slots: manifest.slots,
        ...(brief === undefined
          ? {}
          : {
              configured: {
                skeleton: brief.skeleton,
                formats: brief.formats,
                filled: Object.keys(brief.slots),
              },
            }),
      }),
    );
    return ok(text, [...pluginFiles.diagnostics, ...context.diagnostics]);
  } finally {
    await loaded.close();
  }
}
