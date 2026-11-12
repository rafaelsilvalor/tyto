import {
  type PluginStateChange,
  changePluginState,
  installPlugin,
  permissionPrompt,
} from '@tyto/command-line';
import { diagnostic } from '@tyto/core';
import { type PluginManifest, SIGNIN_CLIENT_KEY_PREFIX } from '@tyto/plugin-api';

import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';
import type { Credentials } from './credentials.js';

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
 *
 * **A remove keeps the plugin's secrets unless the person ticks the box** (TYTO-682, ADR 0134
 * note of 2026-11-12). Forgetting cannot be undone, and keeping is what a remove always did, so
 * the box's checkbox starts unticked. The CLI never offers it: it never touches a secret.
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
  /** The remove box's one checkbox, which always starts unticked. */
  readonly checkboxLabel?: string;
  readonly checkboxChecked?: false;
}

export type ShowBox = (
  box: ManageBox,
) => Promise<{ readonly response: number; readonly checkboxChecked?: boolean }>;

/** The window's words for the two boxes, in its language. */
export type ManageText = (
  key:
    | 'plugins.approve.message'
    | 'plugins.approve.install'
    | 'plugins.approve.cancel'
    | 'plugins.remove.message'
    | 'plugins.remove.detail'
    | 'plugins.remove.confirm'
    | 'plugins.remove.cancel'
    | 'plugins.remove.forget',
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

/**
 * What the remove box answered: whether to remove, and whether to forget the plugin's secrets
 * too. `forget` is never true without `remove`: a ticked box dismissed is a no to both.
 */
export interface RemoveAnswer {
  readonly remove: boolean;
  readonly forget: boolean;
}

/**
 * The remove question, Cancel first in focus: removing deletes the plugin's folder. Its
 * checkbox, unticked, asks whether to forget the plugin's saved credentials and sign-ins too.
 */
export function confirmRemoveInABox(
  show: ShowBox,
  text: ManageText,
): (name: string) => Promise<RemoveAnswer> {
  return async (name) => {
    const answer = await show({
      type: 'warning',
      message: text('plugins.remove.message').replaceAll('{plugin}', name),
      detail: text('plugins.remove.detail'),
      buttons: [text('plugins.remove.confirm'), text('plugins.remove.cancel')],
      defaultId: 1,
      cancelId: 1,
      checkboxLabel: text('plugins.remove.forget'),
      checkboxChecked: false,
    });
    const remove = answer.response === 0;
    return { remove, forget: remove && answer.checkboxChecked === true };
  };
}

/**
 * The beginnings of every keychain account a plugin's secrets live under: its credentials
 * (`plugin:<name>:<key>`, `credentialAccount`), its sign-ins' refresh tokens
 * (`signin:<name>:<id>`, `signinAccount`, ADR 0134) and the clients a person supplied for them
 * (`signin-client:<name>:<id>`, ADR 0192).
 *
 * **The trailing colon is the whole of the safety.** A name is `[a-z0-9-]` (the manifest's
 * rule), so it never holds a colon, and `plugin:foo:` cannot begin `plugin:foo-bar:x`.
 * `plugin-manage.test.ts` builds each account with its own function, so a change to an
 * account's shape fails there instead of silently moving what a remove forgets.
 */
export function pluginSecretPrefixes(name: string): readonly string[] {
  return [`plugin:${name}:`, `signin:${name}:`, `${SIGNIN_CLIENT_KEY_PREFIX}${name}:`];
}

/**
 * Forgets every keychain account of `name` (TYTO-682): deletes the ciphertext and never
 * decrypts, so a locked keyring does not stop it. Answers the accounts it deleted, sorted.
 */
export async function forgetPluginSecrets(
  credentials: Pick<Credentials, 'accounts' | 'delete'>,
  name: string,
): Promise<readonly string[]> {
  const forgotten: string[] = [];
  for (const prefix of pluginSecretPrefixes(name)) {
    for (const account of await credentials.accounts(prefix)) {
      if (await credentials.delete(account)) forgotten.push(account);
    }
  }
  return forgotten.sort();
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
  readonly confirmRemove: (name: string) => Promise<RemoveAnswer>;
  /** Called only after a remove succeeded with its box ticked: `forgetPluginSecrets`. */
  readonly forgetSecrets: (name: string) => Promise<unknown>;
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
      let forget = false;
      if (change === 'remove') {
        const asked = await options.confirmRemove(name);
        if (!asked.remove) return { status: 'cancelled', problems: [] };
        forget = asked.forget;
      }
      const answer = await changePluginState(change, name, { home: options.home });
      if (!answer.ok) {
        // A refused remove forgets nothing: the plugin is still there to use them.
        return { status: 'refused', problems: answer.error.map((item) => item.message) };
      }
      if (forget) await options.forgetSecrets(name);
      return { status: 'changed', problems: [] };
    },
  };
}
