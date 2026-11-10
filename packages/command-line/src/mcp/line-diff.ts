/**
 * What a write would change, as lines an agent reads before it writes (ADR 0185): the lines
 * kept around each change, `-` for a line removed and `+` for one added, as `diff -u` prints
 * them without the hunk headers.
 *
 * A longest-common-subsequence table, which is quadratic: a brief is a few hundred lines, and
 * past {@link DIFF_MAX_LINES} on either side the answer is a count instead of a table that size.
 */

/** Lines on either side past which the diff is summarised instead of computed. */
export const DIFF_MAX_LINES = 2_000;
/** Unchanged lines shown around a change. */
const CONTEXT = 2;

const linesOf = (text: string): string[] =>
  text === '' ? [] : text.replace(/\n$/u, '').split('\n');

type Step = { readonly kind: ' ' | '-' | '+'; readonly line: string };

function steps(before: readonly string[], after: readonly string[]): Step[] {
  const rows = before.length;
  const columns = after.length;
  // `common[i][j]`: the longest common run of `before[i..]` and `after[j..]`.
  const common: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(columns + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      common[i]![j] =
        before[i] === after[j]
          ? common[i + 1]![j + 1]! + 1
          : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const out: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < rows || j < columns) {
    if (i < rows && j < columns && before[i] === after[j]) {
      out.push({ kind: ' ', line: before[i]! });
      i++;
      j++;
    } else if (i < rows && (j === columns || common[i + 1]![j]! >= common[i]![j + 1]!)) {
      // On a tie the removal first, as `diff` prints a replaced line.
      out.push({ kind: '-', line: before[i]! });
      i++;
    } else {
      out.push({ kind: '+', line: after[j]! });
      j++;
    }
  }
  return out;
}

/** The change from `before` to `after`; empty when they are the same text. */
export function lineDiff(before: string, after: string): string {
  if (before === after) return '';
  const old = linesOf(before);
  const next = linesOf(after);
  if (old.length > DIFF_MAX_LINES || next.length > DIFF_MAX_LINES) {
    return `${String(old.length)} lines replaced by ${String(next.length)} lines (too long to compare line by line)`;
  }
  const all = steps(old, next);
  const near = all.map((_step, index) =>
    all
      .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
      .some((other) => other.kind !== ' '),
  );
  const shown: string[] = [];
  let skipped = false;
  all.forEach((step, index) => {
    if (!near[index]) {
      skipped = true;
      return;
    }
    if (skipped && shown.length > 0) shown.push('…');
    skipped = false;
    shown.push(`${step.kind}${step.line}`);
  });
  // Only a final newline differs: no line does, so say what does.
  return shown.length === 0 ? 'only the newline at the end of the file differs' : shown.join('\n');
}
