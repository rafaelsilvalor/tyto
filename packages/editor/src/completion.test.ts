import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { type BriefAnalysis, briefAnalysisField, setBriefAnalysis } from './analysis.js';
import { briefLanguage } from './brief-language.js';
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
 *
 * `briefLanguage` is in the state because the source reads the syntax tree (TYTO-93), and
 * without a language in the state there is no tree to read — every case would answer
 * `null` for the wrong reason.
 */
const completeAt = (marked: string, analysis: BriefAnalysis): CompletionResult | null => {
  const pos = marked.indexOf('|');
  if (pos === -1) throw new Error('the fixture has no | marking the cursor');
  const doc = marked.replace('|', '');

  const created = EditorState.create({ doc, extensions: [briefAnalysisField, briefLanguage] });
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

  it('does not read :: inside an inline body as a directive', () => {
    const result = completeAt(`${frontmatter()}::titulo Direito ::|`, analysisOf(CARROSSEL));

    expect(result).toBeNull();
  });

  /**
   * The other case the tree answers for free. "The first `{…}` after a directive name is an
   * adjustment list" (`docs/brief-language.md`), and a `{` anywhere else in the body opens a
   * mark — which takes a colour, not an adjustment.
   */
  it('does not read a mark in body text as an adjustment list', () => {
    const result = completeAt(`${frontmatter()}::titulo Direito {|`, analysisOf(CARROSSEL));

    expect(result).toBeNull();
  });

  it('replaces what has been typed of an adjustment name', () => {
    const doc = `${frontmatter()}::item {desta|`;
    const result = completeAt(doc, analysisOf(CARROSSEL));

    expect(result?.from).toBe(doc.indexOf('|') - 5);
    expect(labelsOf(result)).toEqual(['destaque', 'tom']);
  });

  it('replaces what has been typed of an enum adjustment value', () => {
    const doc = `${frontmatter()}::item {tom: cl|`;
    const result = completeAt(doc, analysisOf(CARROSSEL));

    expect(result?.from).toBe(doc.indexOf('|') - 2);
    expect(labelsOf(result)).toEqual(['claro', 'escuro']);
  });

  it('offers the next adjustment after a written pair', () => {
    const result = completeAt(`${frontmatter()}::item {tom: claro, |`, analysisOf(CARROSSEL));

    expect(labelsOf(result)).toEqual(['destaque', 'tom']);
  });

  it('offers nothing on a comment line', () => {
    const result = completeAt(`${frontmatter()}// ::|`, analysisOf(CARROSSEL));

    expect(result).toBeNull();
  });

  it('stands down before the first analysis has arrived', () => {
    const state = EditorState.create({
      doc: '::',
      extensions: [briefAnalysisField, briefLanguage],
    });
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

  /**
   * The wreckage of an unterminated frontmatter carries a `Name` node — `template` is the
   * same shape as a directive name — and it is not a directive. The parent says so.
   */
  it('does not read the key of a broken frontmatter as a directive name', () => {
    const result = completeAt('---\ntemplate|: carrossel-lista\n', analysisOf(CARROSSEL));

    expect(result).toBeNull();
  });

  /**
   * Past the 3 000 characters CodeMirror parses up front, where this source used to answer
   * nothing at all.
   *
   * `syntaxTree(state)` returns whatever the last parse finished, and on a fresh state that
   * is `Math.min(3000, doc.length)` with a 20 ms budget on top
   * (`@codemirror/language/dist/index.js:540`). Past the truncation `resolveInner` hands back
   * the top node, `completeBody` falls through to its `default:`, and the author gets no
   * suggestions below roughly line 200 of a brief. Measured before the fix: a 400-line
   * document resolved `Brief` where a 200-line one resolved `Adjustments`, and the labels
   * went from two to none.
   *
   * **This is the same defect as the flake** `completion.test.ts` used to show 2 runs in 9.
   * The 20 ms is wall clock, so a worker descheduled under load loses it on a document of
   * any size; this test is the deterministic half of it, and `syntax.ts` explains both.
   *
   * The sizes bracket the boundary deliberately. 200 lines is 2 942 characters and passed
   * before the fix; 400 lines is 5 942 and did not. Both are here, so a regression that
   * shrank the reachable window rather than removing it would still be caught.
   */
  it('completes past the first 3 000 characters, which the initial parse does not reach', () => {
    const padding = (lines: number): string =>
      `${Array.from({ length: lines }, (_, index) => `// padding ${String(index)}`).join('\n')}\n`;

    for (const lines of [200, 400, 1000]) {
      const document_ = `${frontmatter()}${padding(lines)}::item {destaque, |`;
      // The point of the 400 and 1000 cases, stated rather than left to the reader's
      // arithmetic: they are past the window, and the 200 case is inside it.
      expect(document_.length > 3000, `${String(lines)} lines`).toBe(lines > 200);

      const result = completeAt(document_, analysisOf(CARROSSEL));

      // Asserted before the labels, so a future failure says "no tree" rather than being
      // read as "no suggestions" — the two are indistinguishable through `labelsOf` alone,
      // which is what made the original flake undiagnosable.
      expect(result, `${String(lines)} lines`).not.toBeNull();
      expect(labelsOf(result), `${String(lines)} lines`).toEqual(['destaque', 'tom']);
    }
  });
});
