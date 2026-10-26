import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Scene, sourceRange } from '@tyto/core';
import {
  type Exporter,
  type IsolatedPlugin,
  type InProcessHost,
  connectIsolatedPlugin,
  createPluginHost,
  resolveSettings,
} from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { activateInstalled } from './external.js';
import { pluginProcessLauncher } from './plugin-process.js';

/**
 * An installed plugin's setting, with a real confined process (TYTO-254, ADR 0145).
 *
 * The plugin declares `demo.baseUrl` as a form, which crosses as data; the host validates what
 * a file says against it, and the value reaches the process through `configure`, where the
 * plugin reads it with `host.config` when its exporter is called.
 */

let root: string;
let folder: string;
let isolated: IsolatedPlugin | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-setting-'));
  folder = join(root, 'demo');
  await mkdir(folder);
  await writeFile(
    join(folder, 'index.js'),
    `const anything = { safeParse: (value) => ({ success: true, data: value }) };
export function activate(host) {
  host.registerConfiguration({
    id: 'baseUrl',
    form: { type: 'string', format: 'uri' },
    default: 'https://default.example',
    description: 'Where the service is.',
  });
  host.registerExporter({
    id: 'demo', mime: 'text/plain', extension: 'txt', kinds: ['txt'], rasterized: false,
    exportFrame: () => ({ ok: true, value: String(host.config(anything)?.baseUrl), diagnostics: [] }),
  });
}
`,
  );
});

afterEach(async () => {
  await isolated?.close();
  isolated = undefined;
  await rm(root, { recursive: true, force: true });
});

const SCENE: Scene = {
  version: 1,
  artworks: [{ id: 'capa', frames: [{ format: 'feed', size: { w: 1, h: 1 }, children: [] }] }],
  fonts: [],
  assets: [],
};
const ARTWORK = SCENE.artworks[0]!;
const FRAME = ARTWORK.frames[0]!;

async function started(): Promise<IsolatedPlugin> {
  const launch = pluginProcessLauncher({ guest: inject('pluginGuest') });
  const connected = await connectIsolatedPlugin({
    name: 'demo',
    manifest: {
      name: 'demo',
      version: '1.0.0',
      engine: '>=0.1',
      contributes: ['exporter', 'configuration'],
      permissions: [],
    },
    channel: launch({ name: 'demo', entry: join(folder, 'index.js'), directory: folder }),
    requireSandbox: true,
  });
  if (!connected.ok) throw new Error(connected.error[0]?.message);
  isolated = connected.value;
  return connected.value;
}

function exporterOf(host: InProcessHost): Exporter {
  const exporter = host.registry.exporters.forKind('txt');
  if (exporter === undefined) throw new Error('no txt exporter');
  return exporter;
}

describe("an installed plugin's setting, in a real process", () => {
  it('is W_SETTING_INVALID at the value when the file is wrong, and read when it is right', async () => {
    const plugin = await started();
    const host = createPluginHost();
    const activated = host.tryActivate(plugin.plugin);
    if (!activated.ok) throw new Error(activated.error[0]?.message);

    const wrong = resolveSettings(host.registry.configurations(), [
      { key: 'demo.baseUrl', value: 'not a uri', valueRange: sourceRange(17, 28) },
    ]);
    expect(wrong.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', sourceRange(17, 28)],
    ]);
    host.configure(wrong.config);
    expect(await exporterOf(host).exportFrame(SCENE, ARTWORK, FRAME)).toMatchObject({
      value: 'https://default.example',
    });

    const right = resolveSettings(host.registry.configurations(), [
      { key: 'demo.baseUrl', value: 'https://acme.example' },
    ]);
    expect(right.diagnostics).toEqual([]);
    host.configure(right.config);
    expect(await exporterOf(host).exportFrame(SCENE, ARTWORK, FRAME)).toMatchObject({
      value: 'https://acme.example',
    });
  }, 60_000);

  it('reads its default in the CLI, which never reads the window settings', async () => {
    const plugin = await started();
    const host = createPluginHost();
    const warnings = activateInstalled(host, {
      plugins: [plugin.plugin],
      warnings: [],
      close: () => Promise.resolve(),
    });
    expect(warnings).toEqual([]);
    expect(await exporterOf(host).exportFrame(SCENE, ARTWORK, FRAME)).toMatchObject({
      value: 'https://default.example',
    });
  }, 60_000);
});
