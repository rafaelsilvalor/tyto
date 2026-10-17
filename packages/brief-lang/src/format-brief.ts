import type { SyntaxNode } from '@lezer/common';
import { type Diagnostics, type Result, err, ok } from '@tyto/core';

import { parser } from './brief.parser.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseBrief } from './parse-brief.js';

/**
 * "Format Brief" (TYTO-297, ADR 0096): a brief rewritten into its canonical shape, changing
 * only what the language ignores.
 *
 * The language ignores four things, and those are the four this touches: how far a body line
 * is indented (any indent is a body line, ADR 0004), spaces and tabs at the end of a line (ADR
 * 0096), how many blank lines there are in a row (ADR 0087), and which line ending the file
 * uses (TYTO-64). So the Scene a brief compiles to is the same before and after, which is the
 * guarantee `tools/contract-test` holds across every fixture and every built-in example.
 *
 * Nothing inside a line changes: not the spacing after a name, not a `|`, not a mark, an
 * escape or a `\` break. A brief with a syntax error is refused rather than guessed at — what
 * the formatter would move is exactly what the parser could not place.
 *
 * Pure: no Node, no DOM (ADR 0010).
 */

export interface FormatOptions {
  /** Spaces a body line is indented by. The desktop's `tabSize` setting; 2 by default. */
  readonly indentUnit?: number;
}

/**
 * One replacement in the original text, offsets into it. Edits are sorted and never overlap.
 *
 * Returned rather than only the new text so an editor can apply them as changes: the caret
 * inside a line whose indent moved stays on the same character, which replacing the whole
 * document would not do.
 */
export interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export const DEFAULT_INDENT_UNIT = 2;

interface Line {
  /** Where the line starts. */
  readonly from: number;
  /** Where its text ends, before the line break. */
  readonly end: number;
  /** Past its line break; equal to `end` on a last line with none. */
  readonly next: number;
}

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  while (from < text.length) {
    let end = from;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end += 1;
    let next = end;
    if (text[next] === '\r') next += 1;
    if (text[next] === '\n' && (next === end || text[end] === '\r')) next += 1;
    lines.push({ from, end, next });
    from = next;
  }
  return lines;
}

/** The file's own line ending: the first one it uses, and `\n` when it has none. */
export function lineEndingOf(text: string): '\n' | '\r\n' | '\r' {
  const at = text.search(/[\r\n]/u);
  if (at < 0 || text[at] === '\n') return '\n';
  return text[at + 1] === '\n' ? '\r\n' : '\r';
}

const isBlankText = (value: string): boolean => /^[ \t]*$/u.test(value);

/** Where the spaces and tabs a line ends with start. */
function trimmedEnd(text: string, line: Line): number {
  let end = line.end;
  while (end > line.from && (text[end - 1] === ' ' || text[end - 1] === '\t')) end -= 1;
  return end;
}

/**
 * The offset each body line's text starts at, keyed by the line's start. Read off the tree —
 * a `BodyLine`'s `BlockText` begins right after its indent — rather than off the text, so a
 * line counts as a body line only where the grammar says it is one.
 */
function bodyTextStarts(top: SyntaxNode, lines: readonly Line[]): Map<number, number> {
  const starts = new Map<number, number>();
  const cursor = top.cursor();
  const lineStartOf = (offset: number): number => {
    // Lines are sorted; a binary search keeps a long brief linear.
    let low = 0;
    let high = lines.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lines[middle]!.from <= offset) low = middle;
      else high = middle - 1;
    }
    return lines[low]?.from ?? 0;
  };
  do {
    if (cursor.name === 'BlockText') starts.set(lineStartOf(cursor.from), cursor.from);
  } while (cursor.next());
  return starts;
}

/**
 * True when trimming the frontmatter's line ends leaves its YAML saying the same thing.
 *
 * Almost always: YAML ignores trailing spaces. A literal block scalar (`|`) keeps them, and
 * there the frontmatter is left byte for byte, because the guarantee is the Scene.
 */
function frontmatterTrimIsSafe(text: string, node: SyntaxNode, trimmed: string): boolean {
  const before = parseFrontmatter(text, node.from, node.to);
  const after = parseFrontmatter(trimmed, 0, trimmed.length);
  if (before.diagnostics.length > 0 || after.diagnostics.length > 0) return false;
  return JSON.stringify(before.data) === JSON.stringify(after.data);
}

/**
 * The edits that put a brief in its canonical shape, or the syntax errors that stop it.
 *
 * - A body line is indented by exactly `indentUnit` spaces.
 * - No line ends in spaces or tabs.
 * - A run of blank lines becomes one empty line; none is kept between a directive's head and
 *   its first body line, before the first line or after the last.
 * - The frontmatter is left byte for byte, but for the spaces its lines end with.
 * - Every line ends in the file's own line ending, and the last line ends in one too.
 */
export function formatBriefEdits(
  text: string,
  options: FormatOptions = {},
): Result<readonly TextEdit[], Diagnostics> {
  const parsed = parseBrief(text);
  const syntax = parsed.ok
    ? parsed.diagnostics.filter((item) => item.code === 'E_SYNTAX')
    : parsed.error.filter(
        (item) => item.code === 'E_SYNTAX' || item.code === 'E_FRONTMATTER_SYNTAX',
      );
  if (syntax.length > 0) return err(syntax);

  const unit = ' '.repeat(Math.max(1, Math.trunc(options.indentUnit ?? DEFAULT_INDENT_UNIT)));
  const ending = lineEndingOf(text);
  const top = parser.parse(text).topNode;
  const frontmatter = top.getChild('Frontmatter');
  const lines = linesOf(text);
  const bodyStarts = bodyTextStarts(top, lines);
  const edits: TextEdit[] = [];
  const replace = (from: number, to: number, insert: string): void => {
    if (text.slice(from, to) !== insert) edits.push({ from, to, insert });
  };

  const inFrontmatter = (line: Line): boolean => frontmatter !== null && line.from < frontmatter.to;
  const trimFrontmatter =
    frontmatter !== null &&
    frontmatterTrimIsSafe(
      text,
      frontmatter,
      lines
        .filter(inFrontmatter)
        .map(
          (line) => text.slice(line.from, trimmedEnd(text, line)) + text.slice(line.end, line.next),
        )
        .join(''),
    );
  const blank = (line: Line): boolean =>
    !inFrontmatter(line) && isBlankText(text.slice(line.from, line.end));

  /** Whether a blank line survives: the first of its run, unless the run is not wanted. */
  const keeps = (index: number): boolean => {
    if (index > 0 && blank(lines[index - 1]!)) return false;
    let before = index - 1;
    while (before >= 0 && blank(lines[before]!)) before -= 1;
    let after = index + 1;
    while (after < lines.length && blank(lines[after]!)) after += 1;
    // Nothing above it (and no frontmatter), or nothing below it.
    if (before < 0 || after >= lines.length) return false;
    // Between a head and its first body line: the line above is not a body line and the one
    // below is.
    const below = lines[after]!;
    const above = lines[before]!;
    if (bodyStarts.has(below.from) && !bodyStarts.has(above.from) && !inFrontmatter(above)) {
      return false;
    }
    return true;
  };

  for (const [index, line] of lines.entries()) {
    if (blank(line)) {
      // Removed with its line break; kept, it is emptied.
      if (!keeps(index)) {
        replace(line.from, line.next, '');
        continue;
      }
      replace(line.from, line.end, '');
      replace(line.end, line.next, ending);
      continue;
    }

    if (inFrontmatter(line)) {
      if (trimFrontmatter) replace(trimmedEnd(text, line), line.end, '');
      // Its own line breaks stay; only a missing last one is added.
      if (line.next === line.end) replace(line.end, line.end, ending);
      continue;
    }

    const bodyStart = bodyStarts.get(line.from);
    if (bodyStart !== undefined) replace(line.from, bodyStart, unit);
    replace(trimmedEnd(text, line), line.end, '');
    // The last line with text gets a line ending too: blank lines after it are removed whole,
    // so it is the line the file ends with.
    replace(line.end, line.next, ending);
  }

  // Built line by line, so already in order and never overlapping.
  return ok(edits);
}

/** The edits applied, back to front so each offset still means the original text. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let result = text;
  for (const edit of [...edits].reverse()) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}

/** The brief in its canonical shape, or the syntax errors that stop it. */
export function formatBrief(
  text: string,
  options: FormatOptions = {},
): Result<string, Diagnostics> {
  const edits = formatBriefEdits(text, options);
  if (!edits.ok) return edits;
  return ok(applyEdits(text, edits.value));
}
