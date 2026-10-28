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
 * - a qualifier in parentheses, whole, to the number before it: `R$ 33.820,39 (bruto)`;
 * - the connector of a range to the value **before** it: `R$ 5.667,92 a R$ 13.560,00` can
 *   break only after the `a`, so it comes out as its two values with the `a` closing the
 *   first line — which is what the table art the maintainer approved draws.
 *
 * A number itself (`1.315`, `33.820,39`) has no space in it and was never breakable.
 */

import { fields, lines, plain } from '@tyto/template-kit';

import { NO_BREAK_SPACE, glueParenthesised } from './breaks.js';

import type { RichText } from '@tyto/core';

/** One body line of the table: its cells, or one band across every column. */
export type TableRow =
  | { readonly kind: 'cells'; readonly cells: readonly string[] }
  | { readonly kind: 'band'; readonly text: string };

/** The table a brief wrote: a header, which fixes the column count, then its rows. */
export interface TableContent {
  readonly header: readonly string[];
  readonly rows: readonly TableRow[];
}

/**
 * The brief's `::tabela`, read as the table requests write it.
 *
 * The first line is the header, `Concurso | Banca | Vagas | Salário`, and its field count is
 * the column count. Every later line with a `|` is a row: a short row is padded with empty
 * cells, and a long one keeps its extra separators in its last cell rather than inventing a
 * column. A later line with no `|` is a band across the whole table.
 *
 * Plain text: a cell is a value, and emphasis inside it has no drawing in this piece.
 */
export function readTable(text: RichText): TableContent {
  const [first, ...rest] = lines(text);
  if (first === undefined) return { header: [], rows: [] };

  const header = fields(first).map(cellText);
  const columns = header.length;

  const rows = rest.map((line): TableRow => {
    if (columns > 1 && fields(line).length === 1) {
      return { kind: 'band', text: cellText(line) };
    }
    const cells = fields(line, columns).map(cellText);
    while (cells.length < columns) cells.push('');
    return { kind: 'cells', cells };
  });

  return { header, rows };
}

/** A field's characters, its runs of whitespace made one plain space. */
function cellText(field: RichText): string {
  return plain(field).replace(/\s+/gu, ' ').trim();
}

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
  const nbsp = NO_BREAK_SPACE;
  // R$ 33.820,39 (bruto) — a qualifier stays with the value it qualifies (`breaks.ts`).
  const qualified = glueParenthesised(cell, /\d/u);
  return (
    qualified
      // R$ 33.820,39 — and US$, € written the same way.
      .replace(/(R\$|US\$|€) (?=\d)/gu, `$1${nbsp}`)
      // 5 mil, 10 %
      .replace(new RegExp(`(${NUMBER}) (?=${UNITS}(?![\\p{L}]))`, 'gu'), `$1${nbsp}`)
      // 5 + CR
      .replace(/ \+ /gu, `${nbsp}+${nbsp}`)
      // R$ 5.667,92 a R$ 13.560,00 — the connector stays with the value before it, and the
      // only break left is after it, before the second value.
      .replace(
        new RegExp(`(\\d|\\)) (${CONNECTORS}) (?=(?:R\\$|US\\$|€|\\d))`, 'gu'),
        `$1${nbsp}$2 `,
      )
  );
}
