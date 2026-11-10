import { describe, expect, it } from 'vitest';

import { DIFF_MAX_LINES, lineDiff } from './line-diff.js';

/** What `write_brief` shows an agent before it writes (ADR 0185). */
describe('lineDiff', () => {
  it('is empty for the same text', () => {
    expect(lineDiff('a\nb\n', 'a\nb\n')).toBe('');
  });

  it('shows a replaced line as its removal, then its addition, with the lines around it', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n');
    const after = ['1', '2', '3', '4', 'cinco', '6', '7', '8'].join('\n');
    expect(lineDiff(before, after)).toBe([' 3', ' 4', '-5', '+cinco', ' 6', ' 7'].join('\n'));
  });

  it('marks the lines left out between two changes', () => {
    const before = ['a', '1', '2', '3', '4', '5', '6', 'b'].join('\n');
    const after = ['A', '1', '2', '3', '4', '5', '6', 'B'].join('\n');
    expect(lineDiff(before, after)).toBe(
      ['-a', '+A', ' 1', ' 2', '…', ' 5', ' 6', '-b', '+B'].join('\n'),
    );
  });

  it('shows a new file as every line added', () => {
    expect(lineDiff('', 'a\nb\n')).toBe('+a\n+b');
  });

  it('says so when only the final newline differs', () => {
    expect(lineDiff('a\nb', 'a\nb\n')).toBe('only the newline at the end of the file differs');
  });

  it('counts instead of comparing a text too long to compare', () => {
    const long = Array.from({ length: DIFF_MAX_LINES + 1 }, (_, index) => String(index)).join('\n');
    expect(lineDiff(long, 'x')).toBe(
      `${String(DIFF_MAX_LINES + 1)} lines replaced by 1 lines (too long to compare line by line)`,
    );
  });
});
