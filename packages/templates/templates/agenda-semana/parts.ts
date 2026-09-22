/**
 * Layer 2 of `docs/template-conventions.md`: functions that return a drawn piece.
 *
 * Each one answers with a `Block` — a draft plus the width and height the IR cannot supply
 * — so that `stack` and `row` can place it without anybody restating a number.
 *
 * Nothing here is exported to another template yet, and that is deliberate: the convention
 * says a part moves into a shared module when the **second** template needs it, not in
 * advance. They are split out of `template.ts` anyway, because the point of the split is
 * that the template file reads as composition.
 */

import { group, image, rect, run, runsOf, solid, text, vector } from '@tyto/core/template';
import { type Block, at, block, row, stack } from '@tyto/template-kit';

import {
  ARROW,
  BOLD,
  FACE,
  GAP,
  HANDLE,
  INK,
  type Mark,
  ON_INK,
  OWL,
  PILL,
  PILL_INK,
  RADIUS,
  REGULAR,
  TYPE,
} from './tokens.js';

import type { AssetRef, RichText, TextRun } from '@tyto/core';
import type { NonEmpty, TextOptions } from '@tyto/core/template';

/* ---------------------------------------------------------------------------- type -- */

/**
 * At least one run, or nothing.
 *
 * `text()` takes `NonEmpty<TextRun>` because a text node with no runs is
 * `E_SCENE_EMPTY_TEXT` — the SDK makes it unwritable rather than diagnosable. A brief can
 * still leave a field empty, so somebody has to turn "no runs" into "no node", and this is
 * the narrowing that lets the compiler check that it happened.
 */
function atLeastOne(runs: readonly TextRun[]): NonEmpty<TextRun> | undefined {
  const [first, ...rest] = runs;
  return first === undefined ? undefined : [first, ...rest];
}

/**
 * A text block of a stated size, or the same space drawn empty.
 *
 * The size is stated either way, which is what keeps a row of four sessions the same shape
 * when one of them has no professor yet. An empty group is a transform and a list, so it
 * costs one node and paints nothing.
 */
function label(
  value: RichText,
  size: { readonly w: number; readonly h: number },
  style: { readonly size: number; readonly weight: number; readonly color: string },
  options: Omit<TextOptions, 'runs' | 'box'> = {},
): Block {
  const runs = atLeastOne(
    runsOf(value, { font: FACE, size: style.size, weight: style.weight, color: style.color }),
  );

  if (runs === undefined) return block(size.w, size.h, group({ children: [] }));

  return block(size.w, size.h, text({ ...options, runs, box: { w: size.w, h: size.h } }));
}

/* --------------------------------------------------------------------------- marks -- */

/**
 * A mark drawn at a chosen height, in a chosen colour.
 *
 * **`size` is the box the `d` was drawn in, not the size it appears at.** A path vector's
 * `size` is its viewport: `export-html` emits `<svg width=size.w viewBox="0 0 size.w
 * size.h">`, so geometry outside that box is clipped, and `export-svg` emits the `d` raw
 * into the node's own transform. Passing the *drawn* size here clips a 120-unit owl at 77
 * units, which is a silhouette with its right side sliced off and no diagnostic anywhere.
 *
 * The scale is therefore a transform, which composes as translate-then-scale about an
 * anchor of `(0, 0)` (`packages/core/src/scene/matrix.ts`) — so the coordinate a caller
 * placed the block at stays exactly where they put it.
 */
export function mark(shape: Mark, height: number, fill: string, name: string): Block {
  const scale = height / shape.box.h;

  return block(
    shape.box.w * scale,
    height,
    vector({
      name,
      geometry: { kind: 'path', d: shape.d, fillRule: shape.fillRule },
      size: shape.box,
      fill: solid(fill),
      transform: { scaleX: scale, scaleY: scale },
    }),
  );
}

/* ----------------------------------------------------------------------- the chrome -- */

/** The owl, top left of every slide. */
export function header(): Block {
  return mark(OWL, 96, INK, 'owl');
}

/**
 * The handle and the arrow that points at it, bottom left of every slide.
 *
 * The handle is a token and not a slot: it is the account the carousel is published from,
 * it is the same on every slide of every week, and a slot would be one more thing for a
 * brief to fill in correctly every time.
 */
export function footer(): Block {
  const glyph = mark(ARROW, 30, INK, 'arrow');
  const handle = block(
    280,
    38,
    text({
      name: 'handle',
      runs: [run(HANDLE, { font: FACE, size: TYPE.handle, weight: BOLD, color: INK })],
      box: { w: 280, h: 38 },
      valign: 'middle',
    }),
  );

  return row({ name: 'footer', gap: 12, align: 'center', items: [glyph, handle] });
}

/* ------------------------------------------------------------------------ the cover -- */

export interface CoverOptions {
  readonly titulo: RichText;
  /** The calendar illustration, when the brief supplied one. */
  readonly ilustracao?: AssetRef;
  readonly width: number;
  readonly size: number;
}

/**
 * The block that appears on the first slide and on no other.
 *
 * The illustration is optional because it is an `image` slot, and an `image` slot the brief
 * left unset is simply absent from `context.slots`. A cover with words and no picture is
 * still a cover; a template that required one would refuse a brief that is otherwise
 * complete, over artwork that does not change from week to week.
 */
export function cover(options: CoverOptions): Block {
  const height = Math.round(options.size * 1.3);
  const words = label(
    options.titulo,
    { w: options.width, h: height },
    { size: options.size, weight: BOLD, color: INK },
    { name: 'cover-title', lineHeight: 1.05 },
  );

  if (options.ilustracao === undefined) return stack({ name: 'cover', items: [words] });

  const illustration = block(
    ILLUSTRATION,
    ILLUSTRATION,
    image({
      name: 'calendar',
      asset: options.ilustracao,
      size: { w: ILLUSTRATION, h: ILLUSTRATION },
      fit: 'contain',
    }),
  );

  return stack({ name: 'cover', gap: 24, items: [illustration, words] });
}

const ILLUSTRATION = 220;

/* ---------------------------------------------------------------------- a discipline -- */

/** One session of a discipline: a date, a title and whoever gives it. */
export interface Session {
  readonly data: RichText;
  readonly titulo: RichText;
  readonly professor: RichText;
}

/** The pill sizes. Both rows are one height, which is the wall `sessionPill` describes. */
const DATE = { w: 132, h: 96 } as const;

/** Room between the grey pill's edge and the words inside it. */
const PAD = { top: 12, right: 24, left: 24 } as const;

/** The blue pill on the left of a row, holding the date. */
function datePill(data: RichText): Block {
  const inner = label(
    data,
    { w: DATE.w, h: DATE.h },
    { size: TYPE.date, weight: BOLD, color: ON_INK },
    { name: 'date', align: 'center', valign: 'middle' },
  );

  return block(
    DATE.w,
    DATE.h,
    group({
      name: 'date-pill',
      children: [rect({ size: DATE, radius: RADIUS, fill: solid(INK) }), inner.draft],
    }),
  );
}

/**
 * The grey pill on the right of a row, holding the session and its professor.
 *
 * **This is where the route runs out.** Both text boxes state a height, and the pill states
 * one too, because a template cannot measure text: `build` decides every coordinate before
 * `layoutText` ever runs (`packages/core/src/brief/compile.ts`), so the height a title
 * needs does not exist yet when the height of the pill around it has to be written down.
 *
 * Stating `h` rather than leaving it absent is the deliberate half of that. An absent
 * height means "as large as the content needs", which would let a long title wrap *out of*
 * the pill with nothing said about it; a stated one overflows, and an overflow is a
 * `W_TEXT_OVERFLOW` naming the `disciplina` directive and the format. The wall is the same
 * either way — this makes it announce itself instead of shipping a slide with type lying
 * across the paper.
 *
 * And there is no second guard available: `max` on a repeatable slot counts occurrences,
 * not characters (`packages/core/src/template/manifest.ts`), so the manifest can cap how
 * many slides a week has and cannot cap how long one session's title is.
 *
 * TYTO-162 is the card that removes this. Until it lands, a title longer than one line is a
 * warning whose only answer is a shorter title.
 */
function sessionPill(session: Session, width: number): Block {
  const inner = width - PAD.left - PAD.right;

  const copy = stack({
    gap: 4,
    items: [
      label(
        session.titulo,
        { w: inner, h: 36 },
        { size: TYPE.sessionTitle, weight: BOLD, color: PILL_INK },
        { name: 'session-title' },
      ),
      label(
        session.professor,
        { w: inner, h: 32 },
        { size: TYPE.professor, weight: REGULAR, color: PILL_INK },
        { name: 'professor' },
      ),
    ],
  });

  return block(
    width,
    DATE.h,
    group({
      name: 'session-pill',
      children: [
        rect({ size: { w: width, h: DATE.h }, radius: RADIUS, fill: solid(PILL) }),
        at(PAD.left, PAD.top, copy),
      ],
    }),
  );
}

/** One session, drawn: the date beside the pill that holds the words. */
export function sessionRow(session: Session, width: number): Block {
  return row({
    name: 'session',
    gap: GAP.row,
    align: 'center',
    items: [datePill(session.data), sessionPill(session, width - DATE.w - GAP.row)],
  });
}

/**
 * A discipline and its sessions, stacked.
 *
 * The `.map()` is the whole of "the number of sessions comes from the brief". Nothing above
 * it counts anything, and the `y` of the second session is the height of the first — a
 * number `stack` adds up rather than one somebody typed.
 */
export function discipline(name: RichText, sessions: readonly Session[], width: number): Block {
  const heading = label(
    name,
    { w: width, h: 58 },
    { size: TYPE.discipline, weight: BOLD, color: INK },
    { name: 'discipline' },
  );

  const rows = stack({
    gap: GAP.sessions,
    items: sessions.map((session) => sessionRow(session, width)),
  });

  return stack({ name: 'discipline-block', gap: GAP.heading, items: [heading, rows] });
}
