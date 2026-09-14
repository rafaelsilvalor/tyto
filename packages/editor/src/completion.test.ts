import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { type BriefAnalysis, briefAnalysisField, setBriefAnalysis } from './analysis.js';
import { completeBrief } from './completion.js';

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
adjustments:
  destaque: { type: flag, applies: [item] }
  tom: { type: enum, values: [claro, escuro], applies: [item] }
`);

const PROMO = manifestOf(`
name: promo-curso
version: 1.0.0
formats: [feed, banner-wide]
slots:
  headline: { type: rich-text, required: true }
  imagem: { type: image }
`);

const analysisOf = (manifest?: TemplateManifest): BriefAnalysis => ({
  source: '',
  diagnostics: [],
  templates: ['carrossel-lista', 'promo-curso'],
  ...(manifest === undefined ? {} : { manifest }),
});

/**
 * The cursor is written into the document as `|`.
 *
 * The source is driven directly rather than through a mounted editor: what it answers is a
 * function of the document, the offset and the manifest, and none of the three needs a DOM
 * to exist. The editor-shaped half — that the source is reached at all — is what
 * `briefCompletion` wires through the language's data facet.
 */
const completeAt = (marked: string, analysis: BriefAnalysis): CompletionResult | null => {
  const pos = marked.indexOf('|');
  if (pos === -1) throw new Error('the fixture has no | marking the cursor');
  const doc = marked.replace('|', '');

  const created = EditorState.create({ doc, extensions: [briefAnalysisField] });
  const state = created.update({ effects: setBriefAnalysis.of(analysis) }).state;

  return completeBrief(new CompletionContext(state, pos, false));
};

const labelsOf = (result: CompletionResult | null): string[] =>
  (result?.options ?? []).map((option) => option.label).sort();

const frontmatter = (...lines: readonly string[]): string =>
  ['---', 'template: carrossel-lista', ...lines, '---', ''].join('\n');

describe('completeBrief', () => {
  it('offers exactly the slots the manifest declares, after ::', () => {
    const result = completeAt(`${frontmatter()}::|`, analysisOf(CARROSSEL));

    // Exactly: the acceptance criterion is that the list *matches the manifest*, so this
    // is an equality and not a `toContain`.
    expect(labelsOf(result)).toEqual(['item', 'titulo', 'tom']);
  });

  it('replaces what has been typed of the name, not the :: in front of it', () => {
    const doc = `${frontmatter()}::ti|`;
    const result = completeAt(doc, analysisOf(CARROSSEL));

    expect(result?.from).toBe(doc.indexOf('|') - 2);
    expect(labelsOf(result)).toEqual(['item', 'titulo', 'tom']);
  });

  it('says what kind of slot each one is', () => {
    const result = completeAt(`${frontmatter()}::|`, analysisOf(CARROSSEL));
    const titulo = result?.options.find((option) => option.label === 'titulo');
    const item = result?.options.find((option) => option.label === 'item');

    expect(titulo?.detail).toBe('rich-text · required');
    expect(item?.detail).toBe('rich-text · repeat');
  });

  it('swaps the whole list when the frontmatter names another template', () => {
    const result = completeAt(`${frontmatter()}::|`, analysisOf(PROMO));

    expect(labelsOf(result)).toEqual(['headline', 'imagem']);
  });

  it('offers only the adjustments declared for the slot the list sits on', () => {
    const onItem = completeAt(`${frontmatter()}::item {|`, analysisOf(CARROSSEL));
    const onTitulo = completeAt(`${frontmatter()}::titulo {|`, analysisOf(CARROSSEL));

    expect(labelsOf(onItem)).toEqual(['destaque', 'tom']);
    // Neither adjustment `applies` to `titulo`, so there is nothing to offer and the
    // source stands down rather than showing a list that cannot be written.
    expect(onTitulo).toBeNull();
  });

  it('offers the next adjustment after a comma', () => {
    const result = completeAt(`${frontmatter()}::item {destaque, |`, analysisOf(CARROSSEL));

    expect(labelsOf(result)).toEqual(['destaque', 'tom']);
  });

  it('offers an enum adjustment its values after the colon', () => {
    const result = completeAt(`${frontmatter()}::item {tom: |`, analysisOf(CARROSSEL));

    expect(labelsOf(result)).toEqual(['claro', 'escuro']);
  });

  it('offers nothing after the colon of a flag adjustment, which takes no value', () => {
    const result = completeAt(`${frontmatter()}::item {destaque: |`, analysisOf(CARROSSEL));

    expect(result).toBeNull();
  });

  it('completes the template name in the frontmatter, with no manifest needed', () => {
    const result = completeAt('---\ntemplate: |\n---\n', analysisOf());

    expect(labelsOf(result)).toEqual(['carrossel-lista', 'promo-curso']);
  });

  it('completes format ids inside the frontmatter list', () => {
    const first = completeAt(frontmatter('formats: [|'), analysisOf(CARROSSEL));
    const second = completeAt(frontmatter('formats: [feed, |'), analysisOf(CARROSSEL));

    expect(labelsOf(first)).toEqual(['feed', 'story']);
    expect(labelsOf(second)).toEqual(['feed', 'story']);
  });

  it('completes an enum slot set as a frontmatter scalar', () => {
    const result = completeAt(frontmatter('tom: |'), analysisOf(CARROSSEL));

    expect(labelsOf(result)).toEqual(['claro', 'escuro']);
  });

  it('offers nothing for a frontmatter key that is not an enum slot', () => {
    const result = completeAt(frontmatter('titulo: |'), analysisOf(CARROSSEL));

    expect(result).toBeNull();
  });

  it('does not read :: in an indented body line as a directive', () => {
    const result = completeAt(`${frontmatter()}::item\n  ::|`, analysisOf(CARROSSEL));

    expect(result).toBeNull();
  });

  it('stands down before the first analysis has arrived', () => {
    const state = EditorState.create({ doc: '::', extensions: [briefAnalysisField] });
    expect(completeBrief(new CompletionContext(state, 2, false))).toBeNull();
  });

  it('stands down in the body when no template has been resolved', () => {
    const result = completeAt(`${frontmatter()}::|`, analysisOf());

    expect(result).toBeNull();
  });

  /**
   * "Without a closing fence there is no frontmatter" (`docs/brief-language.md`). The
   * source follows the parser rather than guessing at a block the parser would reject.
   */
  it('treats an unterminated frontmatter as body, the way the language does', () => {
    const result = completeAt('---\ntemplate: |\n', analysisOf(CARROSSEL));

    expect(result).toBeNull();
  });
});
