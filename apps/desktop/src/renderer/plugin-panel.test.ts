// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PLUGIN_PANEL_ELEMENT } from '../../shared/layout.js';
import {
  type OfferedPanel,
  type PanelBridge,
  PANEL_SANDBOX,
  type PluginPanel,
  announceDocument,
  servePanelBridge,
} from './plugin-panel.js';

/**
 * The panel element and its bridge, in jsdom.
 *
 * What only a real window can show — that the sandbox really stops `window.parent.document`
 * and `localStorage`, that no preload reaches the frame, that a navigation out is refused —
 * is `e2e/panel-plugin.desktop.test.ts`. This file pins what the renderer writes and what it
 * relays.
 */

const OFFERED: OfferedPanel = {
  id: 'plugin:demo/contagem',
  plugin: 'demo',
  title: 'Contagem',
  src: 'tyto-plugin://demo/panel/index.html',
};

async function mounted(): Promise<PluginPanel> {
  const panel = document.createElement(PLUGIN_PANEL_ELEMENT);
  panel.panelId = OFFERED.id;
  panel.offered = OFFERED;
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the plugin panel element', () => {
  it('frames the page with sandbox="allow-scripts" and nothing else', async () => {
    const panel = await mounted();
    const frame = panel.querySelector('iframe');

    expect(PANEL_SANDBOX).toBe('allow-scripts');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame?.getAttribute('src')).toBe(OFFERED.src);
    expect(frame?.hasAttribute('allow')).toBe(false);
    expect(panel.querySelector('.work__title')?.textContent).toBe('Contagem');
  });

  it('draws no frame before main has said what the panel is', async () => {
    const panel = document.createElement(PLUGIN_PANEL_ELEMENT);
    document.body.append(panel);
    await panel.updateComplete;
    expect(panel.querySelector('iframe')).toBeNull();
  });
});

describe('the bridge', () => {
  /** A `window` that only records its message listener, so a test can deliver events. */
  function target(): {
    listen: Pick<Window, 'addEventListener'>;
    deliver(event: MessageEvent): void;
  } {
    let listener: ((event: MessageEvent) => void) | undefined;
    return {
      listen: {
        addEventListener: ((type: string, handler: (event: MessageEvent) => void) => {
          if (type === 'message') listener = handler;
        }) as Window['addEventListener'],
      },
      deliver: (event) => listener?.(event),
    };
  }

  const request = {
    tyto: 'panel',
    type: 'request',
    id: 7,
    capability: 'fetch',
    args: ['https://x.test/'],
  };

  it('relays a request with the element’s panel id, and posts the answer back to that frame', async () => {
    const panel = await mounted();
    const source = panel.frameWindow()!;
    const posted = vi.spyOn(source, 'postMessage').mockImplementation(() => undefined);
    const bridge: PanelBridge = {
      request: vi.fn(() =>
        Promise.resolve({ ok: false as const, code: 'E_PERMISSION', message: 'no' }),
      ),
    };
    const window_ = target();
    servePanelBridge(window_.listen, document, bridge);

    window_.deliver(
      new MessageEvent('message', { data: { ...request, panelId: 'plugin:other/x' }, source }),
    );
    await Promise.resolve();
    await Promise.resolve();

    // The page cannot name another panel: the extra key fails the strict shape, and nothing
    // is relayed. The same request without it goes through under the element's own id.
    expect(bridge.request).not.toHaveBeenCalled();

    window_.deliver(new MessageEvent('message', { data: request, source }));
    await vi.waitFor(() => {
      expect(posted).toHaveBeenCalled();
    });
    expect(bridge.request).toHaveBeenCalledWith('plugin:demo/contagem', 'fetch', [
      'https://x.test/',
    ]);
    expect(posted).toHaveBeenCalledWith(
      { tyto: 'panel', type: 'response', id: 7, ok: false, code: 'E_PERMISSION', message: 'no' },
      '*',
    );
  });

  it('ignores a message from anything that is not a panel’s frame', async () => {
    await mounted();
    const bridge: PanelBridge = { request: vi.fn() };
    const window_ = target();
    servePanelBridge(window_.listen, document, bridge);

    window_.deliver(new MessageEvent('message', { data: request, source: window }));
    window_.deliver(new MessageEvent('message', { data: request }));
    await Promise.resolve();
    expect(bridge.request).not.toHaveBeenCalled();
  });

  it('tells every open panel what the document says', async () => {
    const panel = await mounted();
    const posted = vi
      .spyOn(panel.frameWindow()!, 'postMessage')
      .mockImplementation(() => undefined);

    announceDocument(document, '::titulo Oi');
    expect(posted).toHaveBeenCalledWith(
      { tyto: 'panel', type: 'event', event: 'document', text: '::titulo Oi' },
      '*',
    );
  });
});
