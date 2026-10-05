/**
 * Pieces only the azul brand draws: the logo header and the signed footer.
 *
 * **One position for every azul template** — the agenda's (the maintainer, 2026-09-27). The
 * approved list's reference set the logo and the signature a few pixels elsewhere; they are drawn
 * where the agenda draws them, so the chrome does not move between two slides of one feed.
 *
 * Each answers with a `Block` — a draft plus the width and height the IR cannot supply — so
 * that a template places it without restating a number. Every number is a token; a table is
 * not here, nor a title block: those are the kit's components in `presets.ts`'s looks.
 */

import { group, run, text } from '@tyto/core/template';
import { type Block, at, block, mark } from '@tyto/template-kit';

import { drawLogo, oneInk, signatureOf } from '../_casa/kit.js';

import { ARROW, BAND, CHROME, FACE, INK, LIGHT, TYPE } from './tokens.js';

import type { BrandKit } from '@tyto/core';

/** The brand kit's logo, or its placeholder, top left of every slide. */
export function header(kit: BrandKit): Block {
  return drawLogo(kit, CHROME.logo, oneInk(INK));
}

/**
 * The signature, centred, and — while another slide follows — the arrow at the right edge.
 *
 * **The arrow says "there is a next slide", so the last slide has none** (the maintainer,
 * 2026-09-27). A single-slide artwork is its own last slide and has none either. The caller
 * answers the question from `context.artwork`, which is the only place that knows it.
 *
 * The signature is the brand kit's, or its placeholder, and not a slot: it is the account the
 * carousel is published from, it is the same on every slide of every week, and a slot would
 * be one more thing for a brief to fill in correctly every time.
 */
export function footer(width: number, kit: BrandKit, options: { readonly next: boolean }): Block {
  const signature = text({
    name: 'signature',
    runs: [run(signatureOf(kit), { font: FACE, size: TYPE.signature, weight: LIGHT, color: INK })],
    box: { w: width, h: BAND.footer },
    align: 'center',
    valign: 'middle',
    letterSpacing: CHROME.signatureTracking,
  });

  if (!options.next)
    return block(width, BAND.footer, group({ name: 'footer', children: [signature] }));

  const glyph = mark(ARROW, CHROME.arrow, INK, 'arrow');
  return block(
    width,
    BAND.footer,
    group({
      name: 'footer',
      children: [signature, at(width - glyph.width, (BAND.footer - glyph.height) / 2, glyph)],
    }),
  );
}

/** Whether another slide follows this one — what the footer's arrow announces. */
export function hasNextSlide(artwork: { readonly index: number; readonly count: number }): boolean {
  return artwork.index < artwork.count - 1;
}
