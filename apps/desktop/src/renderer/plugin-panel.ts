import { html, nothing } from 'lit';
import { z } from 'zod';

import { type IpcResponse } from '../../shared/ipc.js';
import { PLUGIN_PANEL_ELEMENT } from '../../shared/layout.js';
import { DockedPanel } from './panels.js';

/**
 * A plugin's panel: its page in a sandboxed iframe, and the bridge it talks through
 * (TYTO-49, ADR 0045).
 *
 * **`sandbox="allow-scripts"` and not one token more.** No `allow-same-origin`, so the page
 * has an opaque origin: `window.parent.document` throws, `localStorage` throws, and nothing
 * the app keeps is reachable. No `allow-popups`, `allow-top-navigation`, `allow-forms` or
 * `allow-modals`, so it cannot open a window, move the app, submit anywhere or put a dialog
 * in front of it. Electron runs no preload in a subframe, so `window.tyto` is not there
 * either. Main serves the page with no network (`panelPolicy`) and keeps its frame on its own
 * plugin's pages (`frameNavigationAllowed`).
 *
 * **The bridge is `postMessage`, validated here and checked in main.** A page asks
 * `{ tyto: 'panel', type: 'request', id, capability, args }`; this file checks the shape,
 * relays it on `panel:request` with the panel's id — never one the page names — and posts
 * back `{ tyto: 'panel', type: 'response', id, ok, … }`. A message from anything that is not
 * one of these iframes is ignored. The page hears `{ type: 'event', event: 'document', text }`
 * whenever the open brief changes: **the document's text leaves the editor for the plugin's
 * code**, which is stated in ADR 0045 and on the plugins screen.
 */

export type OfferedPanel = IpcResponse<'plugins:panels'>['panels'][number];

/** The iframe's sandbox, exactly. `plugin-panel.test.ts` asserts the attribute is this. */
export const PANEL_SANDBOX = 'allow-scripts';

const requestSchema = z.strictObject({
  tyto: z.literal('panel'),
  type: z.literal('request'),
  id: z.number().int().nonnegative(),
  capability: z.enum(['fetch', 'credentials']),
  args: z.array(z.unknown()).max(2),
});

export interface PanelBridge {
  request(
    panelId: string,
    capability: 'fetch' | 'credentials',
    args: readonly unknown[],
  ): Promise<IpcResponse<'panel:request'>>;
}

export class PluginPanel extends DockedPanel {
  static override properties = {
    ...DockedPanel.properties,
    offered: { attribute: false },
  };

  declare offered: OfferedPanel | undefined;

  constructor() {
    super();
    this.offered = undefined;
  }

  /** The panel's window, which is the only source a message is accepted from. */
  frameWindow(): Window | null {
    return this.querySelector('iframe')?.contentWindow ?? null;
  }

  protected override render(): unknown {
    const offered = this.offered;
    return html`<div class="work__bar">
        <h2 class="work__title">${offered?.title ?? ''}</h2>
        ${
          this.fixed
            ? nothing
            : html`<button
                type="button"
                class="panel__close"
                title=${this.say('panel.close')}
                aria-label=${this.say('panel.close')}
                @click=${() => {
                  this.onClose(this.panelId);
                }}
              >
                ×
              </button>`
        }
      </div>
      ${
        offered === undefined
          ? nothing
          : html`<iframe
              class="plugin-panel__frame"
              sandbox=${PANEL_SANDBOX}
              src=${offered.src}
              title=${offered.title}
              @load=${() => {
                this.dispatchEvent(new CustomEvent('plugin-panel-load', { bubbles: true }));
              }}
            ></iframe>`
      }`;
  }
}

customElements.define(PLUGIN_PANEL_ELEMENT, PluginPanel);

declare global {
  interface HTMLElementTagNameMap {
    [PLUGIN_PANEL_ELEMENT]: PluginPanel;
  }
}

/** Every plugin panel in the window, open ones only — a closed one has no element. */
const openPanels = (root: ParentNode): PluginPanel[] => [
  ...root.querySelectorAll<PluginPanel>(PLUGIN_PANEL_ELEMENT),
];

/**
 * Answers the panels' requests, from the one listener the window has for them.
 *
 * `source` is matched against each panel's own iframe, so a page cannot speak for another
 * plugin's panel, and the panel id relayed is the element's, never the message's.
 */
export function servePanelBridge(
  target: Pick<Window, 'addEventListener'>,
  root: ParentNode,
  bridge: PanelBridge,
): void {
  target.addEventListener('message', (event: MessageEvent) => {
    const panel = openPanels(root).find(
      (candidate) => candidate.frameWindow() !== null && candidate.frameWindow() === event.source,
    );
    if (panel === undefined) return;
    const parsed = requestSchema.safeParse(event.data);
    if (!parsed.success) return;
    const source = event.source as Window;
    const { id, capability, args } = parsed.data;
    void bridge.request(panel.panelId, capability, args).then((answer) => {
      // `*` because the page's origin is opaque and has no name to target; the message goes
      // to that one window object, which is what makes it private.
      source.postMessage({ tyto: 'panel', type: 'response', id, ...answer }, '*');
    });
  });
}

/** Tells every open panel what the open document now says. */
export function announceDocument(root: ParentNode, text: string): void {
  for (const panel of openPanels(root)) {
    panel
      .frameWindow()
      ?.postMessage({ tyto: 'panel', type: 'event', event: 'document', text }, '*');
  }
}
