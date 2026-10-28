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

import type { BrandKit, BrandMark } from '@tyto/core';

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

/** The kit's signature, or the placeholder. */
export function signatureOf(kit: BrandKit): string {
  return kit.signature ?? PLACEHOLDER_SIGNATURE;
}
