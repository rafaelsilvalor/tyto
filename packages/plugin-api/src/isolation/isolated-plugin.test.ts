import {
  type Diagnostics,
  type Directive,
  type Result,
  type Scene,
  type TemplateAnswer,
  type TemplateCall,
  type TemplateRegistry,
  type TemplateReport,
  ok,
  parseManifest,
  resolve,
  sourceRange,
} from '@tyto/core';
import { describe, expect, it } from 'vitest';

import type {
  DirectiveContribution,
  Exporter,
  IsolatedPackBuild,
  TemplatePack,
} from '../contributions.js';
import { directiveResolverOf } from '../directives.js';
import { type Disposable, type Plugin, type PluginHost, createPluginHost } from '../host.js';
import type { HostCapabilities } from '../capabilities.js';
import type { GuestChannel, PluginChannel } from './channel.js';
import { runGuest } from './guest.js';
import { type IsolatedPlugin, connectIsolatedPlugin } from './isolated-plugin.js';
import type { SandboxReport } from './protocol.js';

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

  it('speaks another protocol', async () => {
    const pair = channelPair(() => undefined);
    const connecting = connectIsolatedPlugin({
      requireSandbox: true,
      name: 'texto',
      manifest: MANIFEST,
      channel: pair.host,
    });
    pair.inject({ type: 'hello', protocol: 3, sandbox: CONFINED });
    const connected = await connecting;
    expect(connected.ok ? '' : connected.error[0]?.message).toBe(
      "Plugin 'texto' failed to activate: its process speaks protocol 3 and this host speaks 2.",
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
