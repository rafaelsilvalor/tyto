import { LitElement, type TemplateResult, html, nothing } from 'lit';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';

/**
 * The plugins screen (TYTO-47): the list `tyto plugin list` prints, in the window.
 *
 * **It reads and runs nothing.** Like the export dialog it is handed what to show — the
 * answer to `plugins:list`, asked by whoever opened it — and has no bridge of its own. It
 * installs nothing either: install, remove and disable are the CLI's, and the screen says so
 * rather than offering buttons that would lead there.
 *
 * **One thing it writes: a plugin's credentials (TYTO-187).** Beside each `credentials:<key>`
 * a plugin declares, a field to set it and a button to clear it, handed to `onCredential`
 * — whoever opened the screen owns the bridge and asks the list again afterwards. The value
 * leaves through that call once and never comes back: the row knows only whether a key is set.
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
    failedCredential: { state: true },
  };

  declare open: boolean;
  declare locale: Locale;
  /** The list, `'failed'` when the bridge could not answer, or nothing while it is asked. */
  declare view: PluginsView | 'failed' | undefined;
  /** Where a set or a clear goes. Nothing is offered while it is absent. */
  declare onCredential: CredentialChange | undefined;
  /** `plugin:key` of the change main refused last, so its row can say so. */
  declare failedCredential: string | undefined;

  constructor() {
    super();
    this.open = false;
    this.locale = DEFAULT_LOCALE;
    this.view = undefined;
    this.onCredential = undefined;
    this.failedCredential = undefined;
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
        ${this.fonts(say, plugin)} ${this.credentials(say, plugin)}
        ${
          plugin.problems.length === 0
            ? nothing
            : html`<ul class="plugins__problems">
                ${plugin.problems.map((problem) => html`<li>${problem}</li>`)}
              </ul>`
        }
      </td>
    </tr>`;
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
      <div class="plugins__actions">
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
