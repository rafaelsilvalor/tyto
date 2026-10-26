import { sourceRange } from '@tyto/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { declaredSetting, resolveSettings } from './configuration.js';
import { type SettingForm, settingSchemaOf } from './setting-form.js';

/**
 * A setting's rules as data, turned into the schema the in-process path uses (TYTO-254,
 * ADR 0145). Each construct is checked by what the schema accepts and refuses, not by its shape.
 */

function accepts(form: SettingForm, value: unknown): boolean {
  return settingSchemaOf(form).safeParse(value).success;
}

describe('settingSchemaOf', () => {
  it.each<[string, SettingForm, unknown[], unknown[]]>([
    ['a string', { type: 'string' }, ['', 'a'], [1, null, true]],
    ['a number', { type: 'number' }, [1.5, -2], ['1', null]],
    ['an integer', { type: 'integer' }, [3, -1], [1.5, '3']],
    ['a boolean', { type: 'boolean' }, [true, false], ['true', 0]],
    ['a nullable string', { type: 'string', nullable: true }, ['a', null], [1]],
    ['an enum', { type: 'string', enum: ['a', 'b'] }, ['a', 'b'], ['c', null]],
    ['a nullable enum', { type: 'integer', enum: [1, 2], nullable: true }, [1, null], [3]],
    ['bounds', { type: 'number', minimum: 0, maximum: 1 }, [0, 0.5, 1], [-0.1, 1.1]],
    ['lengths', { type: 'string', minLength: 2, maxLength: 3 }, ['ab', 'abc'], ['a', 'abcd']],
    ['a pattern', { type: 'string', pattern: '^[a-z]+-\\d+$' }, ['tyto-254'], ['tyto', '']],
    ['a uri', { type: 'string', format: 'uri' }, ['https://x.example/a'], ['x.example', '']],
    [
      'a list',
      { type: 'array', items: { type: 'integer', minimum: 1 } },
      [[], [1, 1, 2]],
      [[0], 'a', [1.5]],
    ],
    [
      'a list of unique entries',
      { type: 'array', items: { type: 'string' }, uniqueItems: true },
      [['a', 'b']],
      [['a', 'a']],
    ],
  ])('reads %s', (_name, form, good, bad) => {
    for (const value of good) expect(accepts(form, value), JSON.stringify(value)).toBe(true);
    for (const value of bad) expect(accepts(form, value), JSON.stringify(value)).toBe(false);
  });

  it.each<[string, unknown, string]>([
    ['an object', { type: 'object' }, 'a setting form cannot be an object'],
    ['a secret', { type: 'string', secret: true }, 'Unrecognized key: "secret"'],
    ['a list of lists', { type: 'array', items: { type: 'array' } }, 'items.type'],
    ['a keyword of another type', { type: 'number', pattern: 'a' }, 'pattern does not apply'],
    ['bounds beside an enum', { type: 'number', enum: [1], minimum: 0 }, 'beside enum'],
    ['an enum value of another type', { type: 'string', enum: ['a', 1] }, 'enum.1 is 1'],
    ['crossed bounds', { type: 'integer', minimum: 3, maximum: 1 }, 'minimum 3 is above'],
    ['a pattern that does not compile', { type: 'string', pattern: '(' }, 'pattern is not one'],
    ['an unbounded pattern', { type: 'string', pattern: '(a+)+' }, 'pattern is not one'],
    ['a pattern over the ceiling', { type: 'string', pattern: 'a'.repeat(513) }, 'pattern'],
  ])('refuses %s', (_name, form, problem) => {
    expect(() => settingSchemaOf(form as SettingForm)).toThrow(problem);
  });
});

describe('a setting declared with a form', () => {
  const form = {
    id: 'baseUrl',
    form: { type: 'string', format: 'uri' } as const,
    default: 'https://example.com',
    description: 'Where the service is.',
  };

  it('resolves like one declared with a schema, ranged diagnostic included', () => {
    const declared = declaredSetting('demo', true, form);
    const resolved = resolveSettings(
      [declared],
      [{ key: 'demo.baseUrl', value: 'nowhere', valueRange: sourceRange(4, 13) }],
    );
    expect(resolved.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_INVALID', sourceRange(4, 13)],
    ]);
    expect(resolved.config).toEqual({ demo: { baseUrl: 'https://example.com' } });
  });

  it('checks a unique list one entry at a time', () => {
    const declared = declaredSetting('demo', true, {
      id: 'tags',
      form: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
      default: [],
      description: 'Tags.',
    });
    const resolved = resolveSettings(
      [declared],
      [
        {
          key: 'demo.tags',
          value: ['a', '', 'a', 'b'],
          entryRanges: [sourceRange(1, 2), sourceRange(3, 4), sourceRange(5, 6), sourceRange(7, 8)],
        },
      ],
    );
    expect(resolved.values['demo.tags']).toEqual(['a', 'b']);
    expect(resolved.diagnostics.map((item) => [item.code, item.range])).toEqual([
      ['W_SETTING_ENTRY_INVALID', sourceRange(3, 4)],
      ['W_SETTING_ENTRY_INVALID', sourceRange(5, 6)],
    ]);
  });

  it('refuses a default the form refuses', () => {
    expect(() => declaredSetting('demo', true, { ...form, default: 'nowhere' })).toThrow(
      "Plugin 'demo' declares the setting 'baseUrl' with a default its own schema refuses",
    );
  });

  it('refuses a form Tyto cannot read, naming the setting', () => {
    expect(() =>
      declaredSetting('demo', true, { ...form, form: { type: 'string', pattern: '(' } }),
    ).toThrow("Plugin 'demo' declares the setting 'baseUrl' with a form Tyto cannot read");
  });

  it('refuses both a schema and a form, and neither', () => {
    expect(() => declaredSetting('demo', true, { ...form, schema: z.string() } as never)).toThrow(
      'both a schema and a form',
    );
    const { form: _dropped, ...neither } = form;
    expect(() => declaredSetting('demo', true, neither as never)).toThrow(
      'neither a schema nor a form',
    );
  });
});
