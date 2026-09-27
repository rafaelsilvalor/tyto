import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Scene } from '@tyto/core';
import { connectIsolatedPlugin, createPluginHost } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pluginCapabilities } from './capabilities.js';
import { launchPluginWorker } from './worker-channel.js';

/**
 * The `worker_threads` adapter, with real threads (TYTO-48).
 *
 * The protocol's own rules are `@tyto/plugin-api`'s tests. What only a real thread can say
 * is how it ends: an uncaught throw and an exit are crashes with a reason, and `close` is
 * not a crash at all.
 */

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'tyto-worker-'));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

const MANIFEST = {
  name: 'texto',
  version: '1.0.0',
  engine: '>=0.1',
  contributes: ['exporter'],
  permissions: [],
};

const SCENE: Scene = {
  version: 1,
  artworks: [{ id: 'capa', frames: [{ format: 'feed', size: { w: 1, h: 1 }, children: [] }] }],
  fonts: [],
  assets: [],
};

/** A plugin module on disk whose `exportFrame` body is `body`. */
async function pluginWith(body: string): Promise<string> {
  const entry = join(folder, 'index.js');
  await writeFile(
    entry,
    `export function activate(host) {
  host.registerExporter({
    id: 'texto', mime: 'text/plain', extension: 'txt', kinds: ['txt'], rasterized: false,
    exportFrame: (scene, artwork, frame) => { ${body} },
  });
}
`,
  );
  return entry;
}

async function connect(
  body: string,
  crashes: string[] = [],
  options: { readonly permissions?: readonly string[]; readonly deadlineMs?: number } = {},
) {
  const connected = await connectIsolatedPlugin({
    name: 'texto',
    manifest: { ...MANIFEST, permissions: options.permissions ?? [] },
    channel: launchPluginWorker({ name: 'texto', entry: await pluginWith(body) }),
    onCrash: (reason) => crashes.push(reason),
    capabilities: pluginCapabilities({ TYTO_PLUGIN_TEXTO_API_TOKEN: 's3cret' }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
  });
  if (!connected.ok) throw new Error(connected.error[0]?.message);
  const host = createPluginHost();
  host.tryActivate(connected.value.plugin);
  const exporter = host.registry.exporters.forKind('txt');
  if (exporter === undefined) throw new Error('no txt exporter');
  return { isolated: connected.value, exporter };
}

const ARTWORK = SCENE.artworks[0]!;
const FRAME = ARTWORK.frames[0]!;

describe('a plugin in a worker thread', () => {
  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('answers from the thread', async () => {
    const { isolated, exporter } = await connect(
      "return { ok: true, value: artwork.id + ' ' + frame.format, diagnostics: [] };",
    );
    expect(await exporter.exportFrame(SCENE, ARTWORK, FRAME)).toEqual({
      ok: true,
      value: 'capa feed',
      diagnostics: [],
    });
    await isolated.close();
  }, 60_000);

  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('crashes with the message of an uncaught throw, and the host keeps answering', async () => {
    const crashes: string[] = [];
    const { isolated, exporter } = await connect(
      "setTimeout(() => { throw new Error('the ink ran out'); }); return new Promise(() => {});",
      crashes,
    );

    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok ? '' : answer.error[0]?.message).toBe(
      "Plugin 'texto' stopped running: the ink ran out.",
    );
    // The thread is gone and the host is not: the next call answers at once, as data.
    const after = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(after.ok ? '' : after.error[0]?.code).toBe('E_PLUGIN_CRASHED');
    expect(crashes).toEqual(['the ink ran out']);
    await isolated.close();
  }, 60_000);

  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is not a crash when the host closes it', async () => {
    const crashes: string[] = [];
    const { isolated } = await connect('return new Promise(() => {});', crashes);
    await isolated.close();
    expect(crashes).toEqual([]);
    expect(isolated.crashed()).toBeUndefined();
  }, 60_000);
});

/** A frame whose text is what the promise `expression` resolves to, or the code it threw. */
const answering = (expression: string): string =>
  `return (${expression}).then(` +
  `(value) => ({ ok: true, value: String(value), diagnostics: [] }), ` +
  `(cause) => ({ ok: true, value: String(cause.code) + ' ' + cause.message, diagnostics: [] }));`;

describe("a plugin in a worker thread, asking for the host's capabilities", () => {
  let server: Server;
  let requests: number;
  let base: string;

  beforeEach(async () => {
    requests = 0;
    server = createServer((_request, response) => {
      requests += 1;
      response.end('from the server');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('reaches a declared host through host.fetch', async () => {
    const { isolated, exporter } = await connect(
      answering(`host.fetch('${base}/').then((response) => response.text())`),
      [],
      { permissions: ['net:127.0.0.1'] },
    );
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('from the server');
    expect(requests).toBe(1);
    await isolated.close();
  }, 60_000);

  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('gets E_PERMISSION for an undeclared host, and the server hears nothing', async () => {
    const other = base.replace('127.0.0.1', 'localhost');
    const { isolated, exporter } = await connect(answering(`host.fetch('${other}/')`), [], {
      permissions: ['net:127.0.0.1'],
    });
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toMatch(
      /^E_PERMISSION Plugin 'texto' called 'host\.fetch to localhost/u,
    );
    expect(requests).toBe(0);
    await isolated.close();
  }, 60_000);

  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('finds no global fetch to go around host.fetch with', async () => {
    const { isolated, exporter } = await connect(answering('Promise.resolve(typeof fetch)'));
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('undefined');
    await isolated.close();
  }, 60_000);

  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('reads a declared credential from the environment, and only that one', async () => {
    const { isolated, exporter } = await connect(
      answering(
        `host.credentials('api-token').then((token) => ` +
          `host.credentials('other').then(() => token, (cause) => token + ' ' + cause.code))`,
      ),
      [],
      { permissions: ['credentials:api-token'] },
    );
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok && answer.value).toBe('s3cret E_PERMISSION');
    await isolated.close();
  }, 60_000);
});

describe('a plugin stuck in a loop', () => {
  // Starts a plugin's worker thread, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is ended at its deadline, and the host answers the frame and every one after', async () => {
    const crashes: string[] = [];
    const { isolated, exporter } = await connect('while (true) {}', crashes, { deadlineMs: 1_000 });

    const started = Date.now();
    const answer = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(answer.ok ? '' : answer.error[0]?.message).toBe(
      "Plugin 'texto' did not answer within 1 s, so its process was ended.",
    );
    // The loop never yields; the host's own thread is what kept the clock.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(crashes).toEqual(['it did not answer within 1 s']);

    const after = await exporter.exportFrame(SCENE, ARTWORK, FRAME);
    expect(after.ok ? '' : after.error[0]?.code).toBe('E_PLUGIN_CRASHED');
    await isolated.close();
  }, 60_000);
});
