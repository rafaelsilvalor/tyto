/**
 * Pieces only Estratégia Saúde draws: the owl header, the signed footer, the cover block.
 *
 * Each answers with a `Block` — a draft plus the width and height the IR cannot supply — so
 * that a template places it without restating a number. Every number is a token; a table is
 * not here, because a table is the kit's `pillTable` in one of `presets.ts`'s looks.
 */

import { group, image, run, text } from '@tyto/core/template';
import { type Block, at, block, mark, stack, textBlock } from '@tyto/template-kit';

import {
  ARROW,
  BAND,
  BLACK,
  CHROME,
  COVER,
  COVER_INK,
  FACE,
  HANDLE,
  INK,
  LIGHT,
  OWL,
  TYPE,
} from './tokens.js';

import type { AssetRef, RichText } from '@tyto/core';

/** The owl, top left of every slide. */
export function header(): Block {
  return mark(OWL, CHROME.owl, INK, 'owl');
}

/**
 * The handle, centred, and — while another slide follows — the arrow at the right edge.
 *
 * **The arrow says "there is a next slide", so the last slide has none** (the maintainer,
 * 2026-09-27). A single-slide artwork is its own last slide and has none either. The caller
 * answers the question from `context.artwork`, which is the only place that knows it.
 *
 * The handle is a token and not a slot: it is the account the carousel is published from,
 * it is the same on every slide of every week, and a slot would be one more thing for a
 * brief to fill in correctly every time.
 */
export function footer(width: number, options: { readonly next: boolean }): Block {
  const handle = text({
    name: 'handle',
    runs: [run(HANDLE, { font: FACE, size: TYPE.handle, weight: LIGHT, color: INK })],
    box: { w: width, h: BAND.footer },
    align: 'center',
    valign: 'middle',
    letterSpacing: CHROME.handleTracking,
  });

  if (!options.next)
    return block(width, BAND.footer, group({ name: 'footer', children: [handle] }));

  const glyph = mark(ARROW, CHROME.arrow, INK, 'arrow');
  return block(
    width,
    BAND.footer,
    group({
      name: 'footer',
      children: [handle, at(width - glyph.width, (BAND.footer - glyph.height) / 2, glyph)],
    }),
  );
}

/** Whether another slide follows this one — what the footer's arrow announces. */
export function hasNextSlide(artwork: { readonly index: number; readonly count: number }): boolean {
  return artwork.index < artwork.count - 1;
}

export interface CoverOptions {
  readonly titulo: RichText;
  /** The illustration over the words, when the brief supplied one. */
  readonly ilustracao?: AssetRef;
  readonly width: number;
  readonly size: number;
}

/**
 * The block on a carousel's first slide: the cover words, and a picture over them.
 *
 * The illustration is optional because it is an `image` slot, and an `image` slot the brief
 * left unset is simply absent from `context.slots`. A cover with words and no picture is
 * still a cover.
 */
export function cover(options: CoverOptions): Block {
  const words = textBlock(
    options.titulo,
    { w: options.width, h: Math.round(options.size * COVER.boxRatio) },
    { font: FACE, size: options.size, weight: BLACK, color: COVER_INK },
    { name: 'cover-title', lineHeight: COVER.lineHeight, align: 'center' },
  );

  if (options.ilustracao === undefined) return stack({ name: 'cover', items: [words] });

  const side = COVER.illustration;
  const illustration = block(
    side,
    side,
    image({
      name: 'illustration',
      asset: options.ilustracao,
      size: { w: side, h: side },
      fit: 'contain',
    }),
  );

  // Centred over the words, as the published slide sets it. A stack places its items at
  // x = 0, so the offset is a block of the full width with the picture inside it.
  const centred = block(
    options.width,
    side,
    group({ children: [at((options.width - side) / 2, 0, illustration)] }),
  );

  return stack({ name: 'cover', gap: COVER.illustrationGap, items: [centred, words] });
}
