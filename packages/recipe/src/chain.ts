/**
 * A step line that chains several steps with `|` (TYTO-706, ADR 0196 note of 2026-11-13).
 *
 * `where status != done | sort due | show table` is read exactly as three lines of the same
 * block. `|` already means three other things in a recipe, so **only a `|` that stands as a word
 * of its own splits**: a blank or the line's edge on both sides, outside a double-quoted string
 * and outside `{ }`.
 *
 * - A `|` description line starts with `|` and is a header line: it never reaches this reading.
 * - A pattern's alternation is written inside one word, quoted (`matches "a|b"`) or not
 *   (`pattern=^(poster|flyer)`): a word holds no blank, so its `|` never stands alone.
 * - A template's filters are written inside braces, `{due|slug}` or `{due | slug}`.
 *
 * So `a|b` never splits, and `a | b` splits only between steps.
 */

/** One step of a chained line, by its offsets in the line's text, blanks around it left out. */
export interface ChainSegment {
  readonly from: number;
  readonly to: number;
  /** The offset of the `|` before this segment; absent for the first. */
  readonly bar?: number;
}

const BLANK = /\s/u;

/** The steps a step line's text holds: one segment when it chains nothing. */
export function chainSegments(line: string): readonly ChainSegment[] {
  const bars: number[] = [];
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (quoted) {
      continue;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === '|' && depth === 0 && standsAlone(line, index)) {
      bars.push(index);
    }
  }
  const segments: ChainSegment[] = [];
  let start = 0;
  for (const [position, end] of [...bars, line.length].entries()) {
    const bar = position === 0 ? undefined : bars[position - 1];
    segments.push({ ...trimmed(line, start, end), ...(bar === undefined ? {} : { bar }) });
    start = end + 1;
  }
  return segments;
}

function standsAlone(line: string, index: number): boolean {
  const before = index === 0 || BLANK.test(line[index - 1] ?? '');
  const after = index === line.length - 1 || BLANK.test(line[index + 1] ?? '');
  return before && after;
}

function trimmed(line: string, from: number, to: number): { from: number; to: number } {
  let start = from;
  let end = to;
  while (start < end && BLANK.test(line[start] ?? '')) start += 1;
  while (end > start && BLANK.test(line[end - 1] ?? '')) end -= 1;
  return { from: start, to: end };
}
