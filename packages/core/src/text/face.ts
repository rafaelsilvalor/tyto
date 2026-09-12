import * as fontkit from 'fontkit';

import type { FontFace, FontSource } from '../ports/font-source.js';

/**
 * A parsed face, reduced to the three questions layout asks it.
 *
 * fontkit rather than opentype.js because it shapes: `layout()` applies the font's own
 * kerning and ligature tables, which is what a browser does, and a width that ignores them
 * drifts a pixel or two per word. Measured against Chromium on the bundled Source Sans 3 at
 * 15px — "Turma nova" 74.25 against 74.25, "Inscrições abertas até o dia 30." 190.65
 * against 190.65625 — the difference is under a hundredth of a pixel, which is Chromium
 * rounding to its 1/64 LayoutUnit and not a disagreement about the glyphs.
 *
 * It also keeps `core` pure. fontkit publishes a browser build through its `exports` map
 * and `create()` takes bytes, so nothing here opens a file; `fontkit.openSync` is the one
 * function this package may never call.
 */

/**
 * `create` is typed as taking a Node `Buffer`, which a pure package has no types for and
 * fontkit does not actually require — it reads a `Uint8Array`. Narrowed here, once, rather
 * than cast at every call site.
 */
const createFont = fontkit.create as unknown as (bytes: Uint8Array) => unknown;

interface FontkitFont {
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  layout(text: string): { readonly advanceWidth: number };
}

function isFont(value: unknown): value is FontkitFont {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<FontkitFont>;
  return typeof candidate.unitsPerEm === 'number' && typeof candidate.layout === 'function';
}

export interface Face {
  /**
   * How far the pen moves across for `text` at one em, before letter spacing.
   *
   * In em units rather than pixels so a caller can try three sizes without three
   * shapings — which is exactly what `overflow: 'shrink'` does.
   */
  advance(text: string): number;
  /** Ascent plus descent, in em. The height of the glyph box, which is not the leading. */
  readonly contentHeight: number;
}

/**
 * Faces by family, weight and style, parsed once.
 *
 * A `Map` keyed on the same string the exporters key a `@font-face` on. Parsing Source Sans
 * 3 is about a millisecond and a scene asks for the same face once per run, so the cache is
 * about not doing it per word.
 */
export interface FaceCache {
  get(face: FontFace): Face | undefined;
}

function keyOf(face: FontFace): string {
  return `${face.family}|${String(face.weight)}|${face.style}`;
}

export function createFaceCache(fonts: FontSource): FaceCache {
  const faces = new Map<string, Face | undefined>();

  return {
    get(face: FontFace): Face | undefined {
      const key = keyOf(face);
      // `has` rather than a truthy check: a face nothing bundles caches as `undefined`,
      // and re-asking the port for it once per word would be the slow path.
      if (faces.has(key)) return faces.get(key);

      const built = build(fonts.outlines(face));
      faces.set(key, built);
      return built;
    },
  };
}

function build(bytes: Uint8Array | undefined): Face | undefined {
  if (bytes === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = createFont(bytes);
  } catch {
    // Bytes that are not a font are the caller's problem to notice, not a reason to take
    // the compile down: layout falls back to the lines the brief wrote, which is what
    // happens when there is no font at all.
    return undefined;
  }

  // A `.ttc` parses to a collection, which is a container and not a face. Nothing bundles
  // one today; refusing is better than picking its first font and measuring a stranger.
  if (!isFont(parsed)) return undefined;

  const font = parsed;
  const unitsPerEm = font.unitsPerEm;
  if (unitsPerEm <= 0) return undefined;

  const widths = new Map<string, number>();

  return {
    advance(text: string): number {
      const cached = widths.get(text);
      if (cached !== undefined) return cached;
      const advance = font.layout(text).advanceWidth / unitsPerEm;
      widths.set(text, advance);
      return advance;
    },
    // `descent` is negative in a font's own units, which is why this adds its magnitude.
    contentHeight: (font.ascent - font.descent) / unitsPerEm,
  };
}
