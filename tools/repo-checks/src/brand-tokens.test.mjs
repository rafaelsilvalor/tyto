import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { digest, findIn, loadHashes, scanRepository, subpathsOf } from './brand-tokens.mjs';

/**
 * Brand content stays out of the public tree (ADR 0065). The list holds digests only, so the
 * cases below hash invented stand-ins of the same shapes — a joined handle, a two-word name, a
 * logo's subpaths — rather than quote what the real list holds.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const HASHES = loadHashes(fileURLToPath(new URL('./brand-token-hashes.json', import.meta.url)));

/** A drawing nobody owns: two rounded squares, each subpath past the minimum length. */
const INVENTED_PATH =
  'M10.5,20.25c4.5,0,8.25,3.75,8.25,8.25v30.5c0,4.5-3.75,8.25-8.25,8.25H2.5Z' +
  'M60.5,20.25c4.5,0,8.25,3.75,8.25,8.25v30.5c0,4.5-3.75,8.25-8.25,8.25H52.5Z';

const STAND_INS = new Map([
  [digest('lojadeteste'), 'word'],
  [digest('loja teste'), 'word'],
  ...subpathsOf(INVENTED_PATH).map((subpath) => [digest(subpath), 'path']),
]);

describe('the tracked tree', () => {
  it('holds no listed brand token', () => {
    expect(scanRepository(repoRoot, HASHES)).toEqual([]);
  });

  it('is compared against a list that is not empty', () => {
    // An empty or unreadable list would make the test above pass on any tree.
    expect([...HASHES.values()].filter((kind) => kind === 'word').length).toBeGreaterThan(0);
    expect([...HASHES.values()].filter((kind) => kind === 'path').length).toBeGreaterThan(0);
  });
});

describe('a word', () => {
  it.each([
    ['a handle', 'signed @lojadeteste below', 1],
    ['a handle in capitals, with an accent', 'signed @LÔJADETESTE', 1],
    ['a two-word name', 'made by Loja Teste', 1],
    ['a two-word name across a line break', 'made by Loja\nTeste', 1],
    ['a two-word name in a hyphenated id', 'template: semana-loja-teste', 1],
    ['a two-word name in camelCase', 'const lojaTeste = 1;', 1],
  ])('finds %s', (_case, text, line) => {
    expect(findIn(text, STAND_INS)).toEqual([{ line, kind: 'word' }]);
  });

  it('leaves each word of a two-word name alone when the other is not beside it', () => {
    // A listed name made of common words must not catch the words: "a loja" and "um teste"
    // are any sentence's.
    expect(findIn('a loja abriu e o teste passou', STAND_INS)).toEqual([]);
  });
});

describe('the real list', () => {
  it('lets the common noun "estratégia" through on its own', () => {
    // The company's name is also Portuguese for "strategy", so it is listed only inside its
    // compound forms and handles, never alone.
    expect(findIn('Uma estratégia de estudo para a semana.\nEstratégia nova.', HASHES)).toEqual([]);
  });
});

describe('path data', () => {
  it('finds a logo joined into one d', () => {
    expect(findIn(`d="${INVENTED_PATH}"`, STAND_INS)).toEqual([
      { line: 1, kind: 'path' },
      { line: 1, kind: 'path' },
    ]);
  });

  it('finds a logo split across string literals, one subpath per line', () => {
    const [first, second] = INVENTED_PATH.split(/(?=M)/);
    expect(findIn(`d:\n  '${first}' +\n  '${second}',`, STAND_INS)).toEqual([
      { line: 2, kind: 'path' },
      { line: 3, kind: 'path' },
    ]);
  });

  it('finds a logo written with spaces where the list was made with commas', () => {
    const spaced = INVENTED_PATH.replaceAll(',', ' ').replace(/([A-Za-z])/g, ' $1 ');
    expect(findIn(spaced, STAND_INS)).toHaveLength(2);
  });

  it('does not find a different drawing', () => {
    expect(findIn(INVENTED_PATH.replaceAll('8.25', '8.5'), STAND_INS)).toEqual([]);
  });
});
