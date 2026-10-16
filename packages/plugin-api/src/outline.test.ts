import { isErr } from '@tyto/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { declaredSetting } from './configuration.js';
import { type Plugin, createPluginHost } from './host.js';
import { outlineOf } from './outline.js';

/**
 * The outline a settings editor suggests and explains from (TYTO-304, ADR 0092): plain data
 * read off each declared schema, so a plugin's setting arrives in the window like a built-in's.
 */

const manifestOf = (name: string): unknown => ({
  name,
  version: '0.1.0',
  engine: '>=0.1',
  contributes: ['configuration'],
  permissions: [],
});

/**
 * A third party's plugin, declared in process because an installed plugin cannot declare a
 * setting yet (`registerConfiguration` is in `NOT_YET_ISOLATED`): what the window would receive
 * once one can.
 */
const demo: Plugin = {
  id: 'demo',
  manifest: manifestOf('demo'),
  activate: (host) => {
    host.registerConfiguration({
      id: 'fontSize',
      schema: z.number().int().min(8).max(72),
      default: 14,
      description: 'The size of the text in the demo panel.',
    });
    host.registerConfiguration({
      id: 'density',
      schema: z.enum(['compact', 'roomy']),
      default: 'roomy',
      description: 'How close together the rows sit.',
      options: [
        { value: 'compact', description: 'Rows touch.' },
        { value: 'roomy', description: 'A line of space between rows.' },
      ],
    });
  },
};

const outline = () => {
  const host = createPluginHost();
  const loaded = host.tryActivate(demo);
  if (isErr(loaded)) throw new Error(loaded.error.map((item) => item.message).join(' '));
  return outlineOf(host.registry.configurations());
};

const one = (contribution: Parameters<typeof declaredSetting>[2]) =>
  outlineOf([declaredSetting('desktop', false, contribution)])[0];

describe('the outline of the declared settings', () => {
  it('carries a plugin setting under its prefixed key, with type and default', () => {
    expect(outline()[0]).toEqual({
      key: 'demo.fontSize',
      plugin: 'demo',
      description: 'The size of the text in the demo panel.',
      type: 'integer from 8 to 72',
      default: '14',
      options: [],
    });
  });

  it('keeps the options a plugin declared, sentences and all', () => {
    expect(outline()[1]?.options).toEqual([
      { value: 'compact', description: 'Rows touch.' },
      { value: 'roomy', description: 'A line of space between rows.' },
    ]);
    expect(outline()[1]?.default).toBe('"roomy"');
  });

  it("falls back to an enum's values and a boolean's two when none are declared", () => {
    expect(
      one({ id: 'style', schema: z.enum(['a', 'b']), default: 'a', description: 'x' })?.options,
    ).toEqual([
      { value: 'a', description: '' },
      { value: 'b', description: '' },
    ]);
    expect(
      one({ id: 'on', schema: z.boolean(), default: false, description: 'x' })?.options.map(
        (option) => option.value,
      ),
    ).toEqual([true, false]);
  });

  it('names a nullable string, a list and a record in words', () => {
    expect(
      one({ id: 'folder', schema: z.string().min(1).nullable(), default: null, description: '' })
        ?.type,
    ).toBe('string | null');
    expect(
      one({ id: 'items', schema: z.array(z.string()).readonly(), default: [], description: '' })
        ?.type,
    ).toBe('list of string');
    expect(
      one({ id: 'kinds', schema: z.record(z.string(), z.number()), default: {}, description: '' })
        ?.type,
    ).toBe('object');
  });

  it('outlines what one list entry and one object member may be', () => {
    const entry = z.enum(['left', 'right']);
    const list = one({
      id: 'sides',
      schema: z.array(entry),
      default: [],
      description: '',
      entries: { schema: entry, unique: true },
    });
    expect(list?.entries?.options.map((option) => option.value)).toEqual(['left', 'right']);

    const name = z.enum(['background', 'foreground']);
    const object = one({
      id: 'colors',
      schema: z.partialRecord(name, z.string()),
      default: {},
      description: '',
      members: {
        key: name,
        schema: z.string(),
        options: [{ value: 'background', description: 'The bar.' }],
      },
    });
    expect(object?.members?.options).toEqual([{ value: 'background', description: 'The bar.' }]);
  });

  it('still outlines a schema JSON Schema cannot describe', () => {
    const odd = one({
      id: 'odd',
      schema: z.custom<string>((value) => typeof value === 'string'),
      default: 'x',
      description: '',
    });
    expect(odd?.type).toBe('any');
  });

  it('refuses an option the setting’s own schema refuses', () => {
    expect(() =>
      declaredSetting('demo', true, {
        id: 'density',
        schema: z.enum(['compact', 'roomy']),
        default: 'roomy',
        description: '',
        options: [{ value: 'huge', description: 'Not a density.' }],
      }),
    ).toThrow(/offers "huge" as a value of the setting 'density'/u);
  });
});
