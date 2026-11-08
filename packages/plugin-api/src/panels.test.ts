import { type Result, err, ok } from '@tyto/core';
import type { JsonValue } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import type { PanelCallRequest, PanelContribution } from './contributions.js';
import { type Plugin, createPluginHost } from './host.js';
import { PANEL_CALL_MAX_BYTES, callPanel, panelCallerOf } from './panels.js';

/**
 * A panel's call in process (TYTO-372, ADR 0173): what the host checks before the plugin sees
 * a page's request and after it answers. The same contribution across a process boundary is
 * `isolation/isolated-plugin.test.ts`'s.
 */

const PANEL = { title: 'Conta', entry: 'panel/index.html' } as const;

function pluginWith(id: string, panels: readonly PanelContribution[]): Plugin {
  return {
    id,
    manifest: {
      name: id,
      version: '0.1.0',
      engine: '>=0.1',
      contributes: ['panel'],
      permissions: [],
    },
    activate: (host) => {
      for (const panel of panels) host.registerPanel(panel);
    },
  };
}

/** A host holding one panel whose `call` echoes, and every request it was handed. */
function echoing(answer?: (request: PanelCallRequest) => unknown) {
  const heard: PanelCallRequest[] = [];
  const host = createPluginHost();
  const activated = host.tryActivate(
    pluginWith('conta', [
      {
        ...PANEL,
        id: 'conta',
        call: (request) => {
          heard.push(request);
          return (answer?.(request) ?? ok(request.params ?? null)) as Result<JsonValue, never>;
        },
      },
    ]),
  );
  if (!activated.ok) throw new Error(activated.error[0]?.message);
  return { call: panelCallerOf(host.registry), heard };
}

const problemOf = (answer: Result<JsonValue, readonly { code: string; message: string }[]>) =>
  answer.ok ? undefined : { code: answer.error[0]?.code, message: answer.error[0]?.message };

describe('a panel calling its own plugin', () => {
  it('hands the plugin the method and params, and answers its JSON', async () => {
    const { call, heard } = echoing();

    const answer = await call('conta', { method: 'folder.list', params: { folder: 'raiz' } });

    expect(answer).toEqual(ok({ folder: 'raiz' }));
    expect(heard).toEqual([{ method: 'folder.list', params: { folder: 'raiz' } }]);
  });

  it('is E_PANEL_CALL when the panel registered no call', async () => {
    const host = createPluginHost();
    host.tryActivate(pluginWith('conta', [{ ...PANEL, id: 'conta' }]));

    const answer = await panelCallerOf(host.registry)('conta', { method: 'token.test' });

    expect(problemOf(answer)).toEqual({
      code: 'E_PANEL_CALL',
      message: "Panel 'conta' could not call its plugin: its plugin registered no 'call'.",
    });
  });

  it('is E_PANEL_CALL for a panel id nobody registered', async () => {
    const { call, heard } = echoing();

    const answer = await call('outra', { method: 'token.test' });

    expect(problemOf(answer)?.message).toBe(
      "Panel 'outra' could not call its plugin: no panel with that id is registered.",
    );
    expect(heard).toEqual([]);
  });

  it.each(['Token', '1token', '', 'a'.repeat(101), 'folder/list', 'token test', '.token'])(
    'refuses the method %j before the plugin sees it',
    async (method) => {
      const { call, heard } = echoing();

      const answer = await call('conta', { method });

      expect(problemOf(answer)?.code).toBe('E_PANEL_CALL');
      expect(problemOf(answer)?.message).toContain('method must be a lowercase letter');
      expect(heard).toEqual([]);
    },
  );

  it.each(['a', 'a'.repeat(100), 'token.test', 'folder_list-2'])(
    'accepts the method %j',
    async (method) => {
      const { call } = echoing();

      expect((await call('conta', { method })).ok).toBe(true);
    },
  );

  it('refuses a request that names a plugin or a panel, rather than ignoring the name', async () => {
    const { call, heard } = echoing();

    const named = await call('conta', { method: 'token.test', plugin: 'outro' });
    const notAnObject = await call('conta', 'token.test');

    expect(problemOf(named)?.message).toContain('Unrecognized key');
    expect(problemOf(notAnObject)?.code).toBe('E_PANEL_CALL');
    expect(heard).toEqual([]);
  });

  it('holds params to 1 MiB of JSON, counted in UTF-8 bytes', async () => {
    const { call, heard } = echoing(() => ok(null));
    // A JSON string is its characters and two quotes.
    const atCeiling = 'x'.repeat(PANEL_CALL_MAX_BYTES - 2);
    const overCeiling = `${'x'.repeat(PANEL_CALL_MAX_BYTES - 3)}é`;

    expect((await call('conta', { method: 'put', params: atCeiling })).ok).toBe(true);
    const over = await call('conta', { method: 'put', params: overCeiling });

    expect(problemOf(over)?.message).toContain(
      `params must be at most ${String(PANEL_CALL_MAX_BYTES)} bytes of JSON`,
    );
    expect(heard).toHaveLength(1);
  });

  it('refuses params that are not JSON', async () => {
    const { call, heard } = echoing();

    const answer = await call('conta', { method: 'put', params: { when: undefined } });

    expect(problemOf(answer)?.code).toBe('E_PANEL_CALL');
    expect(heard).toEqual([]);
  });

  it('refuses an answer over 1 MiB, or one that is not JSON', async () => {
    const big = await echoing(() => ok('x'.repeat(PANEL_CALL_MAX_BYTES))).call('conta', {
      method: 'get',
    });
    const notJson = await echoing(() => ok({ run: () => 1 })).call('conta', { method: 'get' });
    const notResult = await echoing(() => 'raw').call('conta', { method: 'get' });

    expect(problemOf(big)?.message).toContain("its plugin's answer is refused");
    expect(problemOf(notJson)?.message).toContain("its plugin's answer is refused");
    expect(problemOf(notResult)?.message).toContain('something other than a result');
  });

  it("passes the plugin's own refusal through, and turns a throw into E_PANEL_CALL", async () => {
    const refusal = err([
      { severity: 'error' as const, code: 'E_PLUGIN_FETCH' as const, message: 'no token' },
    ]);
    const refused = await echoing(() => refusal).call('conta', { method: 'token.test' });
    const threw = await echoing(() => {
      throw new Error('boom');
    }).call('conta', { method: 'token.test' });

    expect(refused).toEqual(refusal);
    expect(problemOf(threw)?.message).toBe(
      "Panel 'conta' could not call its plugin: its plugin threw: boom.",
    );
  });

  it('reaches only the panel it was asked for, whatever plugin owns another one', async () => {
    const heard: string[] = [];
    const panelOf = (owner: string): PanelContribution => ({
      ...PANEL,
      id: owner,
      call: () => {
        heard.push(owner);
        return ok(owner);
      },
    });
    const host = createPluginHost();
    host.tryActivate(pluginWith('primeiro', [panelOf('primeiro')]));
    host.tryActivate(pluginWith('segundo', [panelOf('segundo')]));
    const call = panelCallerOf(host.registry);

    expect(await call('primeiro', { method: 'whoami' })).toEqual(ok('primeiro'));
    expect(await call('segundo', { method: 'whoami' })).toEqual(ok('segundo'));
    expect(heard).toEqual(['primeiro', 'segundo']);
  });

  it('calls the contribution it is handed with the contribution as `this`', async () => {
    const panel = {
      ...PANEL,
      id: 'conta',
      greeting: 'oi',
      call(this: { greeting: string }) {
        return ok(this.greeting);
      },
    };

    expect(await callPanel(panel, { method: 'hello' })).toEqual(ok('oi'));
  });
});
