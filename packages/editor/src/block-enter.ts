import { EditorSelection, type EditorState, type Line, type Transaction } from '@codemirror/state';
import { type Command, type KeyBinding } from '@codemirror/view';

/**
 * Enter in a brief, as an indented block wants it (TYTO-305, ADR 0087's note of 2026-10-16).
 *
 * The language ignores blank lines inside a block, and a block ends only at the next line
 * with text back at column 0 (ADR 0087). This is the typing side of the same rule, and it
 * changes nothing the language decides:
 *
 * - on a line with text, the new line takes that line's indent, so a block is typed with one
 *   Tab and then Enter only;
 * - on a blank line whose previous line has text, the blank line stays (emptied, since its
 *   spaces mean nothing) and the new line takes the previous line's indent, so one blank line
 *   separates two groups and typing goes on aligned;
 * - on a blank line whose previous line is blank too, no line is added: the current one goes
 *   back to column 0, which is where the next directive starts;
 * - and when that line is already empty at column 0 there is no indent to take away, so Enter
 *   adds a plain new line. Enter is never a key that does nothing.
 *
 * Blank is empty or spaces and tabs only, as the grammar's `blankLines` reads it.
 *
 * The brief language has no indent service, and CodeMirror's `insertNewlineAndIndent` asks the
 * syntax tree, which answers column 0 for every line of a brief. So this command computes the
 * indent itself, from the text, rather than teaching the tree a rule it would have to guess.
 *
 * The frontmatter is YAML, whose indentation is its own business: Enter there is left to
 * CodeMirror's default, which is what the frontmatter had before this command.
 */

const FENCE = /^---[ \t]*$/;
const LEADING = /^[ \t]*/;

const isBlank = (line: Line): boolean => line.text.trim() === '';

const indentOf = (line: Line): string => LEADING.exec(line.text)?.[0] ?? '';

/**
 * Whether `line` sits in the frontmatter: after an opening fence on line 1 and not past the
 * closing one. An unclosed frontmatter counts, since that is a person still typing it.
 */
export const inFrontmatter = (state: EditorState, line: Line): boolean => {
  const { doc } = state;
  if (doc.lines === 0 || !FENCE.test(doc.line(1).text)) return false;
  if (line.number === 1) return true;
  for (let number = 2; number < line.number; number += 1) {
    if (FENCE.test(doc.line(number).text)) return false;
  }
  return true;
};

/** The transaction Enter makes in a brief, or `null` where CodeMirror's default should run. */
export const blockEnterTransaction = (state: EditorState): Transaction | null => {
  if (state.readOnly) return null;
  const { doc } = state;
  if (state.selection.ranges.some((range) => inFrontmatter(state, doc.lineAt(range.from)))) {
    return null;
  }

  const changes = state.changeByRange((range) => {
    const line = doc.lineAt(range.from);
    const previous = line.number > 1 ? doc.line(line.number - 1) : null;

    if (range.empty && isBlank(line)) {
      // The second blank line in a row: back to column 0, on the same line. Only when there is
      // an indent to take away — an empty line at column 0 gets a plain new line, so Enter is
      // never a key that does nothing (spacing between two directives, a third blank line).
      if (previous !== null && isBlank(previous) && line.length > 0) {
        return {
          changes: { from: line.from, to: line.to, insert: '' },
          range: EditorSelection.cursor(line.from),
        };
      }
      // The first blank line: it stays, empty, and the next line keeps the block's indent.
      const insert = `\n${previous === null ? '' : indentOf(previous)}`;
      return {
        changes: { from: line.from, to: line.to, insert },
        range: EditorSelection.cursor(line.from + insert.length),
      };
    }

    // A line with text, or a selection: split, and the new line keeps this line's indent.
    const indent = indentOf(line);
    // A cursor inside the indent itself leaves an empty line above, not a line of spaces.
    const from = range.from - line.from <= indent.length ? line.from : range.from;
    // The spaces after the cursor would push the moved text past the indent.
    const end = doc.lineAt(range.to);
    let to = range.to;
    while (to < end.to && /[ \t]/.test(end.text.charAt(to - end.from))) to += 1;
    const insert = `\n${indent}`;
    return {
      changes: { from, to, insert },
      range: EditorSelection.cursor(from + insert.length),
    };
  });

  return state.update(changes, { scrollIntoView: true, userEvent: 'input' });
};

export const insertNewlineInBlock: Command = (view) => {
  const transaction = blockEnterTransaction(view.state);
  if (transaction === null) return false;
  view.dispatch(transaction);
  return true;
};

/**
 * Plain Enter only. Shift+Enter has no binding here, so it reaches CodeMirror's default
 * keymap, unchanged; an open completion list takes Enter first, from its higher precedence.
 */
export const blockEnterKeymap: readonly KeyBinding[] = [
  { key: 'Enter', run: insertNewlineInBlock },
];
