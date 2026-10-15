import { isErr } from '@tyto/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type SettingEntry, declaredSetting, resolveSettings } from './configuration.js';
import { type Plugin, createPluginHost } from './host.js';

/**
 * The `configuration` point and the rule that resolves a settings file against it (TYTO-206,
 * ADR 0073): declared through the same door as every other contribution, prefixed by plugin
 * id for everybody but a built-in, and resolved one key at a time.
 */

const manifestOf = (name: string): unknown => ({
  name,
  version: '0.1.0',
  engine: '>=0.1',
  contributes: ['configuration'],
  permissions: [],
});

/** A third party's plugin with one setting: a number from 8 to 72. */
const demo: Plugin = {
  id: 'demo',
  manifest: manifestOf('demo'),
  activate: (host) =>
    host.registerConfiguration({
      id: 'fontSize',
      schema: z.number().int().min(8).max(72),
      default: 14,
      description: 'The size of the text in the demo panel.',
    }),
};

/** A built-in with two, whose keys stay unprefixed. */
const builtIn: Plugin = {
  id: 'desktop',
  manifest: manifestOf('desktop'),
  activate: (host) => {
    host.registerConfiguration({
      id: 'queueAutoRun',
      schema: z.boolean(),
      default: false,
      description: 'Render what arrives in the queue without being asked.',
    });
    host.registerConfiguration({
      id: 'templatesFolder',
      schema: z.string().min(1).nullable(),
      default: null,
      description: 'A folder of templates searched before the built-in pack.',
    });
  },
};

function hostWithBoth() {
  const host = createPluginHost();
  host.activate(builtIn);
  const loaded = host.tryActivate(demo);
  if (isErr(loaded)) throw new Error(loaded.error.map((item) => item.message).join(' '));
  return host;
}

const at = (start: number, end: number) => ({ start, end });

describe('declaring a setting', () => {
  it('prefixes a third party with its id and leaves a built-in unprefixed', () => {
    expect(
      hostWithBoth()
        .registry.configurations()
        .map((setting) => setting.key),
    ).toEqual(['queueAutoRun', 'templatesFolder', 'demo.fontSize']);
  });

  it('validates a test plugin’s setting like a built-in one', () => {
    const host = hostWithBoth();
    const resolved = resolveSettings(host.registry.configurations(), [
      { key: 'demo.fontSize', value: 18 },
      { key: 'queueAutoRun', value: true },
    ]);

    expect(resolved.values).toEqual({
      queueAutoRun: true,
      templatesFolder: null,
      'demo.fontSize': 18,
    });
    expect(resolved.diagnostics).toEqual([]);
  });

  it('feeds the record `config()` reads, so a plugin sees its own keys', () => {
    // Built on the existing configuration slice, not beside it: the values land where
    // `PluginHost.config(schema)` was already looking.
    const host = hostWithBoth();
    host.configure(
      resolveSettings(host.registry.configurations(), [{ key: 'demo.fontSize', value: 20 }]).config,
    );

    expect(host.hostFor('demo').config(z.object({ fontSize: z.number() }))).toEqual({
      fontSize: 20,
    });
  });

  it('refuses a key with a dot, because the host owns the prefix', () => {
    const host = createPluginHost();
    const result = host.tryActivate({
      ...demo,
      activate: (h) =>
        h.registerConfiguration({
          id: 'demo.fontSize',
          schema: z.number(),
          default: 1,
          description: 'Prefixed by hand.',
        }),
    });

    expect(isErr(result) ? result.error[0]?.code : 'activated').toBe('E_PLUGIN_ACTIVATE');
    expect(host.registry.configurations()).toEqual([]);
  });

  it('refuses a default its own schema refuses', () => {
    const host = createPluginHost();
    const result = host.tryActivate({
      ...demo,
      activate: (h) =>
        h.registerConfiguration({
          id: 'fontSize',
          schema: z.number().min(8),
          default: 2,
          description: 'Too small to start with.',
        }),
    });

    expect(isErr(result) ? result.error[0]?.message : 'activated').toMatch(/default its own/u);
  });
});

describe('resolving a file, one key at a time', () => {
  it('keeps the good keys when one value is bad, and points at the bad value', () => {
    const host = hostWithBoth();
    const entries: SettingEntry[] = [
      { key: 'templatesFolder', value: '/meus-templates', keyRange: at(4, 21) },
      { key: 'queueAutoRun', value: 'yes', keyRange: at(40, 54), valueRange: at(56, 61) },
    ];

    const resolved = resolveSettings(host.registry.configurations(), entries);

    expect(resolved.values).toEqual({
      queueAutoRun: false,
      templatesFolder: '/meus-templates',
      'demo.fontSize': 14,
    });
    expect(
      resolved.diagnostics.map((item) => [item.code, item.severity, item.range, item.message]),
    ).toEqual([
      [
        'W_SETTING_INVALID',
        'warning',
        at(56, 61),
        "Setting 'queueAutoRun' is not accepted (Invalid input: expected boolean, received string); its default applies.",
      ],
    ]);
  });

  it('reports an unknown key at the key', () => {
    const resolved = resolveSettings(hostWithBoth().registry.configurations(), [
      { key: 'queueAutoRn', value: true, keyRange: at(4, 17), valueRange: at(19, 23) },
    ]);

    expect(resolved.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_UNKNOWN', at(4, 17)],
    ]);
  });

  it('does not accept a third party’s key without its prefix, and says which one it is', () => {
    const resolved = resolveSettings(hostWithBoth().registry.configurations(), [
      { key: 'fontSize', value: 30, keyRange: at(4, 14) },
    ]);

    expect(resolved.values['demo.fontSize']).toBe(14);
    expect(resolved.diagnostics.map((item) => [item.code, item.message])).toEqual([
      [
        'W_SETTING_UNPREFIXED',
        "Setting 'fontSize' belongs to plugin 'demo' and is written 'demo.fontSize'.",
      ],
    ]);
  });

  it('answers every default for an empty file, and no diagnostics', () => {
    const resolved = resolveSettings(hostWithBoth().registry.configurations(), []);

    expect(resolved).toEqual({
      values: { queueAutoRun: false, templatesFolder: null, 'demo.fontSize': 14 },
      config: {
        desktop: { queueAutoRun: false, templatesFolder: null },
        demo: { fontSize: 14 },
      },
      diagnostics: [],
    });
  });
});

describe('a list setting checked one entry at a time (TYTO-301, ADR 0091)', () => {
  const colour = z.enum(['red', 'green', 'blue']);
  const listOf = (unique: boolean) =>
    declaredSetting('desktop', false, {
      id: 'colours',
      schema: z.array(colour),
      default: ['red', 'green', 'blue'],
      description: 'Which colours show, in order.',
      entries: { schema: colour, unique },
    });

  it('leaves out an entry it refuses, at that entry, and keeps the others in order', () => {
    const resolved = resolveSettings(
      [listOf(true)],
      [
        {
          key: 'colours',
          value: ['blue', 'purple', 'red', 7],
          valueRange: at(12, 40),
          entryRanges: [at(13, 19), at(21, 29), at(31, 36), at(38, 39)],
        },
      ],
    );

    expect(resolved.values['colours']).toEqual(['blue', 'red']);
    expect(resolved.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_ENTRY_INVALID', at(21, 29)],
      ['W_SETTING_ENTRY_INVALID', at(38, 39)],
    ]);
    expect(resolved.diagnostics[0]?.message).toMatch(
      /^Entry 2 of setting 'colours' is not accepted \(.+\); it is left out and the rest apply\.$/u,
    );
  });

  it('leaves out a repeated entry when entries are unique, and keeps it when they are not', () => {
    const written = { key: 'colours', value: ['red', 'red'], entryRanges: [at(1, 6), at(8, 13)] };

    const unique = resolveSettings([listOf(true)], [written]);
    expect(unique.values['colours']).toEqual(['red']);
    expect(unique.diagnostics.map((item) => [item.code, item.range, item.message])).toEqual([
      [
        'W_SETTING_ENTRY_INVALID',
        at(8, 13),
        "Entry 2 of setting 'colours' repeats an earlier entry; it is left out and the rest apply.",
      ],
    ]);

    const repeated = resolveSettings([listOf(false)], [written]);
    expect(repeated.values['colours']).toEqual(['red', 'red']);
    expect(repeated.diagnostics).toEqual([]);
  });

  it('refuses a value that is not a list as a whole, and the default applies', () => {
    const resolved = resolveSettings(
      [listOf(true)],
      [{ key: 'colours', value: 'red', valueRange: at(12, 17) }],
    );

    expect(resolved.values['colours']).toEqual(['red', 'green', 'blue']);
    expect(resolved.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', at(12, 17)],
    ]);
  });

  it('points at the value when the reader gave no entry ranges', () => {
    const resolved = resolveSettings(
      [listOf(true)],
      [{ key: 'colours', value: ['pink'], valueRange: at(12, 20) }],
    );

    expect(resolved.values['colours']).toEqual([]);
    expect(resolved.diagnostics.map((item) => item.range)).toEqual([at(12, 20)]);
  });
});
