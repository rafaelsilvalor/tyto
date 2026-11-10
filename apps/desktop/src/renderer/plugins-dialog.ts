import { LitElement, type TemplateResult, html, nothing } from 'lit';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';

/**
 * The plugins screen (TYTO-47): the list `tyto plugin list` prints, in the window.
 *
 * **It reads and runs nothing.** Like the export dialog it is handed what to show — the
 * answer to `plugins:list`, asked by whoever opened it — and has no bridge of its own.
 *
 * **Install, remove, disable and enable (TYTO-373)** are buttons that hand the request to
 * `onInstall` and `onChange`; main opens the picker, asks in a native box and runs the CLI's
 * own steps, and whoever opened the screen asks the list again. A built-in has no buttons: it
 * ships inside Tyto. Nothing applies before the next start, so a row whose state on disk and
 * whether it is running disagree says "restart to apply".
 *
 * **One thing it writes: a plugin's credentials (TYTO-187).** Beside each `credentials:<key>`
 * a plugin declares, a field to set it and a button to clear it, handed to `onCredential`
 * — whoever opened the screen owns the bridge and asks the list again afterwards. The value
 * leaves through that call once and never comes back: the row knows only whether a key is set.
 *
 * **Browser sign-in (TYTO-374, ADR 0174).** Beside each `signin.<id>` a plugin declares, who
 * is signed in — "Signed in as <label>" or "Not signed in" — and Sign in or Sign out, handed to
 * `onSigninStart` and `onSigninOut`. **Only a click here starts a sign-in**; a plugin's call
 * never does. The screen is handed `signins` and never a token: main keeps the refresh token in
 * the keychain and the access token in its memory.
 *
 * **The notice is not decoration.** A permission a person approved at install is recorded
 * and shown, and until TYTO-48 isolates plugins it is not enforced; a screen listing
 * permissions without that sentence would read as a sandbox that does not exist.
 */

export const PLUGINS_DIALOG_TAG = 'tyto-plugins-dialog';

export type PluginsView = IpcResponse<'plugins:list'>;
type PluginRow = PluginsView['plugins'][number];

/** Set a key to `secret`, or clear it when `secret` is absent. Rejects when main refused. */
export type CredentialChange = (change: {
  readonly plugin: string;
  readonly key: string;
  readonly secret?: string;
}) => Promise<void>;

/** Install from a folder or an archive; main picks the file and asks. Rejects on failure. */
export type PluginInstall = (
  from: IpcRequest<'plugins:install'>['from'],
) => Promise<IpcResponse<'plugins:install'>>;

/** Remove, disable or enable one installed plugin. Rejects when main refused the request. */
export type PluginChange = (
  name: string,
  change: IpcRequest<'plugins:change'>['change'],
) => Promise<IpcResponse<'plugins:change'>>;

/** Who is signed in to each declared sign-in, from `signin:list`. */
export type SigninRows = IpcResponse<'signin:list'>['signins'];
type SigninRow = SigninRows[number];

/** Signs in to one declared sign-in; resolves once the browser came back or gave up. */
export type SigninStart = (plugin: string, id: string) => Promise<IpcResponse<'signin:start'>>;

/** Signs out of one declared sign-in. Rejects when main refused the request. */
export type SigninOut = (plugin: string, id: string) => Promise<void>;

/** A sign-in that did not finish: which one, and main's sentence. */
interface SigninFailure {
  readonly key: string;
  readonly message: string;
}

const signinKey = (plugin: string, id: string): string => `${plugin}:${id}`;

/** What the last install or change said, on the line above the buttons. */
interface Outcome {
  readonly key: CatalogueKey;
  readonly plugin?: string;
  readonly problems: readonly string[];
}

const outcomeOf = (key: CatalogueKey, plugin: string | undefined): Outcome =>
  plugin === undefined ? { key, problems: [] } : { key, plugin, problems: [] };

/**
 * A change that applies at the next start: the window starts installed plugins once, so an
 * enabled one it did not start, or a disabled one it did, is waiting for a restart.
 */
export function waitsForRestart(plugin: PluginRow): boolean {
  if (plugin.origin !== 'external') return false;
  if (plugin.status === 'enabled') return !plugin.running;
  if (plugin.status === 'disabled') return plugin.running;
  return false;
}

/**
 * Where the plugin's first key starts in a settings file's text: just inside the quote of its
 * first `"<plugin>.`. `undefined` when the file holds none of its keys yet.
 */
export function settingKeyOffset(text: string, plugin: string): number | undefined {
  const at = text.indexOf(`"${plugin}.`);
  return at === -1 ? undefined : at + 1;
}

const ORIGIN_KEYS: Record<PluginRow['origin'], CatalogueKey> = {
  'built-in': 'plugins.origin.builtIn',
  external: 'plugins.origin.external',
};

const STATUS_KEYS: Record<PluginRow['status'], CatalogueKey> = {
  enabled: 'plugins.status.enabled',
  disabled: 'plugins.status.disabled',
  refused: 'plugins.status.refused',
  crashed: 'plugins.status.crashed',
};

export class PluginsDialog extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    locale: { attribute: false },
    view: { attribute: false },
    onCredential: { attribute: false },
    onInstall: { attribute: false },
    onChange: { attribute: false },
    onSettings: { attribute: false },
    signins: { attribute: false },
    onSigninStart: { attribute: false },
    onSigninOut: { attribute: false },
    signingIn: { state: true },
    signinFailure: { state: true },
    failedCredential: { state: true },
    outcome: { state: true },
    busy: { state: true },
  };

  declare open: boolean;
  declare locale: Locale;
  /** The list, `'failed'` when the bridge could not answer, or nothing while it is asked. */
  declare view: PluginsView | 'failed' | undefined;
  /** Where a set or a clear goes. Nothing is offered while it is absent. */
  declare onCredential: CredentialChange | undefined;
  /** `plugin:key` of the change main refused last, so its row can say so. */
  declare failedCredential: string | undefined;
  /** Where an install goes. The install buttons are not drawn while it is absent. */
  declare onInstall: PluginInstall | undefined;
  /** Where a remove, disable or enable goes. No row buttons while it is absent. */
  declare onChange: PluginChange | undefined;
  /** Opens `settings.json` at the plugin's keys (TYTO-373). */
  declare onSettings: ((plugin: string) => void) | undefined;
  declare outcome: Outcome | undefined;
  /** While an install or a change is out, so a second click does not start another. */
  declare busy: boolean;
  /** Who is signed in to what, or nothing while it is asked or when it could not be read. */
  declare signins: SigninRows | undefined;
  /** Where Sign in goes. No sign-in buttons while it is absent. */
  declare onSigninStart: SigninStart | undefined;
  /** Where Sign out goes. */
  declare onSigninOut: SigninOut | undefined;
  /** `plugin:id` of the sign-in waiting on the browser, so no second one starts beside it. */
  declare signingIn: string | undefined;
  declare signinFailure: SigninFailure | undefined;

  constructor() {
    super();
    this.open = false;
    this.locale = DEFAULT_LOCALE;
    this.view = undefined;
    this.onCredential = undefined;
    this.onInstall = undefined;
    this.onChange = undefined;
    this.onSettings = undefined;
    this.failedCredential = undefined;
    this.outcome = undefined;
    this.busy = false;
    this.signins = undefined;
    this.onSigninStart = undefined;
    this.onSigninOut = undefined;
    this.signingIn = undefined;
    this.signinFailure = undefined;
  }

  private async act(step: () => Promise<Outcome | undefined>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.outcome = await step();
    } catch {
      this.outcome = { key: 'plugins.result.refused', problems: [] };
    } finally {
      this.busy = false;
    }
  }

  private install(from: IpcRequest<'plugins:install'>['from']): void {
    const install = this.onInstall;
    if (install === undefined) return;
    void this.act(async () => {
      const answer = await install(from);
      switch (answer.status) {
        case 'cancelled':
          return undefined;
        case 'installed':
          return outcomeOf('plugins.result.installed', answer.plugin);
        case 'declined':
          return outcomeOf('plugins.result.declined', answer.plugin);
        case 'refused':
          return { key: 'plugins.result.refused', problems: answer.problems };
      }
    });
  }

  private change(name: string, change: IpcRequest<'plugins:change'>['change']): void {
    const run = this.onChange;
    if (run === undefined) return;
    void this.act(async () => {
      const answer = await run(name, change);
      switch (answer.status) {
        case 'cancelled':
          return undefined;
        case 'changed':
          return { key: 'plugins.result.changed', plugin: name, problems: [] };
        case 'refused':
          return { key: 'plugins.result.refused', problems: answer.problems };
      }
    });
  }

  private async signIn(plugin: string, id: string): Promise<void> {
    const start = this.onSigninStart;
    if (start === undefined || this.signingIn !== undefined) return;
    const key = signinKey(plugin, id);
    this.signingIn = key;
    this.signinFailure = undefined;
    try {
      const answer = await start(plugin, id);
      if (!answer.ok) this.signinFailure = { key, message: answer.message };
    } catch (cause) {
      this.signinFailure = { key, message: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      this.signingIn = undefined;
    }
  }

  private async signOut(plugin: string, id: string): Promise<void> {
    const out = this.onSigninOut;
    if (out === undefined) return;
    const key = signinKey(plugin, id);
    this.signinFailure = undefined;
    try {
      await out(plugin, id);
    } catch (cause) {
      this.signinFailure = { key, message: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  /**
   * One line per declared sign-in: its id, who is signed in, and Sign in or Sign out. While a
   * sign-in waits on the browser, every Sign in is disabled and the line says to finish there.
   */
  private signinLines(say: (key: CatalogueKey) => string, plugin: PluginRow): unknown {
    if (plugin.origin !== 'external') return nothing;
    const rows = (this.signins ?? []).filter((row) => row.plugin === plugin.name);
    if (rows.length === 0) return nothing;
    const line = (row: SigninRow): TemplateResult => {
      const key = signinKey(row.plugin, row.id);
      const waiting = this.signingIn === key;
      const state = row.signedIn
        ? row.label === undefined
          ? say('plugins.signin.signedIn')
          : say('plugins.signin.as').replaceAll('{label}', row.label)
        : say('plugins.signin.notSignedIn');
      const button = row.signedIn
        ? html`<button
            class="plugins__signin-out"
            type="button"
            ?hidden=${this.onSigninOut === undefined}
            @click=${() => {
              void this.signOut(row.plugin, row.id);
            }}
          >
            ${say('plugins.signin.out')}
          </button>`
        : html`<button
            class="plugins__signin-start"
            type="button"
            ?hidden=${this.onSigninStart === undefined}
            ?disabled=${this.signingIn !== undefined}
            @click=${() => {
              void this.signIn(row.plugin, row.id);
            }}
          >
            ${say('plugins.signin.start')}
          </button>`;
      return html`<div
        class="plugins__signin"
        data-signin=${row.id}
        data-signed-in=${row.signedIn ? 'true' : 'false'}
      >
        <span class="plugins__signin-id"
          >${say('plugins.signin.label')} <code>${row.id}</code></span
        >
        <span class="plugins__signin-state">${state}</span>
        ${button}
        ${waiting ? html`<p class="plugins__signin-waiting" role="status">${say('plugins.signin.waiting')}</p>` : nothing}
        ${
          this.signinFailure?.key === key
            ? html`<p class="plugins__signin-failed" role="alert">
                ${say('plugins.signin.failed')} ${this.signinFailure.message}
              </p>`
            : nothing
        }
      </div>`;
    };
    return html`<div class="plugins__signins">
      ${rows.map(line)}
      ${
        rows.some((row) => row.signedIn)
          ? html`<p class="plugins__disclosure">${say('plugins.signin.kept')}</p>`
          : nothing
      }
    </div>`;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  close(): void {
    this.open = false;
  }

  private row(say: (key: CatalogueKey) => string, plugin: PluginRow): TemplateResult {
    return html`<tr class="plugins__row" data-plugin=${plugin.name} data-status=${plugin.status}>
      <td class="plugins__name">${plugin.name}</td>
      <td>${plugin.version ?? '—'}</td>
      <td>${say(ORIGIN_KEYS[plugin.origin])}</td>
      <td class="plugins__status">${say(STATUS_KEYS[plugin.status])}</td>
      <td>${plugin.contributes.join(', ')}</td>
      <td class="plugins__permissions">
        ${
          plugin.permissions.length === 0
            ? say('plugins.permissions.none')
            : plugin.permissions.join(', ')
        }
        ${
          plugin.contributes.includes('panel')
            ? html`<p class="plugins__disclosure">${say('plugins.panel.readsDocument')}</p>`
            : nothing
        }
        ${this.fonts(say, plugin)} ${this.workspace(say, plugin)} ${this.programs(say, plugin)}
        ${this.credentials(say, plugin)} ${this.signinLines(say, plugin)}
        ${
          plugin.problems.length === 0
            ? nothing
            : html`<ul class="plugins__problems">
                ${plugin.problems.map((problem) => html`<li>${problem}</li>`)}
              </ul>`
        }
      </td>
      <td><div class="plugins__row-actions">${this.rowActions(say, plugin)}</div></td>
    </tr>`;
  }

  /**
   * An installed plugin's buttons: Disable or Enable by its state, Remove, and Settings when it
   * declares settings. A built-in gets none. A refused folder can only be removed: enabling it
   * would not approve it, which only an install does.
   */
  private rowActions(say: (key: CatalogueKey) => string, plugin: PluginRow): unknown {
    const restart = waitsForRestart(plugin)
      ? html`<span class="plugins__restart">${say('plugins.restart')}</span>`
      : nothing;
    if (plugin.origin !== 'external' || this.onChange === undefined) return restart;

    const button = (action: 'disable' | 'enable' | 'remove', key: CatalogueKey): TemplateResult =>
      html`<button
        class="plugins__action"
        type="button"
        data-action=${action}
        ?disabled=${this.busy}
        @click=${() => {
          this.change(plugin.name, action);
        }}
      >
        ${say(key)}
      </button>`;

    const toggle =
      plugin.status === 'disabled'
        ? button('enable', 'plugins.action.enable')
        : plugin.status === 'refused'
          ? nothing
          : button('disable', 'plugins.action.disable');
    const settings =
      plugin.configurable && this.onSettings !== undefined
        ? html`<button
            class="plugins__action"
            type="button"
            data-action="settings"
            @click=${() => {
              this.onSettings?.(plugin.name);
            }}
          >
            ${say('plugins.action.settings')}
          </button>`
        : nothing;
    return html`${restart}${toggle}${button('remove', 'plugins.action.remove')}${settings}`;
  }

  /** The last install's or change's result, and main's problems when it refused. */
  private outcomeLine(say: (key: CatalogueKey) => string): unknown {
    const outcome = this.outcome;
    if (outcome === undefined) return nothing;
    const line = say(outcome.key).replaceAll('{plugin}', outcome.plugin ?? '');
    return html`<div class="plugins__outcome" role="status" data-key=${outcome.key}>
      <p>${line}</p>
      ${
        outcome.problems.length === 0
          ? nothing
          : html`<ul class="plugins__problems">
              ${outcome.problems.map((problem) => html`<li>${problem}</li>`)}
            </ul>`
      }
    </div>`;
  }

  /**
   * `font:<family>` said in words (ADR 0048): the permission sends a file from this machine
   * to the plugin's process, and the row says whose faces those are.
   */
  private fonts(say: (key: CatalogueKey) => string, plugin: PluginRow): unknown {
    const families = plugin.permissions
      .filter((permission) => permission.startsWith('font:'))
      .map((permission) => permission.slice('font:'.length));
    if (families.length === 0) return nothing;
    return html`<p class="plugins__disclosure plugins__fonts">
      ${say('plugins.font.sendsMachineFaces')} ${families.join(', ')}
    </p>`;
  }

  /**
   * `workspace:read` and `workspace:write` said in words (ADR 0138): the files are the folder
   * open in the window when the plugin asks, not the one open when it started, and only once
   * that folder is trusted.
   */
  private workspace(say: (key: CatalogueKey) => string, plugin: PluginRow): unknown {
    const lines = (['read', 'write'] as const)
      .filter((access) => plugin.permissions.includes(`workspace:${access}`))
      .map((access) =>
        say(access === 'read' ? 'plugins.workspace.reads' : 'plugins.workspace.writes'),
      );
    if (lines.length === 0) return nothing;
    return html`${lines.map(
      (line) => html`<p class="plugins__disclosure plugins__workspace">${line}</p>`,
    )}`;
  }

  /**
   * `process:<name>` said in words (ADR 0182): the programs Tyto may start for the plugin, by
   * name, in the open folder and never while it is restricted.
   */
  private programs(say: (key: CatalogueKey) => string, plugin: PluginRow): unknown {
    const names = plugin.permissions
      .filter((permission) => permission.startsWith('process:'))
      .map((permission) => permission.slice('process:'.length));
    if (names.length === 0) return nothing;
    // ADR 0184: a program the plugin ships is its own code, said apart from one on PATH.
    const own = names.filter((name) => plugin.ownPrograms?.includes(name) === true);
    const installed = names.filter((name) => !own.includes(name));
    return html`${
        installed.length === 0
          ? nothing
          : html`<p class="plugins__disclosure plugins__programs">
              ${say('plugins.process.starts')} ${installed.join(', ')}
            </p>`
      }${
        own.length === 0
          ? nothing
          : html`<p class="plugins__disclosure plugins__programs plugins__own-programs">
              ${say('plugins.process.own')} ${own.join(', ')}
            </p>`
      }
      <p class="plugins__disclosure plugins__programs">${say('plugins.process.terminal')}</p>`;
  }

  /**
   * One line per declared key: its name, whether it is set, a field and Save, and Clear when
   * there is something to clear. The field is a password field and is emptied once saved,
   * so the value is on screen only while it is being typed.
   */
  private credentials(say: (key: CatalogueKey) => string, plugin: PluginRow): unknown {
    const change = this.onCredential;
    if (plugin.credentials.length === 0 || change === undefined) return nothing;

    const run = async (key: string, secret?: string, form?: HTMLFormElement): Promise<void> => {
      const id = `${plugin.name}:${key}`;
      try {
        await change({ plugin: plugin.name, key, ...(secret === undefined ? {} : { secret }) });
        if (this.failedCredential === id) this.failedCredential = undefined;
        form?.reset();
      } catch {
        this.failedCredential = id;
      }
    };

    return html`<div class="plugins__credentials">
      ${plugin.credentials.map(
        ({ key, set }) =>
          html`<form
            class="plugins__credential"
            data-key=${key}
            data-set=${set ? 'true' : 'false'}
            @submit=${(event: SubmitEvent) => {
              event.preventDefault();
              const form = event.currentTarget as HTMLFormElement;
              const field = form.querySelector('input');
              const secret = field?.value ?? '';
              if (secret === '') return;
              void run(key, secret, form);
            }}
          >
            <span class="plugins__credential-key"
              >${say('plugins.credential.label')} <code>${key}</code></span
            >
            <span class="plugins__credential-state"
              >${say(set ? 'plugins.credential.set' : 'plugins.credential.notSet')}</span
            >
            <input
              class="plugins__credential-field"
              type="password"
              autocomplete="off"
              spellcheck="false"
              placeholder=${say('plugins.credential.placeholder')}
              aria-label=${`${say('plugins.credential.label')} ${key}`}
            />
            <button class="plugins__credential-save" type="submit">
              ${say('plugins.credential.save')}
            </button>
            ${
              set
                ? html`<button
                    class="plugins__credential-clear"
                    type="button"
                    @click=${() => {
                      void run(key);
                    }}
                  >
                    ${say('plugins.credential.clear')}
                  </button>`
                : nothing
            }
            ${
              this.failedCredential === `${plugin.name}:${key}`
                ? html`<p class="plugins__credential-failed" role="alert">
                    ${say('plugins.credential.failed')}
                  </p>`
                : nothing
            }
          </form>`,
      )}
      ${
        plugin.credentials.some((credential) => credential.set)
          ? html`<p class="plugins__disclosure">${say('plugins.credential.kept')}</p>`
          : nothing
      }
    </div>`;
  }

  private body(say: (key: CatalogueKey) => string): unknown {
    const view = this.view;
    if (view === undefined) return nothing;
    if (view === 'failed')
      return html`<p class="plugins__failure">${say('plugins.unavailable')}</p>`;

    return html`<table class="plugins__table">
        <thead>
          <tr>
            <th>${say('plugins.column.name')}</th>
            <th>${say('plugins.column.version')}</th>
            <th>${say('plugins.column.origin')}</th>
            <th>${say('plugins.column.status')}</th>
            <th>${say('plugins.column.contributes')}</th>
            <th>${say('plugins.column.permissions')}</th>
            <th>${say('plugins.column.actions')}</th>
          </tr>
        </thead>
        <tbody>
          ${view.plugins.map((plugin) => this.row(say, plugin))}
        </tbody>
      </table>
      <p class="plugins__folder">${say('plugins.folder')} <code>${view.folder}</code></p>`;
  }

  protected override render(): unknown {
    if (!this.open) return nothing;
    const say = (key: CatalogueKey): string => translate(this.locale, key);

    return html`<div
      class="plugins__panel"
      role="dialog"
      aria-modal="true"
      aria-label=${say('plugins.heading')}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === 'Escape') this.close();
      }}
    >
      <h2 class="plugins__title">${say('plugins.heading')}</h2>
      <p class="plugins__notice" role="note">${say('plugins.notice')}</p>
      <p class="plugins__inactive">${say('plugins.inactive')}</p>
      ${this.body(say)}
      <p class="plugins__install">${say('plugins.install')}</p>
      ${this.outcomeLine(say)}
      <div class="plugins__actions">
        ${
          this.onInstall === undefined
            ? nothing
            : html`<button
                  class="plugins__install-folder"
                  type="button"
                  ?disabled=${this.busy}
                  @click=${() => {
                    this.install('folder');
                  }}
                >
                  ${say('plugins.action.installFolder')}
                </button>
                <button
                  class="plugins__install-archive"
                  type="button"
                  ?disabled=${this.busy}
                  @click=${() => {
                    this.install('archive');
                  }}
                >
                  ${say('plugins.action.installArchive')}
                </button>`
        }
        <button
          class="plugins__close"
          type="button"
          @click=${() => {
            this.close();
          }}
        >
          ${say('plugins.close')}
        </button>
      </div>
    </div>`;
  }
}

customElements.define(PLUGINS_DIALOG_TAG, PluginsDialog);
