import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyChanges, englishOnlyPages, run, twinOf } from './docs-edition-pairs.mjs';

/** A runner that answers only the calls it was given, and throws on any other. */
function fakeRunner(answers) {
  return (args) => {
    const key = args.join(' ');
    if (!(key in answers)) throw new Error(`unexpected call: ${key}`);
    return answers[key];
  };
}

const SECTIONS = [
  "// ENGLISH_ONLY_PAGES is read by docs-sync: keep 'mentioned.md' out of it.",
  'export const ENGLISH_ONLY_PAGES: readonly string[] = [',
  "  'extend/template-authoring.md',",
  "  'extend/plugin-api.md',",
  '];',
  "export const OTHER = ['not/this.md'];",
].join('\n');

describe('englishOnlyPages', () => {
  it('reads the array of the declaration, not a comment that names it', () => {
    expect(englishOnlyPages(SECTIONS)).toEqual([
      'extend/template-authoring.md',
      'extend/plugin-api.md',
    ]);
  });

  it('fails loudly when the declaration is gone', () => {
    expect(() => englishOnlyPages('export const X = [];')).toThrow(/ENGLISH_ONLY_PAGES/u);
  });
});

describe('twinOf', () => {
  it('pairs an English page with its pt-BR twin, and back', () => {
    expect(twinOf('apps/docs/pages/guide/start.md')).toEqual({
      relative: 'guide/start.md',
      twin: 'apps/docs/pages/pt-BR/guide/start.md',
    });
    expect(twinOf('apps/docs/pages/pt-BR/guide/start.md')).toEqual({
      relative: 'guide/start.md',
      twin: 'apps/docs/pages/guide/start.md',
    });
  });

  it('skips public files', () => {
    expect(twinOf('apps/docs/pages/public/notes.md')).toBeUndefined();
  });
});

describe('classifyChanges', () => {
  const onDisk = new Set([
    'apps/docs/pages/a.md',
    'apps/docs/pages/pt-BR/a.md',
    'apps/docs/pages/b.md',
    'apps/docs/pages/pt-BR/b.md',
    'apps/docs/pages/new.md',
    'apps/docs/pages/pt-BR/kept.md',
    'apps/docs/pages/extend/plugin-api.md',
  ]);
  const lines = classifyChanges({
    changes: [
      { status: 'M', path: 'apps/docs/pages/a.md' },
      { status: 'M', path: 'apps/docs/pages/pt-BR/a.md' },
      { status: 'M', path: 'apps/docs/pages/pt-BR/b.md' },
      { status: 'A', path: 'apps/docs/pages/new.md' },
      { status: 'D', path: 'apps/docs/pages/kept.md' },
      { status: 'D', path: 'apps/docs/pages/gone.md' },
      { status: 'M', path: 'apps/docs/pages/extend/plugin-api.md' },
      { status: 'A', path: 'apps/docs/pages/public/x.md' },
    ],
    englishOnly: ['extend/plugin-api.md'],
    exists: (file) => onDisk.has(file),
  });

  it('flags each case the parity test misses or fails, and nothing for a pair deleted whole', () => {
    expect(lines).toEqual([
      'both editions (M): a.md',
      'both editions (M): a.md',
      'ONE EDITION (M): apps/docs/pages/pt-BR/b.md changed, apps/docs/pages/b.md did not: review (parity passes)',
      'MISSING HALF (A): apps/docs/pages/pt-BR/new.md does not exist: parity fails',
      'MISSING HALF (D): apps/docs/pages/kept.md deleted, apps/docs/pages/pt-BR/kept.md still exists: parity fails',
      'english-only guide (M): apps/docs/pages/extend/plugin-api.md',
    ]);
  });
});

describe('run', () => {
  for (const [name, pathFlavour, root] of [
    ['posix', path.posix, '/home/someone/tyto'],
    ['win32', path.win32, 'C:/work/tyto'],
  ]) {
    it(`reads committed, uncommitted and untracked pages from the root (${name})`, () => {
      const at = (file) => pathFlavour.join(root, ...file.split('/'));
      const disk = new Map([
        [at('apps/docs/src/sections.ts'), SECTIONS],
        [at('apps/docs/pages/guide/old.md'), ''],
        [at('apps/docs/pages/pt-BR/guide/old.md'), ''],
        [at('apps/docs/pages/guide/renamed.md'), ''],
        [at('apps/docs/pages/extend/template-authoring.md'), ''],
      ]);
      const git = fakeRunner({
        'rev-parse --show-toplevel': `${root}\n`,
        'diff --name-status origin/main -- apps/docs/pages':
          'M\tapps/docs/pages/guide/old.md\r\nR087\tapps/docs/pages/guide/before.md\tapps/docs/pages/guide/renamed.md\r\nM\tapps/docs/pages/logo.svg\r\n',
        'ls-files --others --exclude-standard -- apps/docs/pages':
          'apps/docs/pages/extend/template-authoring.md\n',
      });
      const printed = [];
      const code = run(
        { base: 'origin/main' },
        {
          git,
          files: { exists: (file) => disk.has(file), read: (file) => disk.get(file) ?? '' },
          pathFlavour,
          print: (line) => printed.push(line),
        },
      );
      expect(code).toBe(0);
      expect(printed).toEqual([
        'manual pages changed against origin/main, untracked included: 3',
        'ONE EDITION (M): apps/docs/pages/guide/old.md changed, apps/docs/pages/pt-BR/guide/old.md did not: review (parity passes)',
        'MISSING HALF (R): apps/docs/pages/pt-BR/guide/renamed.md does not exist: parity fails',
        'english-only guide (A): apps/docs/pages/extend/template-authoring.md',
      ]);
    });
  }
});
