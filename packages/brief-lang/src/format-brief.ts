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
  /**
   * How deep a directive sits in the template's tree, by the name the brief writes (ADR 0207):
   * `slotDepth` over the brief's manifest. Each directive is indented by that many units and its
   * body lines one more, so the nesting shows. Absent, every directive is at column 0, which is
   * what a brief whose template is not known has always looked like.
   */
  readonly depthOf?: (name: string) => number;
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
 *
 * A comment line inside a block counts as one of its body lines (TYTO-680, ADR 0204): it is
 * indented like them, so a column-0 `//` between two body lines is drawn inside the block it
 * belongs to. A comment at the top level is a `Comment` straight under the brief and stays
 * where it is.
 */
function bodyTextStarts(top: SyntaxNode, lines: readonly Line[]): Map<number, number> {
  const starts = new Map<number, number>();
  const cursor = top.cursor();
  do {
    const inBlock =
      cursor.name === 'BlockText' ||
      (cursor.name === 'Comment' && cursor.node.parent?.name === 'Directive');
    if (inBlock) starts.set(lineStartOf(lines, cursor.from), cursor.from);
  } while (cursor.next());
  return starts;
}

/**
 * How many indent units each line that is not blank gets, keyed by the line's start: a
 * directive's head line its depth in the template's tree, its body and comment lines one more
 * (ADR 0207). A top-level comment is not here and stays where it is.
 */
function indentLevels(
  top: SyntaxNode,
  text: string,
  lines: readonly Line[],
  depthOf: (name: string) => number,
): Map<number, number> {
  const levels = new Map<number, number>();
  for (let directive = top.firstChild; directive !== null; directive = directive.nextSibling) {
    if (directive.name !== 'Directive') continue;
    const namespace = directive.getChild('Namespace');
    const name = directive.getChild('Name');
    const written =
      (namespace === null ? '' : text.slice(namespace.from, namespace.to)) +
      (name === null ? '' : text.slice(name.from, name.to));
    const depth = Math.max(0, Math.trunc(depthOf(written)));
    levels.set(lineStartOf(lines, directive.from), depth);
    for (let child = directive.firstChild; child !== null; child = child.nextSibling) {
      if (child.name === 'BodyLine') {
        const body = child.getChild('BlockText');
        if (body !== null) levels.set(lineStartOf(lines, body.from), depth + 1);
      } else if (child.name === 'Comment') {
        levels.set(lineStartOf(lines, child.from), depth + 1);
      }
    }
  }
  return levels;
}

/** The start of the line `offset` is on. Lines are sorted; a binary search keeps it linear. */
function lineStartOf(lines: readonly Line[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lines[middle]!.from <= offset) low = middle;
    else high = middle - 1;
  }
  return lines[low]?.from ?? 0;
}

interface BlockLines {
  /** The directive each head, body and comment line belongs to, keyed by the line's start. */
  readonly owner: Map<number, SyntaxNode>;
  /** The starts of the lines of each directive that carry text, in order. */
  readonly textLines: Map<SyntaxNode, number[]>;
}

/**
 * Which directive each line belongs to, and which of its lines are text: a head with text of
 * its own (`::lamina Um`) and every body line. A comment line belongs to its block but is not
 * text — it is skipped as if it were not there (ADR 0204). A blank line inside a block is a
 * paragraph exactly when a line of text of the same block stands on each side of it (ADR 0205),
 * which is the rule `parseBrief` marks a `Break` `paragraph` by.
 */
function blockLinesOf(top: SyntaxNode, text: string, lines: readonly Line[]): BlockLines {
  const owner = new Map<number, SyntaxNode>();
  const textLines = new Map<SyntaxNode, number[]>();
  for (let directive = top.firstChild; directive !== null; directive = directive.nextSibling) {
    if (directive.name !== 'Directive') continue;
    const starts: number[] = [];
    const head = lineStartOf(lines, directive.from);
    owner.set(head, directive);
    const inline = directive.getChild('InlineBody');
    if (inline !== null && !isBlankText(text.slice(inline.from, inline.to))) starts.push(head);
    for (let child = directive.firstChild; child !== null; child = child.nextSibling) {
      const body = child.name === 'BodyLine' ? child.getChild('BlockText') : null;
      if (body !== null) {
        const start = lineStartOf(lines, body.from);
        owner.set(start, directive);
        starts.push(start);
      } else if (child.name === 'Comment') {
        owner.set(lineStartOf(lines, child.from), directive);
      }
    }
    textLines.set(directive, starts);
  }
  return { owner, textLines };
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
 * - A directive is indented by `indentUnit` spaces for each level it sits below the top of the
 *   template's tree (`depthOf`, ADR 0207), and its body lines one level more; a comment line
 *   inside a block is indented like them.
 * - No line ends in spaces or tabs.
 * - A run of blank lines becomes one empty line. Inside a block one is kept only where it is a
 *   paragraph, between two of the block's lines of text with comments skipped (ADR 0205); so
 *   none under a head with no text of its own. None before the first line or after the last.
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
  const levels = indentLevels(top, text, lines, options.depthOf ?? (() => 0));
  const headStarts = new Map<number, number>();
  for (let node = top.firstChild; node !== null; node = node.nextSibling) {
    if (node.name === 'Directive') headStarts.set(lineStartOf(lines, node.from), node.from);
  }
  const blocks = blockLinesOf(top, text, lines);
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
    // Inside a block — the lines on both sides are the same directive's, the one below a body
    // or comment line — it is kept only as a paragraph: a line of text of that block above it
    // and one below, with comments skipped (ADR 0204, ADR 0205). So none stays under a head
    // with no text, beside a comment that has no text past it, or at the block's end.
    const below = lines[after]!;
    const above = lines[before]!;
    const block = blocks.owner.get(below.from);
    if (
      block !== undefined &&
      bodyStarts.has(below.from) &&
      !inFrontmatter(above) &&
      blocks.owner.get(above.from) === block
    ) {
      const own = blocks.textLines.get(block) ?? [];
      const here = lines[index]!.from;
      return own.some((start) => start < here) && own.some((start) => start > here);
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

    const textStart = bodyStarts.get(line.from) ?? headStarts.get(line.from);
    if (textStart !== undefined) {
      replace(line.from, textStart, unit.repeat(levels.get(line.from) ?? 0));
    }
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
