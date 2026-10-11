import type { HostCapabilities } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import { createPanelService } from './panels.js';
import type { WindowPlugins } from './window-plugins.js';

/** One plugin, `demo`, with one panel and the permissions it was granted. */
function contributed(permissions: readonly string[]): WindowPlugins {
  return {
    resolver: { find: () => undefined },
    names: () => [],
    ready: Promise.resolve(),
    panels: () => [
      {
        plugin: 'demo',
        panel: { id: 'contagem', title: 'Contagem', entry: 'panel/index.html', location: 'bottom' },
      },
    ],
    keymaps: () => [],
    themes: () => [],
    permissionsOf: (plugin) => (plugin === 'demo' ? permissions : undefined),
    brandKits: () => ({ kits: new Map(), diagnostics: [] }),
  };
}

const network: HostCapabilities = {
  fetch: (url) =>
    Promise.resolve({
      url,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
      body: new TextEncoder().encode('olá'),
    }),
  credential: () => Promise.resolve('segredo'),
  describeCredential: () => 'the test keychain',
};

describe('the panel service', () => {
  it('lists each panel under a prefixed id, with its page as a tyto-plugin: URL', async () => {
    const panels = await createPanelService(contributed([]), network).list();
    expect(panels).toEqual([
      {
        id: 'plugin:demo/contagem',
        plugin: 'demo',
        title: 'Contagem',
        location: 'bottom',
        src: 'tyto-plugin://demo/panel/index.html',
      },
    ]);
  });

  it('refuses a fetch its plugin has no net: permission for, as data', async () => {
    const service = createPanelService(contributed([]), network);
    const answer = await service.request('plugin:demo/contagem', 'fetch', [
      'https://api.example.com/x',
    ]);
    expect(answer).toMatchObject({ ok: false, code: 'E_PERMISSION' });
  });

  it('answers a fetch its plugin declared, the body as text', async () => {
    const service = createPanelService(contributed(['net:api.example.com']), network);
    const answer = await service.request('plugin:demo/contagem', 'fetch', [
      'https://api.example.com/x',
    ]);
    expect(answer).toEqual({
      ok: true,
      value: {
        url: 'https://api.example.com/x',
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        body: 'olá',
      },
    });
  });

  it('gives a credential only for a declared key', async () => {
    const service = createPanelService(contributed(['credentials:token']), network);
    expect(await service.request('plugin:demo/contagem', 'credentials', ['token'])).toEqual({
      ok: true,
      value: 'segredo',
    });
    expect(await service.request('plugin:demo/contagem', 'credentials', ['other'])).toMatchObject({
      ok: false,
      code: 'E_PERMISSION',
    });
  });

  it('refuses a panel id no plugin offers', async () => {
    const service = createPanelService(contributed(['net:*']), network);
    expect(await service.request('plugin:outro/x', 'fetch', ['https://a.test/'])).toMatchObject({
      ok: false,
      code: 'E_PERMISSION',
    });
  });

  it('refuses arguments of the wrong shape without calling anything', async () => {
    const service = createPanelService(contributed(['net:*']), network);
    expect(await service.request('plugin:demo/contagem', 'fetch', [42])).toMatchObject({
      ok: false,
      code: 'E_PLUGIN_CALL',
    });
  });
});
