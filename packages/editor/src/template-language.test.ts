import { ensureSyntaxTree, foldable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { templateLanguage } from './template-language.js';

import carrossel from '../../templates/templates/carrossel-lista/template.html?raw';
import promo from '../../templates/templates/promo-curso/template.html?raw';

describe('the colours come from the grammar', () => {
  /**
   * The table is `@tyto/template-lang`'s and is asserted there. What this file proves is
   * the seam: that `parser.configure` carried `templateHighlighting` into the language
   * CodeMirror parses with. A `configure` call that dropped the prop would leave a grey
   * editor and break nothing else.
   */
  const named = tagHighlighter([
    { tag: tags.tagName, class: 'tag' },
    { tag: tags.attributeName, class: 'attribute' },
    { tag: tags.propertyName, class: 'property' },
    { tag: tags.className, class: 'selector-class' },
    { tag: tags.definitionKeyword, class: 'at' },
  ]);

  const spans = (source: string): [string, string][] => {
    const found: [string, string][] = [];
    highlightTree(templateLanguage.parser.parse(source), named, (from, to, tag) => {
      found.push([source.slice(from, to), tag]);
    });
    return found;
  };

  it('tells a tag, an attribute and a class selector apart, which are the same characters', () => {
    const source =
      '<text slot="titulo" class="title" />\n<style>\n.title { font-size: 72px }\n</style>\n';

    expect(spans(source)).toEqual([
      ['text', 'tag'],
      ['slot', 'attribute'],
      ['class', 'attribute'],
      ['title', 'selector-class'],
      ['font-size', 'property'],
    ]);
  });

  it('tags an at-rule keyword', () => {
    const source = '<style>\n@if slot(cor) is laranja {\n  :root { fill: #fff }\n}\n</style>\n';

    expect(spans(source)).toContainEqual(['@if', 'at']);
  });
});

describe('folding', () => {
  /**
   * A state whose tree covers the whole document, which `EditorState.create` does not give.
   *
   * `foldable` reads `syntaxTree(state)`, and on a fresh state that is whatever the initial
   * parse finished: `Math.min(3000, doc.length)` characters on a **20 ms wall-clock** budget,
   * truncated at wherever the parser stopped when it runs out
   * (`@codemirror/language/dist/index.js:540`). These documents are fifty characters long, so
   * the length is never the problem — being descheduled is. Measured: 2 red runs in 20 of the
   * whole package, both here, both `foldable` answering `null` for a range that exists
   * (TYTO-114).
   *
   * The two lines are one fix and neither works alone. `ensureSyntaxTree` does the parsing on
   * the context the field holds, but `LanguageState` snapshots `context.tree` in its
   * constructor — so `syntaxTree(state)` keeps answering with the old tree no matter how much
   * work is done afterwards. The empty transaction is what promotes it: `apply` returns
   * `this` only while the snapshot still equals the context's tree, and after the line above
   * it does not.
   *
   * This is the same defect `syntax.ts` describes, in the one consumer `treeAt` cannot reach:
   * `foldable` is CodeMirror's own and calls `syntaxTree` itself. Production is unaffected —
   * the fold gutter only offers to fold what is in the viewport, and the viewport is parsed.
   */
  const stateOf = (doc: string): EditorState => {
    const created = EditorState.create({ doc, extensions: [templateLanguage] });
    ensureSyntaxTree(created, doc.length, 5000);
    return created.update({}).state;
  };

  it('folds an element to its opening tag, attributes and all', () => {
    const doc = '<group class="copy">\n  <text slot="titulo" />\n</group>\n';
    const state = stateOf(doc);
    const head = state.doc.line(1);

    const range = foldable(state, head.from, head.to);

    expect(range).not.toBeNull();
    expect(doc.slice(range?.from, range?.to)).toBe('\n  <text slot="titulo" />\n');
  });

  it('leaves a self-closing element alone — there is nothing to hide', () => {
    const state = stateOf('<rect class="veil" />\n');
    const head = state.doc.line(1);

    expect(foldable(state, head.from, head.to)).toBeNull();
  });

  it('folds a style rule to its selector, leaving the braces', () => {
    const doc = '<style>\n.title {\n  font-size: 72px;\n}\n</style>\n';
    const state = stateOf(doc);
    const rule = state.doc.line(2);

    const range = foldable(state, rule.from, rule.to);

    expect(doc.slice(range?.from, range?.to)).toBe('\n  font-size: 72px;\n');
  });

  it('folds the whole stylesheet to its opening tag', () => {
    const doc = '<style>\n.title { font-size: 72px }\n</style>\n';
    const state = stateOf(doc);
    const head = state.doc.line(1);

    const range = foldable(state, head.from, head.to);

    expect(doc.slice(range?.from, range?.to)).toBe('\n.title { font-size: 72px }\n');
  });
});

describe('the built-in templates', () => {
  const errorPositions = (source: string): number[] => {
    const cursor = templateLanguage.parser.parse(source).cursor();
    const positions: number[] = [];
    do {
      if (cursor.type.isError) positions.push(cursor.from);
    } while (cursor.next());
    return positions;
  };

  /**
   * The demo opens these two files, which is the card's acceptance criterion. A template
   * with an error node in it still highlights, so looking at the demo cannot tell a clean
   * parse from a lucky-looking one.
   */
  it.each([
    ['promo-curso', promo],
    ['carrossel-lista', carrossel],
  ])('parses %s with no error node', (_name, source) => {
    expect(errorPositions(source)).toEqual([]);
  });

  it.each([
    ['promo-curso', promo],
    ['carrossel-lista', carrossel],
  ])('colours something in %s rather than leaving it grey', (_name, source) => {
    let spans = 0;
    highlightTree(
      templateLanguage.parser.parse(source),
      tagHighlighter([{ tag: tags.tagName, class: 'tag' }]),
      () => {
        spans += 1;
      },
    );

    expect(spans).toBeGreaterThan(0);
  });
});
