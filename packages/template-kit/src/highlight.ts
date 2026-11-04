import { colorValue, numberValue } from '@tyto/core/template';

import type { Inline, RichText, TemplateContext } from '@tyto/core';
import type { RunStyle, RunsOptions } from '@tyto/core/template';

/**
 * Highlights: what `**…**`, `*…*` and a named mark look like in one template, written once as
 * data and reused per place (TYTO-554).
 *
 * The house rule (the maintainer, 2026-11-03): `**…**` is the highlight for something out of the
 * ordinary and works in every template, so a template never opts in to it — it only says what
 * it looks like. A colour mark, `{cor:azul}…{/}`, names a colour the template declares and takes
 * the highlight's weight with it, so a coloured word reads as highlighted too.
 *
 * Everything here is data — a {@link HighlightSpec} — and never a function per template: a
 * template's highlights are a map from what the brief wrote to a style, so a house can change
 * them through declared values ({@link highlightsFromValues}, ADR 0153) without touching code.
 *
 * **The closest wrapper decides.** `runsOf` applies each directive over the style around it, so in
 * `{cor:azul}a **b**{/}` the `b` takes the highlight's colour, not azul, and in
 * `**a {cor:azul}b{/}**` the `b` is azul. That is the rule the brief already had for nested
 * bold and italic (ADR 0015), and the kit does not add a second one.
 */

/** The style a highlight lays over the text around it; what it does not name stays as it was. */
export type HighlightStyle = Partial<RunStyle>;

/**
 * One family of marks, `{<family>:<name>}…{/}`, and the style each name maps to.
 *
 * `like: 'bold'` lays the highlight's own style under each name's, which is how a colour mark
 * takes the highlight's weight. A name the family does not list passes its text through
 * unchanged, as a mark nothing maps always has.
 */
export interface MarkFamily {
  readonly like?: 'bold' | 'italic' | 'plain';
  readonly values: Readonly<Record<string, HighlightStyle>>;
}

/** What a template's highlights look like: every field optional, each one data. */
export interface HighlightSpec {
  /** What `**…**` looks like. Weight 700, the surrounding colour, when it names nothing. */
  readonly bold?: HighlightStyle;
  /** What `*…*` looks like, over its italic, which it cannot turn off. */
  readonly italic?: HighlightStyle;
  /** Mark families by key: `{ cor: { like: 'bold', values: { azul: { color } } } }`. */
  readonly marks?: Readonly<Record<string, MarkFamily>>;
}

/** A template's highlights, ready for `runsOf`, and the way to vary them in one place. */
export interface Highlights {
  readonly spec: HighlightSpec;
  /** What `runsOf` takes: bold, italic and a `mark` that reads {@link HighlightSpec.marks}. */
  readonly options: RunsOptions;
  /**
   * The same highlights with `override` laid over them — in the title, the same bold in navy:
   * `highlights.with({ bold: { color: navy } })`. Styles merge field by field, mark families
   * name by name; nothing in `override` removes anything.
   */
  with(override: HighlightSpec): Highlights;
}

/** The weight bold takes when nobody says another: the one `runsOf` has always used. */
export const HIGHLIGHT_WEIGHT = 700;

function mergeFamilies(
  base: HighlightSpec['marks'],
  over: HighlightSpec['marks'],
): HighlightSpec['marks'] {
  if (over === undefined) return base;
  const merged: Record<string, MarkFamily> = { ...base };
  for (const [key, family] of Object.entries(over)) {
    const previous = merged[key];
    const like = family.like ?? previous?.like;
    merged[key] = {
      ...(like === undefined ? {} : { like }),
      values: { ...previous?.values, ...family.values },
    };
  }
  return merged;
}

function merge(base: HighlightSpec, over: HighlightSpec): HighlightSpec {
  const marks = mergeFamilies(base.marks, over.marks);
  return {
    bold: { ...base.bold, ...over.bold },
    italic: { ...base.italic, ...over.italic },
    ...(marks === undefined ? {} : { marks }),
  };
}

function markStyle(spec: HighlightSpec, key: string, value: string): Partial<RunStyle> | undefined {
  const family = spec.marks?.[key];
  const named = family?.values[value];
  if (family === undefined || named === undefined) return undefined;
  switch (family.like) {
    case 'bold':
      return { weight: HIGHLIGHT_WEIGHT, ...spec.bold, ...named };
    case 'italic':
      return { ...spec.italic, ...named, style: 'italic' };
    default:
      return named;
  }
}

/** A template's highlights from a spec. `highlights({})` is the house default: bold at 700. */
export function highlights(spec: HighlightSpec): Highlights {
  return {
    spec,
    options: {
      bold: { weight: HIGHLIGHT_WEIGHT, ...spec.bold },
      italic: spec.italic ?? {},
      mark: (key, value) => markStyle(spec, key, value),
    },
    with: (override) => highlights(merge(spec, override)),
  };
}

/** A colour value the template may have no constant for: read only when it is declared. */
function declaredColor(
  context: Pick<TemplateContext, 'values'>,
  name: string,
  fallback: RunStyle['color'] | undefined,
): RunStyle['color'] | undefined {
  return typeof fallback === 'string'
    ? colorValue(context, name, fallback)
    : typeof context.values?.[name] === 'string'
      ? (context.values[name] as string)
      : fallback;
}

/**
 * A template's highlights with its declared values laid over its constants (ADR 0153), under
 * names every template shares:
 *
 * - `highlight-weight` — a `number` value, the weight of `**…**`;
 * - `highlight-color` — a `color`, the colour of `**…**`;
 * - `<place>-highlight-color` — the same colour in one place, over `highlight-color`, when
 *   `place` is given (`title-highlight-color`);
 * - `mark-<family>-<name>` — a `color`, the colour one mark name maps to (`mark-cor-azul`).
 *
 * A value the manifest does not declare, or a context with none, leaves the constant in
 * `defaults` — so a template that declares nothing draws exactly what `highlights(defaults)`
 * draws.
 */
export function highlightsFromValues(
  context: Pick<TemplateContext, 'values'>,
  defaults: HighlightSpec,
  place?: string,
): Highlights {
  const weight = numberValue(
    context,
    'highlight-weight',
    defaults.bold?.weight ?? HIGHLIGHT_WEIGHT,
  );
  const houseColor = declaredColor(context, 'highlight-color', defaults.bold?.color);
  const color =
    place === undefined
      ? houseColor
      : declaredColor(context, `${place}-highlight-color`, houseColor);

  const marks: Record<string, MarkFamily> = {};
  for (const [key, family] of Object.entries(defaults.marks ?? {})) {
    const values: Record<string, HighlightStyle> = {};
    for (const [name, style] of Object.entries(family.values)) {
      const declared = declaredColor(context, `mark-${key}-${name}`, style.color);
      values[name] = declared === undefined ? style : { ...style, color: declared };
    }
    marks[key] = { ...family, values };
  }

  return highlights({
    ...defaults,
    bold: { ...defaults.bold, weight, ...(color === undefined ? {} : { color }) },
    ...(defaults.marks === undefined ? {} : { marks }),
  });
}

/**
 * Plain text — a frontmatter string, which the brief parser never reads — as the rich text
 * `runsOf` and `labelOf` take, so a template needs no reader of its own for `**…**`.
 *
 * **Exactly a subset**, and a small one: `**…**` and `{key:value}…{/}`, each holding plain text,
 * and `\n` as a line break. No nesting, no italic, no span across a line break. A `**` or a `{`
 * that opens nothing it can close stays in the text as written, because a stray asterisk in a
 * title is a typo to show, not a reason to drop the line.
 *
 * Ranges are offsets in `source`, not in the brief: frontmatter text has no position the
 * diagnostics could point at more closely than its key.
 */
export function richTextOfPlain(source: string): RichText {
  const inlines: Inline[] = [];
  let literalStart = 0;
  let literal = '';

  const flush = (end: number) => {
    if (literal !== '') {
      inlines.push({ kind: 'text', value: literal, range: { start: literalStart, end } });
    }
    literal = '';
  };
  const textAt = (value: string, start: number): Inline => ({
    kind: 'text',
    value,
    range: { start, end: start + value.length },
  });

  let at = 0;
  while (at < source.length) {
    if (source.startsWith('**', at)) {
      const close = source.indexOf('**', at + 2);
      const inner = close < 0 ? '' : source.slice(at + 2, close);
      if (inner !== '' && !inner.includes('\n')) {
        flush(at);
        inlines.push({
          kind: 'bold',
          children: [textAt(inner, at + 2)],
          range: { start: at, end: close + 2 },
        });
        at = close + 2;
        literalStart = at;
        continue;
      }
    }

    const opening = /^\{([\p{L}\d-]+):([^{}\n]+)\}/u.exec(source.slice(at));
    if (opening !== null) {
      const contentStart = at + opening[0].length;
      const close = source.indexOf('{/}', contentStart);
      const inner = close < 0 ? '' : source.slice(contentStart, close);
      if (inner !== '' && !inner.includes('\n') && !inner.includes('{')) {
        flush(at);
        inlines.push({
          kind: 'mark',
          key: opening[1]!,
          value: opening[2]!,
          children: [textAt(inner, contentStart)],
          range: { start: at, end: close + 3 },
        });
        at = close + 3;
        literalStart = at;
        continue;
      }
    }

    if (source[at] === '\n') {
      flush(at);
      inlines.push({ kind: 'break', range: { start: at, end: at + 1 } });
      at += 1;
      literalStart = at;
      continue;
    }

    literal += source[at];
    at += 1;
  }
  flush(at);
  return inlines;
}
