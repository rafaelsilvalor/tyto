/**
 * Pieces the weekly mock-exam agenda draws in every brand's accent: the logo, the sign-off
 * and the grid's call to comment (TYTO-200).
 *
 * Each answers with a `Block`, so the composition places it without restating a number, and
 * every number is a token (ADR 0047).
 */

import { group, rect, run, solid, text } from '@tyto/core/template';
import { type Block, at, block, mark, naturalWidth, textBlock } from '@tyto/template-kit';

import { drawLogo, oneInk, signatureOf } from './kit.js';
import { BALLOON } from './marks.js';
import {
  BOLD,
  CHROME,
  CTA,
  FACE,
  LIGHT,
  SIGNATURE_TRACKING,
  SIGN_OFF_BOX,
  TYPE,
} from './tokens.js';

import type { Brand } from './brands.js';
import type { BrandKit, RichText } from '@tyto/core';
import type { Measure } from '@tyto/template-kit';

/** The brand kit's logo, or its placeholder, in the brand's accent. */
export function logo(kit: BrandKit, accent: string): Block {
  return drawLogo(kit, CHROME.logo, oneInk(accent));
}

/**
 * The bottom area's words, left-aligned on one line: the brand kit's signature, tracked out
 * and light, or roxo's note, bold.
 *
 * Not a slot, as azul's signature is not: the account a piece is published from does not
 * change from week to week.
 */
export function signOff(brand: Brand, kit: BrandKit, width: number): Block {
  const signature = brand.signOff.kind === 'signature';
  const words = text({
    name: signature ? 'signature' : 'note',
    runs: [
      run(brand.signOff.kind === 'signature' ? signatureOf(kit) : brand.signOff.text, {
        font: FACE,
        size: signature ? TYPE.signature : TYPE.note,
        weight: signature ? LIGHT : BOLD,
        color: brand.accent,
      }),
    ],
    box: { w: width, h: SIGN_OFF_BOX },
    align: 'left',
    valign: 'top',
    ...(signature ? { letterSpacing: SIGNATURE_TRACKING } : {}),
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
