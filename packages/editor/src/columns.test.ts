import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { briefLanguage } from './brief-language.js';
import { columnMarks } from './columns.js';
import { fullyParsed } from './test-parse.js';

/**
 * `columnMarks` (TYTO-298): where a brief's `|` lines split, read off the tree the way
 * `fields()` in `@tyto/template-kit` reads the AST.
 */

const marksOf = (doc: string) => {
  const state = fullyParsed(EditorState.create({ doc, extensions: [briefLanguage] }));
  return { state, marks: columnMarks(state, 0, state.doc.length) };
};

/** Each painted stretch as `index:text`, trimmed, and how many separators there are. */
const read = (doc: string): { columns: string[]; separators: number } => {
  const { state, marks } = marksOf(doc);
  for (const at of marks.separators) expect(state.sliceDoc(at, at + 1)).toBe('|');
  return {
    columns: marks.columns.map(
      (column) => `${String(column.index)}:${state.sliceDoc(column.from, column.to).trim()}`,
    ),
    separators: marks.separators.length,
  };
};

describe('the columns of a | line', () => {
  it('splits a body line at each |, and restarts on the next line', () => {
    expect(read('::lamina\n  FARMÁCIA\n    a | b | c\n    d | e\n')).toEqual({
      columns: ['1:a', '2:b', '3:c', '1:d', '2:e'],
      separators: 3,
    });
  });

  it('leaves a line with no | alone: to a grouped table it is a heading', () => {
    expect(read('::lamina\n  FARMÁCIA\n')).toEqual({ columns: [], separators: 0 });
  });

  it('does not split at a | inside bold, italic or a mark, and paints none of them', () => {
    expect(read('::lamina\n  a | **b | c** | d\n')).toEqual({
      columns: ['1:a', '3:d'],
      separators: 2,
    });
    expect(read('::lamina\n  a | *b | c* | {cor:x}d | e{/} | f\n')).toEqual({
      columns: ['1:a', '4:f'],
      separators: 3,
    });
  });

  it('paints the plain text around an emphasis in the column it sits in', () => {
    expect(read('::lamina\n  a | x **b** y | d\n')).toEqual({
      columns: ['1:a', '2:x', '2:y', '3:d'],
      separators: 2,
    });
  });

  it('never paints inside an atomic inline', () => {
    const doc = '::lamina\n  a | **b | c** | {cor:x}d{/} | e\n';
    const { marks } = marksOf(doc);
    const atomic = [
      [doc.indexOf('**b'), doc.indexOf('c**') + 3],
      [doc.indexOf('{cor'), doc.indexOf('{/}') + 3],
    ];
    const inside = marks.columns.filter((column) =>
      atomic.some(([from, to]) => column.from < to! && column.to > from!),
    );
    expect(inside).toEqual([]);
  });

  it('restarts at a \\ hard break', () => {
    expect(read('::lamina\n  a | b \\ c | d\n')).toEqual({
      columns: ['1:a', '2:b', '1:c', '2:d'],
      separators: 2,
    });
  });

  it('reads an inline body like a body line', () => {
    expect(read('::rodape a | b\n')).toEqual({ columns: ['1:a', '2:b'], separators: 1 });
  });

  it('has no \\| escape: the backslash is a break and the | still splits', () => {
    // `a ` before the break is a row of its own with no `|`: a heading, unpainted.
    expect(read('::lamina\n  a \\| b\n')).toEqual({ columns: ['2:b'], separators: 1 });
  });
});
