import { foldable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { briefLanguage } from './brief-language.js';

import lista from '../../templates/templates/carrossel-lista/examples/lista.brief?raw';
import promo from '../../templates/templates/promo-curso/examples/promo.brief?raw';

describe('the colours come from the grammar', () => {
  /**
   * The table itself is `@tyto/brief-lang`'s, and `highlight.test.ts` there asserts every
   * construct in it. What this file has to prove is the seam: that `parser.configure`
   * carried `briefHighlighting` into the language CodeMirror actually parses with. A
   * `configure` call that dropped the prop would leave a grey editor and break nothing else.
   */
  const named = tagHighlighter([
    { tag: tags.definitionKeyword, class: 'name' },
    { tag: tags.attributeName, class: 'attribute-name' },
    { tag: tags.strong, class: 'strong' },
  ]);

  it('tags a directive name, an adjustment and a bold run', () => {
    const source = '::slide {destaque} Direito **Constitucional**\n';
    const found: [string, string][] = [];
    highlightTree(briefLanguage.parser.parse(source), named, (from, to, tag) => {
      found.push([source.slice(from, to), tag]);
    });

    expect(found).toEqual([
      ['slide', 'name'],
      ['destaque', 'attribute-name'],
      ['**Constitucional**', 'strong'],
    ]);
  });
});

describe('folding', () => {
  const stateOf = (doc: string): EditorState =>
    EditorState.create({ doc, extensions: [briefLanguage] });

  it('folds a directive to its first line', () => {
    const doc = '::titulo\n  Direito\n  Constitucional\n::subtitulo Oi\n';
    const state = stateOf(doc);
    const head = state.doc.line(1);

    const range = foldable(state, head.from, head.to);

    expect(range).not.toBeNull();
    expect(doc.slice(range?.from, range?.to)).toBe('\n  Direito\n  Constitucional');
  });

  it('stops at the next directive rather than swallowing it', () => {
    const doc = '::titulo\n  Direito\n::subtitulo\n  Oi\n';
    const state = stateOf(doc);

    const range = foldable(state, state.doc.line(1).from, state.doc.line(1).to);

    expect(doc.slice(range?.from, range?.to)).toBe('\n  Direito');
  });

  it('leaves a directive with an inline body alone — there is nothing to hide', () => {
    const state = stateOf('::titulo Direito\n');
    const head = state.doc.line(1);

    expect(foldable(state, head.from, head.to)).toBeNull();
  });
});

describe('the example briefs', () => {
  const errorPositions = (source: string): number[] => {
    const cursor = briefLanguage.parser.parse(source).cursor();
    const positions: number[] = [];
    do {
      if (cursor.type.isError) positions.push(cursor.from);
    } while (cursor.next());
    return positions;
  };

  /**
   * The demo page opens these two files, which is the card's acceptance criterion. A brief
   * with an error node in it still highlights — recovery keeps going — so looking at the
   * demo cannot tell a clean parse from a lucky-looking one.
   */
  it.each([
    ['promo-curso', promo],
    ['carrossel-lista', lista],
  ])('parses %s with no error node', (_name, source) => {
    expect(errorPositions(source)).toEqual([]);
  });

  it('folds every block directive in the four-slide example', () => {
    const state = EditorState.create({ doc: lista, extensions: [briefLanguage] });
    const foldedHeads: string[] = [];

    for (let line = 1; line <= state.doc.lines; line += 1) {
      const { from, to, text } = state.doc.line(line);
      if (foldable(state, from, to)) foldedHeads.push(text);
    }

    expect(foldedHeads).toEqual([
      '::titulo',
      '::item',
      '::item',
      '::item {destaque, tom: escuro}',
      '::item',
    ]);
  });
});
