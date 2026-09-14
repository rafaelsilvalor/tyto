import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { ATTRIBUTES, PROPERTIES, STRUCTURAL_TAGS, TAGS } from '@tyto/template-lang';
import { describe, expect, it } from 'vitest';

import { completeTemplate } from './template-completion.js';

/** The cursor is written into the document as `|`. */
const completeAt = (marked: string): CompletionResult | null => {
  const pos = marked.indexOf('|');
  if (pos === -1) throw new Error('the fixture has no | marking the cursor');
  const state = EditorState.create({ doc: marked.replace('|', '') });
  return completeTemplate(new CompletionContext(state, pos, false));
};

const labelsOf = (result: CompletionResult | null): string[] =>
  (result?.options ?? []).map((option) => option.label).sort();

const sorted = (names: readonly string[]): string[] => [...names].sort();

describe('completeTemplate', () => {
  it('offers every tag the language has, after <', () => {
    // Exactly the vocabulary, including the two that draw nothing but are written by hand.
    expect(labelsOf(completeAt('<|'))).toEqual(sorted([...TAGS, ...STRUCTURAL_TAGS]));
  });

  it('replaces what has been typed of the tag, not the < in front of it', () => {
    const doc = '<te|';
    const result = completeAt(doc);

    expect(result?.from).toBe(doc.indexOf('|') - 2);
    expect(labelsOf(result)).toEqual(sorted([...TAGS, ...STRUCTURAL_TAGS]));
  });

  it('offers the attributes the tag accepts, and not another tag’s', () => {
    expect(labelsOf(completeAt('<text |'))).toEqual(sorted(ATTRIBUTES.text));
    expect(labelsOf(completeAt('<frame |'))).toEqual(sorted(ATTRIBUTES.frame));
  });

  it('keeps offering attributes after one has been written', () => {
    expect(labelsOf(completeAt('<text slot="titulo" |'))).toEqual(sorted(ATTRIBUTES.text));
  });

  it('stands down once the tag is closed', () => {
    expect(completeAt('<text slot="titulo" />|')).toBeNull();
  });

  it('says nothing for a tag the language does not have', () => {
    expect(completeAt('<marquee |')).toBeNull();
  });

  it('offers CSS properties inside the stylesheet', () => {
    expect(labelsOf(completeAt('<style>\n.title { |'))).toEqual(sorted(PROPERTIES));
  });

  it('offers them again after a semicolon', () => {
    expect(labelsOf(completeAt('<style>\n.title { font-size: 72px; |'))).toEqual(
      sorted(PROPERTIES),
    );
  });

  it('completes a custom property prefix without losing the dashes', () => {
    const doc = '<style>\n:root { --|';
    const result = completeAt(doc);

    // `from` sits before the dashes, so accepting an option replaces them rather than
    // leaving `--fill`.
    expect(result?.from).toBe(doc.indexOf('|') - 2);
  });

  /**
   * The one thing the two halves must not do is bleed into each other: a `<` inside the
   * stylesheet is not the start of a tag, and a property name in the markup is not a
   * property.
   */
  it('does not offer tags inside the stylesheet', () => {
    expect(completeAt('<style>\n.title { font-size: 72px }\n<|')).toBeNull();
  });

  it('does not offer properties in the markup', () => {
    expect(completeAt('<group class="copy">\n  |')).toBeNull();
  });

  it('goes back to markup after the stylesheet is closed', () => {
    expect(labelsOf(completeAt('<style>\n.title { color: #fff }\n</style>\n<|'))).toEqual(
      sorted([...TAGS, ...STRUCTURAL_TAGS]),
    );
  });
});
