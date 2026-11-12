import { ok } from '@tyto/core';
import type { HostCapabilities, PanelCallRequest, PanelContribution } from '@tyto/plugin-api';
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
    vim: () => [],
    themes: () => [],
    permissionsOf: (plugin) => (plugin === 'demo' ? permissions : undefined),
    brandKits: () => ({ kits: new Map(), diagnostics: [] }),
    assetSources: () => [],
    fontSources: () => [],
    configurations: () => [],
    configure: () => undefined,
    running: () => ['demo'],
    recipeContributions: () => ({
      recipeVerbs: () => [],
      ownedRecipeVerbs: () => [],
      recipeDerivations: () => [],
    }),
    setFetched: () => undefined,
    fetchedDirectory: () => undefined,
    inForce: () => Promise.resolve({ plugins: [], warnings: [], close: () => Promise.resolve() }),
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

  it('never reads a credential back to the page, declared or not, and names call (TYTO-641)', async () => {
    let reads = 0;
    const keychain: HostCapabilities = {
      ...network,
      credential: () => {
        reads += 1;
        return Promise.resolve('segredo');
      },
    };
    const service = createPanelService(contributed(['credentials:token']), keychain);
    for (const key of ['token', 'other']) {
      const answer = await service.request('plugin:demo/contagem', 'credentials', [key]);
      expect(answer).toEqual({
        ok: false,
        code: 'E_PANEL_CREDENTIAL_READ',
        message: `Panel 'contagem' cannot read credential '${key}': ask its plugin through 'call', which uses the secret without putting it in the page.`,
      });
      expect(JSON.stringify(answer)).not.toContain('segredo');
    }
    expect(reads).toBe(0);
  });

  it("stores and forgets its own plugin's declared key, and only that one (ADR 0134)", async () => {
    const stored = new Map<string, string>();
    const keychain: HostCapabilities = {
      ...network,
      credential: (plugin, key) => Promise.resolve(stored.get(`${plugin}/${key}`)),
      storeCredential: (plugin, key, value) => {
        stored.set(`${plugin}/${key}`, value);
        return Promise.resolve();
      },
      deleteCredential: (plugin, key) => Promise.resolve(stored.delete(`${plugin}/${key}`)),
    };
    const service = createPanelService(contributed(['credentials:token']), keychain);
    const panel = 'plugin:demo/contagem';

    expect(await service.request(panel, 'storeCredential', ['token', 'novo'])).toEqual({
      ok: true,
      value: null,
    });
    expect([...stored]).toEqual([['demo/token', 'novo']]);
    expect(await service.request(panel, 'deleteCredential', ['token'])).toEqual({
      ok: true,
      value: true,
    });
    for (const [capability, args] of [
      ['storeCredential', ['other', 'x']],
      ['deleteCredential', ['other']],
    ] as const) {
      expect(await service.request(panel, capability, args)).toMatchObject({
        ok: false,
        code: 'E_PERMISSION',
      });
    }
    expect([...stored]).toEqual([]);
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

describe("a panel's call (ADR 0173)", () => {
  /** Two plugins whose panels share an id, each answering with its own name, and one mute. */
  function twoPlugins(): WindowPlugins {
    const answering = (plugin: string): PanelContribution => ({
      id: 'settings',
      title: plugin,
      entry: 'panel/index.html',
      call: (request: PanelCallRequest) =>
        Promise.resolve(ok({ plugin, method: request.method, params: request.params ?? null })),
    });
    return {
      ...contributed([]),
      panels: () => [
        { plugin: 'alfa', panel: answering('alfa') },
        { plugin: 'beta', panel: answering('beta') },
        { plugin: 'mudo', panel: { id: 'settings', title: 'mudo', entry: 'panel/index.html' } },
      ],
      permissionsOf: () => [],
    };
  }

  it("reaches the frame's own plugin, even when another plugin's panel has the same id", async () => {
    const service = createPanelService(twoPlugins(), network);
    expect(
      await service.request('plugin:beta/settings', 'call', ['folder.list', { folder: 'raiz' }]),
    ).toEqual({
      ok: true,
      value: { plugin: 'beta', method: 'folder.list', params: { folder: 'raiz' } },
    });
    expect(await service.request('plugin:alfa/settings', 'call', ['token.test'])).toEqual({
      ok: true,
      value: { plugin: 'alfa', method: 'token.test', params: null },
    });
  });

  it('refuses a panel id no plugin offers, a plugin with no call, and a bad method', async () => {
    const service = createPanelService(twoPlugins(), network);
    expect(await service.request('plugin:gama/settings', 'call', ['token.test'])).toMatchObject({
      ok: false,
      code: 'E_PERMISSION',
    });
    expect(await service.request('plugin:mudo/settings', 'call', ['token.test'])).toMatchObject({
      ok: false,
      code: 'E_PANEL_CALL',
    });
    for (const args of [[], [42], ['Token test']]) {
      expect(await service.request('plugin:alfa/settings', 'call', args)).toMatchObject({
        ok: false,
        code: 'E_PANEL_CALL',
      });
    }
  });
});
