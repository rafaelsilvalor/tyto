import { describe, expect, it } from 'vitest';

import { GAP_ASSET_URI, GAP_COLOR, GAP_MARK_SVG, gapStampNode, gapStampWidth } from './gap.js';
import { parseScene } from './scene.js';

/**
 * The mark is a failure signal, so what has to be true of it is not how it looks but that
 * it cannot fail on its own: it has to survive being put in an HTML attribute, a CSS
 * `url()` and an XML attribute, it has to be IR `parseScene` accepts, and it must not drag
 * a font or an asset into a scene that is already short of something.
 */

describe('the gap mark as a URI', () => {
  it('carries nothing an attribute or a url() would have to escape again', () => {
    // The three destinations, in the three languages: `<img src="…">`, `url("…")` and
    // `href="…"`. A quote, an angle bracket or a `#` in any of them ends the value early
    // and the mark becomes a broken document instead of a warning.
    expect(GAP_ASSET_URI.startsWith('data:image/svg+xml,')).toBe(true);
    for (const character of ['"', "'", '<', '>', '#', '&', ' ']) {
      expect(GAP_ASSET_URI).not.toContain(character);
    }
  });

  it('decodes back to the markup it was made from', () => {
    expect(decodeURIComponent(GAP_ASSET_URI.slice('data:image/svg+xml,'.length))).toBe(
      GAP_MARK_SVG,
    );
  });

  it('states a viewBox and refuses to preserve the ratio, so it fits any box it is given', () => {
    // The box it is dropped into is whatever the node declared, and a marker letterboxed
    // inside it would leave part of the hole undrawn.
    expect(GAP_MARK_SVG).toContain('viewBox="0 0 64 64"');
    expect(GAP_MARK_SVG).toContain('preserveAspectRatio="none"');
  });

  it('draws no text, because a face it cannot resolve is a marker that disappears', () => {
    expect(GAP_MARK_SVG).not.toContain('<text');
    expect(GAP_MARK_SVG).not.toContain('font');
  });
});

describe('the stamp on a frame', () => {
  it('scales with the frame and never goes below the floor', () => {
    expect(gapStampWidth({ w: 1080, h: 1080 })).toBe(18);
    expect(gapStampWidth({ w: 1080, h: 1920 })).toBe(18);
    expect(gapStampWidth({ w: 2160, h: 2160 })).toBe(36);
    // A thumbnail would get a hairline from the ratio alone, and a hairline is not a
    // warning anybody sees.
    expect(gapStampWidth({ w: 64, h: 64 })).toBe(4);
  });

  it('is IR that parseScene accepts, on its own, with no font and no asset', () => {
    const scene = parseScene({
      version: 1,
      fonts: [],
      assets: [],
      artworks: [
        {
          id: 'a',
          frames: [
            {
              format: 'feed',
              size: { w: 1080, h: 1080 },
              children: [gapStampNode('a.feed.gap', { w: 1080, h: 1080 })],
            },
          ],
        },
      ],
    });

    expect(scene.ok).toBe(true);
  });

  it('is an inside-aligned stroke, so the band cannot push the artwork out of the frame', () => {
    const stamp = gapStampNode('a.feed.gap', { w: 1080, h: 1080 });

    expect(stamp.stroke).toEqual({
      paint: { kind: 'solid', color: GAP_COLOR },
      width: 18,
      align: 'inside',
    });
    expect(stamp.fill).toBeUndefined();
    expect(stamp.size).toEqual({ w: 1080, h: 1080 });
  });
});
