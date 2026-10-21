import { LitElement, html, nothing } from 'lit';

import {
  type CatalogueKey,
  type Locale,
  DEFAULT_LOCALE,
  translate,
} from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';

/**
 * Workspace: Manage Trust (TYTO-278, ADR 0111): the open folder, whether it is trusted, and the
 * two buttons that change that. Rafael chose a small dialog of its own on 2026-10-21.
 *
 * **It names no folder to anyone.** It is handed main's answer to show, and its buttons say
 * only "trust" or "take it back"; main acts on the folder it has open (`workspace:trust`). A
 * revoke applies the next time the folder is opened, and the dialog says so rather than
 * pretending the folder changed under the person.
 */

export const TRUST_DIALOG_TAG = 'tyto-trust-dialog';

export type WorkspaceView = IpcResponse<'workspace:folder'>;

const STATE_KEYS: Record<WorkspaceView['trust'], CatalogueKey> = {
  trusted: 'workspace.trust.trusted',
  restricted: 'workspace.trust.restricted',
  revoked: 'workspace.trust.revoked',
};

export class TrustDialog extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    locale: { attribute: false },
    view: { attribute: false },
    onTrust: { attribute: false },
  };

  declare open: boolean;
  declare locale: Locale;
  declare view: WorkspaceView | undefined;
  /** Where Trust (`true`) and Remove trust (`false`) go. */
  declare onTrust: ((trusted: boolean) => void) | undefined;

  constructor() {
    super();
    this.open = false;
    this.locale = DEFAULT_LOCALE;
    this.view = undefined;
    this.onTrust = undefined;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  close(): void {
    this.open = false;
  }

  protected override render(): unknown {
    if (!this.open) return nothing;
    const say = (key: CatalogueKey): string => translate(this.locale, key);
    const view = this.view;
    const folder = view?.folder ?? null;

    return html`<div
      class="trust__panel"
      role="dialog"
      aria-modal="true"
      aria-label=${say('workspace.trust.heading')}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === 'Escape') this.close();
      }}
    >
      <h2 class="trust__title">${say('workspace.trust.heading')}</h2>
      ${
        folder === null || view === undefined
          ? html`<p class="trust__state">${say('workspace.trust.none')}</p>`
          : html`<p class="trust__folder"><code>${folder}</code></p>
              <p class="trust__state" data-trust=${view.trust}>${say(STATE_KEYS[view.trust])}</p>`
      }
      <div class="trust__actions">
        ${
          folder === null || view === undefined
            ? nothing
            : html`<button
                  class="trust__grant"
                  type="button"
                  ?disabled=${view.trust === 'trusted'}
                  @click=${() => this.onTrust?.(true)}
                >
                  ${say('workspace.trust.grant')}
                </button>
                <button
                  class="trust__revoke"
                  type="button"
                  ?disabled=${view.trust !== 'trusted'}
                  @click=${() => this.onTrust?.(false)}
                >
                  ${say('workspace.trust.revoke')}
                </button>`
        }
        <button class="trust__close" type="button" @click=${() => this.close()}>
          ${say('workspace.trust.close')}
        </button>
      </div>
    </div>`;
  }
}

customElements.define(TRUST_DIALOG_TAG, TrustDialog);
