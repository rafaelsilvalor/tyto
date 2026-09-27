import { describe, expect, it } from 'vitest';

import { artifactEncoding, artifactName } from './artifact.js';

/**
 * The output folder is a contract (ADR 0011): Jacurutu reads `out/` and matches files to
 * what it asked for. So the naming is tested as a contract rather than as a detail.
 */

describe('artifactName', () => {
  it('is <artwork>-<format>.<ext>', () => {
    expect(artifactName('slide-2', 'story', 'png')).toBe('slide-2-story.png');
  });

  it.each([
    ['a space', 'promo curso', 'promo-curso-feed.png'],
    ['a slash', 'a/b', 'a-b-feed.png'],
    ['a backslash', 'a\\b', 'a-b-feed.png'],
    ['an accent', 'matrícula', 'matr-cula-feed.png'],
    ['a colon', 'slide:1', 'slide-1-feed.png'],
  ])('collapses %s, because an artwork id is whatever the author typed', (_label, id, expected) => {
    expect(artifactName(id, 'feed', 'png')).toBe(expected);
  });

  it('refuses to produce a hidden file', () => {
    // `.slide-feed.png` would not show in a folder listing, and an artifact nobody can
    // see is an artifact nobody knows was produced.
    expect(artifactName('.slide', 'feed', 'png')).toBe('slide-feed.png');
  });

  it('names an id that sanitises away rather than producing "-feed.png"', () => {
    expect(artifactName('///', 'feed', 'svg')).toBe('untitled-feed.svg');
  });

  it('is stable, because result.json must not change between identical runs', () => {
    expect(artifactName('slide-1', 'feed', 'png')).toBe(artifactName('slide-1', 'feed', 'png'));
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
