import { type TemplateResult, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import type { CatalogueKey } from '../../shared/i18n/index.js';
import { icon } from './icons.js';
import { DockedPanel } from './panels.js';
import type { TerminalSession, TerminalSessions } from './terminal-sessions.js';

/**
 * The Terminal tab of the bottom strip (TYTO-497, ADR 0164 decision 7), after Commands.
 *
 * It draws the chrome, the terminals as small tabs at the right of the strip once there are two
 * or more (the command panel's rule, ADR 0163), and the screen of the one in front. The screens
 * are `TerminalSessions`' and outlive this element, which the dock makes again on every layout
 * change: each render moves them into this body and shows only the front one.
 */

export const TERMINAL_PANEL_TAG = 'tyto-terminal-panel';

export interface TerminalPanelPorts {
  /** Opens another terminal, in front, and focuses it. */
  readonly create: () => void;
  /** Trusts the open folder, the banner's action (ADR 0111). */
  readonly trust: () => void;
}

const NO_PORTS: TerminalPanelPorts = { create: () => undefined, trust: () => undefined };

export class TerminalPanel extends DockedPanel {
  static override properties = {
    ...DockedPanel.properties,
    sessions: { attribute: false },
    ports: { attribute: false },
  };

  declare sessions: TerminalSessions | undefined;
  declare ports: TerminalPanelPorts;

  #unlisten: (() => void) | undefined;
  #resize: ResizeObserver | undefined;

  constructor() {
    super();
    this.sessions = undefined;
    this.ports = NO_PORTS;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#follow();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unlisten?.();
    this.#unlisten = undefined;
    this.#resize?.disconnect();
    this.#resize = undefined;
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('sessions')) this.#follow();
  }

  /** Focuses the terminal in front, or opens one when there is none and nothing was refused. */
  focusTerminal(): void {
    const sessions = this.sessions;
    const active = sessions?.active;
    if (active === undefined) {
      if (sessions !== undefined && sessions.refusal === undefined) this.ports.create();
      return;
    }
    sessions?.fit();
    sessions?.view(active.terminalId)?.focus();
  }

  #follow(): void {
    this.#unlisten?.();
    this.#unlisten = this.sessions?.listen(() => {
      this.requestUpdate();
    });
  }

  protected override updated(): void {
    const screens = this.querySelector<HTMLElement>('.terminal-panel__screens');
    const sessions = this.sessions;
    if (screens === null || sessions === undefined) return;
    const active = sessions.active?.terminalId;
    for (const session of sessions.sessions) {
      const view = sessions.view(session.terminalId);
      if (view === undefined) continue;
      if (view.element.parentElement !== screens) screens.append(view.element);
      view.element.hidden = session.terminalId !== active;
    }
    if (this.#resize === undefined) {
      this.#resize = new ResizeObserver(() => {
        this.sessions?.fit();
      });
      this.#resize.observe(screens);
    }
    sessions.fit();
  }

  private action(name: Parameters<typeof icon>[0], key: CatalogueKey, run: () => void) {
    const label = this.say(key);
    return html`<button
      type="button"
      class="tool__action"
      data-action=${key}
      title=${label}
      aria-label=${label}
      @click=${run}
    >
      ${icon(name)}
    </button>`;
  }

  private name(session: TerminalSession): string {
    const sessions = this.sessions?.sessions ?? [];
    const shared = sessions.filter((each) => each.title === session.title).length > 1;
    return shared ? `${session.title} ${String(session.number)}` : session.title;
  }

  private sessionTab(session: TerminalSession, active: boolean): TemplateResult {
    const name = this.name(session);
    const ended =
      session.exitCode === undefined
        ? nothing
        : html`<span class="terminal-session__ended">${String(session.exitCode)}</span>`;
    return html`<div class="command-session terminal-session" ?data-active=${active}>
      <button
        type="button"
        role="tab"
        class="command-session__tab"
        data-terminal=${session.terminalId}
        aria-selected=${active ? 'true' : 'false'}
        tabindex=${active ? '0' : '-1'}
        title=${name}
        @click=${() => {
          this.sessions?.select(session.terminalId);
          this.focusTerminal();
        }}
      >
        <span class="command-session__name">${name}</span>${ended}
      </button>
      <button
        type="button"
        class="command-session__close"
        tabindex="-1"
        title=${this.say('terminal.session.close')}
        aria-label=${this.say('terminal.session.close')}
        @click=${() => {
          this.sessions?.close(session.terminalId);
        }}
      >
        ×
      </button>
    </div>`;
  }

  private sessionTabs(): TemplateResult | typeof nothing {
    const sessions = this.sessions;
    if (sessions === undefined || sessions.sessions.length < 2) return nothing;
    const active = sessions.active?.terminalId;
    return html`<div
      class="command-panel__sessions"
      role="tablist"
      aria-label=${this.say('terminal.sessions')}
    >
      ${repeat(
        sessions.sessions,
        (session) => session.terminalId,
        (session) => this.sessionTab(session, session.terminalId === active),
      )}
    </div>`;
  }

  private refusal(): TemplateResult | typeof nothing {
    const refusal = this.sessions?.refusal;
    if (refusal === undefined) return nothing;
    if (refusal.reason === 'failed') {
      return html`<p class="terminal-panel__refusal" role="alert">${refusal.message}</p>`;
    }
    // The line the other withheld features show, with the trust action beside it (ADR 0164 §5).
    return html`<p class="terminal-panel__refusal" role="alert">
      <span>${this.say('terminal.restricted')}</span>
      <button
        type="button"
        class="terminal-panel__trust"
        @click=${() => {
          this.ports.trust();
        }}
      >
        ${this.say('terminal.trust')}
      </button>
    </p>`;
  }

  protected override render(): unknown {
    const actions = html`${this.sessionTabs()}
    ${this.action('plus', 'terminal.new', () => {
      this.ports.create();
    })}`;
    return html`${this.chrome(
        html`<h2 class="tool__title">${this.say('panel.terminal')}</h2>`,
        actions,
      )}
      <div class="terminal-panel">
        ${this.refusal()}
        <div class="terminal-panel__screens"></div>
      </div>`;
  }
}

customElements.define(TERMINAL_PANEL_TAG, TerminalPanel);
