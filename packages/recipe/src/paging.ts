import { type Diagnostic, type Result, diagnostic, err, ok } from '@tyto/core';

import { checkTable } from './check-table.js';
import type { Column, Row, Table } from './table.js';

/**
 * One answer of a source (ADR 0128, ADR 0135): some rows, and where to go on from.
 *
 * `cursor` absent means the last page. `truncated` is the source saying its own limit cut this
 * page short — Jira's `isLast: false` with no way on — and that is an error, never a table.
 */
export interface SourcePage {
  readonly table: Table;
  readonly cursor?: string;
  readonly truncated?: boolean;
}

export type PageResult = Result<SourcePage, readonly Diagnostic[]>;

/** One call into the source: the first page when `cursor` is absent. */
export type PageFetcher = (cursor: string | undefined) => Promise<PageResult>;

export interface PageLimits {
  /** Of one page, as UTF-8 JSON. */
  readonly maxPageBytes: number;
  readonly maxPageRows: number;
  /** Of the whole table the pages make. */
  readonly maxRows: number;
  readonly maxPages: number;
}

/**
 * Provisional ceilings (ADR 0135): nobody has measured a real Jira page yet, and TYTO-386 is
 * where somebody does. They exist so that a source that never stops, or answers a gigabyte,
 * is an error at a known number rather than a process that runs out of memory.
 */
export const PAGE_LIMITS: PageLimits = {
  maxPageBytes: 8 * 1024 * 1024,
  maxPageRows: 5_000,
  maxRows: 100_000,
  maxPages: 1_000,
};

/**
 * Calls a source page by page until it says there are no more, and answers the one table they
 * make (ADR 0128 decision 5). The host loops so that each call fits its own deadline: a search
 * that takes a minute is twenty calls of three seconds, never one call of sixty.
 *
 * **Every way out short of the last page is an error, never a partial table**: a page the
 * source says was cut short, a cursor it already gave (it would loop for ever), a ceiling
 * passed, a page whose columns differ from the first, or a key two pages both hold.
 */
export async function pagedSource(
  verb: string,
  fetchPage: PageFetcher,
  limits: PageLimits = PAGE_LIMITS,
): Promise<Result<Table, readonly Diagnostic[]>> {
  const problem = (text: string) => err([diagnostic('E_RECIPE_SOURCE', { verb, problem: text })]);
  const seen = new Set<string>();
  const keys = new Set<string>();
  const rows: Row[] = [];
  const warnings: Diagnostic[] = [];
  let columns: readonly Column[] | undefined;
  let cursor: string | undefined;

  for (let page = 1; ; page++) {
    if (page > limits.maxPages) {
      return problem(`did not finish within ${String(limits.maxPages)} pages`);
    }
    const answer = await fetchPage(cursor);
    if (!answer.ok) return answer;
    warnings.push(...answer.diagnostics);
    const { table } = answer.value;
    const at = `page ${String(page)}`;

    const bytes = utf8Length(JSON.stringify(table));
    if (bytes > limits.maxPageBytes) {
      return problem(
        `answered ${at} of ${String(bytes)} bytes, over ${String(limits.maxPageBytes)}`,
      );
    }
    if (table.rows.length > limits.maxPageRows) {
      return problem(
        `answered ${at} with ${String(table.rows.length)} rows, over ${String(limits.maxPageRows)}`,
      );
    }
    const checked = checkTable(table, `${verb}, ${at}`);
    if (!checked.ok) return checked;
    if (answer.value.truncated === true) {
      return problem(`says its own limit cut ${at} short, so the table would be incomplete`);
    }

    if (columns === undefined) columns = table.columns;
    else if (!sameColumns(columns, table.columns)) {
      return problem(`answered ${at} with other columns than page 1`);
    }
    for (const row of table.rows) {
      if (keys.has(row.key)) return problem(`answered the key '${row.key}' twice, again on ${at}`);
      keys.add(row.key);
      rows.push(row);
    }
    if (rows.length > limits.maxRows) {
      return problem(`passed ${String(limits.maxRows)} rows by ${at}`);
    }

    const next = answer.value.cursor;
    if (next === undefined) return ok({ columns, rows }, warnings);
    if (seen.has(next)) {
      return problem(`gave the cursor '${next}' a second time on ${at}, so it would never end`);
    }
    seen.add(next);
    cursor = next;
  }
}

function sameColumns(first: readonly Column[], other: readonly Column[]): boolean {
  return (
    first.length === other.length &&
    first.every(
      (column, index) => column.name === other[index]?.name && column.type === other[index]?.type,
    )
  );
}

/** The UTF-8 length of a string, counted rather than encoded: this package names no runtime. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one code point of four bytes.
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}
