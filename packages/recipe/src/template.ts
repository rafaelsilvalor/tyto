import { type Result, type SourceRange, diagnostic, err, ok } from '@tyto/core';

import { resolveColumn } from './columns.js';
import type { Problems } from './support.js';
import { type CellValue, type Column, type Row, type Table, cellText } from './table.js';

/**
 * The text templates `compose` and `rules` fill from a row (ADR 0136): literal text and
 * `{column|filter|filter}` placeholders, as in `{course|slug}_{phase|slug}`.
 *
 * A placeholder names one column and any number of the fixed filters below, applied left to
 * right. `{column|}` is the column as it is: in a recipe line `{name}` is always a parameter
 * (ADR 0128), so a template written there names a column with at least the `|`. A template
 * read from a data file is not filled with parameters and may write `{column}` too. A brace
 * has no escape: every `{` opens a placeholder and a `}` outside one is refused, because a
 * brace in a name or a key is something no recipe has needed yet.
 */

/** `slug` follows the private plugin's Python order: lower case first, then NFKD. */
const FILTERS = {
  slug: (text: string) =>
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{Mn}/gu, '')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, ''),
  trim: (text: string) => text.trim(),
  upper: (text: string) => text.toUpperCase(),
  lower: (text: string) => text.toLowerCase(),
} as const satisfies Record<string, (text: string) => string>;

export type TemplateFilter = keyof typeof FILTERS;

export const TEMPLATE_FILTERS = Object.keys(FILTERS) as readonly TemplateFilter[];

type Part =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'column';
      readonly column: string;
      readonly filters: readonly TemplateFilter[];
    };

export interface Template {
  readonly text: string;
  readonly parts: readonly Part[];
}

const PLACEHOLDER_BODY = /^([A-Za-z_][\w-]*)((?:\|[a-z]*)*)$/u;

/** The template's parts, or why it is not one, as the end of a sentence about the template. */
export function parseTemplate(text: string): Result<Template, string> {
  const parts: Part[] = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('{', index);
    const literal = text.slice(index, open === -1 ? text.length : open);
    const stray = literal.indexOf('}');
    if (stray !== -1) {
      return err(`has a '}' at character ${String(index + stray + 1)} that closes nothing`);
    }
    if (literal !== '') parts.push({ kind: 'text', text: literal });
    if (open === -1) break;
    const close = text.indexOf('}', open);
    if (close === -1)
      return err(`opens a placeholder at character ${String(open + 1)} and never closes it`);
    const body = text.slice(open + 1, close);
    const match = PLACEHOLDER_BODY.exec(body);
    if (match?.[1] === undefined) {
      return err(
        `has the placeholder '{${body}}', and a placeholder is written {column} or ` +
          '{column|filter|filter}',
      );
    }
    const filters: TemplateFilter[] = [];
    for (const name of (match[2] ?? '').split('|').slice(1)) {
      if (name === '') continue;
      if (!Object.hasOwn(FILTERS, name)) {
        return err(
          `uses the filter '${name}', which does not exist; the filters are ${TEMPLATE_FILTERS.join(', ')}`,
        );
      }
      filters.push(name as TemplateFilter);
    }
    parts.push({ kind: 'column', column: match[1], filters });
    index = close + 1;
  }
  return ok({ text, parts });
}

/** How a filled template treats an empty placeholder. */
export interface FillMode {
  /** Drop an empty placeholder and the literal written right before it. */
  readonly skipEmpty?: boolean;
  /** The whole value is empty when any placeholder is. */
  readonly required?: boolean;
}

/** A template whose placeholders name columns of one table, ready to fill its rows. */
export interface BoundTemplate {
  fill(row: Row): string | null;
}

/** Checks a parsed template's columns against the table; an unknown one lands at `range`. */
export function bindTemplate(
  template: Template,
  table: Table,
  aliases: ReadonlyMap<string, string>,
  range: SourceRange,
  mode: FillMode = {},
): Result<BoundTemplate, Problems> {
  const columns = new Map<string, Column>();
  for (const part of template.parts) {
    if (part.kind !== 'column' || columns.has(part.column)) continue;
    const column = resolveColumn(table, part.column, range, aliases);
    if (!column.ok) return column;
    columns.set(part.column, column.value);
  }
  const value = (part: Part, row: Row): string => {
    if (part.kind === 'text') return part.text;
    const cell: CellValue | undefined = row.values[columns.get(part.column)?.name ?? ''];
    return part.filters.reduce((text, filter) => FILTERS[filter](text), cellText(cell));
  };
  return ok({ fill: (row) => fillParts(template.parts, (part) => value(part, row), mode) });
}

/**
 * Joins the parts. Without `skipEmpty` an empty placeholder is an empty string in place. With
 * it, the template reads as a list: the literal before the first placeholder and the one after
 * the last always stay, and each other placeholder that is not empty is preceded by the literal
 * written right before it, unless it is the first one kept. So `{a}, {b} and {c}` gives
 * `a and c` without `b`, and `a, b` without `c`. A template whose every placeholder is empty
 * is empty. Empty means blank once the filters ran, so `slug` of `!!!` is empty too.
 */
function fillParts(
  parts: readonly Part[],
  value: (part: Part) => string,
  mode: FillMode,
): string | null {
  const texts = parts.map(value);
  const placeholders = parts.flatMap((part, index) => (part.kind === 'column' ? [index] : []));
  const blank = (index: number) => (texts[index] ?? '').trim() === '';
  if (mode.required === true && placeholders.some(blank)) return null;
  if (mode.skipEmpty !== true || placeholders.length === 0) return emptyAsNull(texts.join(''));

  const kept = placeholders.filter((index) => !blank(index));
  if (kept.length === 0) return null;
  const first = placeholders[0] ?? 0;
  const last = placeholders[placeholders.length - 1] ?? 0;
  let result = texts.slice(0, first).join('');
  kept.forEach((index, position) => {
    const before = parts[index - 1];
    if (position > 0 && before?.kind === 'text') result += before.text;
    result += texts[index] ?? '';
  });
  return emptyAsNull(result + texts.slice(last + 1).join(''));
}

/** A table holds `null`, never `''`, for an empty cell. */
function emptyAsNull(text: string): string | null {
  return text === '' ? null : text;
}

/** A template problem as a diagnostic, at the argument or entry that wrote it. */
export function templateProblem(template: string, problem: string, range: SourceRange): Problems {
  return [diagnostic('E_RECIPE_TEMPLATE', { template, problem }, { range })];
}
