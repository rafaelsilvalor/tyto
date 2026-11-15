import { describe, expect, it } from 'vitest';

import { type ListById, folderId, listedKindOf, stepsOf, walk } from './command-paths.js';

/** Paths typed for the command panel's file commands (TYTO-537, ADR 0201 decision 1). */

describe('reading a typed path into steps', () => {
  it('reads it from the working folder, skipping `.` and empty steps', () => {
    expect(stepsOf(['entregas'], 'novembro/./capa.brief')).toEqual({
      ok: true,
      steps: ['entregas', 'novembro', 'capa.brief'],
    });
    expect(stepsOf([], 'a\\b')).toEqual({ ok: true, steps: ['a', 'b'] });
    expect(stepsOf(['a'], '')).toEqual({ ok: true, steps: ['a'] });
  });

  it('lets `..` step back while it stays inside the workspace', () => {
    expect(stepsOf(['entregas', 'novembro'], '..')).toEqual({ ok: true, steps: ['entregas'] });
    expect(stepsOf(['entregas'], '../assets')).toEqual({ ok: true, steps: ['assets'] });
    expect(stepsOf(['a'], 'b/../../c')).toEqual({ ok: true, steps: ['c'] });
  });

  it.each([
    ['a `..` above the root', [], '..'],
    ['a `..` that climbs past it later', ['a'], '../../x'],
    ['an absolute path', [], '/etc/hosts'],
    ['a backslash root', [], '\\Windows'],
    ['a drive letter', ['a'], 'C:\\Users'],
    ['a drive letter with no separator', [], 'D:notes'],
    ['a network share', [], '\\\\server\\share'],
    ['the home folder', [], '~/notes'],
  ])('refuses %s', (_name, base, typed) => {
    expect(stepsOf(base, typed)).toEqual({ ok: false, problem: 'outside' });
  });
});

/** A workspace by the folder each id names, ids being the steps joined with `/`. */
const tree: Record<string, { name: string; kind: 'folder' | 'brief' | 'file' }[]> = {
  '': [
    { name: 'Entregas', kind: 'folder' },
    { name: 'capa.brief', kind: 'brief' },
  ],
  Entregas: [{ name: 'novembro', kind: 'folder' }],
  'Entregas/novembro': [{ name: 'notas.txt', kind: 'file' }],
};
const list: ListById = (entryId) => {
  const key = entryId ?? '';
  return Promise.resolve({
    entries: (tree[key] ?? []).map((entry) => ({
      ...entry,
      id: key === '' ? entry.name : `${key}/${entry.name}`,
    })),
    more: 0,
  });
};

describe('walking the steps through the listings', () => {
  it('finds a file and a folder by the id each listing gave it, with the name on disk', async () => {
    await expect(walk(['entregas', 'NOVEMBRO', 'notas.txt'], list, true)).resolves.toEqual({
      found: { kind: 'file', id: 'Entregas/novembro/notas.txt', name: 'notas.txt' },
      steps: ['Entregas', 'novembro', 'notas.txt'],
    });
    await expect(walk([], list, true)).resolves.toEqual({ found: { kind: 'root' }, steps: [] });
  });

  it('finds nothing for a missing step, a wrong case where case counts, or a file mid-path', async () => {
    await expect(walk(['nada'], list, true)).resolves.toBeUndefined();
    await expect(walk(['entregas'], list, false)).resolves.toBeUndefined();
    await expect(walk(['capa.brief', 'x'], list, true)).resolves.toBeUndefined();
  });

  it('answers a folder id only for a folder', async () => {
    await expect(folderId(['Entregas'], list, false)).resolves.toBe('Entregas');
    await expect(folderId([], list, false)).resolves.toBeNull();
    await expect(folderId(['capa.brief'], list, false)).resolves.toBeUndefined();
  });
});

describe('the kind ls shows', () => {
  it('tells a recipe from another file by its ending', () => {
    expect(listedKindOf({ name: 'semana.RECIPE', kind: 'file' })).toBe('recipe');
    expect(listedKindOf({ name: 'notas.txt', kind: 'file' })).toBe('file');
    expect(listedKindOf({ name: 'capa.brief', kind: 'brief' })).toBe('brief');
    expect(listedKindOf({ name: 'a.recipe', kind: 'folder' })).toBe('folder');
  });
});
