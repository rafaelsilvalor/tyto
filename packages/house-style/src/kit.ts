/**
 * The brand kit's logo, wordmark and signature, or the placeholders where the kit leaves them
 * out (ADR 0065).
 *
 * Every template of the house reads its kit through these, so "what is drawn when no kit is
 * installed" and "which colour each tone of a toned mark takes" (ADR 0066) are decided once.
 */

import { group, isTonedMark, solid, vector } from '@tyto/core/template';
import { type Block, block, mark } from '@tyto/template-kit';

import { PLACEHOLDER_LOGO, PLACEHOLDER_SIGNATURE } from './marks.js';

import type { BrandKit, BrandMark, MaskRef } from '@tyto/core';

/**
 * The colour each tone of a kit's mark is drawn in. A one-shape mark is all `primary`, so
 * `primary` is the colour a one-colour logo was drawn in before marks had tones.
 */
export interface ToneInks {
  readonly primary: string;
  readonly secondary: string;
}

/** Both tones in one colour, for a place that draws the logo in a single ink. */
export function oneInk(ink: string): ToneInks {
  return { primary: ink, secondary: ink };
}

/**
 * A kit's mark drawn at a chosen height, each tone in its ink.
 *
 * A one-shape mark goes through template-kit's `mark()` exactly as it did before marks had
 * tones, so the placeholder — and a kit written for ADR 0063 — draws the same bytes. A toned
 * mark is a group of one vector per layer, each scaled as `mark()` scales its one.
 */
export function drawBrandMark(
  shape: BrandMark,
  height: number,
  inks: ToneInks,
  name: string,
): Block {
  if (!isTonedMark(shape)) return mark(shape, height, inks.primary, name);

  const scale = height / shape.box.h;
  return block(
    shape.box.w * scale,
    height,
    group({
      name,
      children: shape.layers.map((layer) =>
        vector({
          name: `${name}-${layer.tone}`,
          geometry: { kind: 'path', d: layer.d, fillRule: layer.fillRule },
          size: shape.box,
          fill: solid(inks[layer.tone]),
          transform: { scaleX: scale, scaleY: scale },
        }),
      ),
    }),
  );
}

/** The kit's logo, or the placeholder, drawn at a height. */
export function drawLogo(kit: BrandKit, height: number, inks: ToneInks): Block {
  return drawBrandMark(kit.logo ?? PLACEHOLDER_LOGO, height, inks, 'logo');
}

/**
 * The kit's accent, or the template's own (ADR 0155). The fallback is the colour the template
 * drew before kits carried colours, so a render without a kit keeps its bytes; a kit's accent
 * wins, so switching a configuration's brand switches its colour with its logo.
 */
export function accentOf(kit: BrandKit, fallback: string): string {
  return kit.colors?.accent ?? fallback;
}

/** The kit's signature, or the placeholder. */
export function signatureOf(kit: BrandKit): string {
  return kit.signature ?? PLACEHOLDER_SIGNATURE;
}

/** Where and how a kit's pattern is laid (ADR 0228). */
export interface PatternOptions {
  /** The area the tiles cover, from its top-left corner. */
  readonly size: { readonly w: number; readonly h: number };
  /** The width each tile is drawn at; its height follows the tile's proportions. */
  readonly tileWidth: number;
  readonly inks: ToneInks;
  /** The whole pattern's opacity, applied once, so where tiles overlap nothing darkens. */
  readonly opacity: number;
  /**
   * The shape the pattern is cut to — a node of the same frame, by its id, put on every
   * vector of every tile. Without one the last row and column of tiles run past the area.
   */
  readonly mask?: MaskRef;
}

/**
 * The kit's pattern laid over an area, or `undefined` when the kit has none (ADR 0228).
 *
 * No placeholder: a stand-in pattern would change every render without a kit, which ADR 0065
 * fixed, and no layout needs a pattern's room held. Each tile is a group of one vector per
 * layer, scaled as `drawBrandMark` scales a toned mark, so a stroke scales with its tile.
 */
export function drawPattern(kit: BrandKit, options: PatternOptions): Block | undefined {
  const pattern = kit.pattern;
  if (pattern === undefined) return undefined;

  const scale = options.tileWidth / pattern.tile.w;
  const tileHeight = pattern.tile.h * scale;
  const columns = Math.ceil(options.size.w / options.tileWidth);
  const rows = Math.ceil(options.size.h / tileHeight);

  const tiles = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push(
        group({
          name: `pattern-${String(row)}-${String(column)}`,
          transform: { x: column * options.tileWidth, y: row * tileHeight },
          children: pattern.layers.map((layer, index) => {
            const ink = solid(options.inks[layer.tone]);
            return vector({
              name: `pattern-${layer.tone}-${String(index)}`,
              geometry: {
                kind: 'path',
                d: layer.d,
                fillRule: 'fillRule' in layer ? layer.fillRule : 'nonzero',
              },
              size: pattern.tile,
              ...('stroke' in layer
                ? { stroke: { paint: ink, width: layer.stroke, align: 'center' as const } }
                : { fill: ink }),
              transform: { scaleX: scale, scaleY: scale },
              // On each vector, not on the group: a group has no box in the IR, and
              // export-html masks an element only inside its own box, so a masked group
              // draws nothing (measured 2026-11-22, TYTO-842). A vector's box is its size.
              ...(options.mask !== undefined ? { mask: options.mask } : {}),
            });
          }),
        }),
      );
    }
  }

  return block(
    options.size.w,
    options.size.h,
    group({
      name: 'pattern',
      opacity: options.opacity,
      children: tiles,
    }),
  );
}
