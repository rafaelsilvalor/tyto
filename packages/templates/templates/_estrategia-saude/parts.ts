/**
 * Pieces only Estratégia Saúde draws: the owl header and the signed footer.
 *
 * Each answers with a `Block` — a draft plus the width and height the IR cannot supply — so
 * that a template places it without restating a number. Every number is a token; a table is
 * not here, nor a title block: those are the kit's components in `presets.ts`'s looks.
 */

import { group, run, text } from '@tyto/core/template';
import { type Block, at, block, mark } from '@tyto/template-kit';

import { ARROW, BAND, CHROME, FACE, HANDLE, INK, LIGHT, OWL, TYPE } from './tokens.js';

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
