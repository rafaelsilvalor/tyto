import { describe, expect, it } from 'vitest';

import { artifactExtension, artifactMimeType, artifactName } from './artifact.js';

/**
 * The output folder is a contract (ADR 0011): Jacurutu reads `out/` and matches files to
 * what it asked for. So the naming is tested as a contract rather than as a detail.
 */

describe('artifactName', () => {
  it('is <artwork>-<format>.<ext>', () => {
    expect(artifactName('slide-2', 'story', 'png')).toBe('slide-2-story.png');
  });

  it('writes jpeg as .jpg, agreeing with the raster port', () => {
    expect(artifactName('artwork-1', 'feed', 'jpeg')).toBe('artwork-1-feed.jpg');
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

describe('artifact media types and extensions', () => {
  it.each([
    ['png', 'png', 'image/png'],
    ['jpeg', 'jpg', 'image/jpeg'],
    ['webp', 'webp', 'image/webp'],
    ['svg', 'svg', 'image/svg+xml'],
  ] as const)('%s is .%s and %s', (kind, extension, mime) => {
    expect(artifactExtension(kind)).toBe(extension);
    expect(artifactMimeType(kind)).toBe(mime);
  });
});
