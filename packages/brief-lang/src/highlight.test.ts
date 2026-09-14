import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { parser } from './brief.parser.js';
import { briefHighlighting } from './highlight.js';

/**
 * The table in `highlight.ts` is asserted through its output, not by reading it back.
 *
 * Both ways a style rule can be wrong are silent: a rule naming a node the grammar never
 * produces colours nothing, and a rule without `/...` colours a construct's delimiters and
 * not its content. Neither throws, neither warns, and both looked correct in the source
 * until an editor rendered them (TYTO-36). So this parses real briefs and reads the spans
 * `@lezer/highlight` hands a renderer.
 *
 * Tags, not colours: `@tyto/editor` decides what `attributeName` looks like and may change
 * its mind, but `cor` in `{cor: laranja}` is an attribute name in every theme.
 */
const highlighting = parser.configure({ props: [briefHighlighting] });

const named = tagHighlighter([
  { tag: tags.meta, class: 'meta' },
  { tag: tags.lineComment, class: 'comment' },
  { tag: tags.definitionKeyword, class: 'name' },
  { tag: tags.namespace, class: 'namespace' },
  { tag: tags.punctuation, class: 'punctuation' },
  { tag: tags.attributeName, class: 'attribute-name' },
  { tag: tags.attributeValue, class: 'attribute-value' },
  { tag: tags.strong, class: 'strong' },
  { tag: tags.emphasis, class: 'emphasis' },
  { tag: tags.escape, class: 'escape' },
]);

/** Every styled range of a source, in document order, as `[text, tag]`. */
const spans = (source: string): [string, string][] => {
  const found: [string, string][] = [];
  highlightTree(highlighting.parse(source), named, (from, to, tag) => {
    found.push([source.slice(from, to), tag]);
  });
  return found;
};

/** What a piece of source was tagged, or `undefined` when nothing claimed it. */
const tagOf = (source: string, text: string): string | undefined =>
  spans(source).find(([span]) => span === text)?.[1];

describe('a directive', () => {
  /**
   * The trailing `\n` is styled because the line break is part of the `Directive` node and
   * no child covers it. It has no glyph, so nothing shows; it is written out here rather
   * than filtered away, because a filter would also hide a real over-reach.
   */
  it('separates the mark, the namespace and the name', () => {
    expect(spans('::ai/caption something\n')).toEqual([
      ['::', 'punctuation'],
      ['ai/', 'namespace'],
      ['caption', 'name'],
      ['\n', 'punctuation'],
    ]);
  });

  it('leaves its body unstyled', () => {
    expect(tagOf('::titulo Direito\n', 'Direito')).toBeUndefined();
  });
});

describe('an adjustment list', () => {
  /**
   * The braces, the comma and the colon are lowercase tokens with no node of their own.
   * They are here because `Adjustments/...` reaches what its children do not cover; the
   * previous spelling named the tokens and painted none of them.
   */
  it('styles every delimiter and both halves of a pair', () => {
    expect(spans('::slide {destaque, cor: laranja}\n')).toEqual([
      ['::', 'punctuation'],
      ['slide', 'name'],
      [' {', 'punctuation'],
      ['destaque', 'attribute-name'],
      [', ', 'punctuation'],
      ['cor', 'attribute-name'],
      [': ', 'punctuation'],
      ['laranja', 'attribute-value'],
      ['}\n', 'punctuation'],
    ]);
  });

  /** A name that came out `punctuation attributeName` is the bug the two rules avoid. */
  it('gives a name and a value one tag each, not two', () => {
    const tagged = spans('::slide {cor: laranja}\n');
    expect(tagged.filter(([, tag]) => tag.includes(' '))).toEqual([]);
  });
});

describe('a mark', () => {
  const source = '::titulo a {cor:azul}oi{/} b\n';

  it('styles its braces and its pair', () => {
    expect(tagOf(source, '{')).toBe('punctuation');
    expect(tagOf(source, 'cor')).toBe('attribute-name');
    expect(tagOf(source, ':')).toBe('punctuation');
    expect(tagOf(source, 'azul')).toBe('attribute-value');
    expect(tagOf(source, '{/}')).toBe('punctuation');
  });

  /** The reason `Mark` is not `Mark/...`: its body is text, not punctuation. */
  it('leaves the text it wraps alone', () => {
    expect(tagOf(source, 'oi')).toBeUndefined();
  });
});

describe('emphasis', () => {
  it('reaches the words, not only the asterisks', () => {
    expect(tagOf('::titulo a **b c** d\n', '**b c**')).toBe('strong');
    expect(tagOf('::titulo a *b c* d\n', '*b c*')).toBe('emphasis');
  });

  it('adds the inner tag to the outer one where they nest', () => {
    expect(spans('::titulo **a *b* c**\n')).toEqual([
      ['::', 'punctuation'],
      ['titulo', 'name'],
      ['**a ', 'strong'],
      ['*b*', 'strong emphasis'],
      [' c**', 'strong'],
      ['\n', 'punctuation'],
    ]);
  });
});

describe('the rest of the language', () => {
  it('styles the frontmatter as one block', () => {
    const source = '---\ntemplate: promo-curso\n---\n::titulo Oi\n';
    expect(spans(source)[0]).toEqual(['---\ntemplate: promo-curso\n---\n', 'meta']);
  });

  it('styles a comment', () => {
    expect(tagOf('// nota\n::titulo Oi\n', '// nota')).toBe('comment');
  });

  it('styles both escapes', () => {
    expect(tagOf('::titulo \\:: literal\n', '\\::')).toBe('escape');
    expect(tagOf('::titulo quebra\\\n', '\\')).toBe('escape');
  });
});
