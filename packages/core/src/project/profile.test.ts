import { describe, expect, it } from 'vitest';

import { sourceRange } from '../source/range.js';
import { isPathShaped, problemWithName, profileReferenceOf } from './profile.js';
import type { ProjectLayer } from './project.js';

function folder(
  profile: unknown,
  trust: ProjectLayer['trust'] = 'trusted',
  root = '/work/promo',
): ProjectLayer {
  return {
    kind: 'folder',
    root,
    trust,
    entries: [
      {
        key: 'profile',
        value: profile,
        keyRange: sourceRange(2, 11),
        valueRange: sourceRange(13, 20),
      },
    ],
  };
}

function codes(read: { readonly diagnostics: readonly { readonly code: string }[] }): string[] {
  return read.diagnostics.map((item) => item.code);
}

describe('profileReferenceOf', () => {
  it('reads nothing from a sheet with no profile key', () => {
    expect(
      profileReferenceOf({ kind: 'folder', root: '/work', trust: 'trusted', entries: [] }),
    ).toEqual({ reference: undefined, diagnostics: [] });
  });

  it('reads a bare word as a name, and keeps where it was written', () => {
    const read = profileReferenceOf(folder('Saúde'));
    expect(read.reference).toEqual({
      kind: 'name',
      name: 'Saúde',
      written: 'Saúde',
      range: sourceRange(13, 20),
    });
    expect(codes(read)).toEqual([]);
  });

  it('reads anything with a separator or a .json ending as a path, against the folder', () => {
    expect(profileReferenceOf(folder('../team/saude.json')).reference).toMatchObject({
      kind: 'path',
      path: '/work/team/saude.json',
    });
    expect(profileReferenceOf(folder('saude.json')).reference).toMatchObject({
      kind: 'path',
      path: '/work/promo/saude.json',
    });
    expect(
      profileReferenceOf(folder('brand\\profile.json', 'trusted', 'D:\\work')).reference,
    ).toMatchObject({ kind: 'path', path: 'D:\\work\\brand\\profile.json' });
  });

  it('lets a restricted folder name a profile file inside itself', () => {
    expect(profileReferenceOf(folder('brand/profile.json', 'restricted')).reference).toMatchObject({
      kind: 'path',
      path: '/work/promo/brand/profile.json',
    });
  });

  it('refuses a restricted folder a profile path that leads outside it (ADR 0111)', () => {
    for (const written of ['../team/saude.json', '/srv/team/saude.json']) {
      const read = profileReferenceOf(folder(written, 'restricted'));
      expect(read.reference).toBeUndefined();
      expect(codes(read)).toEqual(['W_PROJECT_PATH_OUTSIDE']);
      expect(read.diagnostics[0]?.message).toContain(written);
      expect(read.diagnostics[0]?.range).toEqual(sourceRange(13, 20));
    }
  });

  it('still lets a restricted folder name a profile kept in TYTO_HOME', () => {
    expect(profileReferenceOf(folder('saude', 'restricted')).reference).toMatchObject({
      kind: 'name',
      name: 'saude',
    });
  });

  it('refuses a value that is neither a name nor a path, at the value', () => {
    for (const value of [3, '', '   ', ['saude'], null]) {
      const read = profileReferenceOf(folder(value));
      expect(read.reference).toBeUndefined();
      expect(codes(read)).toEqual(['W_PROJECT_PROFILE_INVALID']);
      expect(read.diagnostics[0]?.range).toEqual(sourceRange(13, 20));
    }
  });

  it('refuses a name that could leave TYTO_HOME/profiles or that Windows cannot hold', () => {
    const names = ['.hidden', '..', 'a..b', 'CON', 'nul.txt', 'com1', 'a:b', 'x?', 'end.'];
    for (const name of [...names, 'tab\tname']) {
      const read = profileReferenceOf(folder(name));
      expect({ name, codes: codes(read) }).toEqual({
        name,
        codes: ['W_PROJECT_PROFILE_INVALID'],
      });
    }
  });

  it('reads the last profile key when the file repeats it, as the other keys are read', () => {
    const layer = folder('first');
    const read = profileReferenceOf({
      ...layer,
      entries: [...layer.entries, { key: 'profile', value: 'second' }],
    });
    expect(read.reference).toMatchObject({ name: 'second' });
  });
});

describe('isPathShaped and problemWithName', () => {
  it('tells a name from a path', () => {
    expect(isPathShaped('saude')).toBe(false);
    expect(isPathShaped('Saúde Concursos')).toBe(false);
    expect(isPathShaped('saude.JSON')).toBe(true);
    expect(isPathShaped('team/saude')).toBe(true);
    expect(isPathShaped('team\\saude')).toBe(true);
  });

  it('accepts ordinary names, accents and spaces included', () => {
    for (const name of [
      'saude',
      'Saúde',
      'carreira-juridica',
      'OAB 2026',
      'con-curso',
      'console',
    ]) {
      expect({ name, problem: problemWithName(name) }).toEqual({ name, problem: undefined });
    }
  });

  it('refuses a name longer than 64 characters', () => {
    expect(problemWithName('a'.repeat(64))).toBeUndefined();
    expect(problemWithName('a'.repeat(65))).toContain('64');
  });
});
