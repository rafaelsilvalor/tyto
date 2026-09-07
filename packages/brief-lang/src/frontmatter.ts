import { type Diagnostic, type SourceRange, diagnostic, sourceRange } from '@tyto/core';
import { parseDocument } from 'yaml';

/**
 * The YAML half of a brief.
 *
 * The grammar marks the block from `---` to `---` and stops there on purpose — a grammar
 * that tried to describe YAML would be a second, worse YAML. A real parser runs here
 * instead, over exactly the text between the fences.
 *
 * `yaml` is the one dependency this package takes that is not Lezer. It has no
 * dependencies of its own, and it stays inside the pure boundary (ADR 0010) through its
 * export conditions rather than by having one build: the `node` condition resolves to a
 * build that reaches for `process` and `buffer`, the default condition to one that
 * imports nothing. A bundler pinned to the `node` condition for a browser target would
 * pull those in — the only way this package can end up with a Node dependency, and worth
 * knowing before anyone configures one.
 */

export interface FrontmatterResult {
  readonly data: Readonly<Record<string, unknown>>;
  /**
   * The span of each top-level key. `resolve` reports "this slot is not declared" against
   * a frontmatter key, and a diagnostic that pointed at the whole block instead would make
   * the author read four lines to find the one word that is wrong.
   */
  readonly ranges: Readonly<Record<string, SourceRange>>;
  readonly diagnostics: readonly Diagnostic[];
}

const EMPTY: FrontmatterResult = { data: {}, ranges: {}, diagnostics: [] };

/**
 * The key spans of a YAML mapping, offset back onto the brief.
 *
 * `yaml` reports a node's range as `[start, valueEnd, nodeEnd]` relative to the text it
 * was handed, which here is the block between the fences.
 */
function keyRanges(contents: unknown, offset: number): Record<string, SourceRange> {
  const items = (contents as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return {};

  const ranges: Record<string, SourceRange> = {};
  for (const item of items) {
    const key = (item as { key?: { value?: unknown; range?: [number, number, number] } }).key;
    if (typeof key?.value !== 'string' || !key.range) continue;
    ranges[key.value] = sourceRange(offset + key.range[0], offset + key.range[1]);
  }
  return ranges;
}

/**
 * The span between the fences, given the whole block the tokenizer matched.
 *
 * The opening fence always ends in a line break — the tokenizer refuses the block
 * otherwise — and the closing fence is the last line of the block, with or without a
 * break of its own on a file that ends there.
 */
function bodySpan(text: string, blockStart: number, blockEnd: number): [number, number] {
  const start = text.indexOf('\n', blockStart) + 1;
  const beforeTrailingBreak = text[blockEnd - 1] === '\n' ? blockEnd - 1 : blockEnd;
  const closingFenceStart = text.lastIndexOf('\n', beforeTrailingBreak - 1) + 1;
  return [start, Math.max(start, closingFenceStart)];
}

/** `yaml` reports a message with a code frame under it; the gutter wants the first line. */
function firstLine(message: string): string {
  const [line] = message.split('\n');
  return line ?? message;
}

/**
 * Parses the frontmatter and reports what went wrong without throwing.
 *
 * `parseDocument` collects every YAML error rather than stopping at the first, which is
 * the same promise the rest of the pipeline makes: one pass, every problem.
 */
export function parseFrontmatter(
  text: string,
  blockStart: number,
  blockEnd: number,
): FrontmatterResult {
  const [start, end] = bodySpan(text, blockStart, blockEnd);
  const body = text.slice(start, end);
  if (body.trim() === '') return EMPTY;

  const document = parseDocument(body);

  if (document.errors.length > 0) {
    return {
      data: {},
      ranges: {},
      diagnostics: document.errors.map((error) =>
        diagnostic(
          'E_SYNTAX',
          { problem: `the frontmatter is not valid YAML (${firstLine(error.message)})` },
          { range: sourceRange(start + error.pos[0], start + Math.min(error.pos[1], body.length)) },
        ),
      ),
    };
  }

  const value: unknown = document.toJS();
  if (value === null || value === undefined) return EMPTY;

  // A list or a scalar between the fences parses as YAML and still cannot be slots.
  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      data: {},
      ranges: {},
      diagnostics: [
        diagnostic(
          'E_SYNTAX',
          { problem: 'the frontmatter must be a mapping of keys to values' },
          { range: sourceRange(start, end) },
        ),
      ],
    };
  }

  return {
    data: value as Record<string, unknown>,
    ranges: keyRanges(document.contents, start),
    diagnostics: [],
  };
}
