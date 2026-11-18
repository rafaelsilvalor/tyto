/**
 * The words of a one-image table (TYTO-218): how the brief's `::tabela` is read, and where a
 * cell may break.
 *
 * Strings only — no measuring and no drawing — so every rule here is checked by a test that
 * reads characters, and `table.ts` decides sizes on top of it.
 *
 * ## Where a line may break, and how that is enforced
 *
 * A value that must never split has its inner spaces written as no-break spaces; the
 * mechanism, and the rules the banner shares with this table, are in `breaks.ts`.
 *
 * What is glued:
 *
 * - a currency sign to its amount: `R$ 33.820,39`;
 * - a number to its unit or percent: `5 mil`, `10 %`;
 * - both sides of a `+`: `5 + CR`, `200 + CR`;
 * - a dash to the word before it: `Banca contratada — Quadrix` never leaves the `—` alone;
 * - the last word of a group in parentheses to the word before it: no line holds only `CR)`;
 * - a qualifier in parentheses, whole, to the number before it: `R$ 33.820,39 (bruto)`;
 * - the connector of a range to the value **before** it: `R$ 5.667,92 a R$ 13.560,00` can
 *   break only after the `a`, so it comes out as its two values with the `a` closing the
 *   first line — which is what the table art the maintainer approved draws.
 *
 * A number itself (`1.315`, `33.820,39`) has no space in it and was never breakable.
 *
 * A parenthesised group of more than {@link QUALIFIER_WORDS} words is a phrase, not a
 * qualifier, and is not glued: `10.604 (2.650 imediatas + 7.954 CR)` glued whole was one piece as
 * wide as the cell, and its column could never give room to a column that wrapped more.
 *
 * ## What else a `::tabela` may hold
 *
 * - A `\` inside a row is a line break the author placed in that cell; the row goes on after it.
 * - A line with no `|` that starts with `*` is a note, drawn small under the table, never a band.
 */

import { fields, plain } from '@tyto/template-kit';

import { NO_BREAK_SPACE, glueParenthesised } from './breaks.js';

import type { Inline, RichText } from '@tyto/core';

/** One body line of the table: its cells, or one band across every column. */
export type TableRow =
  | { readonly kind: 'cells'; readonly cells: readonly string[] }
  | { readonly kind: 'band'; readonly text: string };

/**
 * The table a brief wrote: a header, which fixes the column count, then its rows, then the
 * notes under it. A cell's `\n` is a line break its author placed.
 */
export interface TableContent {
  readonly header: readonly string[];
  readonly rows: readonly TableRow[];
  /** The `*` lines, in the order written, each with its `*`. */
  readonly notes: readonly string[];
}

/**
 * The brief's `::tabela`, read as the table requests write it.
 *
 * The first line is the header, `Concurso | Banca | Vagas | Salário`, and its field count is
 * the column count. Every later line with a `|` is a row: a short row is padded with empty
 * cells, and a long one keeps its extra separators in its last cell rather than inventing a
 * column. A later line with no `|` is a band across the whole table, unless it starts with `*`:
 * then it is a note, wherever it was written.
 *
 * Plain text: a cell is a value, and emphasis inside it has no drawing in this piece.
 */
export function readTable(text: RichText): TableContent {
  const [first, ...rest] = records(text);
  if (first === undefined) return { header: [], rows: [], notes: [] };

  const header = fields(first).map(cellText);
  const columns = header.length;

  const rows: TableRow[] = [];
  const notes: string[] = [];
  for (const line of rest) {
    if (fields(line).length === 1) {
      const whole = cellText(line);
      if (whole.startsWith('*')) {
        notes.push(whole.replaceAll('\n', ' '));
        continue;
      }
      if (columns > 1) {
        rows.push({ kind: 'band', text: whole });
        continue;
      }
    }
    const cells = fields(line, columns).map(cellText);
    while (cells.length < columns) cells.push('');
    rows.push({ kind: 'cells', cells });
  }

  return { header, rows, notes };
}

/**
 * The table's lines, each one record: cut at the end of every block line, never at a `\` the
 * author typed, which stays inside its cell (`Break.typed`).
 */
function records(text: RichText): RichText[] {
  const result: RichText[] = [];
  let current: Inline[] = [];
  for (const inline of text) {
    if (inline.kind === 'break' && inline.typed !== true) {
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
 * A field's characters, each of its lines with its runs of whitespace made one plain space,
 * and the lines joined by `\n`. An empty line — a `\` at the edge of a cell — is dropped.
 */
function cellText(field: RichText): string {
  return plain(field)
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** A parenthesised group of up to this many words is a qualifier, glued to its number. */
export const QUALIFIER_WORDS = 3;

/** A number: digits, with the thousands dots and the decimal comma written in Brazil. */
const NUMBER = String.raw`\d[\d.,]*`;

/** Words a number is read together with. */
const UNITS = '(?:mil|milhão|milhões|bi|bilhão|bilhões|%)';

/** Range connectors. */
const CONNECTORS = '(?:a|e|até)';

/**
 * The cell with every space that must not break turned into a no-break space.
 *
 * The order matters: currency first, so `R$ 5.667,92` is one piece before the connector rule
 * looks for "a value, then `a`".
 */
export function glue(cell: string): string {
  return cell.split('\n').map(glueLine).join('\n');
}

function glueLine(cell: string): string {
  const nbsp = NO_BREAK_SPACE;
  // R$ 33.820,39 (bruto) — a qualifier stays with the value it qualifies (`breaks.ts`).
  const qualified = glueParenthesised(cell, /\d/u, QUALIFIER_WORDS);
  return (
    qualified
      // R$ 33.820,39 — and US$, € written the same way.
      .replace(/(R\$|US\$|€) (?=\d)/gu, `$1${nbsp}`)
      // 5 mil, 10 %
      .replace(new RegExp(`(${NUMBER}) (?=${UNITS}(?![\\p{L}]))`, 'gu'), `$1${nbsp}`)
      // 5 + CR
      .replace(/ \+ /gu, `${nbsp}+${nbsp}`)
      // Banca contratada — Quadrix: a dash closes the words before it, never opens a line or
      // stands on one alone.
      .replace(/ ([—–]) /gu, `${nbsp}$1 `)
      // (2.650 imediatas + 7.954 CR): the last word of a group never stands alone as `CR)`.
      .replace(/ ([^\s()]+\))/gu, `${nbsp}$1`)
      // R$ 5.667,92 a R$ 13.560,00 — the connector stays with the value before it, and the
      // only break left is after it, before the second value.
      .replace(
        new RegExp(`(\\d|\\)) (${CONNECTORS}) (?=(?:R\\$|US\\$|€|\\d))`, 'gu'),
        `$1${nbsp}$2 `,
      )
  );
}
