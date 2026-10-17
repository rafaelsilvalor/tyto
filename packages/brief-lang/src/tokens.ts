import { ExternalTokenizer } from '@lezer/lr';

import { Frontmatter, blankRun, virtualNewline } from './brief.parser.terms.js';

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
const DASH = 45;

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
