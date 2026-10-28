import { type Diagnostics, ok } from '@tyto/core';
import type { RunClock } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { resolveSettings } from './configuration.js';
import { PLUGIN_API_VERSION } from './engine.js';
import { type PluginHost, createPluginHost } from './host.js';
import { activateInstalled, startInstalledPlugins } from './installed.js';
import { runGuest } from './isolation/guest.js';
import { inProcessChannel } from './isolation/in-process-channel.js';
import type { PluginStore } from './loader.js';
import { testPlugin } from './testing.js';

/**
 * The harness a plugin's repository tests with (TYTO-445, ADR 0150), held to the app's path.
 *
 * "The app's path" is `startInstalledPlugins` and `activateInstalled`, the half the CLI and
 * the desktop share, composed here over an in-memory store and the same in-process channel.
 * Every refusal below is asked of both, and the harness must answer the code and the message
 * the app wraps in its `W_PLUGIN_SKIPPED`.
 */

const MANIFEST = {
  name: 'demo',
  version: '1.0.0',
  engine: `>=${PLUGIN_API_VERSION}`,
  contributes: ['recipe-verb', 'configuration'],
  namespace: 'demo',
  permissions: ['credentials:token'],
};

const manifestText = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ ...MANIFEST, ...overrides });

const greetingSchema = z.object({ greeting: z.string() }).partial().optional();

/** A plugin as its repository would build it: a module with `activate`. */
const demoPlugin = (host: PluginHost): void => {
  host.registerConfiguration({
    id: 'greeting',
    form: { type: 'string' },
    default: 'olá',
    description: 'What the row says.',
  });
  host.registerRecipeVerb({
    id: 'demo.pull',
    kind: 'source',
    arguments: [],
    page: async ({ section }) => {
      // A test that hands no secret still runs the verb; the one that does sees it rotated.
      const token = await host.credentials('token').catch(() => undefined);
      const greeting = host.config(greetingSchema)?.greeting ?? '(none)';
      const site = (section as { site?: string } | undefined)?.site ?? '(no section)';
      if (token !== undefined) await host.credentials.set('token', `${token}-rotated`);
      return ok({
        table: {
          columns: [
            { name: 'greeting', type: 'text', origin: 'demo' },
            { name: 'site', type: 'text', origin: 'demo' },
            { name: 'token', type: 'text', origin: 'demo' },
            { name: 'seen', type: 'text', origin: 'demo' },
          ],
          rows: [
            {
              key: 'D-1',
              values: { greeting, site, token: token ?? '(none)', seen: null },
              provenance: { source: 'demo', id: 'D-1', fetchedAt: '2026-10-27' },
            },
          ],
        },
      });
    },
  });
};

const moduleOf = (activate: (host: PluginHost) => void) => () => Promise.resolve({ activate });

/** 2026-10-27 12:00 in São Paulo. */
const FIXED: RunClock = {
  now: () => new Date('2026-10-27T15:00:00Z'),
  offsetMinutes: () => -180,
};

describe('testPlugin', () => {
  it('runs a recipe verb with settings, its section, a secret and a fixed clock', async () => {
    const harness = await testPlugin({
      manifest: manifestText(),
      load: moduleOf(demoPlugin),
      settings: { 'demo.greeting': 'bom dia' },
      section: { site: 'acme' },
      secrets: { token: 's3cret' },
    });
    if (!harness.ok) throw new Error(harness.error[0]?.message);

    const run = await harness.value.runRecipe(
      ['demo.pull', 'stamp seen when="site = acme" format="yyyy-MM-dd HH:mm"'].join('\n'),
      { clock: FIXED },
    );
    if (!run.ok) throw new Error(run.error[0]?.message);
    expect(run.value.cells.flatMap((cell) => cell.diagnostics)).toEqual([]);
    expect(run.value.table?.rows[0]?.values).toEqual({
      greeting: 'bom dia',
      site: 'acme',
      token: 's3cret',
      seen: '2026-10-27 12:00',
    });
    expect(harness.value.secret('token')).toBe('s3cret-rotated');
    expect(harness.value.host.registry.configurations().map((setting) => setting.key)).toEqual([
      'demo.greeting',
    ]);
    await harness.value.close();
  });

  it('includes a recipe by name, and names one the test did not include', async () => {
    const harness = await testPlugin({ manifest: manifestText(), load: moduleOf(demoPlugin) });
    if (!harness.ok) throw new Error(harness.error[0]?.message);
    const included = await harness.value.runRecipe('run pull', {
      include: { pull: 'recipe pull\ndemo.pull' },
    });
    expect(included.ok && included.value.table?.rows[0]?.values['greeting']).toBe('olá');

    const missing = await harness.value.runRecipe('run other');
    const codes = missing.ok
      ? missing.value.cells.flatMap((cell) => cell.diagnostics.map((item) => item.code))
      : missing.error.map((item) => item.code);
    expect(codes).toEqual(['E_RECIPE_RUN']);
    await harness.value.close();
  });

  it('refuses an answer that could not cross a process, as the app does', async () => {
    const harness = await testPlugin({
      manifest: manifestText(),
      load: moduleOf((host) => {
        host.registerRecipeVerb({
          id: 'demo.pull',
          kind: 'source',
          arguments: [],
          page: () =>
            ok({
              table: { columns: [], rows: [] },
              // A function is what `postMessage` cannot clone; a call in process could hand it.
              cursor: (() => 'next') as unknown as string,
            }),
        });
      }),
    });
    if (!harness.ok) throw new Error(harness.error[0]?.message);
    const run = await harness.value.runRecipe('demo.pull');
    const codes = run.ok
      ? run.value.cells.flatMap((cell) => cell.diagnostics.map((item) => item.code))
      : [];
    expect(codes).toEqual(['E_PLUGIN_CALL']);
    await harness.value.close();
  });

  it('rejects a fetch the test did not stub, naming the URL', async () => {
    const harness = await testPlugin({
      manifest: manifestText({ permissions: ['net:example.com'] }),
      load: moduleOf((host) => {
        host.registerRecipeVerb({
          id: 'demo.pull',
          kind: 'source',
          arguments: [],
          page: async () => {
            await host.fetch('https://example.com/issues');
            return ok({ table: { columns: [], rows: [] } });
          },
        });
      }),
    });
    if (!harness.ok) throw new Error(harness.error[0]?.message);
    const run = await harness.value.runRecipe('demo.pull');
    const messages = run.ok
      ? run.value.cells.flatMap((cell) => cell.diagnostics.map((item) => item.message))
      : [];
    expect(messages.join('\n')).toContain('no fetch for https://example.com/issues');
    await harness.value.close();
  });
});

/** The CLI's and the desktop's shared path, over one stored folder. */
async function throughTheApp(
  manifest: string,
  activate: (host: PluginHost) => void,
): Promise<{ readonly warnings: Diagnostics; readonly host: ReturnType<typeof createPluginHost> }> {
  const permissions = (JSON.parse(manifest) as { permissions: string[] }).permissions;
  const store: PluginStore = {
    list: () => Promise.resolve([{ folder: 'demo', manifestSource: manifest }]),
    readState: () =>
      Promise.resolve(
        ok({ plugins: { demo: { enabled: true, permissions, source: '/somewhere/demo' } } }),
      ),
    writeState: () => Promise.resolve(),
    readCrashes: () => Promise.resolve(ok({ crashes: {} })),
    writeCrashes: () => Promise.resolve(),
    add: () => Promise.resolve(ok(undefined)),
    remove: () => Promise.resolve(),
    directoryOf: (name) => `/plugins/${name}`,
    linksLeaving: () => Promise.resolve([]),
  };
  const loaded = await startInstalledPlugins(store, {
    requireSandbox: false,
    entryOf: (folder) => Promise.resolve(`/plugins/${folder}/dist/index.js`),
    launch: () =>
      inProcessChannel((guest) =>
        runGuest(guest, moduleOf(activate), {
          runtime: 'test',
          canary: 'readable',
          detail: '',
        }),
      ),
  });
  const host = createPluginHost();
  const warnings = activateInstalled(host, loaded, { encodes: () => true, encodable: '' });
  await loaded.close();
  return { warnings, host };
}

/** What the harness refused with, as the app's `W_PLUGIN_SKIPPED` carries each reason. */
async function refusedBoth(
  manifest: string,
  activate: (host: PluginHost) => void,
): Promise<{ readonly harness: Diagnostics; readonly app: Diagnostics }> {
  const harness = await testPlugin({ manifest, load: moduleOf(activate) });
  if (harness.ok) throw new Error('the harness loaded a plugin it should have refused');
  const { warnings } = await throughTheApp(manifest, activate);
  return { harness: harness.error, app: warnings };
}

function expectSameRefusal(
  refusal: { readonly harness: Diagnostics; readonly app: Diagnostics },
  code: string,
): void {
  expect(refusal.harness.map((item) => item.code)).toEqual([code]);
  expect(refusal.app.map((item) => item.code)).toEqual(['W_PLUGIN_SKIPPED']);
  expect(refusal.app[0]?.message).toContain(refusal.harness[0]?.message);
}

describe('testPlugin refuses what the app refuses', () => {
  it('loads the demo plugin where the app loads it', async () => {
    const { warnings, host } = await throughTheApp(manifestText(), demoPlugin);
    expect(warnings).toEqual([]);
    expect(host.registry.recipeVerbs().map((verb) => verb.id)).toEqual(['demo.pull']);
  });

  it('a registration into a point the manifest does not declare: E_PLUGIN_ACTIVATE', async () => {
    const refusal = await refusedBoth(manifestText({ contributes: ['configuration'] }), demoPlugin);
    expectSameRefusal(refusal, 'E_PLUGIN_ACTIVATE');
    expect(refusal.harness[0]?.message).toContain("'recipe-verb'");
  });

  it('accepts a declared point the plugin never registers into, as the host does', async () => {
    const manifest = manifestText({ contributes: ['recipe-verb', 'configuration', 'theme'] });
    const harness = await testPlugin({ manifest, load: moduleOf(demoPlugin) });
    expect(harness.ok).toBe(true);
    if (harness.ok) await harness.value.close();
    expect((await throughTheApp(manifest, demoPlugin)).warnings).toEqual([]);
  });

  it('a setting whose default its own form refuses: E_PLUGIN_ACTIVATE', async () => {
    const refusedDefault = (host: PluginHost): void => {
      host.registerConfiguration({
        id: 'site',
        form: { type: 'string', format: 'uri' },
        default: 'not a uri',
        description: 'Where the service is.',
      });
    };
    const refusal = await refusedBoth(
      manifestText({ contributes: ['configuration'] }),
      refusedDefault,
    );
    expectSameRefusal(refusal, 'E_PLUGIN_ACTIVATE');
    expect(refusal.harness[0]?.message).toContain('default');
  });

  it('a written value the setting refuses: W_SETTING_INVALID, and the default applies', async () => {
    const settings = { 'demo.greeting': 42 };
    const harness = await testPlugin({
      manifest: manifestText(),
      load: moduleOf(demoPlugin),
      settings,
    });
    if (!harness.ok) throw new Error(harness.error[0]?.message);
    const { host } = await throughTheApp(manifestText(), demoPlugin);
    const app = resolveSettings(
      host.registry.configurations(),
      Object.entries(settings).map(([key, value]) => ({ key, value })),
    );

    expect(harness.value.settings.diagnostics.map((item) => item.code)).toEqual([
      'W_SETTING_INVALID',
    ]);
    expect(harness.value.settings.diagnostics).toEqual(app.diagnostics);
    const run = await harness.value.runRecipe('demo.pull');
    expect(run.ok && run.value.table?.rows[0]?.values['greeting']).toBe('olá');
    await harness.value.close();
  });

  it('an engine range this plugin API does not satisfy: E_PLUGIN_ENGINE', async () => {
    const refusal = await refusedBoth(manifestText({ engine: '>=99' }), demoPlugin);
    expectSameRefusal(refusal, 'E_PLUGIN_ENGINE');
  });
});
