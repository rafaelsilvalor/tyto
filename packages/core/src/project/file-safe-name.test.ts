import { describe, expect, it } from 'vitest';

import { fileSafeName } from './file-safe-name.js';

describe('fileSafeName', () => {
  it.each([
    ['a space', 'grid quadrado', 'grid-quadrado'],
    ['a slash', 'a/b', 'a-b'],
    ['a backslash', 'a\\b', 'a-b'],
    ['an accent', 'miniatura-vídeo', 'miniatura-v-deo'],
    ['a colon', 'grid:4x5', 'grid-4x5'],
    ['a climb', '../../etc', 'etc'],
  ])('collapses %s', (_label, part, expected) => {
    expect(fileSafeName(part)).toBe(expected);
  });

  it('never names a hidden file', () => {
    expect(fileSafeName('.tyto')).toBe('tyto');
  });

  it('names a part that sanitises away', () => {
    expect(fileSafeName('///')).toBe('untitled');
    expect(fileSafeName('')).toBe('untitled');
  });
});
