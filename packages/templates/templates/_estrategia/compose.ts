/**
 * The weekly mock-exam agenda ("Simulados da semana"), composed once for three brands
 * (TYTO-200).
 *
 * `simulados-semana-ec`, `-ecj` and `-oab` are one piece in three accents, so each template's
 * `template.ts` is this function applied to its brand. The composition is here rather than
 * copied three times, and ESLint holds it to the same rule a `template.ts` is held to: every
 * number is a token.
 *
 * ## The slide, top to bottom
 *
 * | area   | what                                            | where                          |
 * | ------ | ----------------------------------------------- | ------------------------------ |
 * | top    | the owl, on the grid only                       | its top-left, on the gutter    |
 * | middle | the title, the days and their exams, and on the | centred on the page, both ways |
 * |        | last grid the call to comment                   |                                |
 * | bottom | the handle, or EC's note                        | its top-left, `SAFETY` below   |
 *
 * The top and bottom areas are whatever the middle leaves (the maintainer, 2026-09-28): the
 * middle is centred, and what stands in an area hugs it from the area's top. The middle is
 * left-aligned inside itself — title, days and rows share one left edge — and the block as a
 * whole is centred, so a wider title moves everything under it with it.
 *
 * The stories carry no owl, as none of the three references draws one there.
 */

import { frame, solid } from '@tyto/core/template';
import { type Block, at, grownTextBlock, naturalWidth, pillTable, stack } from '@tyto/template-kit';

import { CALL_TO_COMMENT } from './brands.js';
import { callToComment, owl, signOff } from './parts.js';
import { TITLE_LINE, TITLE_STYLE, examTable } from './presets.js';
import { CTA, EDGE, MARGIN, PAPER, SAFETY, TABLE, TITLE } from './tokens.js';

import type { Brand } from './brands.js';
import type { RichText, TemplateBuild, TemplateContext } from '@tyto/core';

/** The build for one brand's template. */
export function simuladosDaSemana(brand: Brand): TemplateBuild {
  return (context: TemplateContext) => {
    const story = context.format === 'story';
    const room = context.size.w - MARGIN * 2;

    const table = pillTable(examTable(brand.accent), {
      text: richTextOf(context, 'lamina') ?? [],
      width: TABLE.width,
      measure: context.measure,
    });

    // The call to comment closes the carousel, so only the last grid carries it.
    const lastGrid = !story && context.artwork.index === context.artwork.count - 1;
    const body = lastGrid
      ? stack({
          gap: CTA.gap,
          items: [table, callToComment(CALL_TO_COMMENT, brand.accent, room, context.measure)],
        })
      : table;

    const middle = stack({
      name: 'middle',
      gap: TITLE.gap,
      items: [...titleOf(context, room), body],
    });

    const chrome = story ? undefined : owl(brand.accent);
    const top = chrome === undefined ? EDGE.top : EDGE.top + chrome.height + SAFETY;
    const middleX = (context.size.w - middle.width) / 2;
    const middleY = Math.max(top, (context.size.h - middle.height) / 2);

    return frame({
      format: context.format,
      size: context.size,
      idPrefix: context.idPrefix,
      background: solid(PAPER),
      children: [
        ...(chrome === undefined ? [] : [at(MARGIN, EDGE.top, chrome)]),
        at(middleX, middleY, middle),
        at(MARGIN, middleY + middle.height + SAFETY, signOff(brand, room)),
      ],
    });
  };
}

/**
 * The title, as wide as its longest line and no wider than the room — past it, it wraps.
 *
 * A list of none or one, spread into the middle, so a brief with no title loses the gap too.
 */
function titleOf(context: TemplateContext, room: number): Block[] {
  const titulo = richTextOf(context, 'titulo');
  if (titulo === undefined) return [];

  const natural = naturalWidth(titulo, TITLE_STYLE, context.measure);
  const width = natural === undefined ? room : Math.min(room, natural);
  return [
    grownTextBlock(titulo, width, TITLE_LINE, TITLE_STYLE, context.measure, { name: 'title' }),
  ];
}

/** A rich-text slot's value, or nothing when the brief left it unset. */
function richTextOf(context: TemplateContext, name: string): RichText | undefined {
  const value = context.slots[name]?.value;
  return value?.kind === 'rich-text' ? value.text : undefined;
}
