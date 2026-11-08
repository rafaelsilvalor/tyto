import {
  type PluginStateChange,
  changePluginState,
  installPlugin,
  permissionPrompt,
} from '@tyto/command-line';
import { diagnostic } from '@tyto/core';
import type { PluginManifest } from '@tyto/plugin-api';

import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';

/**
 * Installing, removing, disabling and enabling a plugin from the plugins screen (TYTO-373).
 *
 * **The CLI's steps, the window's questions.** `installPlugin` and `changePluginState` are the
 * ones `tyto plugin install|remove|disable|enable` runs, so what is checked, what is refused
 * and what lands in `plugins.json` is one implementation behind both apps. What this module
 * adds is how a window asks: a native picker in place of a typed path, and a native box in
 * place of `[y/N]`, showing the very text the terminal prints (`permissionPrompt`).
 *
 * **Nothing changes unless a person said yes.** The approval box and the remove box both
 * default to Cancel, which is also what Escape and closing the box answer; only the first
 * button, strictly, goes ahead. Nothing here stops or starts a plugin: the window starts its
 * installed plugins once, when it opens (ADR 0044), so every change applies the next time.
 */

export type InstallFrom = IpcRequest<'plugins:install'>['from'];
export type InstallAnswer = IpcResponse<'plugins:install'>;
export type ChangeAnswer = IpcResponse<'plugins:change'>;

/** A native question box, as Electron's `showMessageBox` takes it. Cancel is the default. */
export interface ManageBox {
  readonly type: 'question' | 'warning';
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [proceed: string, cancel: string];
  readonly defaultId: 1;
  readonly cancelId: 1;
}

export type ShowBox = (box: ManageBox) => Promise<{ readonly response: number }>;

/** The window's words for the two boxes, in its language. */
export type ManageText = (
  key:
    | 'plugins.approve.message'
    | 'plugins.approve.install'
    | 'plugins.approve.cancel'
    | 'plugins.remove.message'
    | 'plugins.remove.detail'
    | 'plugins.remove.confirm'
    | 'plugins.remove.cancel',
) => string;

/**
 * The install question: the plugin's name, and as detail the text `tyto plugin install`
 * prints — every permission, what the process is confined to and what it is not. **Install
 * only on the first button**: a dismissed box answers `cancelId`, and anything but `0` is no.
 */
export function approveInstallInABox(
  show: ShowBox,
  text: ManageText,
): (manifest: PluginManifest, source: string) => Promise<boolean> {
  return async (manifest, source) => {
    const answer = await show({
      type: 'question',
      message: text('plugins.approve.message').replaceAll('{plugin}', manifest.name),
      detail: permissionPrompt(manifest, source),
      buttons: [text('plugins.approve.install'), text('plugins.approve.cancel')],
      defaultId: 1,
      cancelId: 1,
    });
    return answer.response === 0;
  };
}

/** The remove question, Cancel first in focus: removing deletes the plugin's folder. */
export function confirmRemoveInABox(
  show: ShowBox,
  text: ManageText,
): (name: string) => Promise<boolean> {
  return async (name) => {
    const answer = await show({
      type: 'warning',
      message: text('plugins.remove.message').replaceAll('{plugin}', name),
      detail: text('plugins.remove.detail'),
      buttons: [text('plugins.remove.confirm'), text('plugins.remove.cancel')],
      defaultId: 1,
      cancelId: 1,
    });
    return answer.response === 0;
  };
}

export interface PluginManagerOptions {
  /** `TYTO_HOME`: where installs land and what remove may delete. */
  readonly home: string;
  /** What a relative source would be relative to; the picker answers absolute paths. */
  readonly cwd: string;
  /** Set, a source that would need a shell is refused with it, as the window's CLI is. */
  readonly shellRefusal?: string;
  /** The names this app ships, which no install takes and no change touches. */
  readonly builtInNames: () => ReadonlySet<string>;
  /** The native picker: a folder, or one `.tgz` file. `undefined` when nothing was chosen. */
  readonly choose: (from: InstallFrom) => Promise<string | undefined>;
  readonly approve: (manifest: PluginManifest, source: string) => Promise<boolean>;
  readonly confirmRemove: (name: string) => Promise<boolean>;
}

export interface PluginManager {
  install(from: InstallFrom): Promise<InstallAnswer>;
  change(name: string, change: PluginStateChange): Promise<ChangeAnswer>;
}

/** The archives `fetchPlugin` unpacks itself; any other file would be handed to npm. */
const ARCHIVE = /\.(tgz|tar\.gz)$/iu;

export function createPluginManager(options: PluginManagerOptions): PluginManager {
  return {
    async install(from) {
      const source = await options.choose(from);
      if (source === undefined) return { status: 'cancelled', problems: [] };
      // A picker filter is a suggestion the person can switch off: a file that is not an
      // archive would go to npm, which the window never runs.
      if (from === 'archive' && !ARCHIVE.test(source)) {
        const problem = diagnostic('E_PLUGIN_FETCH', {
          source,
          problem: 'it is not a .tgz or .tar.gz archive',
        });
        return { status: 'refused', problems: [problem.message] };
      }

      // The desktop's own built-ins too, which the CLI's list does not know.
      let taken: string | undefined;
      const answer = await installPlugin(source, {
        home: options.home,
        cwd: options.cwd,
        ...(options.shellRefusal === undefined ? {} : { shellRefusal: options.shellRefusal }),
        approve: (manifest, shown) => {
          if (options.builtInNames().has(manifest.name)) {
            taken = manifest.name;
            return Promise.resolve(false);
          }
          return options.approve(manifest, shown);
        },
      });
      if (taken !== undefined) {
        const problem = diagnostic('E_PLUGIN_NAME_TAKEN', { plugin: taken, origin: 'built-in' });
        return { status: 'refused', plugin: taken, problems: [problem.message] };
      }
      if (!answer.ok) {
        return { status: 'refused', problems: answer.error.map((item) => item.message) };
      }
      return { status: answer.value.status, plugin: answer.value.manifest.name, problems: [] };
    },

    async change(name, change) {
      if (options.builtInNames().has(name)) {
        throw new Error(`'${name}' is built into Tyto; it cannot be removed, disabled or enabled.`);
      }
      if (change === 'remove' && (await options.confirmRemove(name)) !== true) {
        return { status: 'cancelled', problems: [] };
      }
      const answer = await changePluginState(change, name, { home: options.home });
      if (!answer.ok) {
        return { status: 'refused', problems: answer.error.map((item) => item.message) };
      }
      return { status: 'changed', problems: [] };
    },
  };
}
