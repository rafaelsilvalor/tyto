import { describe, expect, it } from 'vitest';

import type { ListedEntry } from './command-completion.js';
import { GLOB_LIMIT, type ListFolder, expandGlob, isGlob } from './command-glob.js';

/**
 * Globs on the command panel's line (TYTO-535, ADR 0200): expanded over the explorer's listings,
 * inside the workspace only, never crossing a separator, never matching a leading dot.
 */

const folder = (name: string): ListedEntry => ({ name, kind: 'folder' });
const brief = (name: string): ListedEntry => ({ name, kind: 'brief' });
const file = (name: string): ListedEntry => ({ name, kind: 'file' });

const TREE: Record<string, ListedEntry[]> = {
  '': [
    brief('b.brief'),
    brief('a.brief'),
    file('notes.txt'),
    brief('.hidden.brief'),
    folder('sub'),
    folder('Other'),
  ],
  sub: [brief('c.brief'), folder('deep')],
  'sub/deep': [brief('d.brief')],
  Other: [brief('e.brief')],
};

/** Lists `TREE`, recording each folder asked for. */
function lister(asked: string[] = []): ListFolder {
  return (segments) => {
    asked.push(segments.join('/'));
    return Promise.resolve(TREE[segments.join('/')]);
  };
}

const expand = (pattern: string, options: { caseless?: boolean; base?: string[] } = {}) =>
  expandGlob(pattern, options.base ?? [], lister(), {
    caseless: options.caseless ?? false,
    folder: true,
  });

describe('expandGlob', () => {
  it('matches names in the working folder, in name order', async () => {
    expect(await expand('*.brief')).toEqual({ ok: true, words: ['a.brief', 'b.brief'] });
    expect(await expand('?.brief')).toEqual({ ok: true, words: ['a.brief', 'b.brief'] });
  });

  it('never matches a leading dot unless the pattern starts with one', async () => {
    expect(await expand('.*.brief')).toEqual({ ok: true, words: ['.hidden.brief'] });
  });

  it('walks folders a step at a time and keeps the separator typed', async () => {
    expect(await expand('*/*.brief')).toEqual({
      ok: true,
      words: ['Other/e.brief', 'sub/c.brief'],
    });
    expect(await expand('sub\\*.brief')).toEqual({ ok: true, words: ['sub\\c.brief'] });
  });

  it('never crosses a separator: * stays inside one name', async () => {
    expect(await expand('sub*')).toEqual({ ok: true, words: ['sub'] });
    expect(await expand('*d.brief')).toEqual({
      ok: false,
      problem: 'no-match',
      pattern: '*d.brief',
    });
  });

  it('compares names without case only where the platform does', async () => {
    expect(await expand('other/*')).toEqual({ ok: false, problem: 'no-match', pattern: 'other/*' });
    expect(await expand('other/*', { caseless: true })).toEqual({
      ok: true,
      words: ['Other/e.brief'],
    });
  });

  it('reads from the working folder, not from the workspace root', async () => {
    expect(await expand('*.brief', { base: ['sub'] })).toEqual({ ok: true, words: ['c.brief'] });
  });

  it('refuses a pattern that leads outside the workspace, listing nothing', async () => {
    for (const pattern of [
      '../*.brief',
      'sub/../../*',
      '/etc/*',
      'C:\\*',
      '\\\\server\\*',
      '~/*',
    ]) {
      const asked: string[] = [];
      expect(
        await expandGlob(pattern, [], lister(asked), { caseless: false, folder: true }),
        pattern,
      ).toEqual({ ok: false, problem: 'outside', pattern });
      expect(asked, pattern).toEqual([]);
    }
  });

  it('refuses with no folder open, and when nothing matches', async () => {
    expect(await expandGlob('*.brief', [], lister(), { caseless: false, folder: false })).toEqual({
      ok: false,
      problem: 'no-folder',
      pattern: '*.brief',
    });
    expect(await expand('*.recipe')).toEqual({
      ok: false,
      problem: 'no-match',
      pattern: '*.recipe',
    });
  });

  it('refuses a pattern that would become more than the limit', async () => {
    const many: ListFolder = () =>
      Promise.resolve(
        Array.from({ length: GLOB_LIMIT + 1 }, (_, index) => brief(`${index}.brief`)),
      );
    expect(await expandGlob('*', [], many, { caseless: false, folder: true })).toEqual({
      ok: false,
      problem: 'too-many',
      pattern: '*',
    });
  });

  it('tells a pattern from a word', () => {
    expect(isGlob('*.brief')).toBe(true);
    expect(isGlob('a?.brief')).toBe(true);
    expect(isGlob('a.brief')).toBe(false);
  });
});
