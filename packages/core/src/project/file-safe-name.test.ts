import { describe, expect, it } from 'vitest';

import { fileSafeName } from './file-safe-name.js';

describe('fileSafeName', () => {
  it.each([
    ['a space', 'grid quadrado', 'grid-quadrado'],
    ['a slash', 'a/b', 'a-b'],
    ['a backslash', 'a\\b', 'a-b'],
    ['a colon', 'grid:4x5', 'grid-4x5'],
    ['a climb', '../../etc', 'etc'],
    ['a letter outside Latin', 'aula日本', 'aula-'],
    ['a symbol', 'preço €', 'preco-'],
  ])('collapses %s', (_label, part, expected) => {
    expect(fileSafeName(part)).toBe(expected);
  });

  it.each([
    ['Matemática', 'Matematica'],
    ['miniatura-vídeo', 'miniatura-video'],
    ['Português', 'Portugues'],
    ['AÇÃO', 'ACAO'],
    ['Ñandú', 'Nandu'],
    // Already decomposed, as macOS writes some names: the mark goes, the letter stays.
    ['Matema\u0301tica', 'Matematica'],
    ['Straße', 'Strasse'],
    ['Ærø', 'AEro'],
    ['cœur', 'coeur'],
    ['Łódź', 'Lodz'],
    ['Đakovo', 'Dakovo'],
  ])('keeps the base letter of %s', (part, expected) => {
    expect(fileSafeName(part)).toBe(expected);
  });

  it.each([
    ['CON', 'CON_'],
    ['con', 'con_'],
    ['Nul', 'Nul_'],
    ['PRN', 'PRN_'],
    ['aux', 'aux_'],
    ['COM1', 'COM1_'],
    ['lpt9', 'lpt9_'],
    ['con.brief', 'con_.brief'],
    ['CON.tar.gz', 'CON_.tar.gz'],
    // A reserved name reached only after sanitising is still reserved.
    ['.nul', 'nul_'],
    ['cón', 'con_'],
  ])('moves %s off a Windows device name', (part, expected) => {
    expect(fileSafeName(part)).toBe(expected);
  });

  it.each(['CONSOLE', 'COM0', 'COM10', 'LPT', 'icon', 'nul-01', 'auxiliar.brief'])(
    'leaves %s alone, which only looks like a device name',
    (part) => {
      expect(fileSafeName(part)).toBe(part);
    },
  );

  it.each([
    ['a.', 'a'],
    ['a...', 'a'],
    ['a ', 'a'],
    ['a. .', 'a'],
    ['aula 3. ', 'aula-3'],
    ['...', 'untitled'],
  ])('drops the trailing dots and spaces of %j, which Windows cannot create', (part, expected) => {
    expect(fileSafeName(part)).toBe(expected);
  });

  it('leaves names that were already safe byte for byte as they were', () => {
    const names = [
      'grid',
      'story',
      'grid-1x1',
      'feed_4x5',
      'Aula-1',
      'carrossel.v2',
      'A-Z_0-9',
      'untitled',
      'x',
    ];
    expect(names.map(fileSafeName)).toEqual(names);
  });

  it('never names a hidden file', () => {
    expect(fileSafeName('.tyto')).toBe('tyto');
  });

  it('names a part that sanitises away', () => {
    expect(fileSafeName('///')).toBe('untitled');
    expect(fileSafeName('')).toBe('untitled');
  });
});
