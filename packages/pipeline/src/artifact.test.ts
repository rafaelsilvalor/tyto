import { describe, expect, it } from 'vitest';

import { artifactEncoding, artifactName, artworkNumber } from './artifact.js';

/**
 * The output folder is a contract (ADR 0011): Jacurutu reads `out/` and matches files to
 * what it asked for. So the naming is tested as a contract rather than as a detail.
 */

describe('artifactName', () => {
  it('is <format>-<NN>.<ext> (TYTO-197)', () => {
    expect(artifactName('story', '02', 'png')).toBe('story-02.png');
    expect(artifactName('grid-1x1', '01', 'svg')).toBe('grid-1x1-01.svg');
  });

  it.each([
    ['a space', 'grid quadrado', 'grid-quadrado-01.png'],
    ['a slash', 'a/b', 'a-b-01.png'],
    ['a backslash', 'a\\b', 'a-b-01.png'],
    ['an accent', 'miniatura-vídeo', 'miniatura-v-deo-01.png'],
    ['a colon', 'grid:4x5', 'grid-4x5-01.png'],
  ])('collapses %s, because a project names its formats', (_label, format, expected) => {
    expect(artifactName(format, '01', 'png')).toBe(expected);
  });

  it('refuses to produce a hidden file', () => {
    // `.grid-01.png` would not show in a folder listing, and an artifact nobody can
    // see is an artifact nobody knows was produced.
    expect(artifactName('.grid', '01', 'png')).toBe('grid-01.png');
  });

  it('names a format that sanitises away rather than producing "-01.png"', () => {
    expect(artifactName('///', '01', 'svg')).toBe('untitled-01.svg');
  });

  it('is stable, because result.json must not change between identical runs', () => {
    expect(artifactName('grid', '01', 'png')).toBe(artifactName('grid', '01', 'png'));
  });
});

describe('artworkNumber', () => {
  it('counts from one, in two digits', () => {
    expect([0, 1, 11].map((index) => artworkNumber(index, 12))).toEqual(['01', '02', '12']);
  });

  it('widens every number of a delivery together, once it passes 99', () => {
    expect([0, 99].map((index) => artworkNumber(index, 100))).toEqual(['001', '100']);
  });

  it('keeps two digits for a single artwork', () => {
    expect(artworkNumber(0, 1)).toBe('01');
  });
});

describe('artifactEncoding', () => {
  const RASTERIZED = { extension: 'html', mime: 'text/html', rasterized: true } as const;

  it.each([
    ['png', 'png', 'image/png'],
    ['jpeg', 'jpg', 'image/jpeg'],
    ['webp', 'webp', 'image/webp'],
  ] as const)(
    'a rasterized %s is .%s and %s, as the raster port writes it',
    (kind, extension, mime) => {
      expect(artifactEncoding(kind, RASTERIZED)).toEqual({ extension, mime });
    },
  );

  it('takes a document exporter at its word, including for a kind Tyto never shipped', () => {
    // The whole of TYTO-47's vocabulary change: `pdf` names no raster format and is not
    // `svg`, and the file is still called what its exporter says.
    expect(
      artifactEncoding('pdf', { extension: 'pdf', mime: 'application/pdf', rasterized: false }),
    ).toEqual({ extension: 'pdf', mime: 'application/pdf' });
    expect(
      artifactEncoding('svg', { extension: 'svg', mime: 'image/svg+xml', rasterized: false }),
    ).toEqual({ extension: 'svg', mime: 'image/svg+xml' });
  });

  it('has no answer for a rasterized kind no rasterizer encodes', () => {
    expect(artifactEncoding('gif', RASTERIZED)).toBeUndefined();
  });
});
