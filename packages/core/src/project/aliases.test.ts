import { describe, expect, it } from 'vitest';

import { sourceRange } from '../source/range.js';
import { aliasBodyProblem } from './aliases.js';
import { type ProjectLayer, resolveProject } from './project.js';

/** The command panel's `aliases` key (TYTO-536, ADR 0112 note of 2026-11-15). */

function sheet(
  kind: ProjectLayer['kind'],
  aliases: unknown,
  trust: ProjectLayer['trust'] = 'trusted',
): ProjectLayer {
  return {
    kind,
    root: kind === 'folder' ? '/work/promo' : '/home/me/.tyto/profiles/saude',
    trust,
    entries: [{ key: 'aliases', value: aliases, keyRange: sourceRange(0, 9) }],
  };
}

const codes = (rows: readonly { readonly code: string }[] | undefined): string[] =>
  (rows ?? []).map((row) => row.code);

describe('the aliases key', () => {
  it('is read from a trusted sheet, in name order, with the sheet it came from', () => {
    const project = resolveProject([
      sheet('folder', { entrega: 'render --delivery', check: 'validate *.brief' }),
    ]);
    expect(project.aliases).toEqual([
      { name: 'check', body: 'validate *.brief', origin: 'folder' },
      { name: 'entrega', body: 'render --delivery', origin: 'folder' },
    ]);
    expect(project.diagnostics).toEqual([[]]);
  });

  it('merges one alias at a time, the folder winning over the profile', () => {
    const project = resolveProject([
      sheet('profile', { entrega: 'render --delivery', check: 'validate' }),
      sheet('folder', { entrega: 'render --delivery --formats png' }),
    ]);
    expect(project.aliases).toEqual([
      { name: 'check', body: 'validate', origin: 'profile' },
      { name: 'entrega', body: 'render --delivery --formats png', origin: 'folder' },
    ]);
  });

  it('is withheld whole from a restricted sheet, and says which', () => {
    const project = resolveProject([
      sheet('profile', { check: 'validate' }),
      sheet('folder', { entrega: 'render', check: 'render --trust' }, 'restricted'),
    ]);
    expect(project.aliases).toEqual([{ name: 'check', body: 'validate', origin: 'profile' }]);
    expect(codes(project.diagnostics[1])).toEqual(['W_PROJECT_ALIASES_WITHHELD']);
    expect(project.diagnostics[1]?.[0]?.message).toContain('entrega, check');
  });

  it('refuses a name or a body the panel could not type, costing that alias alone', () => {
    const project = resolveProject([
      sheet('folder', {
        '9lives': 'render',
        'two words': 'render',
        ok: 'render',
        empty: '  ',
        lines: 'render\nrm x',
        number: 3,
      }),
    ]);
    expect(project.aliases.map((alias) => alias.name)).toEqual(['ok']);
    expect(codes(project.diagnostics[0])).toEqual(Array(5).fill('W_PROJECT_KEY_INVALID'));
  });

  it('refuses a value that is not an object', () => {
    const project = resolveProject([sheet('folder', ['render'])]);
    expect(project.aliases).toEqual([]);
    expect(codes(project.diagnostics[0])).toEqual(['W_PROJECT_KEY_INVALID']);
  });

  it('measures a body by length', () => {
    expect(aliasBodyProblem('x'.repeat(1000))).toBeUndefined();
    expect(aliasBodyProblem('x'.repeat(1001))).toContain('longer');
  });
});
