import { type Diagnostics, type Result, type Scene, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import type { Exporter } from '../contributions.js';
import { type Disposable, type Plugin, type PluginHost, createPluginHost } from '../host.js';
import type { GuestChannel, PluginChannel } from './channel.js';
import { runGuest } from './guest.js';
import { type IsolatedPlugin, connectIsolatedPlugin } from './isolated-plugin.js';

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
 * types (ADR 0010), and every runtime it targets has these three.
 */
const { structuredClone, queueMicrotask, setTimeout } = globalThis as unknown as {
  structuredClone<T>(value: T): T;
  queueMicrotask(callback: () => void): void;
  setTimeout(callback: (value?: unknown) => void, delay: number): unknown;
};

interface Pair {
  readonly host: PluginChannel;
  /** Ends the guest's side as a crash would, with the reason the platform gives. */
  crash(reason: string): void;
  /** Delivered to the host as though the guest had sent it — for a guest that lies. */
  inject(message: unknown): void;
}

function channelPair(start: (guest: GuestChannel) => void): Pair {
  const toHost = new Set<(message: unknown) => void>();
  const toGuest = new Set<(message: unknown) => void>();
  const exits = new Set<(reason: string) => void>();
  let ended = false;

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
  options: { readonly onCrash?: (reason: string) => void; readonly log?: string[] } = {},
): Promise<{ readonly pair: Pair; readonly connected: Result<IsolatedPlugin, Diagnostics> }> {
  const pair = channelPair((guest) => runGuest(guest, () => Promise.resolve({ activate })));
  const lines = options.log;
  const connected = await connectIsolatedPlugin({
    name: 'texto',
    manifest: MANIFEST,
    channel: pair.host,
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
    ['directive', (host: PluginHost) => host.registerDirective({ id: 'd', namespace: 'd' })],
    ['panel', (host: PluginHost) => host.registerPanel({ id: 'p', title: 'P' })],
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
      name: 'texto',
      manifest: MANIFEST,
      channel: pair.host,
    });
    pair.inject({ type: 'hello', protocol: 2 });
    const connected = await connecting;
    expect(connected.ok ? '' : connected.error[0]?.message).toBe(
      "Plugin 'texto' failed to activate: its process speaks protocol 2 and this host speaks 1.",
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
      runGuest(guest, () =>
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
