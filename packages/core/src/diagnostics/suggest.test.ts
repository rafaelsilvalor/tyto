import { describe, expect, it } from 'vitest';

import { didYouMean, editDistance } from './suggest.js';

/**
 * The budget is the whole behaviour worth testing. A suggestion that is wrong costs more
 * than no suggestion, so the tests here are mostly about what is *not* suggested.
 */

describe('editDistance', () => {
  it('is zero for the same word and one per edit', () => {
    expect(editDistance('titulo', 'titulo')).toBe(0);
    expect(editDistance('titulo', 'titlo')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('didYouMean', () => {
  it('finds a typo within a third of the word', () => {
    expect(didYouMean('titlo', ['titulo', 'subtitulo'])).toBe('titulo');
  });

  it('suggests nothing for a word that is simply different', () => {
    expect(didYouMean('rodape', ['titulo', 'imagem'])).toBeUndefined();
  });

  it('gives a short word a budget of one edit rather than none', () => {
    expect(didYouMean('wi', ['w', 'h'])).toBe('w');
    expect(didYouMean('xyz', ['w', 'h'])).toBeUndefined();
  });

  it('ignores case, because a manifest key and a typo may differ only in it', () => {
    expect(didYouMean('Titulo', ['titulo'])).toBe('titulo');
  });

  it('prefers the closest candidate when two are within budget', () => {
    expect(didYouMean('widt', ['width', 'widget'])).toBe('width');
  });

  it('suggests nothing when there is nothing to suggest', () => {
    expect(didYouMean('titulo', [])).toBeUndefined();
  });
});
