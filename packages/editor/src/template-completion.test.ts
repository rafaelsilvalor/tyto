import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { ATTRIBUTES, PROPERTIES, STRUCTURAL_TAGS, TAGS } from '@tyto/template-lang';
import { describe, expect, it } from 'vitest';

import { completeTemplate } from './template-completion.js';
import { setTemplateAnalysis, templateAnalysisField } from './template-analysis.js';
import { templateLanguage } from './template-language.js';

const manifestOf = (yaml: string): TemplateManifest => {
  const parsed = parseManifest(yaml, 'manifest.yaml');
  if (!parsed.ok) throw new Error('fixture manifest does not parse');
  return parsed.value;
};

const CARROSSEL = manifestOf(`
name: carrossel-lista
version: 1.0.0
formats: [feed, story]
slots:
  titulo: { type: rich-text, required: true, max: 60 }
  item: { type: rich-text, repeat: true, min: 1, max: 10 }
  tom: { type: enum, values: [claro, escuro], default: escuro }
`);

const PROMO = manifestOf(`
name: promo-curso
version: 1.0.0
formats: [feed, banner-wide]
slots:
  headline: { type: rich-text, required: true }
  imagem: { type: image }
`);

/**
 * The cursor is written into the document as `|`.
 *
 * `templateLanguage` is in the state because the source reads the syntax tree (TYTO-93):
 * without a language there is no tree, and every case would answer `null` for the wrong
 * reason. The analysis is optional, the way it is in a real editor — a host may mount
 * `templateCompletion()` without `templateLint()`, and everything but `slot="…"` still works.
 */
const completeAt = (marked: string, manifest?: TemplateManifest): CompletionResult | null => {
  const pos = marked.indexOf('|');
  if (pos === -1) throw new Error('the fixture has no | marking the cursor');
  const doc = marked.replace('|', '');

  const created = EditorState.create({
    doc,
    extensions: [templateAnalysisField, templateLanguage],
  });
  const state =
    manifest === undefined
      ? created
      : created.update({
          effects: setTemplateAnalysis.of({ source: doc, diagnostics: [], manifest }),
        }).state;

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

  it('replaces what has been typed of the attribute name', () => {
    const doc = '<text slot="titulo" cl|';
    const result = completeAt(doc);

    expect(result?.from).toBe(doc.indexOf('|') - 2);
    expect(labelsOf(result)).toEqual(sorted(ATTRIBUTES.text));
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

  it('offers them inside an at-rule’s nested block', () => {
    expect(labelsOf(completeAt('<style>\n@format story {\n  .title { |'))).toEqual(
      sorted(PROPERTIES),
    );
  });

  it('replaces what has been typed of the property name', () => {
    const doc = '<style>\n.title { fo|';
    const result = completeAt(doc);

    expect(result?.from).toBe(doc.indexOf('|') - 2);
    expect(labelsOf(result)).toEqual(sorted(PROPERTIES));
  });

  it('completes a custom property prefix without losing the dashes', () => {
    const doc = '<style>\n:root { --|';
    const result = completeAt(doc);

    // `from` sits before the dashes, so accepting an option replaces them rather than
    // leaving `--fill`.
    expect(result?.from).toBe(doc.indexOf('|') - 2);
  });

  it('stands down past the colon, where a value goes and not a property', () => {
    expect(completeAt('<style>\n.title { color: #f|')).toBeNull();
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

/**
 * The one list a manifest decides, and the two cases a regular expression had to special-case
 * (TYTO-93).
 */
describe('completeTemplate — slot values', () => {
  it('offers the slots the active manifest declares, inside slot="', () => {
    expect(labelsOf(completeAt('<text slot="|', CARROSSEL))).toEqual(['item', 'titulo', 'tom']);
  });

  it('swaps the whole list when the buffer is checked against another manifest', () => {
    expect(labelsOf(completeAt('<text slot="|', PROMO))).toEqual(['headline', 'imagem']);
  });

  it('says what kind of slot each one is', () => {
    const result = completeAt('<text slot="|', PROMO);

    expect(result?.options.find((option) => option.label === 'imagem')?.detail).toBe('image');
  });

  it('replaces what has been typed of the slot, not the quote in front of it', () => {
    const doc = '<text slot="ti|';
    const result = completeAt(doc, CARROSSEL);

    expect(result?.from).toBe(doc.indexOf('|') - 2);
    expect(labelsOf(result)).toEqual(['item', 'titulo', 'tom']);
  });

  it('offers them on an image too, which is the other tag that takes a slot', () => {
    expect(labelsOf(completeAt('<image slot="|', CARROSSEL))).toEqual(['item', 'titulo', 'tom']);
  });

  it('offers nothing for an attribute that is not a slot', () => {
    expect(completeAt('<image src="|', CARROSSEL)).toBeNull();
  });

  /**
   * `slot` belongs to `text` and `image` and to nothing else (`ATTRIBUTES`), so a list here
   * would be a list of names the linter then underlines.
   */
  it('offers nothing on a tag that does not take a slot', () => {
    expect(completeAt('<rect slot="|', CARROSSEL)).toBeNull();
  });

  it('offers nothing where no manifest has reached the editor', () => {
    expect(completeAt('<text slot="|')).toBeNull();
  });

  /**
   * The case the tree answers for free: `<` is the start of a tag everywhere except inside a
   * string, and a regular expression over the line before the cursor cannot tell the two
   * apart without being taught about quotes.
   */
  it('offers nothing for a < written inside a value', () => {
    expect(completeAt('<text slot="a<|', CARROSSEL)).toBeNull();
  });

  it('reads a value as ended at the line break, the way the grammar does', () => {
    // The quote on the line above cannot still be open here, so this `<` is a tag again.
    expect(labelsOf(completeAt('<text slot="a\n<|', CARROSSEL))).toEqual(
      sorted([...TAGS, ...STRUCTURAL_TAGS]),
    );
  });

  it('stands down once the value is closed', () => {
    expect(completeAt('<text slot="titulo" |', CARROSSEL)).not.toBeNull();
    expect(labelsOf(completeAt('<text slot="titulo" |', CARROSSEL))).toEqual(
      sorted(ATTRIBUTES.text),
    );
  });
});
