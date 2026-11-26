/**
 * Pieces the weekly mock-exam agenda draws in every brand's accent: the logo, the sign-off
 * and the grid's call to comment (TYTO-200).
 *
 * Each answers with a `Block`, so the composition places it without restating a number, and
 * every number is a token (ADR 0047).
 */

import { group, run, text } from '@tyto/core/template';
import {
  type Block,
  type ButtonStyle,
  block,
  buttonRow,
  mark,
  naturalWidth,
  textBlock,
} from '@tyto/template-kit';

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
 *
 * Drawn by the kit's `buttonRow` (TYTO-880): the pill is an outlined button whose words fill
 * it edge to edge, centred, so the width rule above stays the house's; the balloon is a second
 * button with no shape, `CTA.balloonGap` to its right and centred on its height.
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

  const bare: ButtonStyle = {
    height: CTA.height,
    radius: 0,
    padding: { left: 0, right: 0 },
    gap: 0,
  };
  return buttonRow(
    [
      {
        name: 'cta-pill',
        style: {
          ...bare,
          radius: CTA.height / 2,
          stroke: { color: accent, width: CTA.stroke },
        },
        words: textBlock(words, { w: pill, h: CTA.height }, style, {
          name: 'cta',
          align: 'center',
          valign: 'middle',
          overflow: 'shrink',
        }),
      },
      { name: 'cta-balloon', style: bare, leading: mark(BALLOON, CTA.balloon, accent, 'balloon') },
    ],
    { gap: CTA.balloonGap, name: 'call-to-comment' },
  );
}
