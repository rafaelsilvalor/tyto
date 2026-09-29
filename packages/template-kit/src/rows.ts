/**
 * Reading one slot as a small table: one line is one row, `|` separates its fields, and a
 * line with no `|` can start a group.
 *
 * A manifest may declare **at most one** repeatable slot, and its occurrences become
 * artworks (`packages/core/src/template/manifest.ts`). A carousel that spends that repeat on
 * the slide has nothing left to repeat rows with, so the occurrence carries them as lines:
 *
 * ```
 * ::lamina
 *   FARMÁCIA
 *   16/09 - 14:00 | Farmacologia Geral | Profª. Marcela Rocha
 *   SERVIÇO SOCIAL
 *   15/09 - 19:00 | Serviço Social no âmbito hospitalar | Profª. Norma Castilhos
 * ```
 *
 * The language already hands that over as structure: "the line between two block lines is a
 * `Break`" (`docs/brief-language.md`), the same node a trailing `\` produces. So splitting
 * on lines reads the author's lines and never a `\n` inside a string (ADR 0016).
 *
 * **This is the cost of doing repetition in the template rather than in the language.** It
 * works, it needs no card, and it asks the brief's author to learn a separator. TYTO-163 is
 * the version where the language repeats and nobody learns one.
 *
 * Moved here from `agenda-semana` by TYTO-185, because nothing in it knows what the rows
 * mean: the agenda's sessions and an approved list's `rank | name` are read the same way.
 */

import type { Inline, RichText } from '@tyto/core';

/** What separates the fields of one row. */
export const FIELD_SEPARATOR = '|';

/** A heading and the rows written under it. */
export interface RowGroup {
  /** The heading line, or empty for rows written before any heading. */
  readonly heading: RichText;
  /**
   * The heading line's fields after its first, when a heading has more than one — the
   * schedule a day's caption band draws, say. Empty for a one-field heading and for rows
   * written before any heading.
   */
  readonly headingRest: readonly RichText[];
  /** Each row as its fields, already split and trimmed. */
  readonly rows: readonly (readonly RichText[])[];
}

/**
 * A slot's lines as groups of rows.
 *
 * With `grouped`, a line with no separator starts a group and every line with one is a row
 * of the group above it; rows written before any heading belong to a group with an empty
 * heading, which is drawn rather than dropped — a brief being written has that slide even
 * if the published artwork never does. Without `grouped`, every line is a row of one group
 * with no heading, separator or not.
 *
 * `fieldCount` caps the split, so the last field keeps any further separators.
 *
 * `headingFields` is how many fields a heading line has. One by default: a line with no
 * separator is a heading. Two when a heading carries a second field, like
 * `Domingo 26/10 | Aplicação às 08h30`: then a line with exactly one separator is a heading
 * and a table whose rows have one field tells them apart by that separator. The count is
 * the test, so it must differ from the rows' own count.
 */
export function rowGroups(
  text: RichText,
  fieldCount: number,
  grouped: boolean,
  headingFields = 1,
): RowGroup[] {
  const result: { heading: RichText; headingRest: RichText[]; rows: RichText[][] }[] = [];

  for (const line of lines(text)) {
    // The heading test reads the uncapped split, so a one-field table still tells a
    // heading from a row by the separator rather than by the cap.
    if (grouped && fields(line).length === headingFields) {
      // A one-field heading is the line as written, which is what it has always been.
      const [heading = [], ...headingRest] =
        headingFields === 1 ? [line] : fields(line, headingFields);
      result.push({ heading, headingRest, rows: [] });
      continue;
    }
    if (result.length === 0) result.push({ heading: [], headingRest: [], rows: [] });
    result[result.length - 1]!.rows.push(fields(line, fieldCount));
  }

  return result;
}

/**
 * The lines of a rich-text value, in order, with the breaks removed.
 *
 * A line that holds nothing but whitespace is dropped rather than returned empty: a blank
 * line in a block body is how an author spaces their source out, and it is not a session.
 */
export function lines(text: RichText): RichText[] {
  const result: RichText[] = [];
  let current: Inline[] = [];

  for (const inline of text) {
    if (inline.kind === 'break') {
      result.push(current);
      current = [];
      continue;
    }
    current.push(inline);
  }
  result.push(current);

  return result.filter((line) => plain(line).trim() !== '');
}

/**
 * One line split into fields at {@link FIELD_SEPARATOR}, with the structure kept.
 *
 * Only a top-level plain-text inline is cut. A `**bold**` or a `{cor:x}…{/}` is atomic and
 * joins whichever field is open when it arrives — a separator written inside emphasis is a
 * brief doing something nobody meant, and splitting it would silently reflow the author's
 * words into a different column.
 *
 * Always returns at least one field, and never more than `limit` when one is given: the
 * remainder stays in the last field, separators and all, so a professor's name containing
 * the character survives.
 */
export function fields(line: RichText, limit?: number): RichText[] {
  const result: Inline[][] = [[]];
  const last = () => result[result.length - 1]!;

  for (const inline of line) {
    if (inline.kind !== 'text' || (limit !== undefined && result.length >= limit)) {
      last().push(inline);
      continue;
    }

    const parts = inline.value.split(FIELD_SEPARATOR);
    for (const [index, part] of parts.entries()) {
      if (index > 0) {
        if (limit !== undefined && result.length >= limit) {
          // The cap is reached mid-inline: put the separator back rather than eating it.
          last().push(sliceOf(inline, `${FIELD_SEPARATOR}${part}`, inline.value));
          continue;
        }
        result.push([]);
      }
      if (part !== '') last().push(sliceOf(inline, part, inline.value));
    }
  }

  return result.map(trimEnds);
}

/** The plain characters of a rich-text value, for a comparison or an emptiness test. */
export function plain(text: RichText): string {
  return text
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
          return inline.value;
        case 'break':
          return '\n';
        default:
          return plain(inline.children);
      }
    })
    .join('');
}

/**
 * A piece of a text inline, carrying a range inside the one it came from.
 *
 * `value` is decoded — `\::` in the source arrives as `::` — so an offset into it is not an
 * offset into the source when the author escaped something. The range is therefore clamped
 * rather than trusted: what it has to be is *inside the slot*, because that is the
 * granularity `W_TEXT_OVERFLOW` reports at (`compile.ts`, `provenance`), and a range that
 * ran past the slot would point the warning at the wrong directive.
 */
function sliceOf(inline: Inline & { kind: 'text' }, part: string, whole: string): Inline {
  const offset = whole.indexOf(part);
  const start = Math.min(inline.range.start + Math.max(offset, 0), inline.range.end);
  return {
    kind: 'text',
    value: part,
    range: { start, end: Math.min(start + part.length, inline.range.end) },
  };
}

/** The same field without the spaces that sat against its separators. */
function trimEnds(field: readonly Inline[]): RichText {
  const trimmed = [...field];

  const first = trimmed[0];
  if (first?.kind === 'text') trimmed[0] = { ...first, value: first.value.replace(/^\s+/u, '') };

  const lastIndex = trimmed.length - 1;
  const final = trimmed[lastIndex];
  if (final?.kind === 'text') {
    trimmed[lastIndex] = { ...final, value: final.value.replace(/\s+$/u, '') };
  }

  return trimmed.filter((inline) => inline.kind !== 'text' || inline.value !== '');
}
