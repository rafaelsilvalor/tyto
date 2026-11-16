import { ExternalTokenizer } from '@lezer/lr';

import {
  Formula,
  Frontmatter,
  blankRun,
  bodyBreak,
  commentBreak,
  virtualNewline,
} from './brief.parser.terms.js';

/**
 * The two tokens a regular expression cannot recognise, because both depend on where in
 * the document the parser happens to be rather than on what the characters are.
 *
 * Pure: `@lezer/lr` runs unchanged in Node, in the browser and in a worker (ADR 0010).
 */

const NEWLINE = 10;
const RETURN = 13;
const TAB = 9;
const SPACE = 32;
const DOLLAR = 36;
const DASH = 45;
const SLASH = 47;
const DIGIT_ZERO = 48;
const DIGIT_NINE = 57;
const COLON = 58;
const BACKSLASH = 92;

type Input = { peek: (offset: number) => number };

/**
 * True where a line ends: `\n`, `\r\n` or a lone `\r` (TYTO-64).
 *
 * The same three the grammar's `lineBreak` accepts. This tokenizer scans by hand and
 * cannot share that rule, so the two have to be changed together — a fence recognised
 * here but not there, or the other way round, is a brief that half-parses.
 */
function isLineEnd(code: number): boolean {
  return code === NEWLINE || code === RETURN;
}

/** Past the line ending at `offset`, however many units it takes. `\r\n` is one break. */
function afterLineEnd(input: Input, offset: number): number {
  if (input.peek(offset) === RETURN && input.peek(offset + 1) === NEWLINE) return offset + 2;
  return offset + 1;
}

/** True when the line starting at `offset` is exactly `---`, ignoring trailing spaces. */
function isFence(input: Input, offset: number): boolean {
  if (input.peek(offset) !== DASH || input.peek(offset + 1) !== DASH) return false;
  if (input.peek(offset + 2) !== DASH) return false;

  let after = offset + 3;
  while (input.peek(after) === SPACE || input.peek(after) === TAB) after += 1;
  const end = input.peek(after);
  return isLineEnd(end) || end < 0;
}

/**
 * The whole frontmatter block, delimiters included, as one token.
 *
 * Its contents are YAML, and the grammar deliberately does not describe them: a second,
 * worse YAML would be the only thing that could come of trying. `parseBrief` (E3.2) runs
 * a real YAML parser over the text this token covers.
 *
 * Only at offset 0. `---` anywhere else is text.
 */
export const frontmatterBlock = new ExternalTokenizer((input) => {
  if (input.pos !== 0 || !isFence(input, 0)) return;

  let offset = 0;
  // Past the opening fence's line break, then on until the closing one.
  while (input.peek(offset) >= 0 && !isLineEnd(input.peek(offset))) offset += 1;
  if (input.peek(offset) < 0) return;
  offset = afterLineEnd(input, offset);

  while (input.peek(offset) >= 0) {
    if (isFence(input, offset)) {
      while (input.peek(offset) >= 0 && !isLineEnd(input.peek(offset))) offset += 1;
      if (input.peek(offset) >= 0) offset = afterLineEnd(input, offset);
      input.acceptToken(Frontmatter, offset);
      return;
    }
    while (input.peek(offset) >= 0 && !isLineEnd(input.peek(offset))) offset += 1;
    if (input.peek(offset) >= 0) offset = afterLineEnd(input, offset);
  }

  // No closing fence: leave it unmatched so the parser reports it rather than swallowing
  // the whole document as metadata.
});

/**
 * A zero-length line break at end of input.
 *
 * A directive is terminated by a break, and a file whose last line has none would end in
 * an error node — a spurious red squiggle in the editor on a perfectly good brief. Lezer's
 * own grammars solve automatic semicolons the same way. It is guarded to end of input, so
 * it cannot fire twice at the same place and spin.
 */
export const endOfInput = new ExternalTokenizer((input) => {
  if (input.next < 0) input.acceptToken(virtualNewline);
});

function isBlank(code: number): boolean {
  return code === SPACE || code === TAB;
}

/**
 * A run of blank lines at the top level, empty or holding only spaces and tabs (ADR 0087).
 *
 * A blank line has no meaning, and a line of spaces is a blank line nobody can see. The
 * grammar's own tokens cannot say so. `$[ \t]+` would also match the indent of a line with
 * text and no directive above it, which must stay an error at that indent; and the break in
 * front of a blank line is the start of a `blockIndent` that takes the blank lines with it,
 * which is right inside a block and invalid after a comment or the frontmatter. Only the end
 * of each line tells them apart, and a Lezer token has no lookahead.
 *
 * So this scans by hand: the break the current line ends with, if the run starts on one,
 * then every following line that is blank, and it stops at the start of the first line that
 * is not — so an orphan indent after the run is still the error it was. At end of input the
 * last line needs no break. Inside a directive the token is not valid, and Lezer hands the
 * same characters to the grammar's own tokens.
 */
export const blankLines = new ExternalTokenizer((input) => {
  let end = 0;
  if (isLineEnd(input.peek(0))) end = afterLineEnd(input, 0);

  for (;;) {
    let offset = end;
    while (isBlank(input.peek(offset))) offset += 1;
    const next = input.peek(offset);
    if (next < 0) {
      end = offset;
      break;
    }
    if (!isLineEnd(next)) break;
    end = afterLineEnd(input, offset);
  }

  if (end > 0) input.acceptToken(blankRun, end);
});

/** Past the end of the line holding `offset`, line break included, or at end of input. */
function nextLineStart(input: Input, offset: number): number {
  let at = offset;
  while (input.peek(at) >= 0 && !isLineEnd(input.peek(at))) at += 1;
  return input.peek(at) < 0 ? at : afterLineEnd(input, at);
}

/** True when `//` starts at `offset`. */
function isCommentAt(input: Input, offset: number): boolean {
  return input.peek(offset) === SLASH && input.peek(offset + 1) === SLASH;
}

/** True when `::` starts at `offset`: a directive. */
function isDirectiveAt(input: Input, offset: number): boolean {
  return input.peek(offset) === COLON && input.peek(offset + 1) === COLON;
}

/** The first line from `lineStart` on that is not blank: where it starts, and its first character. */
interface FilledLine {
  readonly lineStart: number;
  readonly at: number;
}

/** Past blank lines, to the first one holding something; `undefined` when only blank lines are left. */
function firstFilledLine(input: Input, from: number): FilledLine | undefined {
  let lineStart = from;
  for (;;) {
    let at = lineStart;
    while (isBlank(input.peek(at))) at += 1;
    const next = input.peek(at);
    if (next < 0) return undefined;
    if (!isLineEnd(next)) return { lineStart, at };
    lineStart = afterLineEnd(input, at);
  }
}

/**
 * True when the block goes on from `offset`: the first line that is neither blank nor a
 * column-0 comment is not a directive. An indented line always is the block's; since TYTO-708
 * a column-0 text line is too (ADR 0202), so only a `::` at column 0, or the end of the input,
 * ends it.
 */
function blockGoesOn(input: Input, offset: number): boolean {
  let from = offset;
  for (;;) {
    const line = firstFilledLine(input, from);
    if (line === undefined) return false;
    if (line.at > line.lineStart) return true;
    if (!isCommentAt(input, line.at)) return !isDirectiveAt(input, line.at);
    from = nextLineStart(input, line.at);
  }
}

/**
 * The line break, blank lines and indent in front of a comment line that belongs to the
 * block above it (TYTO-680, ADR 0204).
 *
 * A comment inside a block is skipped and the block goes on, the way a blank line is
 * (ADR 0087). An indented `//` is always the block's: nothing else can sit at an indent
 * inside a block. A `//` at column 0 is the block's only when the block goes on after it —
 * the next line that is neither blank nor another column-0 comment is not a directive
 * (ADR 0204's note of 2026-11-16: it read "is indented" until a column-0 text line became a
 * body line, TYTO-708). Otherwise the block ends at it, and it is the top-level comment it
 * always was, so a comment above a directive still belongs to nothing. That depends on lines
 * past the token, which is why this scans by hand.
 *
 * The token stops right before the `//`, so the `Comment` that follows is the grammar's own
 * token and covers the same characters a top-level comment does. It is only asked inside a
 * directive, where `commentBreak` is valid; anywhere else Lezer skips this tokenizer.
 */
export const commentsInBlocks = new ExternalTokenizer((input) => {
  if (!isLineEnd(input.peek(0))) return;

  const line = firstFilledLine(input, afterLineEnd(input, 0));
  if (line === undefined || !isCommentAt(input, line.at)) return;
  if (line.at === line.lineStart && !blockGoesOn(input, nextLineStart(input, line.at))) return;
  input.acceptToken(commentBreak, line.at);
});

/**
 * The line break and blank lines in front of a column-0 text line, which continues the block
 * above it (TYTO-708, ADR 0202 decision 2).
 *
 * Indentation never changes what a brief compiles to, so a line that starts with neither
 * `::` nor `//` is a body line whether it is indented or not. An indented one is the grammar's
 * `blockIndent`; this hands out the break for the other, and only when the line really starts
 * at column 0 with something that is neither a directive nor a comment — the start of the next
 * line, which a Lezer token cannot see. Blank lines in front of it are taken along, as
 * `blockIndent` takes them, so a blank line between two column-0 lines is the same paragraph
 * boundary it is between two indented ones (ADR 0205).
 *
 * Only asked inside a directive, where `bodyBreak` is valid: text before the first directive
 * is still the error it was.
 */
export const bodyBreaks = new ExternalTokenizer((input) => {
  if (!isLineEnd(input.peek(0))) return;

  const line = firstFilledLine(input, afterLineEnd(input, 0));
  if (line === undefined || line.at !== line.lineStart) return;
  if (isDirectiveAt(input, line.at) || isCommentAt(input, line.at)) return;
  input.acceptToken(bodyBreak, line.lineStart);
});

function isDigit(code: number): boolean {
  return code >= DIGIT_ZERO && code <= DIGIT_NINE;
}

/**
 * A formula, `$…$`, as one token (ADR 0206 decisions 2 and 3, TYTO-734).
 *
 * Pandoc's rule, on one line: a `$` opens a formula only when the character after it is not a
 * space, and a later `$` closes it only when the character before it is not a space and the
 * character after it is not a digit. That is what keeps money plain: `R$ 50` opens nothing, and
 * in `R$50 a R$60` the second `$` is followed by a digit, so nothing closes the first. A `\`
 * inside takes the character after it along, so `\$` never closes the formula. `$$` is a
 * formula with nothing in it, which `parseBrief` reports.
 *
 * Inside, everything belongs to the formula: the grammar sees one token, so a `\` there is
 * not a line break and a `{` is not a mark. Where nothing closes, no token is produced and the
 * `$` is plain text, as it always was.
 */
export const formulas = new ExternalTokenizer((input) => {
  if (input.next !== DOLLAR) return;
  const first = input.peek(1);
  if (first < 0 || isBlank(first) || isLineEnd(first)) return;

  let offset = 1;
  for (;;) {
    const code = input.peek(offset);
    if (code < 0 || isLineEnd(code)) return;
    if (code === BACKSLASH) {
      const escaped = input.peek(offset + 1);
      if (escaped < 0 || isLineEnd(escaped)) return;
      offset += 2;
      continue;
    }
    if (code === DOLLAR && !isBlank(input.peek(offset - 1)) && !isDigit(input.peek(offset + 1))) {
      input.acceptToken(Formula, offset + 1);
      return;
    }
    offset += 1;
  }
});
