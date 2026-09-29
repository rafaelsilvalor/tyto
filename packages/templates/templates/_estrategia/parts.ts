/**
 * Pieces the weekly mock-exam agenda draws in every brand's accent: the owl, the sign-off
 * and the grid's call to comment (TYTO-200).
 *
 * Each answers with a `Block`, so the composition places it without restating a number, and
 * every number is a token (ADR 0047).
 */

import { group, rect, run, solid, text } from '@tyto/core/template';
import { type Block, at, block, mark, naturalWidth, textBlock } from '@tyto/template-kit';

import { BALLOON, OWL } from './marks.js';
import { BOLD, CHROME, CTA, FACE, HANDLE_TRACKING, LIGHT, SIGN_OFF_BOX, TYPE } from './tokens.js';

import type { Brand } from './brands.js';
import type { RichText } from '@tyto/core';
import type { Measure } from '@tyto/template-kit';

/** The owl, in the brand's accent: the same geometry as Saúde's. */
export function owl(accent: string): Block {
  return mark(OWL, CHROME.owl, accent, 'owl');
}

/**
 * The bottom area's words, left-aligned on one line: the handle, tracked out and light, or
 * EC's note, bold.
 *
 * A token and not a slot, as Saúde's handle is: the account a piece is published from does
 * not change from week to week.
 */
export function signOff(brand: Brand, width: number): Block {
  const handle = brand.signOff.kind === 'handle';
  const words = text({
    name: handle ? 'handle' : 'note',
    runs: [
      run(brand.signOff.text, {
        font: FACE,
        size: handle ? TYPE.handle : TYPE.note,
        weight: handle ? LIGHT : BOLD,
        color: brand.accent,
      }),
    ],
    box: { w: width, h: SIGN_OFF_BOX },
    align: 'left',
    valign: 'top',
    ...(handle ? { letterSpacing: HANDLE_TRACKING } : {}),
  });
  return block(width, SIGN_OFF_BOX, group({ name: 'sign-off', children: [words] }));
}

/**
 * The call to comment: its words in an outlined pill as wide as they are, then the balloon.
 *
 * The words are the brief's `chamada` when it wrote one, and the house's line otherwise.
 *
 * The pill hugs its words, so it is measured; where nothing can measure it takes the width
 * it is offered, which is a guess the exporter's own layout may not agree with.
 */
export function callToComment(
  words: RichText,
  accent: string,
  width: number,
  measure: Measure,
): Block {
  const style = { font: FACE, size: TYPE.cta, weight: BOLD, color: accent };
  const balloonRoom = CTA.balloonGap + CTA.balloon;
  const natural = naturalWidth(words, style, measure);
  const pill =
    natural === undefined
      ? width - balloonRoom
      : Math.min(width - balloonRoom, natural + CTA.padding * 2);

  const glyph = mark(BALLOON, CTA.balloon, accent, 'balloon');
  return block(
    pill + balloonRoom,
    CTA.height,
    group({
      name: 'call-to-comment',
      children: [
        rect({
          name: 'cta-pill',
          size: { w: pill, h: CTA.height },
          radius: CTA.height / 2,
          stroke: { paint: solid(accent), width: CTA.stroke, align: 'inside' },
        }),
        textBlock(words, { w: pill, h: CTA.height }, style, {
          name: 'cta',
          align: 'center',
          valign: 'middle',
          overflow: 'shrink',
        }).draft,
        at(pill + CTA.balloonGap, (CTA.height - glyph.height) / 2, glyph),
      ],
    }),
  );
}
