import { resolve } from 'node:path';

import type { Diagnostics, Result } from '@tyto/core';

import type { CliEnvironment } from './environment.js';
import {
  NO_PLUGIN_FILES,
  type SyncedPluginFiles,
  leftOutPluginFiles,
  syncPluginFiles,
} from './plugin-files.js';
import {
  type LoadedPlugins,
  loadInstalledPlugins,
  pluginCapabilities,
  pluginFolders,
} from './plugins/index.js';
import {
  type RenderContext,
  type RenderContextOptions,
  loadRenderContext,
} from './render-context.js';
import { registerUnplaced } from './report.js';
import { cliSigninCapabilities } from './signin.js';
import type { BriefWorkspace } from './workspace.js';

/**
 * The templates a run in a folder can reach (TYTO-728): the folder's own `templates/`, the
 * workspace's template folders, the built-in pack and the installed plugins, with what the
 * plugin files fetched, configure and alias. **One function, so what `tyto template list`
 * prints is what `tyto render`, `tyto recipe run` and `tyto delivery new --template` accept**:
 * three copies of these steps are how a listing and a render would come to disagree.
 *
 * The folder's trust decides as it does for a render: a restricted folder's plugin files are
 * neither fetched nor loaded (ADR 0111), and `leftOut` says so. Never moves a pinned ref and
 * never asks (ADR 0151 decision 3). The caller closes `plugins`.
 */

export interface TemplatesInReachOptions {
  /** The workspace the run is in, as `workspaceOfFolder` found it; none outside one. */
  readonly workspace: BriefWorkspace | undefined;
  /** The command, as a plugin's capabilities name the host (`tyto render`). */
  readonly hostName: string;
  /** Where `templates/` and `formats.yaml` are looked for when nobody named them. */
  readonly folder: string;
  /**
   * `--templates`, with whether somebody typed it (a default folder that is not there is not
   * worth saying); the folder's `templates/`, as a default, when absent.
   */
  readonly templates?: { readonly directory: string; readonly named: boolean };
  /** `--formats-file`, likewise; the folder's `formats.yaml`, as a default, when absent. */
  readonly formats?: { readonly file: string; readonly named: boolean };
  /** What `leftOut` says the restricted folder's plugin files were not. */
  readonly leftOutAs?: 'loaded' | 'listed';
}

export interface TemplatesInReach {
  readonly pluginFiles: SyncedPluginFiles;
  /** Why a restricted folder's plugin files count for nothing, or `''`. Printed on stderr. */
  readonly leftOut: string;
  /** The installed plugins, loaded; the caller closes them. */
  readonly plugins: LoadedPlugins;
  readonly context: Result<RenderContext, Diagnostics>;
}

export async function templatesInReach(
  options: TemplatesInReachOptions,
  environment: CliEnvironment,
): Promise<TemplatesInReach> {
  const { workspace } = options;
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
  // A source that could not be fetched is about no file this run names.
  registerUnplaced(pluginFiles.diagnostics);
  const leftOut = await leftOutPluginFiles(
    pluginFilesWorkspace,
    options.leftOutAs ?? 'loaded',
    environment,
  );
  const plugins = await loadInstalledPlugins(environment.home, {
    launch: environment.launch,
    copies: pluginFiles.copies,
    capabilities: pluginCapabilities(environment.variables, {
      hostName: options.hostName,
      signin: cliSigninCapabilities(environment),
      ...(environment.home === undefined ? {} : { home: environment.home }),
      workspace:
        workspace === undefined
          ? { trust: 'restricted' }
          : { folder: workspace.loaded.folder, trust: workspace.loaded.trust },
    }),
  });
  const context = await loadRenderContext({
    templatesDirectory: options.templates?.directory ?? resolve(options.folder, 'templates'),
    projectTemplatesDirectories: workspace?.loaded.project.templates ?? [],
    formatsFile: options.formats?.file ?? resolve(options.folder, 'formats.yaml'),
    templatesDirectoryIsDefault: options.templates?.named !== true,
    formatsFileIsDefault: options.formats?.named !== true,
    ...installedOption(environment, plugins, pluginFiles),
  });
  return { pluginFiles, leftOut, plugins, context };
}

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
