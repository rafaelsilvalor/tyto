import { ExternalTokenizer } from '@lezer/lr';

import { Frontmatter, virtualNewline } from './brief.parser.terms.js';

/**
 * The two tokens a regular expression cannot recognise, because both depend on where in
 * the document the parser happens to be rather than on what the characters are.
 *
 * Pure: `@lezer/lr` runs unchanged in Node, in the browser and in a worker (ADR 0010).
 */

const NEWLINE = 10;
const TAB = 9;
const SPACE = 32;
const DASH = 45;

/** True when the line starting at `offset` is exactly `---`, ignoring trailing spaces. */
function isFence(input: { peek: (offset: number) => number }, offset: number): boolean {
  if (input.peek(offset) !== DASH || input.peek(offset + 1) !== DASH) return false;
  if (input.peek(offset + 2) !== DASH) return false;

  let after = offset + 3;
  while (input.peek(after) === SPACE || input.peek(after) === TAB) after += 1;
  const end = input.peek(after);
  return end === NEWLINE || end < 0;
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
  // Past the opening fence's newline, then on until the closing one.
  while (input.peek(offset) >= 0 && input.peek(offset) !== NEWLINE) offset += 1;
  if (input.peek(offset) < 0) return;
  offset += 1;

  while (input.peek(offset) >= 0) {
    if (isFence(input, offset)) {
      while (input.peek(offset) >= 0 && input.peek(offset) !== NEWLINE) offset += 1;
      if (input.peek(offset) === NEWLINE) offset += 1;
      input.acceptToken(Frontmatter, offset);
      return;
    }
    while (input.peek(offset) >= 0 && input.peek(offset) !== NEWLINE) offset += 1;
    if (input.peek(offset) === NEWLINE) offset += 1;
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
