import {
  type BrandMark,
  type Diagnostics,
  type Directive,
  MARK_PATH_LIMIT,
  type Result,
  type Scene,
  type TemplateAnswer,
  type TemplateCall,
  type TemplateRegistry,
  type TemplateReport,
  ok,
  isTonedMark,
  parseManifest,
  resolve,
  sourceRange,
} from '@tyto/core';
import { colorValue, faceValue, imageValue, numberValue } from '@tyto/core/template';
import { type Plan, type Table, parseRecipe, runRecipe } from '@tyto/recipe';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type {
  BrandKitContribution,
  DirectiveContribution,
  Exporter,
  IsolatedPackBuild,
  TemplatePack,
} from '../contributions.js';
import { directiveResolverOf } from '../directives.js';
import { resolveSettings } from '../configuration.js';
import { type RecipeRegistryOptions, recipeRegistriesOf } from '../recipes.js';
import {
  type Disposable,
  type InProcessHost,
  type InstalledPlugin,
  type Plugin,
  type PluginHost,
  createPluginHost,
} from '../host.js';
import {
  CREDENTIAL_VALUE_LIMIT_BYTES,
  type HostCapabilities,
  PLUGIN_FILE_LIMIT_BYTES,
} from '../capabilities.js';
import { ASSET_SOURCE_MAX_BYTES } from '../sources.js';
import type { GuestChannel, PluginChannel } from './channel.js';
import { runGuest } from './guest.js';
import { type IsolatedPlugin, connectIsolatedPlugin } from './isolated-plugin.js';
import { RPC_PROTOCOL_VERSION, type SandboxReport } from './protocol.js';

/** What a confined process reports: its canary was refused (ADR 0049). */
const CONFINED: SandboxReport = { runtime: 'Node v24.21.0', canary: 'denied', detail: '' };

const runConfined = (guest: GuestChannel, load: () => Promise<unknown>): void =>
  runGuest(guest, load, CONFINED);

/**
 * Isolation's protocol, end to end, with both ends in this process (TYTO-48).
 *
 * The two ends are the real ones — `runGuest` and `connectIsolatedPlugin` — and what sits
 * between them is a pair of queues that clone every message the way `postMessage` does. So
 * everything the protocol decides is exercised here: what crosses, what each side refuses,
 * and what a caller receives when the other end is gone. The worker thread itself is
 * `apps/cli`'s adapter, and its own test kills a real one.
 */

/**
 * The runtime's own, read off `globalThis`: this package compiles against no platform's
 * types (ADR 0010), and every runtime it targets has these.
 */
const { structuredClone, queueMicrotask, setTimeout, TextEncoder } = globalThis as unknown as {
  structuredClone<T>(value: T): T;
  TextEncoder: new () => { encode(text: string): Uint8Array };
  queueMicrotask(callback: () => void): void;
  setTimeout(callback: (value?: unknown) => void, delay: number): unknown;
};

interface Pair {
  readonly host: PluginChannel;
  /** Ends the guest's side as a crash would, with the reason the platform gives. */
  crash(reason: string): void;
  /** Delivered to the host as though the guest had sent it — for a guest that lies. */
  inject(message: unknown): void;
  /** Whether the host ended the channel with `close`. */
  closed(): boolean;
}

function channelPair(start: (guest: GuestChannel) => void): Pair {
  const toHost = new Set<(message: unknown) => void>();
  const toGuest = new Set<(message: unknown) => void>();
  const exits = new Set<(reason: string) => void>();
  let ended = false;
  let closedByHost = false;

  const deliver = (listeners: Set<(message: unknown) => void>, message: unknown): void => {
    // Cloned now, as `postMessage` does: a value that cannot cross throws at the sender.
    const copy = structuredClone(message);
    queueMicrotask(() => {
      if (ended) return;
      for (const listener of listeners) listener(copy);
    });
  };

  const host: PluginChannel = {
    send: (message) => deliver(toGuest, message),
    onMessage: (listener) => void toHost.add(listener),
    onExit: (listener) => void exits.add(listener),
    keepAlive: () => undefined,
    close: () => {
      ended = true;
      closedByHost = true;
      return Promise.resolve();
    },
  };

  start({
    send: (message) => deliver(toHost, message),
    onMessage: (listener) => void toGuest.add(listener),
  });

  return {
    host,
    crash: (reason) => {
      ended = true;
      for (const listener of exits) listener(reason);
    },
    closed: () => closedByHost,
    inject: (message) => {
      for (const listener of toHost) listener(message);
    },
  };
}

const MANIFEST = {
  name: 'texto',
  version: '1.0.0',
  engine: '>=0.1',
  contributes: ['exporter'],
  permissions: [],
};

const SCENE: Scene = {
  version: 1,
  artworks: [{ id: 'capa', frames: [{ format: 'feed', size: { w: 10, h: 10 }, children: [] }] }],
  fonts: [],
  assets: [],
};
const ARTWORK = SCENE.artworks[0]!;
const FRAME = ARTWORK.frames[0]!;

const textExporter: Exporter = {
  id: 'texto',
  mime: 'text/plain',
  extension: 'txt',
  kinds: ['txt'],
  rasterized: false,
  exportFrame: (scene, artwork, frame, options) =>
    ok(
      `${artwork.id} ${frame.format} ${String(scene.artworks.length)} ${String(options?.textAsPaths ?? false)}`,
    ),
};

/** Starts `activate` behind a channel and connects the host to it. */
async function isolate(
  activate: (host: PluginHost) => Disposable | void,
  options: {
    readonly onCrash?: (reason: string) => void;
    readonly log?: string[];
    readonly permissions?: readonly string[];
    readonly capabilities?: HostCapabilities;
    readonly deadlineMs?: number;
    readonly contributes?: readonly string[];
    readonly namespace?: string;
    readonly writes?: readonly string[];
  } = {},
): Promise<{ readonly pair: Pair; readonly connected: Result<IsolatedPlugin, Diagnostics> }> {
  const pair = channelPair((guest) => runConfined(guest, () => Promise.resolve({ activate })));
  const lines = options.log;
  const connected = await connectIsolatedPlugin({
    requireSandbox: true,
    name: 'texto',
    manifest: {
      ...MANIFEST,
      permissions: options.permissions ?? [],
      contributes: options.contributes ?? MANIFEST.contributes,
      ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
      ...(options.writes === undefined ? {} : { writes: options.writes }),
    },
    channel: pair.host,
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.onCrash === undefined ? {} : { onCrash: options.onCrash }),
    ...(lines === undefined
      ? {}
      : {
          log: {
            debug: (line) => lines.push(line),
            info: (line) => lines.push(line),
            warn: (line) => lines.push(line),
            error: (line) => lines.push(line),
          },
        }),
  });
  return { pair, connected };
}

function exporterIn(plugin: Plugin): Exporter {
  const host = createPluginHost();
  const activated = host.tryActivate(plugin);
  if (!activated.ok) throw new Error(activated.error.map((item) => item.message).join('\n'));
  const exporter = host.registry.exporters.forKind('txt');
  if (exporter === undefined) throw new Error('no txt exporter');
  return exporter;
}

describe('an isolated exporter', () => {
  it('produces the same output as the same exporter in process', async () => {
    const { connected } = await isolate((host) => host.registerExporter(textExporter));
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const inProcess = exporterIn({
      id: 'texto',
      manifest: MANIFEST,
      activate: (host) => host.registerExporter(textExporter),
    });
    const isolated = exporterIn(connected.value.plugin);

    for (const options of [undefined, { textAsPaths: true }]) {
      expect(await isolated.exportFrame(SCENE, ARTWORK, FRAME, options)).toEqual(
        await inProcess.exportFrame(SCENE, ARTWORK, FRAME, options),
      );
    }
    expect({ ...isolated, exportFrame: undefined }).toEqual({
      ...inProcess,
      exportFrame: undefined,
    });
  });

  it('is activated into every host it is given, from one process', async () => {
    let activations = 0;
    const { connected } = await isolate((host) => {
      activations += 1;
      host.registerExporter(textExporter);
    });
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    exporterIn(connected.value.plugin);
    exporterIn(connected.value.plugin);
    expect(activations).toBe(1);
  });

  it('goes through tryActivate, so a duplicate id is refused by name', async () => {
    const { connected } = await isolate((host) => host.registerExporter(textExporter));
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const host = createPluginHost();
    host.activate({
      id: 'owner',
      manifest: { ...MANIFEST, name: 'owner' },
      activate: (inner) => inner.registerExporter(textExporter),
    });
    const refused = host.tryActivate(connected.value.plugin);
    expect(refused.ok ? [] : refused.error.map((item) => item.code)).toEqual([
      'E_PLUGIN_DUPLICATE',
    ]);
  });

  it('has its arguments checked by the guest, before the plugin sees them', async () => {
    let seen = 0;
    const { connected } = await isolate((host) =>
      host.registerExporter({
        ...textExporter,
        exportFrame: () => {
          seen += 1;
          return ok('');
        },
      }),
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const exporter = exporterIn(connected.value.plugin);
    const broken = { ...SCENE, version: 2 } as unknown as Scene;
    const answer = await exporter.exportFrame(broken, ARTWORK, FRAME);
    expect(answer.ok ? [] : answer.error.map((item) => item.code)).toEqual(['E_PLUGIN_CALL']);
    expect(seen).toBe(0);
  });

  it('has its answer checked by the host, so a malformed result is a diagnostic', async () => {
    const { connected } = await isolate((host) =>
      host.registerExporter({
        ...textExporter,
        exportFrame: () => ({ ok: true, value: 5, diagnostics: [] }) as unknown as Result<string>,
      }),
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const answer = await exporterIn(connected.value.plugin).exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok ? [] : answer.error.map((item) => item.code)).toEqual(['E_PLUGIN_PROTOCOL']);
  });

  it('reports a throw from the plugin as E_PLUGIN_CALL', async () => {
    const { connected } = await isolate((host) =>
      host.registerExporter({
        ...textExporter,
        exportFrame: () => {
          throw new Error('no ink');
        },
      }),
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const answer = await exporterIn(connected.value.plugin).exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok ? '' : answer.error[0]?.message).toBe(
      "Plugin 'texto' threw while the host was calling it: no ink.",
    );
  });

  it('can be withdrawn by the plugin after activation', async () => {
    let registration: Disposable | undefined;
    const { connected } = await isolate((host) => {
      registration = host.registerExporter(textExporter);
    });
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const host = createPluginHost();
    host.tryActivate(connected.value.plugin);
    expect(host.registry.exporters.list()).toHaveLength(1);

    registration?.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.registry.exporters.list()).toHaveLength(0);
  });
});

describe('a crashed plugin', () => {
  it('answers every waiting call and every later one with E_PLUGIN_CRASHED, and says so once', async () => {
    const crashes: string[] = [];
    let release: (() => void) | undefined;
    const { pair, connected } = await isolate(
      (host) =>
        host.registerExporter({
          ...textExporter,
          // Never answers, so the call is still waiting when the process goes.
          exportFrame: () =>
            new Promise((resolve) => {
              release = () => resolve(ok(''));
            }),
        }),
      { onCrash: (reason) => crashes.push(reason) },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const exporter = exporterIn(connected.value.plugin);
    const waiting = exporter.exportFrame(SCENE, ARTWORK, FRAME);
    await new Promise((resolve) => setTimeout(resolve, 0));
    pair.crash('exit code 7');
    release?.();

    const codes = (answer: Result<string, Diagnostics>): readonly string[] =>
      answer.ok ? [] : answer.error.map((item) => item.message);
    expect(codes(await waiting)).toEqual(["Plugin 'texto' stopped running: exit code 7."]);
    expect(codes(await exporter.exportFrame(SCENE, ARTWORK, FRAME))).toEqual([
      "Plugin 'texto' stopped running: exit code 7.",
    ]);
    expect(crashes).toEqual(['exit code 7']);
    expect(connected.value.crashed()).toBe('exit code 7');
  });

  it('is refused when it dies during activation', async () => {
    const pair = channelPair(() => undefined);
    const connecting = connectIsolatedPlugin({
      requireSandbox: true,
      name: 'texto',
      manifest: MANIFEST,
      channel: pair.host,
    });
    pair.crash('exit code 1');
    const connected = await connecting;
    expect(connected.ok ? '' : connected.error[0]?.message).toBe(
      "Plugin 'texto' failed to activate: its process exited during activation: exit code 1.",
    );
  });
});

describe('what an isolated plugin cannot do', () => {
  it.each([
    ['source', (host: PluginHost) => host.registerSource({ id: 'inbox', value: {} })],
    ['sink', (host: PluginHost) => host.registerSink({ id: 'outbox', value: {} })],
    ['rasterizer', (host: PluginHost) => host.registerRasterizer({ id: 'r', value: {} })],
  ])('registers into %s, which is refused by name', async (point, activate) => {
    const { connected } = await isolate(activate);
    expect(connected.ok ? '' : connected.error[0]?.message).toBe(
      `Plugin 'texto' failed to activate: extension point '${point}' is not available to an isolated plugin yet.`,
    );
  });

  it('carries a function the point does not name', async () => {
    const { connected } = await isolate((host) =>
      host.registerCommand({ id: 'c', title: 'C', run: () => undefined } as never),
    );
    expect(connected.ok ? '' : connected.error[0]?.message).toContain(
      "a 'editor.command' contribution cannot carry a function in 'run'",
    );
  });

  // A bootstrap left behind by an upgrade: 8 is the number before a source's page call carried
  // `refresh` (ADR 0148), and it is refused by name rather than by a schema complaint at the
  // first run without cache.
  it('speaks another protocol', async () => {
    const pair = channelPair(() => undefined);
    const connecting = connectIsolatedPlugin({
      requireSandbox: true,
      name: 'texto',
      manifest: MANIFEST,
      channel: pair.host,
    });
    pair.inject({ type: 'hello', protocol: RPC_PROTOCOL_VERSION - 1, sandbox: CONFINED });
    const connected = await connecting;
    expect(connected.ok ? '' : connected.error[0]?.message).toBe(
      "Plugin 'texto' failed to activate: its process speaks protocol 10 and this host speaks 11.",
    );
  });

  it('registers a contribution whose data does not match its point', async () => {
    const { connected } = await isolate((host) =>
      host.registerExporter({ ...textExporter, kinds: 'txt' } as unknown as Exporter),
    );
    expect(connected.ok ? '' : connected.error[0]?.message).toContain(
      "its 'exporter' contribution does not match: kinds",
    );
  });
});

describe('what crosses besides contributions', () => {
  it('sends the plugin its configuration and its log lines to the host', async () => {
    const lines: string[] = [];
    const pair = channelPair((guest) =>
      runConfined(guest, () =>
        Promise.resolve({
          activate: (host: PluginHost) => {
            const { greeting } = host.config(
              // A schema of the plugin's own, checked in the guest.
              { safeParse: (value: unknown) => ({ success: true, data: value }) } as never,
            ) as { greeting: string };
            host.log.info(greeting, { detail: () => undefined });
          },
        }),
      ),
    );
    const connected = await connectIsolatedPlugin({
      requireSandbox: true,
      name: 'texto',
      manifest: { ...MANIFEST, contributes: ['editor.command'] },
      channel: pair.host,
      config: { greeting: 'olá' },
      log: {
        debug: () => undefined,
        info: (line, detail) => lines.push(`${line} ${String(detail)}`),
        warn: () => undefined,
        error: () => undefined,
      },
    });
    expect(connected.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lines).toEqual(['[texto] olá [object Object]']);
  });

  it('forwards the events of the host it is activated in', async () => {
    const seen: string[] = [];
    const { connected } = await isolate((host) => {
      host.registerExporter(textExporter);
      host.events.on('registered', ({ point, id }) => seen.push(`${point}/${id}`));
    });
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const host = createPluginHost();
    host.tryActivate(connected.value.plugin);
    host.activate({
      id: 'svg',
      manifest: { ...MANIFEST, name: 'svg' },
      activate: (inner) => inner.registerExporter({ ...textExporter, id: 'svg', kinds: ['svg'] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(['exporter/svg']);
  });
});

describe('a setting an isolated plugin declares (ADR 0145)', () => {
  const SETTINGS_MANIFEST = { ...MANIFEST, contributes: ['exporter', 'configuration'] };
  const passThrough = { safeParse: (value: unknown) => ({ success: true, data: value }) } as never;

  /** An exporter that answers the `baseUrl` the plugin reads from `host.config` at call time. */
  function declaring(declare: (host: PluginHost) => void) {
    return isolate(
      (host) => {
        declare(host);
        host.registerExporter({
          ...textExporter,
          exportFrame: () => {
            const config = host.config(passThrough) as { baseUrl?: string } | undefined;
            return ok(config?.baseUrl ?? '(none)');
          },
        });
      },
      { contributes: SETTINGS_MANIFEST.contributes },
    );
  }

  const declareBaseUrl = (host: PluginHost): void =>
    void host.registerConfiguration({
      id: 'baseUrl',
      form: { type: 'string', format: 'uri' },
      default: 'https://example.com',
      description: 'Where the service is.',
    });

  it('crosses as a form and is validated on the host', async () => {
    const { connected } = await declaring(declareBaseUrl);
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const host = createPluginHost();
    expect(host.tryActivate(connected.value.plugin).ok).toBe(true);

    const [declared] = host.registry.configurations();
    expect(declared?.key).toBe('texto.baseUrl');
    const resolved = resolveSettings(host.registry.configurations(), [
      { key: 'texto.baseUrl', value: 'not a uri', valueRange: sourceRange(10, 21) },
    ]);
    expect(resolved.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', sourceRange(10, 21)],
    ]);
    expect(resolved.values['texto.baseUrl']).toBe('https://example.com');
  });

  it('reaches the process on every configure, and a call reads the newest', async () => {
    const { connected } = await declaring(declareBaseUrl);
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const host = createPluginHost();
    host.tryActivate(connected.value.plugin);
    const exporter = host.registry.exporters.forKind('txt');
    if (exporter === undefined) throw new Error('no txt exporter');

    const configureWith = (value: string): void =>
      host.configure(
        resolveSettings(host.registry.configurations(), [{ key: 'texto.baseUrl', value }]).config,
      );
    configureWith('https://a.example');
    expect(await exporter.exportFrame(SCENE, ARTWORK, FRAME)).toMatchObject({
      value: 'https://a.example',
    });
    configureWith('https://b.example');
    expect(await exporter.exportFrame(SCENE, ARTWORK, FRAME)).toMatchObject({
      value: 'https://b.example',
    });
  });

  it('holds the last configure when activated into two hosts', async () => {
    const { connected } = await declaring(declareBaseUrl);
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const first = createPluginHost();
    const second = createPluginHost();
    first.tryActivate(connected.value.plugin);
    second.tryActivate(connected.value.plugin);
    first.configure({ texto: { baseUrl: 'https://first.example' } });
    second.configure({ texto: { baseUrl: 'https://second.example' } });
    const exporter = first.registry.exporters.forKind('txt');
    expect(await exporter?.exportFrame(SCENE, ARTWORK, FRAME)).toMatchObject({
      value: 'https://second.example',
    });
  });

  it('refuses a Zod schema by name, saying to use form', async () => {
    const { connected } = await declaring((host) =>
      host.registerConfiguration({
        id: 'size',
        schema: z.number(),
        default: 1,
        description: 'A size.',
      }),
    );
    expect(connected.ok ? '' : connected.error[0]?.message).toBe(
      "Plugin 'texto' failed to activate: the setting 'size' carries a Zod schema, which is code " +
        'and does not cross to the host; use form, the same rules as data (ADR 0145).',
    );
  });

  it('refuses a default its form refuses, at activation', async () => {
    const { connected } = await declaring((host) =>
      host.registerConfiguration({
        id: 'baseUrl',
        form: { type: 'string', format: 'uri' },
        default: 'nowhere',
        description: 'Where the service is.',
      }),
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const activated = createPluginHost().tryActivate(connected.value.plugin);
    expect(activated.ok ? [] : activated.error.map((item) => item.code)).toEqual([
      'E_PLUGIN_ACTIVATE',
    ]);
    expect(activated.ok ? '' : activated.error[0]?.message).toContain(
      "declares the setting 'baseUrl' with a default its own schema refuses",
    );
  });

  it('refuses an object form when the data crosses', async () => {
    const { connected } = await declaring((host) =>
      host.registerConfiguration({
        id: 'board',
        form: { type: 'object' } as never,
        default: {},
        description: 'A board.',
      }),
    );
    expect(connected.ok ? '' : connected.error[0]?.message).toContain(
      "its 'configuration' contribution does not match: form",
    );
  });
});

describe('host.fetch and host.credentials across the boundary', () => {
  function network(values: Readonly<Record<string, string>> = {}) {
    const fetched: string[] = [];
    const capabilities: HostCapabilities = {
      fetch: (url) => {
        fetched.push(url);
        return Promise.resolve({
          url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: new TextEncoder().encode('{"title":"olá"}'),
        });
      },
      credential: (_plugin, key) => Promise.resolve(values[key]),
      describeCredential: (_plugin, key) => `TYTO_PLUGIN_TEXTO_${key.toUpperCase()}`,
    };
    return { fetched, capabilities };
  }

  /** An exporter whose frame is whatever `ask` answers, or the code of what it threw. */
  const asking = (ask: (host: PluginHost) => Promise<string>) => (host: PluginHost) =>
    host.registerExporter({
      ...textExporter,
      exportFrame: async () => {
        try {
          return ok(await ask(host));
        } catch (cause) {
          return ok(
            `${(cause as { code?: string }).code ?? 'no code'}: ${(cause as Error).message}`,
          );
        }
      },
    });

  it('rejects fetch on an undeclared host with E_PERMISSION, and nothing is sent', async () => {
    const { fetched, capabilities } = network();
    const { connected } = await isolate(
      asking(async (host) => (await host.fetch('https://evil.example.org/')).text()),
      { permissions: ['net:api.example.com'], capabilities },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const answer = await exporterIn(connected.value.plugin).exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe(
      "E_PERMISSION: Plugin 'texto' called 'host.fetch to evil.example.org (net:evil.example.org)' " +
        'without that permission being granted at install time.',
    );
    expect(fetched).toEqual([]);
  });

  it('reaches a declared host, and the plugin reads the body', async () => {
    const { fetched, capabilities } = network();
    const { connected } = await isolate(
      asking(async (host) => {
        const response = await host.fetch('https://api.example.com/v1', { method: 'GET' });
        return `${String(response.ok)} ${String(((await response.json()) as { title: string }).title)}`;
      }),
      { permissions: ['net:api.example.com'], capabilities },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const answer = await exporterIn(connected.value.plugin).exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('true olá');
    expect(fetched).toEqual(['https://api.example.com/v1']);
  });

  it('resolves only a declared credential', async () => {
    const { capabilities } = network({ 'api-token': 's3cret', other: 'x' });
    const { connected } = await isolate(
      asking(async (host) => {
        const token = await host.credentials('api-token');
        const other = await host
          .credentials('other')
          .catch((cause: { code: string }) => cause.code);
        return `${token} ${other}`;
      }),
      { permissions: ['credentials:api-token'], capabilities },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const answer = await exporterIn(connected.value.plugin).exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('s3cret E_PERMISSION');
  });

  /** A host whose secrets are a map the plugin may write (ADR 0134). */
  function writable(values: Record<string, string> = {}) {
    const stored = new Map(Object.entries(values));
    const capabilities: HostCapabilities = {
      ...network().capabilities,
      credential: (_plugin, key) => Promise.resolve(stored.get(key)),
      storeCredential: (_plugin, key, value) => {
        stored.set(key, value);
        return Promise.resolve();
      },
      deleteCredential: (_plugin, key) => Promise.resolve(stored.delete(key)),
    };
    return { stored, capabilities };
  }

  it('sets, reads and deletes a declared credential', async () => {
    const { stored, capabilities } = writable();
    const { connected } = await isolate(
      asking(async (host) => {
        await host.credentials.set('token', 'novo');
        const read = await host.credentials('token');
        const deleted = await host.credentials.delete('token');
        const again = await host.credentials.delete('token');
        const missing = await host
          .credentials('token')
          .catch((cause: { code: string }) => cause.code);
        return `${read} ${String(deleted)} ${String(again)} ${missing}`;
      }),
      { permissions: ['credentials:token'], capabilities },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const answer = await exporterIn(connected.value.plugin).exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('novo true false E_CREDENTIAL_MISSING');
    expect([...stored]).toEqual([]);
  });

  it('refuses set and delete of an undeclared key, and writes nothing', async () => {
    const { stored, capabilities } = writable({ other: 'kept' });
    const { connected } = await isolate(
      asking(async (host) => {
        const codes = await Promise.all(
          [host.credentials.set('other', 'x'), host.credentials.delete('other')].map((attempt) =>
            attempt.then(
              () => 'ok',
              (cause: { code: string }) => cause.code,
            ),
          ),
        );
        return codes.join(' ');
      }),
      { permissions: ['credentials:token'], capabilities },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const answer = await exporterIn(connected.value.plugin).exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('E_PERMISSION E_PERMISSION');
    expect([...stored]).toEqual([['other', 'kept']]);
  });

  it('refuses a value over the ceiling on the host side, whatever the guest sends', async () => {
    const { stored, capabilities } = writable();
    const { connected } = await isolate(
      asking(async (host) => {
        const fits = 'a'.repeat(CREDENTIAL_VALUE_LIMIT_BYTES);
        await host.credentials.set('token', fits);
        return host.credentials.set('token', `${fits}a`).then(
          () => 'ok',
          (cause: { code: string }) => cause.code,
        );
      }),
      { permissions: ['credentials:token'], capabilities },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const answer = await exporterIn(connected.value.plugin).exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('E_CREDENTIAL_TOO_LARGE');
    expect(stored.get('token')).toHaveLength(CREDENTIAL_VALUE_LIMIT_BYTES);
  });
});

describe('host.cache and host.workspace across the boundary (ADR 0138)', () => {
  /** A cache and a workspace that are maps, each answer carrying a key the guest must not see. */
  function storing() {
    const cache = new Map<string, Uint8Array>();
    const files = new Map<string, Uint8Array>();
    const capabilities: HostCapabilities = {
      fetch: () => Promise.reject(new Error('no network here')),
      credential: () => Promise.resolve(undefined),
      describeCredential: () => 'nowhere',
      cacheGet: (_plugin, key) => {
        const bytes = cache.get(key);
        return Promise.resolve(
          bytes === undefined
            ? undefined
            : ({ bytes, storedAt: '2026-10-25T12:00:00.000Z', path: '/secret' } as never),
        );
      },
      cachePut: (_plugin, key, bytes) => {
        cache.set(key, bytes);
        return Promise.resolve({ storedAt: '2026-10-25T12:00:00.000Z', path: '/secret' } as never);
      },
      cacheDelete: (_plugin, key) => Promise.resolve(cache.delete(key)),
      cacheList: () =>
        Promise.resolve(
          [...cache].map(
            ([key, bytes]) =>
              ({
                key,
                storedAt: '2026-10-25T12:00:00.000Z',
                size: bytes.length,
                path: '/secret',
              }) as never,
          ),
        ),
      workspaceRead: (_plugin, path) => Promise.resolve(files.get(path) ?? new Uint8Array()),
      workspaceWrite: (_plugin, path, bytes) => {
        files.set(path, bytes);
        return Promise.resolve();
      },
    };
    return { cache, files, capabilities };
  }

  const asking = (ask: (host: PluginHost) => Promise<string>) => (host: PluginHost) =>
    host.registerExporter({
      ...textExporter,
      exportFrame: async () => {
        try {
          return ok(await ask(host));
        } catch (cause) {
          return ok((cause as { code?: string }).code ?? (cause as Error).message);
        }
      },
    });

  async function answerOf(
    ask: (host: PluginHost) => Promise<string>,
    options: { permissions?: readonly string[]; capabilities?: HostCapabilities },
  ): Promise<unknown> {
    const { connected } = await isolate(asking(ask), options);
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const answer = await exporterIn(connected.value.plugin).exportFrame(SCENE, ARTWORK, FRAME);
    return answer.ok && answer.value;
  }

  it('puts, gets, lists and deletes a cache entry with no permission declared', async () => {
    const { cache, capabilities } = storing();
    const answer = await answerOf(
      async (host) => {
        const stored = await host.cache.put('jira/TYTO-1', 'olá');
        const entry = await host.cache.get('jira/TYTO-1');
        const listed = await host.cache.list('jira/');
        const deleted = await host.cache.delete('jira/TYTO-1');
        const missing = await host.cache.get('jira/TYTO-1');
        return JSON.stringify([
          stored,
          entry === undefined ? 'none' : [Array.from(entry.bytes), entry.storedAt, entry],
          listed,
          deleted,
          missing === undefined ? 'undefined' : missing,
        ]);
      },
      { capabilities },
    );

    expect(JSON.parse(String(answer))).toEqual([
      { storedAt: '2026-10-25T12:00:00.000Z' },
      [
        [111, 108, 195, 161],
        '2026-10-25T12:00:00.000Z',
        // The bytes, as JSON writes a Uint8Array, and no `path`: the answer was rebuilt.
        { bytes: { 0: 111, 1: 108, 2: 195, 3: 161 }, storedAt: '2026-10-25T12:00:00.000Z' },
      ],
      [{ key: 'jira/TYTO-1', storedAt: '2026-10-25T12:00:00.000Z', size: 4 }],
      true,
      'undefined',
    ]);
    expect([...cache]).toEqual([]);
  });

  it('writes and reads back a workspace file, and write answers null', async () => {
    const { files, capabilities } = storing();
    const answer = await answerOf(
      async (host) => {
        const written = await host.workspace.write('tabelas/jira.csv', new Uint8Array([1, 2]));
        const read = await host.workspace.read('tabelas/jira.csv');
        return `${String(written)} ${String(read instanceof Uint8Array)} ${Array.from(read).join(',')}`;
      },
      { permissions: ['workspace:read', 'workspace:write'], capabilities },
    );

    expect(answer).toBe('null true 1,2');
    expect([...files.keys()]).toEqual(['tabelas/jira.csv']);
  });

  it('refuses undeclared workspace access and a path that leaves the folder, writing nothing', async () => {
    const { files, capabilities } = storing();
    const answer = await answerOf(
      async (host) => {
        const codes = await Promise.all(
          [
            host.workspace.read('a.csv'),
            host.workspace.write('../fora.csv', 'x'),
            host.workspace.write('.tyto/project.json', '{}'),
          ].map((attempt) =>
            attempt.then(
              () => 'ok',
              (cause: { code: string }) => cause.code,
            ),
          ),
        );
        return codes.join(' ');
      },
      { permissions: ['workspace:write'], capabilities },
    );

    expect(answer).toBe('E_PERMISSION E_WORKSPACE_FILE E_WORKSPACE_FILE');
    expect([...files]).toEqual([]);
  });

  it('refuses a cache entry over the ceiling on the host side, whatever the guest sends', async () => {
    const { cache, capabilities } = storing();
    const answer = await answerOf(
      (host) => host.cache.put('big', new Uint8Array(PLUGIN_FILE_LIMIT_BYTES + 1)).then(() => 'ok'),
      { capabilities },
    );

    expect(answer).toBe('E_PLUGIN_CACHE');
    expect([...cache]).toEqual([]);
  });

  it('answers E_PLUGIN_CACHE from a host composed without a cache', async () => {
    const answer = await answerOf((host) => host.cache.get('k').then(() => 'ok'), {});

    expect(answer).toBe('E_PLUGIN_CACHE');
  });
});

describe('a plugin that does not answer', () => {
  it('has its call ended at the deadline, is closed, and is reported once', async () => {
    const crashes: string[] = [];
    const { pair, connected } = await isolate(
      (host) =>
        host.registerExporter({ ...textExporter, exportFrame: () => new Promise(() => {}) }),
      { deadlineMs: 100, onCrash: (reason) => crashes.push(reason) },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const exporter = exporterIn(connected.value.plugin);

    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok ? '' : answer.error[0]?.message).toBe(
      "Plugin 'texto' did not answer within 0.1 s, so its process was ended.",
    );
    expect(pair.closed()).toBe(true);
    expect(crashes).toEqual(['it did not answer within 0.1 s']);
    const after = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(after.ok ? '' : after.error[0]?.code).toBe('E_PLUGIN_CRASHED');
  });

  it('is refused when its activation does not finish in time', async () => {
    const pair = channelPair((guest) => runConfined(guest, () => new Promise(() => {})));
    const connected = await connectIsolatedPlugin({
      requireSandbox: true,
      name: 'texto',
      manifest: MANIFEST,
      channel: pair.host,
      activationDeadlineMs: 100,
    });
    expect(connected.ok ? '' : connected.error[0]?.message).toBe(
      "Plugin 'texto' failed to activate: it did not finish activating within 0.1 s.",
    );
    expect(pair.closed()).toBe(true);
  });
});

describe('an isolated directive (TYTO-49)', () => {
  const DIRECTIVE: Directive = {
    name: 'shout',
    namespace: 'demo',
    adjustments: [{ name: 'slot', value: 'titulo', range: sourceRange(10, 24) }],
    body: [{ kind: 'text', value: 'Direito', range: sourceRange(25, 32) }],
    range: sourceRange(0, 32),
    nameRange: sourceRange(2, 12),
  };

  const shout: DirectiveContribution = {
    id: 'demo',
    names: ['shout'],
    transform: (directive) =>
      ok([
        {
          name: directive.adjustments[0]?.value ?? '',
          body: directive.body.map((inline) =>
            inline.kind === 'text'
              ? { kind: 'text' as const, value: inline.value.toUpperCase() }
              : { kind: 'break' as const },
          ),
        },
      ]),
  };

  function directiveIn(plugin: Plugin): DirectiveContribution {
    const host = createPluginHost();
    const activated = host.tryActivate(plugin);
    if (!activated.ok) throw new Error(activated.error.map((item) => item.message).join('\n'));
    const [directive] = host.registry.directives();
    if (directive === undefined) throw new Error('no directive');
    return directive;
  }

  it('answers the same as the same directive in process', async () => {
    const { connected } = await isolate((host) => host.registerDirective(shout), {
      contributes: ['directive'],
    });
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const isolated = directiveIn(connected.value.plugin);
    expect(isolated.id).toBe('demo');
    expect(isolated.names).toEqual(['shout']);
    expect(await isolated.transform(DIRECTIVE)).toEqual(shout.transform(DIRECTIVE));
  });

  it('refuses a replacement that is itself a plugin directive', async () => {
    const { connected } = await isolate(
      (host) =>
        host.registerDirective({
          ...shout,
          transform: () => ok([{ name: 'titulo', namespace: 'demo', body: [] }] as never),
        }),
      { contributes: ['directive'] },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const answer = await directiveIn(connected.value.plugin).transform(DIRECTIVE);
    expect(answer.ok ? [] : answer.error.map((item) => item.code)).toEqual(['E_PLUGIN_PROTOCOL']);
  });

  it('past its deadline is E_PLUGIN_TIMEOUT on the directive’s range, and the brief still resolves', async () => {
    const { connected } = await isolate(
      (host) =>
        host.registerDirective({
          ...shout,
          transform: () => new Promise(() => undefined),
        }),
      { contributes: ['directive'], deadlineMs: 20 },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const host = createPluginHost();
    host.tryActivate(connected.value.plugin);
    const manifest = parseManifest(
      'name: promo-curso\nversion: 1.0.0\nformats: [feed]\nslots:\n  titulo: { type: rich-text }\n',
      'manifest.yaml',
    );
    if (!manifest.ok) throw new Error('manifest');
    const registry: TemplateRegistry = {
      list: () => [manifest.value],
      get: () => manifest.value,
      formatsOf: () => manifest.value.formats,
      directoryOf: () => undefined,
      failures: [],
    };
    const resolved = await resolve(
      {
        frontmatter: { data: { template: 'promo-curso' }, ranges: {} },
        directives: [DIRECTIVE],
        range: sourceRange(0, 32),
      },
      {
        registry,
        assets: { base: '', resolve: () => Promise.resolve(undefined) },
        directives: directiveResolverOf(() => host.registry.directives()),
      },
    );

    expect(resolved.ok).toBe(true);
    const problems = resolved.ok ? resolved.diagnostics : resolved.error;
    expect(problems.map((item) => [item.code, item.range])).toEqual([
      ['E_PLUGIN_TIMEOUT', DIRECTIVE.range],
    ]);
    expect(connected.value.crashed()).toBe('it did not answer within 0 s');
  });
});

describe('an isolated panel (TYTO-49)', () => {
  it('crosses as data the host can serve', async () => {
    const { connected } = await isolate(
      (host) =>
        host.registerPanel({
          id: 'contagem',
          title: 'Contagem',
          location: 'right',
          entry: 'panel/index.html',
        }),
      { contributes: ['panel'] },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const host = createPluginHost();
    host.tryActivate(connected.value.plugin);
    expect(host.registry.panels()).toEqual([
      { id: 'contagem', title: 'Contagem', location: 'right', entry: 'panel/index.html' },
    ]);
  });

  it('is refused without an entry, since there would be nothing to show', async () => {
    const { connected } = await isolate(
      (host) => host.registerPanel({ id: 'p', title: 'P' } as never),
      { contributes: ['panel'] },
    );
    expect(connected.ok ? '' : connected.error[0]?.message).toContain(
      "its 'panel' contribution does not match",
    );
  });
});

describe('an isolated vim contribution (TYTO-417, ADR 0141)', () => {
  const SURROUND = {
    id: 'surround',
    title: 'Surround',
    mappings: [
      { keys: 'ys', context: 'normal' as const, operation: 'surround.add', args: { pair: '()' } },
    ],
    ex: [{ name: 'surround', shortName: 'sur', command: 'surround.run' }],
  };

  it('crosses as data, so a keypress never waits on the plugin', async () => {
    const { connected } = await isolate((host) => host.registerVim(SURROUND), {
      contributes: ['editor.vim'],
    });
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const host = createPluginHost();
    host.tryActivate(connected.value.plugin);
    expect(host.registry.vim()).toEqual([SURROUND]);
  });

  it('is refused when a mapping carries code instead of an operation name', async () => {
    const { connected } = await isolate(
      (host) =>
        host.registerVim({
          id: 'surround',
          mappings: [{ keys: 'ys', operation: 'surround.add', source: 'return 1' }],
        } as never),
      { contributes: ['editor.vim'] },
    );
    expect(connected.ok ? '' : connected.error[0]?.message).toContain(
      "its 'editor.vim' contribution does not match",
    );
  });
});

describe('an isolated theme (TYTO-208, ADR 0077)', () => {
  it('crosses as data, since a theme is a file and not a schema', async () => {
    const { connected } = await isolate(
      (host) => host.registerTheme({ id: 'dusk', label: 'Dusk', kind: 'dark', path: 'dusk.json' }),
      { contributes: ['theme'] },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);

    const host = createPluginHost();
    host.tryActivate(connected.value.plugin);
    expect(host.registry.themes()).toEqual([
      { id: 'dusk', label: 'Dusk', kind: 'dark', path: 'dusk.json' },
    ]);
  });

  it('is refused with a path that leaves its folder', async () => {
    const { connected } = await isolate(
      (host) =>
        host.registerTheme({ id: 'dusk', label: 'Dusk', kind: 'dark', path: '../../dusk.json' }),
      { contributes: ['theme'] },
    );
    expect(connected.ok ? '' : connected.error[0]?.message).toContain(
      "its 'theme' contribution does not match",
    );
  });
});

describe('the confinement a host requires (ADR 0049)', () => {
  /** Connects to a guest whose bootstrap reported `sandbox`, and says whether it was imported. */
  async function reporting(sandbox: SandboxReport | undefined, requireSandbox: boolean) {
    let imported = false;
    const load = (): Promise<unknown> => {
      imported = true;
      return Promise.resolve({
        activate: (host: PluginHost) => host.registerExporter(textExporter),
      });
    };
    const pair = channelPair((guest) =>
      sandbox === undefined
        ? // A guest built before the field existed: its hello carries none.
          runGuest(
            {
              send: (message) => guest.send({ ...message, sandbox: undefined } as never),
              onMessage: guest.onMessage,
            },
            load,
            CONFINED,
          )
        : runGuest(guest, load, sandbox),
    );
    const connected = await connectIsolatedPlugin({
      name: 'texto',
      manifest: MANIFEST,
      channel: pair.host,
      requireSandbox,
    });
    return { connected, imported: () => imported, closed: pair.closed };
  }

  it.each<[string, SandboxReport | undefined, string]>([
    [
      'reports nothing',
      undefined,
      "Plugin 'texto' was not run: its process on an unknown runtime is not confined to its folder (it did not report whether it is confined).",
    ],
    [
      'could read the canary',
      {
        runtime: 'Electron 44.4.1 utilityProcess',
        canary: 'readable',
        detail: 'it read /app/out/main/index.js',
      },
      "Plugin 'texto' was not run: its process on Electron 44.4.1 utilityProcess is not confined to its folder (it could read a file outside its folder: it read /app/out/main/index.js).",
    ],
    [
      'was refused the canary for another reason',
      {
        runtime: 'Node v24.21.0',
        canary: 'failed',
        detail: 'reading /cli/index.js failed with ENOENT',
      },
      "Plugin 'texto' was not run: its process on Node v24.21.0 is not confined to its folder (its check of the confinement did not complete: reading /cli/index.js failed with ENOENT).",
    ],
  ])('refuses a guest that %s, and never imports its module', async (_, sandbox, message) => {
    const { connected, imported, closed } = await reporting(sandbox, true);
    expect(
      connected.ok ? [] : connected.error.map((problem) => [problem.code, problem.message]),
    ).toEqual([['E_PLUGIN_SANDBOX', message]]);
    expect(imported()).toBe(false);
    expect(closed()).toBe(true);
  });

  it('activates a guest whose canary was denied', async () => {
    const { connected, imported } = await reporting(CONFINED, true);
    expect(connected.ok).toBe(true);
    expect(imported()).toBe(true);
  });

  it('does not ask a host that does not require it, which is a crash boundary only', async () => {
    const { connected } = await reporting(
      { runtime: 'Electron 44.4.1 utilityProcess', canary: 'failed', detail: 'not confined' },
      false,
    );
    expect(connected.ok).toBe(true);
  });
});

describe('an isolated template’s reports (ADR 0058)', () => {
  const CALL: TemplateCall = {
    format: 'feed',
    size: { w: 10, h: 10 },
    idPrefix: 'lamina-1.feed',
    artwork: { id: 'lamina-1', index: 0, count: 1 },
    slots: {},
    adjustments: {},
    brand: {},
  };

  /** A pack whose one template reports what `reports` says, and draws an empty frame. */
  function reportingPack(reports: readonly unknown[]): TemplatePack {
    return {
      id: 'demo',
      templates: [],
      build: (_template, context) => {
        for (const report of reports) context.report(report as TemplateReport);
        return { format: context.format, size: context.size, children: [] };
      },
    };
  }

  async function buildIn(
    reports: readonly unknown[],
  ): Promise<Result<TemplateAnswer, Diagnostics>> {
    const { connected } = await isolate(
      (host) => host.registerTemplatePack(reportingPack(reports)),
      {
        contributes: ['template-pack'],
      },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const host = createPluginHost();
    const activated = host.tryActivate(connected.value.plugin);
    if (!activated.ok) throw new Error(activated.error[0]?.message);
    const [pack] = host.registry.templatePacks();
    // The proxy's calling convention is the wire's (`IsolatedPackBuild`), as `@tyto/io` reads it.
    const build = pack?.build as unknown as IsolatedPackBuild;
    return build('demo', CALL, []);
  }

  it('crosses back beside the frame, as the list the template made', async () => {
    const answer = await buildIn([{ code: 'W_TEMPLATE_OVERFLOW', overflow: 37 }]);

    expect(answer.ok && answer.value).toEqual({
      frame: { format: 'feed', size: { w: 10, h: 10 }, children: [] },
      reports: [{ code: 'W_TEMPLATE_OVERFLOW', overflow: 37 }],
    });
  });

  it('crosses as an empty list when the template reports nothing, never as nothing', async () => {
    const answer = await buildIn([]);

    expect(answer.ok && answer.value.reports).toEqual([]);
    // The desktop's wire is JSON (`plugin-wire.ts`), where an absent field and `undefined`
    // are lost: the answer has to come out of a round trip the same as it went in.
    expect(JSON.parse(JSON.stringify(answer))).toEqual(answer);
  });

  it('refuses a report outside the closed list, so a plugin cannot write its own diagnostic', async () => {
    const answer = await buildIn([{ code: 'E_PLUGIN_CRASHED', overflow: 1 }]);

    expect(answer.ok ? [] : answer.error.map((item) => item.code)).toEqual(['E_PLUGIN_PROTOCOL']);
  });
});

describe('an isolated template’s files (ADR 0062)', () => {
  const CALL: TemplateCall = {
    format: 'feed',
    size: { w: 10, h: 10 },
    idPrefix: 'lamina-1.feed',
    artwork: { id: 'lamina-1', index: 0, count: 1 },
    slots: {},
    adjustments: {},
    brand: {},
  };

  /**
   * `files` is functions and does not cross, so the guest rebuilds it, as `measure`. A plugin's
   * own folder is not read for its templates yet, so every path answers nothing — and a
   * template that asks must get that answer, not a `TypeError` on a field that is not there.
   */
  it('hands the template no files, rather than no field', async () => {
    const pack: TemplatePack = {
      id: 'demo',
      templates: [],
      build: (_template, context) => ({
        format: context.files.image('assets/bg.png') === undefined ? context.format : 'leaked',
        size: context.size,
        children: [],
      }),
    };
    const { connected } = await isolate((host) => host.registerTemplatePack(pack), {
      contributes: ['template-pack'],
    });
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const host = createPluginHost();
    const activated = host.tryActivate(connected.value.plugin);
    if (!activated.ok) throw new Error(activated.error[0]?.message);
    const build = host.registry.templatePacks()[0]?.build as unknown as IsolatedPackBuild;

    const answer = await build('demo', CALL, []);

    expect(answer.ok && answer.value.frame.format).toBe('feed');
  });
});

/** A kit mark as one string, so a template can hand what it received back through `format`. */
function logoPaths(mark: BrandMark | undefined): string {
  if (mark === undefined) return 'none';
  if (!isTonedMark(mark)) return mark.d;
  return mark.layers.map((layer) => `${layer.tone}:${layer.d}`).join(',');
}

describe('an isolated plugin’s brand kit (ADR 0063)', () => {
  // Invented: a brand nobody has and a triangle.
  const TRIANGLE = {
    box: { w: 10, h: 10 },
    d: 'M0 10 L5 0 L10 10 Z',
    fillRule: 'nonzero',
  } as const;
  const KIT = { logo: TRIANGLE, signature: '@test-brand' };
  // Invented: a square in a frame, in two tones, and two bars standing in for a name.
  const TONED_KIT = {
    logo: {
      box: { w: 10, h: 10 },
      layers: [
        { tone: 'secondary', d: 'M0 0H10V10H0Z M2 2V8H8V2Z', fillRule: 'evenodd' },
        { tone: 'primary', d: 'M3 3H7V7H3Z', fillRule: 'nonzero' },
      ],
    },
    wordmark: TRIANGLE,
  } as const;

  async function registered(
    kit: BrandKitContribution,
  ): Promise<Result<InstalledPlugin, Diagnostics> & { readonly host: InProcessHost }> {
    const { connected } = await isolate((host) => host.registerBrandKit(kit), {
      contributes: ['brand-kit'],
    });
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const host = createPluginHost();
    return Object.assign(host.tryActivate(connected.value.plugin), { host });
  }

  it('crosses as data, and the host holds it under its brand', async () => {
    const activated = await registered({ id: 'kit', brands: { 'test-brand': KIT } });

    expect(activated.ok).toBe(true);
    expect(activated.host.registry.brandKits()).toEqual([
      { id: 'kit', brands: { 'test-brand': KIT } },
    ]);
    expect(activated.host.registry.brandKitsByBrand().kits.get('test-brand')).toEqual(KIT);
  });

  it('crosses the brand’s colours as data (ADR 0155)', async () => {
    const coloured = { ...KIT, colors: { accent: '#5900a6' } };
    const activated = await registered({ id: 'kit', brands: { 'test-brand': coloured } });

    expect(activated.ok).toBe(true);
    expect(activated.host.registry.brandKitsByBrand().kits.get('test-brand')).toEqual(coloured);
  });

  it('crosses a toned logo and a wordmark as data (ADR 0066)', async () => {
    const activated = await registered({ id: 'kit', brands: { 'test-brand': TONED_KIT } });

    expect(activated.ok).toBe(true);
    expect(activated.host.registry.brandKitsByBrand().kits.get('test-brand')).toEqual(TONED_KIT);
  });

  it.each([
    ['a brand id a manifest could not name', { 'Test Brand': KIT }],
    [
      'a logo with a colour, which a mark never carries',
      { 'test-brand': { logo: { ...TRIANGLE, fill: '#f00' } } },
    ],
    [
      'a path longer than the limit',
      { 'test-brand': { logo: { ...TRIANGLE, d: 'M0 0'.padEnd(MARK_PATH_LIMIT + 1, ' ') } } },
    ],
    ['a box of no size', { 'test-brand': { logo: { ...TRIANGLE, box: { w: 0, h: 10 } } } }],
    ['an accent that is not hex', { 'test-brand': { colors: { accent: 'purple' } } }],
    ['a colour nobody declared', { 'test-brand': { colors: { ink: '#000000' } } }],
    [
      'a layer with a colour',
      {
        'test-brand': {
          logo: {
            box: TRIANGLE.box,
            layers: [{ tone: 'primary', d: 'M0 0', fillRule: 'nonzero', fill: '#f00' }],
          },
        },
      },
    ],
    [
      'a tone outside the list',
      {
        'test-brand': {
          logo: { box: TRIANGLE.box, layers: [{ tone: 'accent', d: 'M0 0', fillRule: 'nonzero' }] },
        },
      },
    ],
    [
      'layers whose paths together pass the limit, each under it',
      {
        'test-brand': {
          wordmark: {
            box: TRIANGLE.box,
            layers: ['primary', 'secondary'].map((tone) => ({
              tone,
              d: 'M0 0'.padEnd(MARK_PATH_LIMIT / 2 + 1, ' '),
              fillRule: 'nonzero',
            })),
          },
        },
      },
    ],
  ])('refuses %s, at activation, before the host holds anything', async (_, brands) => {
    const { connected } = await isolate(
      (host) => host.registerBrandKit({ id: 'kit', brands } as unknown as BrandKitContribution),
      { contributes: ['brand-kit'] },
    );

    expect(connected.ok ? [] : connected.error.map((item) => [item.code, item.message])).toEqual([
      ['E_PLUGIN_ACTIVATE', expect.stringContaining("its 'brand-kit' contribution does not match")],
    ]);
  });

  it('reaches a code template in the plugin’s process with the call', async () => {
    const pack: TemplatePack = {
      id: 'demo',
      templates: [],
      // The template writes what it was handed into the frame's format, which is the one
      // string that crosses back unchecked against a vocabulary.
      build: (_template, context) => ({
        format: [
          context.brand.signature ?? 'none',
          logoPaths(context.brand.logo),
          logoPaths(context.brand.wordmark),
          context.brand.colors?.accent ?? 'none',
        ].join('|'),
        size: context.size,
        children: [],
      }),
    };
    const { connected } = await isolate((host) => host.registerTemplatePack(pack), {
      contributes: ['template-pack'],
    });
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const host = createPluginHost();
    const activated = host.tryActivate(connected.value.plugin);
    if (!activated.ok) throw new Error(activated.error[0]?.message);
    const build = host.registry.templatePacks()[0]?.build as unknown as IsolatedPackBuild;
    const call: TemplateCall = {
      format: 'feed',
      size: { w: 10, h: 10 },
      idPrefix: 'lamina-1.feed',
      artwork: { id: 'lamina-1', index: 0, count: 1 },
      slots: {},
      adjustments: {},
      brand: KIT,
    };

    const withKit = await build('demo', call, []);
    const withTonedKit = await build('demo', { ...call, brand: TONED_KIT }, []);
    const withoutKit = await build('demo', { ...call, brand: {} }, []);
    const withColours = await build(
      'demo',
      { ...call, brand: { ...KIT, colors: { accent: '#5900a6' } } },
      [],
    );

    expect(withKit.ok && withKit.value.frame.format).toBe(
      '@test-brand|M0 10 L5 0 L10 10 Z|none|none',
    );
    expect(withTonedKit.ok && withTonedKit.value.frame.format).toBe(
      'none|secondary:M0 0H10V10H0Z M2 2V8H8V2Z,primary:M3 3H7V7H3Z|M0 10 L5 0 L10 10 Z|none',
    );
    expect(withoutKit.ok && withoutKit.value.frame.format).toBe('none|none|none|none');
    expect(withColours.ok && withColours.value.frame.format).toBe(
      '@test-brand|M0 10 L5 0 L10 10 Z|none|#5900a6',
    );
  });

  it('hands a code template its values, and its readers fall back when none crossed (TYTO-439)', async () => {
    // What a template built against an older `@tyto/core/template` does: read through the
    // readers with its own constants as fallbacks. The guest runs in the host's bundle, so
    // the template itself is never rebuilt for protocol 10.
    const logo = {
      id: 'TYTO_HOME/logo.png',
      source: 'file',
      path: '/h/logo.png',
      hash: 'h',
    } as const;
    const pack: TemplatePack = {
      id: 'demo',
      templates: [],
      build: (_template, context) => ({
        format: [
          colorValue(context, 'paper', '#fbfbfb'),
          numberValue(context, 'gap', 20),
          faceValue(context, 'face', { family: 'Inter', weight: 400, style: 'normal' }).family,
          imageValue(context, 'logo')?.id ?? 'no-logo',
        ].join('|'),
        size: context.size,
        children: [],
      }),
    };
    const { connected } = await isolate((host) => host.registerTemplatePack(pack), {
      contributes: ['template-pack'],
    });
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const host = createPluginHost();
    const activated = host.tryActivate(connected.value.plugin);
    if (!activated.ok) throw new Error(activated.error[0]?.message);
    const build = host.registry.templatePacks()[0]?.build as unknown as IsolatedPackBuild;
    const call: TemplateCall = {
      format: 'feed',
      size: { w: 10, h: 10 },
      idPrefix: 'lamina-1.feed',
      artwork: { id: 'lamina-1', index: 0, count: 1 },
      slots: {},
      adjustments: {},
      brand: {},
    };

    const configured = await build(
      'demo',
      {
        ...call,
        values: {
          paper: '#4b2a7b',
          gap: 8,
          face: { family: 'Source Sans 3', weight: 700, style: 'normal' },
          logo,
        },
      },
      [],
    );
    const bare = await build('demo', call, []);

    expect(configured.ok ? configured.value.frame.format : configured.error[0]?.message).toBe(
      '#4b2a7b|8|Source Sans 3|TYTO_HOME/logo.png',
    );
    expect(bare.ok && bare.value.frame.format).toBe('#fbfbfb|20|Inter|no-logo');
  });
});

describe('isolated asset and font sources (TYTO-280, ADR 0117)', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  async function connected(activate: (host: PluginHost) => Disposable | void, point: string) {
    const { connected } = await isolate(activate, { contributes: [point] });
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const host = createPluginHost();
    const activated = host.tryActivate(connected.value.plugin);
    if (!activated.ok) throw new Error(activated.error[0]?.message);
    return host.registry;
  }

  it('fetches an asset across the boundary, with the section the call carried', async () => {
    const seen: unknown[] = [];
    const registry = await connected(
      (host) =>
        host.registerAssetSource({
          id: 'test',
          schemes: ['test'],
          fetch: (reference, request) => {
            seen.push([reference, request.section]);
            return ok({ bytes: PNG, mime: 'image/png' });
          },
        }),
      'asset-source',
    );

    const [owned] = registry.assetSources();
    expect(owned?.plugin).toBe('texto');
    expect(owned?.source.schemes).toEqual(['test']);
    const answer = await owned!.source.fetch('test:logo', { section: { folder: 'abc' } });
    expect(answer).toEqual(ok({ bytes: PNG, mime: 'image/png' }));
    expect(seen).toEqual([['test:logo', { folder: 'abc' }]]);

    // A withheld section is no section at all, and the plugin reads it as absent.
    await owned!.source.fetch('test:logo', {});
    expect(seen[1]).toEqual(['test:logo', undefined]);
  });

  it('refuses an asset over the ceiling before anything can cache it', async () => {
    const registry = await connected(
      (host) =>
        host.registerAssetSource({
          id: 'test',
          schemes: ['test'],
          fetch: () => ok({ bytes: new Uint8Array(ASSET_SOURCE_MAX_BYTES + 1), mime: 'image/png' }),
        }),
      'asset-source',
    );
    const answer = await registry.assetSources()[0]!.source.fetch('test:huge', {});
    expect(answer.ok).toBe(false);
    expect(answer.ok ? [] : answer.error.map((problem) => problem.code)).toEqual([
      'E_PLUGIN_PROTOCOL',
    ]);
  });

  it('fetches a face across the boundary', async () => {
    const asked: unknown[] = [];
    const registry = await connected(
      (host) =>
        host.registerFontSource({
          id: 'faces',
          families: ['Inter'],
          fetch: (face) => {
            asked.push(face);
            return ok(new Uint8Array([1, 2, 3]));
          },
        }),
      'font-source',
    );
    const face = { family: 'Inter', weight: 700, style: 'italic' } as const;
    const answer = await registry.fontSources()[0]!.source.fetch(face, {});
    expect(answer).toEqual(ok(new Uint8Array([1, 2, 3])));
    expect(asked).toEqual([face]);
  });

  it('answers a throw in the plugin as a failed call, not a rejection', async () => {
    const registry = await connected(
      (host) =>
        host.registerFontSource({
          id: 'faces',
          families: ['Inter'],
          fetch: () => {
            throw new Error('quota exceeded');
          },
        }),
      'font-source',
    );
    const answer = await registry
      .fontSources()[0]!
      .source.fetch({ family: 'Inter', weight: 400, style: 'normal' }, {});
    expect(answer.ok ? '' : answer.error[0]?.message).toContain('quota exceeded');
  });

  it('is refused with a scheme a reference could never spell', async () => {
    const { connected } = await isolate(
      (host) => host.registerAssetSource({ id: 't', schemes: ['C'], fetch: () => ok({} as never) }),
      { contributes: ['asset-source'] },
    );
    expect(connected.ok ? '' : connected.error[0]?.message).toContain(
      "its 'asset-source' contribution does not match",
    );
  });
});

describe('isolated recipe verbs and derivations (TYTO-376, ADR 0135)', () => {
  const COLUMNS: Table['columns'] = [{ name: 'number', type: 'number', origin: 'demo' }];
  const rowOf = (number: number) => ({
    key: `N-${String(number)}`,
    values: { number },
    provenance: { source: 'demo', id: `N-${String(number)}`, fetchedAt: '2026-10-24' },
  });
  const later = <T>(ms: number, value: T) =>
    new Promise<T>((settle) => setTimeout(() => settle(value), ms));

  /** A plugin in the `demo` namespace, isolated with a 200 ms deadline per call. */
  async function recipeIn(activate: (host: PluginHost) => void, ...lines: string[]) {
    return recipeWith({}, activate, ...lines);
  }

  /** As {@link recipeIn}, with each plugin's project section by id (ADR 0147). */
  async function recipeWith(
    sections: Readonly<Record<string, unknown>>,
    activate: (host: PluginHost) => void,
    ...lines: string[]
  ) {
    return recipeUnder({ sectionOf: (plugin) => sections[plugin] }, activate, ...lines);
  }

  /** As {@link recipeIn}, with the registries built from `options`. */
  async function recipeUnder(
    options: RecipeRegistryOptions,
    activate: (host: PluginHost) => void,
    ...lines: string[]
  ) {
    const { connected } = await isolate(activate, {
      contributes: ['recipe-verb', 'recipe-derivation'],
      namespace: 'demo',
      writes: ['mark', 'assign'],
      deadlineMs: 200,
    });
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const host = createPluginHost();
    const activated = host.tryActivate(connected.value.plugin);
    if (!activated.ok) throw new Error(activated.error[0]?.message);
    const parsed = parseRecipe(['recipe test', ...lines].join('\n'));
    if (!parsed.ok) throw new Error('the recipe must parse');
    const result = await runRecipe(parsed.value, {
      ...recipeRegistriesOf(host.registry, options),
      resolveRecipe: () => Promise.resolve({ ok: false, error: [] }),
    });
    if (!result.ok) throw new Error('the run must start');
    const { cells } = result.value;
    const problem = cells.flatMap((cell) => cell.diagnostics)[0];
    return { table: result.value.table, problem, cells, crashed: connected.value.crashed() };
  }

  /** Three pages of 150 ms each: every call inside the deadline, the three together past it. */
  const slowPages = (host: PluginHost) =>
    host.registerRecipeVerb({
      id: 'demo.pull',
      kind: 'source',
      arguments: [],
      page: ({ cursor }) => {
        const page = cursor === undefined ? 1 : Number(cursor);
        return later(
          150,
          ok({
            table: { columns: COLUMNS, rows: [rowOf(page)] },
            ...(page < 3 ? { cursor: String(page + 1) } : {}),
          }),
        );
      },
    });

  it('pages a source past a deadline no single call reaches, then transforms and derives', async () => {
    const started = Date.now();
    const { table, problem, crashed } = await recipeIn(
      (host) => {
        slowPages(host);
        host.registerRecipeVerb({
          id: 'demo.tag',
          kind: 'transform',
          arguments: [{ name: 'label', type: 'text', positional: true, required: true }],
          transform: ({ arguments: { label }, table: input }) =>
            ok({
              columns: [...input.columns, { name: 'tag', type: 'text', origin: 'demo' }],
              rows: input.rows.map((row) => ({
                ...row,
                values: { ...row.values, tag: String(label) },
              })),
            }),
        });
        host.registerRecipeDerivation({
          id: 'demo.double',
          requires: ['number'],
          produces: ['double'],
          derive: (input) =>
            ok({
              columns: [...input.columns, { name: 'double', type: 'number', origin: 'demo' }],
              rows: input.rows.map((row) => ({
                ...row,
                values: { ...row.values, double: Number(row.values['number']) * 2 },
              })),
            }),
        });
      },
      'demo.pull',
      'demo.tag ready',
      'derive demo.double',
    );
    expect(problem).toBeUndefined();
    expect(crashed).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    expect(table?.rows.map((row) => row.values)).toEqual([
      { number: 1, tag: 'ready', double: 2 },
      { number: 2, tag: 'ready', double: 4 },
      { number: 3, tag: 'ready', double: 6 },
    ]);
  });

  /** A source, a transform and an action that each write down what their call carried. */
  const recording = (heard: unknown[]) => (host: PluginHost) => {
    const note = (verb: string, request: object) =>
      heard.push([verb, 'section' in request, (request as { section?: unknown }).section]);
    host.registerRecipeVerb({
      id: 'demo.pull',
      kind: 'source',
      arguments: [],
      page: (request) => {
        note('page', request);
        return ok({ table: { columns: COLUMNS, rows: [rowOf(1)] } });
      },
    });
    host.registerRecipeVerb({
      id: 'demo.tag',
      kind: 'transform',
      arguments: [],
      transform: (request) => {
        note('transform', request);
        return ok(request.table);
      },
    });
    host.registerRecipeVerb({
      id: 'demo.mark',
      kind: 'action',
      arguments: [],
      writes: ['mark'],
      plan: (request) => {
        note('plan', request);
        const operations = request.table.rows.map((row) => ({
          write: 'mark',
          rowKey: row.key,
          description: `Mark ${row.key}`,
        }));
        return ok({ target: 'demo items', operations, count: operations.length });
      },
    });
  };

  it("hands every kind of verb its own plugin's project section across the wire (ADR 0147)", async () => {
    const heard: unknown[] = [];
    const { problem } = await recipeWith(
      { texto: { site: 'acme.example' }, other: { site: 'rival.example' } },
      recording(heard),
      'demo.pull',
      'demo.tag',
      'demo.mark',
    );
    expect(problem).toBeUndefined();
    expect(heard).toEqual([
      ['page', true, { site: 'acme.example' }],
      ['transform', true, { site: 'acme.example' }],
      ['plan', true, { site: 'acme.example' }],
    ]);
  });

  it('hands no section at all when its plugin has none, even if another plugin has one', async () => {
    const heard: unknown[] = [];
    const { problem } = await recipeWith(
      { other: { site: 'rival.example' } },
      recording(heard),
      'demo.pull',
      'demo.tag',
      'demo.mark',
    );
    expect(problem).toBeUndefined();
    expect(heard).toEqual([
      ['page', false, undefined],
      ['transform', false, undefined],
      ['plan', false, undefined],
    ]);
  });

  /** Three pages, each writing down what its request said of `refresh`. */
  const refreshHeard = (heard: unknown[]) => (host: PluginHost) =>
    host.registerRecipeVerb({
      id: 'demo.pull',
      kind: 'source',
      arguments: [],
      page: (request) => {
        heard.push('refresh' in request ? request.refresh : 'absent');
        const page = request.cursor === undefined ? 1 : Number(request.cursor);
        return ok({
          table: { columns: COLUMNS, rows: [rowOf(page)] },
          ...(page < 3 ? { cursor: String(page + 1) } : {}),
        });
      },
    });

  it('hands a source refresh on every page of a run without cache (ADR 0148)', async () => {
    const heard: unknown[] = [];
    const { problem, table } = await recipeUnder(
      { refresh: true },
      refreshHeard(heard),
      'demo.pull',
    );
    expect(problem).toBeUndefined();
    expect(table?.rows).toHaveLength(3);
    expect(heard).toEqual([true, true, true]);
  });

  it('hands no refresh key at all on an ordinary run', async () => {
    const heard: unknown[] = [];
    for (const options of [{}, { refresh: false }]) {
      const { problem } = await recipeUnder(options, refreshHeard(heard), 'demo.pull');
      expect(problem).toBeUndefined();
    }
    expect(heard).toEqual(['absent', 'absent', 'absent', 'absent', 'absent', 'absent']);
  });

  it('refuses a malformed table: a value outside the columns, and a row with no provenance', async () => {
    const answering = (rows: unknown[]) => (host: PluginHost) =>
      host.registerRecipeVerb({
        id: 'demo.pull',
        kind: 'source',
        arguments: [],
        page: () => ok({ table: { columns: COLUMNS, rows } as Table }),
      });
    const outside = await recipeIn(
      answering([{ ...rowOf(1), values: { title: 'x' } }]),
      'demo.pull',
    );
    expect(outside.problem?.message).toBe(
      "The table from 'demo.pull, page 1' is malformed: row 1 ('N-1') has a value for 'title', " +
        'which is not a column.',
    );
    const bare = await recipeIn(answering([{ key: 'N-1', values: {} }]), 'demo.pull');
    expect(bare.problem?.code).toBe('E_PLUGIN_PROTOCOL');
    expect(bare.problem?.range).toEqual({ start: 12, end: 21 });
  });

  it('refuses a cursor the source gave before, and a page it says was cut short', async () => {
    const repeating = await recipeIn(
      (host) =>
        host.registerRecipeVerb({
          id: 'demo.pull',
          kind: 'source',
          arguments: [],
          page: ({ cursor }) =>
            ok({
              table: { columns: COLUMNS, rows: [rowOf(cursor === undefined ? 1 : 2)] },
              cursor: 'again',
            }),
        }),
      'demo.pull',
    );
    expect(repeating.problem?.message).toBe(
      "Source 'demo.pull' gave the cursor 'again' a second time on page 2, so it would never end.",
    );
    const cut = await recipeIn(
      (host) =>
        host.registerRecipeVerb({
          id: 'demo.pull',
          kind: 'source',
          arguments: [],
          page: () => ok({ table: { columns: COLUMNS, rows: [] }, truncated: true }),
        }),
      'demo.pull',
    );
    expect(cut.problem?.code).toBe('E_RECIPE_SOURCE');
  });

  /** `demo.mark` plans one `write` per row and declares only `mark`; `count` may lie. */
  const planning = (write: string, count?: number) => (host: PluginHost) => {
    slowPages(host);
    host.registerRecipeVerb({
      id: 'demo.mark',
      kind: 'action',
      arguments: [{ name: 'label', type: 'text', positional: true, required: true }],
      writes: ['mark'],
      plan: ({ arguments: { label }, table: input }) =>
        ok({
          target: 'demo items',
          operations: input.rows.map((row) => ({
            write,
            rowKey: row.key,
            description: `Mark ${row.key} as ${String(label)}`,
          })),
          count: count ?? input.rows.length,
        }),
    });
  };

  it('carries a plan back across the boundary, and writes nothing', async () => {
    const { cells, problem, crashed } = await recipeIn(
      planning('mark'),
      'demo.pull',
      'demo.mark x',
    );
    expect(problem).toBeUndefined();
    expect(crashed).toBeUndefined();
    expect(cells[1]?.plan).toEqual({
      target: 'demo items',
      operations: [1, 2, 3].map((number) => ({
        write: 'mark',
        rowKey: `N-${String(number)}`,
        description: `Mark N-${String(number)} as x`,
      })),
      count: 3,
    });
    expect(cells[1]?.table?.rows.map((row) => row.key)).toEqual(['N-1', 'N-2', 'N-3']);
  });

  it('refuses a planned write the verb did not declare, at the verb, and a stray field', async () => {
    const undeclared = await recipeIn(planning('assign'), 'demo.pull', 'demo.mark x');
    expect(undeclared.problem?.code).toBe('E_RECIPE_PLAN');
    expect(undeclared.problem?.message).toContain(
      "operation 1 writes 'assign', and the verb declares mark",
    );
    expect(undeclared.problem?.range).toEqual(undeclared.cells[1]?.step.verbRange);
    expect(undeclared.cells[1]?.plan).toBeUndefined();

    const miscounted = await recipeIn(planning('mark', 4), 'demo.pull', 'demo.mark x');
    expect(miscounted.problem?.message).toBe(
      "'demo.mark' answered a plan that counts 4 operations and lists 3.",
    );

    const stray = await recipeIn(
      (host) => {
        slowPages(host);
        host.registerRecipeVerb({
          id: 'demo.mark',
          kind: 'sink',
          arguments: [],
          writes: ['mark'],
          plan: () => ok({ target: 'x', operations: [], count: 0, applied: true } as Plan),
        });
      },
      'demo.pull',
      'demo.mark',
    );
    expect(stray.problem?.code).toBe('E_PLUGIN_PROTOCOL');
  });

  it('refuses at load a verb whose writes the manifest does not declare', async () => {
    const { connected } = await isolate(
      (host) => {
        host.registerRecipeVerb({
          id: 'demo.mark',
          kind: 'action',
          arguments: [],
          writes: ['delete'],
          plan: () => ok({ target: 'x', operations: [], count: 0 }),
        });
      },
      { contributes: ['recipe-verb'], namespace: 'demo', writes: ['mark'] },
    );
    if (!connected.ok) throw new Error(connected.error[0]?.message);
    const activated = createPluginHost().tryActivate(connected.value.plugin);
    expect(activated.ok ? '' : activated.error[0]?.message).toContain(
      "writing 'delete', which its tyto-plugin.json does not declare in 'writes' (mark)",
    );
  });
});
