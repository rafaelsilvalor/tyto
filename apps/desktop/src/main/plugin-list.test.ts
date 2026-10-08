import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fsPluginStore } from '@tyto/io';
import {
  EMPTY_PLUGIN_CRASHES,
  EMPTY_PLUGIN_STATE,
  PLUGIN_API_VERSION,
  withPluginCrash,
  withPluginEntry,
} from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exporterBuiltIns, listPlugins, tytoHome } from './plugin-list.js';

/**
 * The rows the plugins screen shows, from a real `~/.tyto` in the temp space. Every check is
 * one the CLI's `tyto plugin list` also makes; the two apps must list the same plugins.
 */

let home: string;

const svg = {
  manifest: {
    name: 'svg',
    version: '1.0.2',
    engine: '>=0.1',
    contributes: ['exporter' as const],
    permissions: [],
  },
  origin: 'built-in' as const,
};

const nothingStored = (): Promise<boolean> => Promise.resolve(false);

async function installed(
  name: string,
  engine = `>=${PLUGIN_API_VERSION}`,
  permissions: readonly string[] = ['net:api.example.com'],
): Promise<void> {
  const folder = join(home, 'plugins', name);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine,
      contributes: ['exporter'],
      permissions,
    }),
  );
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tyto-desktop-plugins-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('listPlugins', () => {
  it('lists the built-ins first, and nothing else when nothing is installed', async () => {
    const rows = await listPlugins([svg], fsPluginStore(home), nothingStored);

    expect(rows).toEqual([
      {
        name: 'svg',
        version: '1.0.2',
        origin: 'built-in',
        status: 'enabled',
        contributes: ['exporter'],
        permissions: [],
        problems: [],
        credentials: [],
      },
    ]);
  });

  it('shows an installed plugin as enabled or disabled, with its permissions', async () => {
    const store = fsPluginStore(home);
    await installed('pdf');
    await store.writeState(
      withPluginEntry(EMPTY_PLUGIN_STATE, 'pdf', {
        enabled: false,
        permissions: ['net:api.example.com'],
        source: './pdf',
      }),
    );

    const rows = await listPlugins([svg], store, nothingStored);

    expect(rows.at(-1)).toMatchObject({
      name: 'pdf',
      origin: 'external',
      status: 'disabled',
      permissions: ['net:api.example.com'],
    });
  });

  it('refuses a folder nobody installed, and says why', async () => {
    await installed('solto');

    const rows = await listPlugins([svg], fsPluginStore(home), nothingStored);

    expect(rows.at(-1)).toMatchObject({ name: 'solto', status: 'refused', version: null });
    expect(rows.at(-1)?.problems[0]).toMatch(/never recorded it/u);
  });

  it('refuses an incompatible engine with the same sentence the CLI prints', async () => {
    const store = fsPluginStore(home);
    await installed('velho', '>=99');
    await store.writeState(
      withPluginEntry(EMPTY_PLUGIN_STATE, 'velho', {
        enabled: true,
        permissions: ['net:api.example.com'],
        source: './velho',
      }),
    );

    const rows = await listPlugins([svg], store, nothingStored);

    expect(rows.at(-1)?.problems).toEqual([
      `Plugin 'velho' needs plugin API >=99, and this Tyto provides plugin API ${PLUGIN_API_VERSION}.`,
    ]);
  });

  it('refuses every folder when the state file cannot be read', async () => {
    await installed('pdf');
    await writeFile(join(home, 'plugins.json'), 'not json');

    const rows = await listPlugins([svg], fsPluginStore(home), nothingStored);

    expect(rows.at(-1)).toMatchObject({ name: 'pdf', status: 'refused' });
  });

  it('shows a crash as history, with when and why, and only while it is enabled', async () => {
    const store = fsPluginStore(home);
    await installed('pdf');
    const approved = { enabled: true, permissions: ['net:api.example.com'], source: './pdf' };
    await store.writeState(withPluginEntry(EMPTY_PLUGIN_STATE, 'pdf', approved));
    await store.writeCrashes(
      withPluginCrash(EMPTY_PLUGIN_CRASHES, 'pdf', {
        at: '2026-09-27T12:00:00.000Z',
        reason: 'its process exited with code 7',
      }),
    );

    expect((await listPlugins([svg], store, nothingStored)).at(-1)).toMatchObject({
      name: 'pdf',
      status: 'crashed',
      problems: [
        "Plugin 'pdf' crashed at 2026-09-27T12:00:00.000Z: its process exited with code 7. It is " +
          'still activated; installing or enabling it again clears this.',
      ],
    });

    await store.writeState(
      withPluginEntry(EMPTY_PLUGIN_STATE, 'pdf', { ...approved, enabled: false }),
    );
    expect((await listPlugins([svg], store, nothingStored)).at(-1)).toMatchObject({
      status: 'disabled',
      problems: [],
    });
  });
});

describe('the credentials a row declares (TYTO-187)', () => {
  it('says whether each declared key is set, asking by account and never for a value', async () => {
    const store = fsPluginStore(home);
    const permissions = ['net:api.example.com', 'credentials:api-token', 'credentials:conta'];
    await installed('pdf', `>=${PLUGIN_API_VERSION}`, permissions);
    await store.writeState(
      withPluginEntry(EMPTY_PLUGIN_STATE, 'pdf', { enabled: true, permissions, source: './pdf' }),
    );
    const asked: string[] = [];
    const isStored = (account: string): Promise<boolean> => {
      asked.push(account);
      return Promise.resolve(account === 'plugin:pdf:conta');
    };

    const rows = await listPlugins([svg], store, isStored);

    expect(rows.at(-1)?.credentials).toEqual([
      { key: 'api-token', set: false },
      { key: 'conta', set: true },
    ]);
    expect(rows[0]?.credentials).toEqual([]);
    expect(asked).toEqual(['plugin:pdf:api-token', 'plugin:pdf:conta']);
  });
});

describe('exporterBuiltIns', () => {
  it('lists html and svg, which the startup host never holds because exports make their own', () => {
    // Measured in the window: without these the screen listed two built-ins where
    // `tyto plugin list` lists six, for the same exporters running the same code.
    expect(exporterBuiltIns().map((plugin) => [plugin.manifest.name, plugin.origin])).toEqual([
      ['html', 'built-in'],
      ['svg', 'built-in'],
    ]);
  });
});

describe('tytoHome', () => {
  it('is TYTO_HOME when it is set, so both apps and a test agree on one folder', () => {
    expect(tytoHome({ TYTO_HOME: '/tmp/elsewhere' })).toBe('/tmp/elsewhere');
  });

  it('is ~/.tyto otherwise, and an empty variable counts as unset', () => {
    expect(tytoHome({})).toMatch(/[\\/]\.tyto$/u);
    expect(tytoHome({ TYTO_HOME: '' })).toMatch(/[\\/]\.tyto$/u);
  });
});
