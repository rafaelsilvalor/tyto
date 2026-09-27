import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Scene } from '@tyto/core';
import { connectIsolatedPlugin, createPluginHost } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

async function connect(body: string, crashes: string[] = []) {
  const connected = await connectIsolatedPlugin({
    name: 'texto',
    manifest: MANIFEST,
    channel: launchPluginWorker({ name: 'texto', entry: await pluginWith(body) }),
    onCrash: (reason) => crashes.push(reason),
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
