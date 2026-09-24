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
 * It also keeps `core` pure, but conditionally, which is the part worth spelling out.
 * `create()` takes bytes, so nothing here opens a file and `fontkit.openSync` is the one
 * function this package may never call — that half is on this file. The other half is not:
 * fontkit ships two builds and its `exports` map picks between them by condition, and the
 * `node` one imports `fs`. Resolving that condition for a browser target is the only way
 * this package can end up with a Node dependency, and the decision lives in a bundler
 * config rather than here. ADR 0010 carries the rule; the same holds for `yaml`, and
 * `tools/repo-checks/src/pure-export-conditions.test.ts` is what measures both.
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

interface DescriptiveTables {
  readonly familyName?: unknown;
  readonly italicAngle?: unknown;
  readonly name?: { readonly records?: { readonly preferredFamily?: Record<string, string> } };
  readonly 'OS/2'?: {
    readonly usWeightClass?: unknown;
    readonly fsSelection?: { readonly italic?: boolean };
  };
}

/**
 * The face a font file holds, read from its own tables rather than from its file name.
 *
 * Here and not in `@tyto/fonts`, which reads installed files (ADR 0037) and is the one
 * package the desktop ships outside its bundle: a `fontkit` import there would be a module
 * the packaged app does not contain. `core` already bundles fontkit, and naming a face from
 * its bytes opens no file, so the adapter is handed this function instead of importing it.
 *
 * The preferred family (name ID 16) where there is one, because that is the family a type
 * designer groups weights under: CircularXX's Medium says `CircularXX Medium` in the legacy
 * family field and `CircularXX` in the preferred one. Italic is the slant *or* the flag,
 * because CircularStd sets the angle to -12 and leaves `fsSelection.italic` false. Both
 * measured on the maintainer's installed files for TYTO-182.
 */
export function describeFace(bytes: Uint8Array): FontFace | undefined {
  let parsed: unknown;
  try {
    parsed = createFont(bytes);
  } catch {
    return undefined;
  }
  if (!isFont(parsed)) return undefined;

  const tables = parsed as DescriptiveTables;
  const os2 = tables['OS/2'];
  const weight = os2?.usWeightClass;
  if (typeof tables.familyName !== 'string' || typeof weight !== 'number') return undefined;

  const preferred = tables.name?.records?.preferredFamily;
  const family = preferred?.en ?? Object.values(preferred ?? {})[0] ?? tables.familyName;
  const slanted = typeof tables.italicAngle === 'number' && tables.italicAngle !== 0;
  const italic = slanted || os2?.fsSelection?.italic === true;
  return { family, weight, style: italic ? 'italic' : 'normal' };
}
