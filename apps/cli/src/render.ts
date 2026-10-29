import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';

import type { Diagnostics } from '@tyto/core';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { NO_PLUGIN_FILES, type SyncedPluginFiles, syncPluginFiles } from './plugin-files.js';
import {
  type OutputKind,
  type SectionOverrides,
  needsRasterizer,
  outputRequests,
  unavailableTypes,
} from './options.js';
import {
  type LoadedPlugins,
  loadInstalledPlugins,
  pluginCapabilities,
  pluginFolders,
  reachableExporters,
  withoutRefused,
} from './plugins/index.js';
import { type RenderContextOptions, loadRenderContext, readFailure } from './render-context.js';
import { renderTask } from './render-task.js';
import { googleFontsOption } from './google-fonts.js';
import { optionalSources, renderSources } from './sources.js';
import { diagnosticsDocument, formatDiagnostics, json } from './report.js';
import { workspaceOfBrief } from './workspace.js';

/**
 * `tyto render <brief> --out <dir>` — the contract command (ADR 0011).
 *
 * It writes the artifacts and a `result.json` into `--out` and nothing anywhere else, so
 * the folder it produces is the same folder `tyto watch` produces for the same task. That
 * is what lets the watcher double as a Jacurutu simulator.
 */

export interface RenderCommandOptions {
  /**
   * `--out`. Optional since TYTO-278: absent, the brief's workspace's `output` folder is used,
   * and with neither the run stops before reading anything else.
   */
  readonly out?: string;
  /** `--trust`: the brief's workspace is trusted for this run, never written down (ADR 0111). */
  readonly trust?: boolean;
  /**
   * `--folder`: deliver into `<out>/<brief-name>/` instead of into `<out>` itself.
   *
   * Off by default and off for every caller that does not type it, which is what keeps the
   * ADR 0011 contract byte for byte what `docs/render-contract.md` publishes.
   */
  readonly folder?: boolean;
  readonly template?: string;
  readonly formats?: readonly string[];
  readonly types: readonly OutputKind[];
  readonly scale?: number;
  readonly quality?: number;
  readonly templates: string;
  /**
   * True when `--templates` was typed rather than defaulted.
   *
   * A folder the user named and does not have is a mistake worth reporting; the default
   * `templates/` not existing is not, now that a project with no folder of its own still
   * renders from the built-in pack (ADR 0020).
   */
  readonly templatesNamed?: boolean;
  readonly formatsFile: string;
  /**
   * True when `--formats-file` was typed rather than defaulted: a file somebody named and
   * does not have is `E_FORMATS_READ`, while the default one not being there falls back to
   * the built-in pack's formats, as the window does (TYTO-336).
   */
  readonly formatsNamed?: boolean;
  readonly assets?: string;
  readonly concurrency?: number;
  readonly json: boolean;
  /** `--no-google-fonts` makes this false; on by default (ADR 0120). */
  readonly googleFonts?: boolean;
  /**
   * `--section <plugin>.<key>=<value>`, repeated: keys over the plugin's section of the
   * project for this run, applied in a restricted folder too (ADR 0147).
   */
  readonly section?: SectionOverrides;
}

/**
 * Stripped from the brief's file name to get the delivery folder's, and nothing else.
 *
 * A brief named something other than `.brief` keeps its whole name as the folder's, which is
 * the honest answer: `basename` removes a suffix only when it is there.
 */
const BRIEF_SUFFIX = '.brief';

/** What `loadRenderContext` needs to search installed packs, when there is a home to read. */
export function installedOption(
  environment: CliEnvironment,
  plugins: LoadedPlugins,
  pluginFiles: SyncedPluginFiles = NO_PLUGIN_FILES,
): Pick<RenderContextOptions, 'installed'> {
  return environment.home === undefined
    ? {}
    : {
        installed: {
          plugins,
          folderOf: pluginFolders(environment.home, pluginFiles.copies),
          pluginFiles,
        },
      };
}

/** Paths are printed as the user would type them, not as this machine stores them. */
export function displayPath(cwd: string, path: string): string {
  const shown = relative(cwd, path);
  return shown === '' || shown.startsWith('..') ? path : shown;
}

/** Prints a run that never got as far as a job: no artifacts, no `result.json`. */
function reportFailure(
  diagnostics: Diagnostics,
  options: RenderCommandOptions,
  environment: CliEnvironment,
  primary?: { readonly path: string; readonly source: string },
): ExitCode {
  const scope = primary === undefined ? {} : { primary };
  if (options.json) {
    environment.console.out(json(diagnosticsDocument(diagnostics, scope)));
  } else {
    environment.console.err(formatDiagnostics(diagnostics, scope));
  }
  return EXIT_DIAGNOSTICS;
}

export async function renderCommand(
  brief: string,
  options: RenderCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const { cwd } = environment;
  const briefPath = isAbsolute(brief) ? brief : resolve(cwd, brief);
  const shownBrief = displayPath(cwd, briefPath);

  let source: string;
  try {
    source = await readFile(briefPath, 'utf8');
  } catch (cause) {
    return reportFailure(readFailure(shownBrief, cause), options, environment);
  }

  // The workspace before anything else, because it decides where the run writes; a run with
  // nowhere to write stops here, with whatever the project file said printed first so the
  // refusal explains itself (a restricted folder's `output` that led outside, say).
  const workspace = await workspaceOfBrief(briefPath, options, environment, (path) =>
    displayPath(cwd, path),
  );
  const projectDiagnostics = workspace?.diagnostics ?? [];
  const project = workspace?.loaded.project;
  const out = options.out === undefined ? project?.output : resolve(cwd, options.out);
  if (out === undefined) {
    if (projectDiagnostics.length > 0)
      environment.console.err(formatDiagnostics(projectDiagnostics));
    environment.console.err(
      workspace === undefined
        ? "error: required option '-o, --out <dir>' not specified\n"
        : `error: --out is required: ${displayPath(cwd, workspace.loaded.file)} declares no output folder this run may use\n`,
    );
    return EXIT_DIAGNOSTICS;
  }

  // Before the project, because an installed plugin's template pack is part of it: the
  // registry a brief is resolved against has to be able to find its templates (ADR 0046).
  // A plugin's cache lives in `TYTO_HOME`; its workspace files are the brief's folder's, with
  // that folder's trust, and a brief in no workspace answers that none is open (ADR 0138).
  // The plugin files first: their copies load as installed plugins. A render never moves a
  // pinned ref and never asks, so it reaches the network only for a copy the cache lacks
  // (ADR 0151 decision 3); a plugin nobody approved is skipped with the reason.
  const pluginFiles =
    environment.home === undefined
      ? NO_PLUGIN_FILES
      : await syncPluginFiles(
          {
            home: environment.home,
            ...(workspace === undefined
              ? {}
              : {
                  workspace: {
                    folder: workspace.loaded.folder,
                    trusted: workspace.loaded.trust === 'trusted',
                  },
                }),
            update: false,
            fetches: true,
            approval: 'never',
          },
          environment,
        );
  const loaded = await loadInstalledPlugins(environment.home, {
    copies: pluginFiles.copies,
    capabilities: pluginCapabilities(environment.variables, {
      hostName: 'tyto render',
      ...(environment.home === undefined ? {} : { home: environment.home }),
      workspace:
        workspace === undefined
          ? { trust: 'restricted' }
          : { folder: workspace.loaded.folder, trust: workspace.loaded.trust },
    }),
  });
  const context = await loadRenderContext({
    templatesDirectory: resolve(cwd, options.templates),
    projectTemplatesDirectories: project?.templates ?? [],
    formatsFile: resolve(cwd, options.formatsFile),
    templatesDirectoryIsDefault: options.templatesNamed !== true,
    formatsFileIsDefault: options.formatsNamed !== true,
    ...installedOption(environment, loaded, pluginFiles),
  });
  if (!context.ok) {
    await loaded.close();
    return reportFailure([...pluginFiles.diagnostics, ...context.error], options, environment, {
      path: shownBrief,
      source,
    });
  }

  const plugins = withoutRefused(loaded, context.value.refusedPlugins);
  const { exporters, warnings: skipped } = reachableExporters(plugins);
  const unavailable = unavailableTypes(options.types, exporters);
  if (unavailable !== undefined) {
    // The skipped plugins first: when a kind is missing, the reason is usually one of them.
    if (skipped.length > 0) environment.console.err(formatDiagnostics(skipped));
    environment.console.err(`error: ${unavailable}
`);
    await plugins.close();
    return EXIT_DIAGNOSTICS;
  }

  const rasterizer = needsRasterizer(options.types, exporters)
    ? environment.rasterizer()
    : undefined;

  try {
    const report = await renderTask(
      context.value,
      {
        id: shownBrief,
        brief: source,
        briefPath: shownBrief,
        briefDirectory: resolve(briefPath, '..'),
        ...(options.assets === undefined ? {} : { assetsOverride: options.assets }),
        ...(project === undefined ? {} : { projectAssets: project.assets }),
        outDirectory: out,
        // `basename` and nothing else. The name comes off a file that exists, so it is
        // already legal here, and a second sanitiser is what `artifact.ts` warns against.
        ...(options.folder === true
          ? { delivery: { name: basename(briefPath, BRIEF_SUFFIX) } }
          : {}),
      },
      {
        outputs: outputRequests(options),
        version: environment.version,
        plugins,
        ...(options.template === undefined ? {} : { template: options.template }),
        ...(options.formats === undefined ? {} : { formats: options.formats }),
        ...(rasterizer === undefined ? {} : { rasterizer }),
        ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
        ...(project === undefined ? {} : { fontDirectories: project.fonts }),
        ...optionalSources(renderSources(environment.home, workspace?.loaded, options.section)),
        ...googleFontsOption(options.googleFonts, environment.variables),
      },
      [...projectDiagnostics, ...pluginFiles.diagnostics, ...context.diagnostics],
    );

    const scope = { primary: { path: shownBrief, source } };

    if (options.json) {
      environment.console.out(
        json({
          status: report.result.status,
          cancelled: report.result.cancelled,
          planned: report.result.planned,
          artifacts: report.result.artifacts,
          // Located, unlike the `result.json` on disk: that document is the ADR 0011
          // contract and carries offsets, and adding a line number to it would be a
          // change to a schema the other side validates.
          diagnostics: diagnosticsDocument(report.diagnostics, scope).diagnostics,
        }),
      );
    } else {
      if (report.diagnostics.length > 0) {
        environment.console.err(formatDiagnostics(report.diagnostics, scope));
      }
      // Names on stdout, one per line, so a shell can pipe them somewhere.
      for (const artifact of report.result.artifacts) environment.console.out(`${artifact.name}\n`);
    }

    return report.ok ? EXIT_OK : EXIT_DIAGNOSTICS;
  } finally {
    await rasterizer?.close?.();
    // Every plugin's process, and any crash still being written to plugins.json.
    await plugins.close();
  }
}
