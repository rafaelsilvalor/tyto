import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BUILT_IN_FORMATS, BUILT_IN_PACK, REPOSITORY_ROOT } from './paths.ts';
import { UsageError, parseArguments, resolveTarget } from './target.ts';

describe('parseArguments', () => {
  it('reads a template and the options, and skips the `--` pnpm passes along', () => {
    expect(parseArguments(['--', 'agenda-semana', '--types', 'png,svg', '--port', '0'])).toEqual({
      template: 'agenda-semana',
      types: ['png', 'svg'],
      port: 0,
    });
  });

  it('refuses no template, two templates and an unknown option', () => {
    expect(() => parseArguments([])).toThrow(UsageError);
    expect(() => parseArguments(['a', 'b'])).toThrow(UsageError);
    expect(() => parseArguments(['a', '--host', '0.0.0.0'])).toThrow(/unknown option --host/);
  });
});

describe('resolveTarget', () => {
  it('finds a pack template by name, its first example and the pack formats', () => {
    const target = resolveTarget({ template: 'agenda-semana' }, REPOSITORY_ROOT);
    expect(target).toMatchObject({
      template: 'agenda-semana',
      brief: join(BUILT_IN_PACK, 'agenda-semana', 'examples', 'agenda.brief'),
      templates: BUILT_IN_PACK,
      formatsFile: BUILT_IN_FORMATS,
      types: ['png'],
      compiled: true,
    });
  });

  it('marks a markup template as needing no rebuild', () => {
    expect(resolveTarget({ template: 'promo-curso' }, REPOSITORY_ROOT).compiled).toBe(false);
  });

  it('refuses a name that is neither a folder nor in the pack', () => {
    expect(() => resolveTarget({ template: 'nope' }, REPOSITORY_ROOT)).toThrow(UsageError);
  });
});
