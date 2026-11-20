import { describe, expect, it } from 'vitest';

import { briefsToRecompile, fileNameOf } from './asset-redraw.js';

/** TYTO-741: the briefs whose preview compiles again when the open folder changes. */

const asked = new Map<string, readonly string[]>([
  ['capa', ['grafico.png', 'grafico.grid-1x1.png', 'grafico.story.png']],
  ['outra', ['./assets/logo.png']],
  ['sem-arte', []],
]);

describe('briefsToRecompile', () => {
  it("compiles a brief again when a format's copy of its art appears beside it", () => {
    expect(briefsToRecompile(asked, ['entrega/assets/grafico.story.png'])).toEqual(['capa']);
  });

  it('matches by file name whatever folder or separator the watcher names, and any case', () => {
    expect(briefsToRecompile(asked, ['assets\\LOGO.png'])).toEqual(['outra']);
  });

  it('compiles nothing for a file no brief asked for, nor for a guide written beside the art', () => {
    expect(briefsToRecompile(asked, ['assets/grafico.story.guide.psd', 'notas.txt'])).toEqual([]);
    expect(briefsToRecompile(asked, [])).toEqual([]);
  });

  it('compiles every brief that asked for a file when the burst names something it cannot', () => {
    expect(briefsToRecompile(asked, ['notas.txt', null])).toEqual(['capa', 'outra']);
  });
});

describe('fileNameOf', () => {
  it('reads both separators', () => {
    expect(fileNameOf('a/b\\C.png')).toBe('c.png');
    expect(fileNameOf('c.png')).toBe('c.png');
  });
});
