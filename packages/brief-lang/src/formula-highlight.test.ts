import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { parser } from './brief.parser.js';
import { formulaMounts } from './formula-highlight.js';
import { briefHighlighting, formulaText } from './highlight.js';
import { parseBrief } from './parse-brief.js';

/**
 * A formula's colours (TYTO-743), read as `highlight.test.ts` reads the rest: through the
 * spans `@lezer/highlight` hands a renderer, with the editor's wrap mounted, because a rule
 * naming a node nobody produces colours nothing and says nothing.
 */
const unwrapped = parser.configure({ props: [briefHighlighting] });
const wrapped = parser.configure({ props: [briefHighlighting], wrap: formulaMounts });

const named = tagHighlighter([
  { tag: tags.punctuation, class: 'punctuation' },
  { tag: tags.definitionKeyword, class: 'name' },
  { tag: tags.attributeName, class: 'attribute-name' },
  { tag: tags.attributeValue, class: 'attribute-value' },
  { tag: tags.strong, class: 'strong' },
  { tag: formulaText, class: 'formula' },
  { tag: tags.processingInstruction, class: 'formula-mark' },
  { tag: tags.keyword, class: 'command' },
  { tag: tags.brace, class: 'brace' },
  { tag: tags.operator, class: 'script' },
  { tag: tags.escape, class: 'escape' },
]);

/** The styled ranges of a brief's formula, from its first `$` to its last, as `[text, tag]`. */
const formulaSpans = (source: string, language = wrapped): [string, string][] => {
  const start = source.indexOf('$');
  const end = source.lastIndexOf('$') + 1;
  const found: [string, string][] = [];
  highlightTree(language.parse(source), named, (from, to, tag) => {
    if (from >= start && to <= end) found.push([source.slice(from, to), tag]);
  });
  return found;
};

describe('a formula in the editor', () => {
  it('colours its marks, its command, its braces, its scripts, its escape and its text', () => {
    expect(formulaSpans('::t $F = \\frac{1}{40·10^{-3}} = 25\\ Hz$\n')).toEqual([
      ['$', 'formula-mark'],
      ['F = ', 'formula'],
      ['\\frac', 'command'],
      ['{', 'brace'],
      ['1', 'formula'],
      ['}', 'brace'],
      ['{', 'brace'],
      ['40·10', 'formula'],
      ['^', 'script'],
      ['{', 'brace'],
      ['-3', 'formula'],
      ['}', 'brace'],
      ['}', 'brace'],
      [' = 25', 'formula'],
      ['\\ ', 'escape'],
      ['Hz', 'formula'],
      ['$', 'formula-mark'],
    ]);
  });

  it('colours a subscript, the other escapes and a command it does not know', () => {
    expect(formulaSpans('::t $a_1 \\$ \\{ \\sqrt$\n')).toEqual([
      ['$', 'formula-mark'],
      ['a', 'formula'],
      ['_', 'script'],
      ['1 ', 'formula'],
      ['\\$', 'escape'],
      [' ', 'formula'],
      ['\\{', 'escape'],
      [' ', 'formula'],
      ['\\sqrt', 'command'],
      ['$', 'formula-mark'],
    ]);
  });

  it('keeps the bold of a formula written inside bold', () => {
    expect(formulaSpans('::t **a $x^2$**\n')).toEqual([
      ['$', 'strong formula-mark'],
      ['x', 'strong formula'],
      ['^', 'strong script'],
      ['2', 'strong formula'],
      ['$', 'strong formula-mark'],
    ]);
  });

  it('colours a formula inside a mark, not as the mark', () => {
    // A word first: braces right after the directive's name are its adjustment list.
    const source = '::t a {cor:azul}$x^2$ ok{/}\n';
    const names: string[] = [];
    wrapped.parse(source).iterate({ enter: (node) => void names.push(node.name) });
    expect(names).toContain('Mark');
    expect(names).not.toContain('⚠');
    expect(formulaSpans(source)).toEqual([
      ['$', 'formula-mark'],
      ['x', 'formula'],
      ['^', 'script'],
      ['2', 'formula'],
      ['$', 'formula-mark'],
    ]);
  });

  it('colours a formula that opens a column-0 body line (TYTO-708)', () => {
    expect(formulaSpans('::lamina\n$x^2$ sobe\n')).toEqual([
      ['$', 'formula-mark'],
      ['x', 'formula'],
      ['^', 'script'],
      ['2', 'formula'],
      ['$', 'formula-mark'],
    ]);
  });

  it('is one colour without the mount, as the compiler parses it', () => {
    expect(formulaSpans('::t $x^{2}$\n', unwrapped)).toEqual([['$x^{2}$', 'formula']]);
  });
});

describe('the mount', () => {
  const brief = '::lamina\n  $F = \\frac{1}{40·10^{-3}}$ e **$x_1$** {cor:azul}$y$ ok{/}\n$z^2$\n';

  it('belongs to the editor only: the exported parser has no node inside a formula', () => {
    const names = (language: typeof parser): string[] => {
      const found: string[] = [];
      language.parse(brief).iterate({ enter: (node) => void found.push(node.name) });
      return found;
    };
    expect(names(parser)).not.toContain('FormulaCommand');
    expect(names(wrapped)).toContain('FormulaCommand');
  });

  it('keeps a node named Formula where each formula is, in both trees', () => {
    const formulas = (language: typeof parser): string[] => {
      const found: string[] = [];
      language.parse(brief).iterate({
        enter: (node) =>
          void (node.name === 'Formula' && found.push(brief.slice(node.from, node.to))),
      });
      return found;
    };
    const written = ['$F = \\frac{1}{40·10^{-3}}$', '$x_1$', '$y$', '$z^2$'];
    expect(formulas(parser)).toEqual(written);
    expect(formulas(wrapped)).toEqual(written);
  });

  it('leaves parseBrief byte for byte as it was before the editor configured its parser', () => {
    // `configure` returns a new parser and never changes the one it was called on. The two
    // reads around it are the same brief through `parseBrief`, which runs the exported parser.
    const before = JSON.stringify(parseBrief(brief));
    parser.configure({ wrap: formulaMounts }).parse(brief);
    expect(JSON.stringify(parseBrief(brief))).toBe(before);
    expect(before).toContain('"kind":"formula"');
  });
});
