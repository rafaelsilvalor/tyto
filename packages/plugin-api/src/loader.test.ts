import { type Diagnostics, type Result, isErr } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { checkInstallable, checkStoredPlugin, skippedPluginWarnings } from './loader.js';
import {
  EMPTY_PLUGIN_STATE,
  type PluginState,
  parsePluginState,
  serializePluginState,
  withPluginEntry,
} from './state.js';

/**
 * The half of the loader that reads no disk: every refusal decided from strings, before a
 * line of the plugin's code is imported.
 */

const ENGINE = '0.3.9';

function manifestSource(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'pdf',
    version: '1.0.0',
    engine: '>=0.3',
    contributes: ['exporter'],
    permissions: ['net:api.example.com'],
    ...overrides,
  });
}

const approved: PluginState = {
  plugins: {
    pdf: { enabled: true, permissions: ['net:api.example.com'], source: './pdf' },
  },
};

const codes = (result: Result<unknown, Diagnostics>): readonly string[] =>
  isErr(result) ? result.error.map((item) => item.code) : [];

describe('checkInstallable', () => {
  it('accepts a manifest whose engine this host satisfies', () => {
    expect(checkInstallable(manifestSource(), 'pdf/tyto-plugin.json', ENGINE).ok).toBe(true);
  });

  it('refuses an incompatible engine, naming both numbers', () => {
    const result = checkInstallable(manifestSource({ engine: '>=1' }), 'x', ENGINE);

    expect(isErr(result) && result.error[0]?.message).toBe(
      "Plugin 'pdf' needs plugin API >=1, and this Tyto provides plugin API 0.3.9.",
    );
  });

  it('refuses a file that is not JSON before asking anything else', () => {
    expect(codes(checkInstallable('{', 'x', ENGINE))).toEqual(['E_PLUGIN_MANIFEST_SYNTAX']);
  });
});

describe('checkStoredPlugin', () => {
  it('passes an installed folder whose approval covers what it asks for', () => {
    const result = checkStoredPlugin(
      { folder: 'pdf', manifestSource: manifestSource() },
      approved,
      ENGINE,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a folder nobody installed, because nobody approved it', () => {
    const result = checkStoredPlugin(
      { folder: 'pdf', manifestSource: manifestSource() },
      EMPTY_PLUGIN_STATE,
      ENGINE,
    );
    expect(isErr(result) && result.error[0]?.message).toMatch(/never recorded it/);
  });

  it('refuses a plugin that now asks for a permission nobody approved', () => {
    const result = checkStoredPlugin(
      {
        folder: 'pdf',
        manifestSource: manifestSource({ permissions: ['net:api.example.com', 'net:*'] }),
      },
      approved,
      ENGINE,
    );
    expect(isErr(result) && result.error[0]?.message).toBe(
      "Plugin 'pdf' asks for 'net:*', which were not approved when it was installed. Install it again to approve them.",
    );
  });

  it('refuses a folder whose manifest names somebody else', () => {
    const result = checkStoredPlugin(
      { folder: 'pdf', manifestSource: manifestSource({ name: 'outro' }) },
      approved,
      ENGINE,
    );
    expect(codes(result)).toEqual(['E_PLUGIN_ACTIVATE']);
  });

  it('refuses a folder with no manifest at all', () => {
    const result = checkStoredPlugin(
      { folder: 'pdf', manifestSource: undefined },
      approved,
      ENGINE,
    );
    expect(codes(result)).toEqual(['E_PLUGIN_ACTIVATE']);
  });

  it('checks the engine again at load, because a newer Tyto can leave a plugin behind', () => {
    const result = checkStoredPlugin(
      { folder: 'pdf', manifestSource: manifestSource({ engine: '^0.3' }) },
      approved,
      '0.4.0',
    );
    expect(codes(result)).toEqual(['E_PLUGIN_ENGINE']);
  });
});

describe('skippedPluginWarnings', () => {
  it('turns each refusal into a warning that still carries the reason', () => {
    const refused = checkStoredPlugin(
      { folder: 'pdf', manifestSource: manifestSource({ engine: '>=1' }) },
      approved,
      ENGINE,
    );
    const warnings = isErr(refused) ? skippedPluginWarnings('pdf', refused.error) : [];

    expect(warnings.map((warning) => [warning.severity, warning.code])).toEqual([
      ['warning', 'W_PLUGIN_SKIPPED'],
    ]);
    expect(warnings[0]?.message).toBe(
      "Plugin 'pdf' was skipped: Plugin 'pdf' needs plugin API >=1, and this Tyto provides plugin API 0.3.9.",
    );
  });
});

describe('plugin state', () => {
  it('round-trips, sorted by name so install order does not change the file', () => {
    const state = withPluginEntry(
      withPluginEntry(EMPTY_PLUGIN_STATE, 'zeta', { enabled: false, permissions: [], source: 'z' }),
      'alfa',
      { enabled: true, permissions: [], source: 'a' },
    );
    const text = serializePluginState(state);

    expect(Object.keys(JSON.parse(text).plugins as object)).toEqual(['alfa', 'zeta']);
    expect(parsePluginState(text, 'plugins.json')).toEqual({
      ok: true,
      value: state,
      diagnostics: [],
    });
  });

  it('removes an entry when handed nothing', () => {
    expect(withPluginEntry(approved, 'pdf', undefined)).toEqual(EMPTY_PLUGIN_STATE);
  });

  it('refuses a file it cannot read, naming the file', () => {
    expect(codes(parsePluginState('{"plugins": {"pdf": {"enabled": "yes"}}}', 'p.json'))).toEqual([
      'E_PLUGIN_STATE',
      'E_PLUGIN_STATE',
      'E_PLUGIN_STATE',
    ]);
    expect(codes(parsePluginState('nope', 'p.json'))).toEqual(['E_PLUGIN_STATE']);
  });
});
