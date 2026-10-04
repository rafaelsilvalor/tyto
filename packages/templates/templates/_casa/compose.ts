/**
 * The weekly mock-exam agenda ("Simulados da semana"), composed once for three brands
 * (TYTO-200).
 *
 * `simulados-semana-roxo`, `-ocre` and `-vinho` are one piece in three accents, so each template's
 * `template.ts` is this function applied to its brand. The composition is here rather than
 * copied three times, and ESLint holds it to the same rule a `template.ts` is held to: every
 * number is a token.
 *
 * ## The slide, top to bottom
 *
 * | area   | what                                            | where                          |
 * | ------ | ----------------------------------------------- | ------------------------------ |
 * | top    | the logo, on the grid only                       | its top, on the middle's edge  |
 * | middle | the title, the days and their exams, and on the | centred on the page, both ways |
 * |        | last grid the call to comment                   |                                |
 * | bottom | the signature, or roxo's note                      | its top, on the middle's edge, |
 * |        |                                                 | `SAFETY` below the middle      |
 *
 * The top and bottom areas are whatever the middle leaves (the maintainer, 2026-09-28): the
 * middle is centred, and what stands in an area hugs it from the area's top. The middle is
 * left-aligned inside itself — title, days and rows share one left edge — and the block as a
 * whole is centred, so a wider title moves everything under it with it.
 *
 * **Everything shares the middle's left edge** (the maintainer, 2026-09-29, on the first real
 * art: "todos devem estar alinhados"): the logo above and the sign-off below start where the
 * title, the days and the call to comment start, so they move with the middle too.
 *
 * The stories carry no logo, as none of the three references draws one there.
 *
 * The last grid may close with the brief's `selo` glued to its foot (TYTO-201). The page then
 * shrinks by the seal's height before any of the above is placed, so the middle centres
 * above the seal and the sign-off follows it up (`sealed` in the kit, `sealOf` here).
 */

import { frame, solid } from '@tyto/core/template';
import {
  type Block,
  type Measure,
  at,
  grownTextBlock,
  naturalWidth,
  pillTable,
  reportOverflow,
  rowGroups,
  sealed,
  stack,
} from '@tyto/template-kit';

import { CALL_TO_COMMENT } from './brands.js';
import { callToComment, logo, signOff } from './parts.js';
import { EXAM_STYLE, TITLE_LINE, TITLE_STYLE, examTable } from './presets.js';
import { sealOf } from './seal.js';
import { CTA, EDGE, MARGIN, PAPER, SAFETY, TABLE, TITLE } from './tokens.js';

import type { Brand } from './brands.js';
import type { RichText, TemplateBuild, TemplateContext } from '@tyto/core';

/** The build for one brand's template. */
export function simuladosDaSemana(brand: Brand): TemplateBuild {
  return (context: TemplateContext) => {
    const story = context.format === 'story';
    const room = context.size.w - MARGIN * 2;

    const lamina = richTextOf(context, 'lamina') ?? [];
    const table = pillTable(examTable(brand.accent), {
      text: lamina,
      width: tableWidth(lamina, context.measure),
      measure: context.measure,
    });

    // The call to comment closes the carousel, so only the last grid carries it.
    const lastGrid = !story && context.artwork.index === context.artwork.count - 1;
    const body = lastGrid
      ? stack({
          gap: CTA.gap,
          items: [
            table,
            callToComment(
              richTextOf(context, 'chamada') ?? defaultCall(),
              brand.accent,
              room,
              context.measure,
            ),
          ],
        })
      : table;

    const middle = stack({
      name: 'middle',
      gap: TITLE.gap,
      items: [...titleOf(context, room), body],
    });

    const page = sealed(context.size, sealOf(context));
    const chrome = story ? undefined : logo(context.brand, brand.accent);
    const top = chrome === undefined ? EDGE.top : EDGE.top + chrome.height + SAFETY;
    const middleX = (page.size.w - middle.width) / 2;
    const middleY = Math.max(top, (page.size.h - middle.height) / 2);
    const signature = signOff(brand, context.brand, middle.width);
    const signatureY = middleY + middle.height + SAFETY;

    // One lamina feeds the grid and the story, and what fits the taller story can run off
    // the grid's foot (TYTO-202): the sign-off is the lowest thing drawn, and it must end on
    // the page — above the seal, when there is one.
    reportOverflow(context.report, signatureY + signature.height, page.size.h);

    return frame({
      format: context.format,
      size: context.size,
      idPrefix: context.idPrefix,
      background: solid(PAPER),
      children: [
        ...(chrome === undefined ? [] : [at(middleX, EDGE.top, chrome)]),
        at(middleX, middleY, middle),
        at(middleX, signatureY, signature),
        ...page.seal,
      ],
    });
  };
}

/**
 * The table's width: as wide as the slide's longest exam and its padding, never narrower than
 * `TABLE.width` nor wider than `TABLE.maxWidth`.
 *
 * Read from the exams only: a day and its schedule are shorter than any name in the
 * references. Where nothing can measure, the table keeps its least width.
 */
function tableWidth(lamina: RichText, measure: Measure): number {
  let widest: number = TABLE.width;
  // One field per exam and two per heading, as `examTable`'s caption reads them.
  for (const group of rowGroups(lamina, 1, true, 2)) {
    for (const [exam = []] of group.rows) {
      const natural = naturalWidth(exam, EXAM_STYLE, measure);
      if (natural === undefined) return TABLE.width;
      widest = Math.max(widest, natural + TABLE.padding * 2);
    }
  }
  return Math.min(TABLE.maxWidth, widest);
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

/** The house's call to comment, as the rich text a brief's `chamada` would have been. */
function defaultCall(): RichText {
  return [{ kind: 'text', value: CALL_TO_COMMENT, range: { start: 0, end: 0 } }];
}

/** A rich-text slot's value, or nothing when the brief left it unset. */
function richTextOf(context: TemplateContext, name: string): RichText | undefined {
  const value = context.slots[name]?.value;
  return value?.kind === 'rich-text' ? value.text : undefined;
}
