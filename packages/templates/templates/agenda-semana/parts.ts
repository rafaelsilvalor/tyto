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
import { type Block, at, block, stack } from '@tyto/template-kit';

import {
  ARROW,
  BAND,
  BLACK,
  COVER_INK,
  FACE,
  GAP,
  HANDLE,
  INK,
  LIGHT,
  MEDIUM,
  type Mark,
  ON_INK,
  OWL,
  PILL,
  PILL_INK,
  RADIUS,
  TYPE,
} from './tokens.js';

import type { AssetRef, RichText, TemplateContext, TextRun } from '@tyto/core';
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
  return mark(OWL, 64, INK, 'owl');
}

/** The footer band's height; the handle and the arrow are centred on it. */
const FOOTER_H = BAND.footer;

/**
 * The handle, centred, and the arrow at the right edge pointing on to the next slide.
 *
 * The handle is a token and not a slot: it is the account the carousel is published from,
 * it is the same on every slide of every week, and a slot would be one more thing for a
 * brief to fill in correctly every time. Regular and tracked out, as the published slide
 * sets it, so the signature reads quieter than the agenda above it.
 */
export function footer(width: number): Block {
  const glyph = mark(ARROW, 26, INK, 'arrow');
  const handle = text({
    name: 'handle',
    runs: [run(HANDLE, { font: FACE, size: TYPE.handle, weight: LIGHT, color: INK })],
    box: { w: width, h: FOOTER_H },
    align: 'center',
    valign: 'middle',
    letterSpacing: 4,
  });

  return block(
    width,
    FOOTER_H,
    group({
      name: 'footer',
      children: [handle, at(width - glyph.width, (FOOTER_H - glyph.height) / 2, glyph)],
    }),
  );
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
    { size: options.size, weight: BLACK, color: COVER_INK },
    { name: 'cover-title', lineHeight: 1.05, align: 'center' },
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

  // Centred over the words, as the published slide sets it. A stack places its items at
  // x = 0, so the offset is a block of the full width with the picture inside it.
  const centred = block(
    options.width,
    ILLUSTRATION,
    group({ children: [at((options.width - ILLUSTRATION) / 2, 0, illustration)] }),
  );

  return stack({ name: 'cover', gap: 16, items: [centred, words] });
}

const ILLUSTRATION = 180;

/* ---------------------------------------------------------------------- a discipline -- */

/** One session of a discipline: a date, a title and whoever gives it. */
export interface Session {
  readonly data: RichText;
  readonly titulo: RichText;
  readonly professor: RichText;
}

/** The pills' height for a session whose copy fits one line each — the published row. */
const DATE = { w: 220, h: 86 } as const;

/** Room between the grey pill's edge and the words inside it. */
const PAD = { vertical: 12, right: 32, left: 32 } as const;

/** What a template is handed to ask how tall its text will be (ADR 0038). */
type Measure = TemplateContext['measure'];

/**
 * One line of the grey pill's copy — the title or the professor — as tall as its lines.
 *
 * **It wraps and grows rather than shrinking** (TYTO-184): the published pill breaks a
 * long title onto a second line and grows to hold it. The text is built with the column's
 * width and no height, asked how tall it comes out, and given that height — never less than
 * `oneLine`, which is today's single-line box, so a short title is drawn exactly as before.
 *
 * Where nothing can measure (`measure` answers `undefined`: no faces in this compile), the
 * box is `oneLine` and a long line shrinks into it, which is TYTO-173's behaviour. That
 * height is a guess, and the exporter's own wrap can differ from it.
 */
function copyLine(
  value: RichText,
  width: number,
  oneLine: number,
  style: { readonly size: number; readonly weight: number; readonly color: string },
  name: string,
  measure: Measure,
): Block {
  const runs = atLeastOne(
    runsOf(value, { font: FACE, size: style.size, weight: style.weight, color: style.color }),
  );
  if (runs === undefined) return block(width, oneLine, group({ children: [] }));

  const measured = measure(text({ name, runs, box: { w: width } }));
  if (measured === undefined) {
    return block(
      width,
      oneLine,
      text({ name, runs, box: { w: width, h: oneLine }, overflow: 'shrink' }),
    );
  }

  const height = Math.max(oneLine, measured.height);
  return block(width, height, text({ name, runs, box: { w: width, h: height } }));
}

/** The blue pill on the left of a row, holding the date, as tall as the row it sits on. */
function datePill(data: RichText, height: number): Block {
  const inner = label(
    data,
    { w: DATE.w, h: height },
    { size: TYPE.date, weight: MEDIUM, color: ON_INK },
    { name: 'date', align: 'center', valign: 'middle' },
  );

  return block(
    DATE.w,
    height,
    group({
      name: 'date-pill',
      children: [
        rect({ size: { w: DATE.w, h: height }, radius: RADIUS, fill: solid(INK) }),
        inner.draft,
      ],
    }),
  );
}

/**
 * The grey pill of a row, holding the session and its professor.
 *
 * **It starts under the date pill, not beside it.** The published slide draws the two as
 * one shape: the grey runs the full width of the row and the blue sits on top of its left
 * end, so there is no gap and no second rounded edge between them. The words therefore
 * start after the date pill, not after the grey pill's own edge.
 *
 * **It is as tall as its copy** plus the padding, and never shorter than the published
 * single-line row: `copyLine` measures each line before it is placed (ADR 0038), so a title
 * that wraps makes the pill — and the row, and everything `stack` puts under it — taller.
 */
function sessionPill(session: Session, width: number, measure: Measure): Block {
  const inner = width - DATE.w - PAD.left - PAD.right;

  const copy = stack({
    gap: 4,
    items: [
      copyLine(
        session.titulo,
        inner,
        30,
        { size: TYPE.sessionTitle, weight: MEDIUM, color: PILL_INK },
        'session-title',
        measure,
      ),
      copyLine(
        session.professor,
        inner,
        28,
        { size: TYPE.professor, weight: LIGHT, color: PILL_INK },
        'professor',
        measure,
      ),
    ],
  });

  const height = Math.max(DATE.h, copy.height + PAD.vertical * 2);

  return block(
    width,
    height,
    group({
      name: 'session-pill',
      children: [
        rect({ size: { w: width, h: height }, radius: RADIUS, fill: solid(PILL) }),
        at(DATE.w + PAD.left, (height - copy.height) / 2, copy),
      ],
    }),
  );
}

/** One session, drawn: the grey pill across the row, and the date pill on top of its end. */
export function sessionRow(session: Session, width: number, measure: Measure): Block {
  const pill = sessionPill(session, width, measure);
  const date = datePill(session.data, pill.height);

  return block(
    width,
    pill.height,
    group({
      name: 'session',
      // Painted in order, so the date is last: it covers the grey pill's rounded left end.
      children: [pill.draft, date.draft],
    }),
  );
}

/**
 * The discipline component: a heading and the sessions written under it, stacked.
 *
 * This is the unit a slide repeats — the maintainer's own word for it is "component" — so
 * the slide never places a session, only disciplines, and a discipline never knows how many
 * of its siblings share the slide.
 *
 * The `.map()` is the whole of "the number of sessions comes from the brief". Nothing above
 * it counts anything, and the `y` of the second session is the height of the first — a
 * number `stack` adds up rather than one somebody typed.
 */
export function discipline(
  name: RichText,
  sessions: readonly Session[],
  width: number,
  measure: Measure,
): Block {
  const heading = label(
    name,
    { w: width, h: 78 },
    { size: TYPE.discipline, weight: MEDIUM, color: INK },
    { name: 'discipline', align: 'center', overflow: 'shrink' },
  );

  const rows = stack({
    name: 'eventos',
    gap: GAP.sessions,
    items: sessions.map((session) => sessionRow(session, width, measure)),
  });

  return stack({ name: 'discipline-block', gap: GAP.heading, items: [heading, rows] });
}
