/**
 * `aprovados` — an exam's approved list on one slide.
 *
 * ## The slide, top to bottom
 *
 * | band   | what                                                   | drawn by                         |
 * | ------ | ------------------------------------------------------ | -------------------------------- |
 * | header | the owl                                                | `header()` — `_azul` |
 * | middle | emblem, kicker, subtitle, rule, the exam's name        | `titleBlock(resultTitle)`        |
 * |        | the approved, each specialty as wide as its longest name | `pillTable(approvedTable)`     |
 * | footer | the handle; no arrow, since no slide follows           | `footer()` — `_azul` |
 *
 * The second Azul template (TYTO-185), and the first written after the four layers of
 * ADR 0047: it draws nothing of its own. Every piece is the brand's or the kit's, and every
 * number the brand's tokens.
 */

import { frame, solid } from '@tyto/core/template';
import { bandedPage, pillTable, stack, titleBlock } from '@tyto/template-kit';

import { footer, hasNextSlide, header } from '../_azul/parts.js';
import { approvedTable, resultTitle } from '../_azul/presets.js';
import { APPROVED, BAND, EDGE, MARGIN, PAPER } from '../_azul/tokens.js';

import type { RichText, TemplateBuild, TemplateContext } from '@tyto/core';

export const build: TemplateBuild = (context: TemplateContext) => {
  const width = context.size.w - MARGIN * 2;

  const title = titleBlock(resultTitle, {
    width,
    fields: {
      emblema: imageOf(context, 'emblema'),
      chamada: richTextOf(context, 'chamada'),
      subtitulo: richTextOf(context, 'subtitulo'),
      titulo: richTextOf(context, 'titulo'),
    },
  });

  const list = pillTable(approvedTable, {
    text: richTextOf(context, 'lista') ?? [],
    width,
    measure: context.measure,
  });

  return frame({
    format: context.format,
    size: context.size,
    idPrefix: context.idPrefix,
    background: solid(PAPER),
    children: bandedPage({
      size: context.size,
      edges: { top: EDGE.top, bottom: EDGE.bottom, side: MARGIN },
      header: { item: header(), band: BAND.header },
      footer: footer(width, { next: hasNextSlide(context.artwork) }),
      middle: stack({ name: 'middle', gap: APPROVED.gap.table, items: [title, list] }),
    }),
  });
};

/** A rich-text slot's value, or nothing when the brief left it unset. */
function richTextOf(context: TemplateContext, name: string): RichText | undefined {
  const value = context.slots[name]?.value;
  return value?.kind === 'rich-text' ? value.text : undefined;
}

/** An image slot's asset, or nothing when the brief left it unset. */
function imageOf(context: TemplateContext, name: string) {
  const value = context.slots[name]?.value;
  return value?.kind === 'image' ? value.asset : undefined;
}
