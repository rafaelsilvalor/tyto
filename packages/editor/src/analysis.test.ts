import { EditorState } from '@codemirror/state';
import { type AssetResolver, type TemplateManifest, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { briefAnalysisField, createBriefAnalyzer, setBriefAnalysis } from './analysis.js';

/**
 * The analyzer is exercised through `parseManifest` and the real `resolve`, not a stub.
 *
 * What this file is actually claiming is that the editor reports what the compiler
 * reports — same codes, same ranges. A fake manifest object or a fake resolve would assert
 * that this package calls two functions, which is the one thing nobody needs a test for.
 */
const manifestOf = (yaml: string): TemplateManifest => {
  const parsed = parseManifest(yaml, 'manifest.yaml');
  if (!parsed.ok) {
    throw new Error(
      `fixture manifest does not parse: ${parsed.error.map((d) => d.message).join('; ')}`,
    );
  }
  return parsed.value;
};

/** The built-in `carrossel-lista`, which is the manifest with one of everything in it. */
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
formats: [feed, story]
slots:
  titulo: { type: rich-text, required: true, max: 80 }
  imagem: { type: image }
`);

const analyzer = createBriefAnalyzer({ manifests: [CARROSSEL, PROMO] });

const VALID = ['---', 'template: carrossel-lista', '---', '::titulo Lista', '::item Um', ''].join(
  '\n',
);

const codesOf = (diagnostics: readonly { code: string }[]): string[] =>
  diagnostics.map((item) => item.code);

describe('createBriefAnalyzer', () => {
  it('finds the manifest the frontmatter names', async () => {
    const analysis = await analyzer.analyze(VALID);

    expect(analysis.manifest?.name).toBe('carrossel-lista');
    expect(analysis.diagnostics).toEqual([]);
  });

  it('lists every template it was given, for completing the frontmatter', async () => {
    const analysis = await analyzer.analyze(VALID);

    expect([...analysis.templates].sort()).toEqual(['carrossel-lista', 'promo-curso']);
  });

  it('reports an unknown slot against the name, with the suggestion resolve made', async () => {
    const source = ['---', 'template: carrossel-lista', '---', '::titlo Lista', '::item Um'].join(
      '\n',
    );
    const analysis = await analyzer.analyze(source);
    const unknown = analysis.diagnostics.find((item) => item.code === 'E_UNKNOWN_SLOT');

    expect(unknown?.hint).toBe("Did you mean 'titulo'?");
    // `nameRange` and not the whole directive: five characters, not the line.
    expect(source.slice(unknown?.range?.start ?? 0, unknown?.range?.end ?? 0)).toBe('titlo');
  });

  it('keeps the document it read, so a late answer can be recognised as late', async () => {
    const analysis = await analyzer.analyze(VALID);
    expect(analysis.source).toBe(VALID);
  });

  it('reports an unknown template and offers no manifest to complete against', async () => {
    const source = ['---', 'template: nao-existe', '---', '::titulo Lista'].join('\n');
    const analysis = await analyzer.analyze(source);

    expect(codesOf(analysis.diagnostics)).toEqual(['E_UNKNOWN_TEMPLATE']);
    expect(analysis.manifest).toBeUndefined();
  });

  it('passes a syntax error through without reaching resolve', async () => {
    const analysis = await analyzer.analyze('::titulo {cor : azul}\n');

    expect(codesOf(analysis.diagnostics)).toContain('E_SYNTAX');
    expect(analysis.manifest).toBeUndefined();
  });

  it('keeps warnings from a resolve that succeeded', async () => {
    const source = [
      '---',
      'template: carrossel-lista',
      'titulo: Direito **Constitucional**',
      '---',
      '::item Um',
    ].join('\n');
    const analysis = await analyzer.analyze(source);

    expect(codesOf(analysis.diagnostics)).toContain('W_MARKUP_IN_FRONTMATTER');
  });

  it('does not report a missing asset when the host gave it no way to look', async () => {
    const source = ['---', 'template: promo-curso', 'imagem: ./nao-existe.png', '---'].join('\n');
    const analysis = await analyzer.analyze(source);

    expect(codesOf(analysis.diagnostics)).not.toContain('E_ASSET_NOT_FOUND');
  });

  it('reports a missing asset when the host did give it one', async () => {
    const assets: AssetResolver = {
      base: '/briefs',
      resolve: () => Promise.resolve(undefined),
    };
    const withDisk = createBriefAnalyzer({ manifests: [PROMO], assets });
    const source = ['---', 'template: promo-curso', 'imagem: ./nao-existe.png', '---'].join('\n');

    const analysis = await withDisk.analyze(source);

    expect(codesOf(analysis.diagnostics)).toContain('E_ASSET_NOT_FOUND');
  });

  it('lets the first of two manifests with one name win', async () => {
    const shadowing = manifestOf(`
name: promo-curso
version: 2.0.0
formats: [banner]
slots:
  headline: { type: rich-text }
`);
    const withProject = createBriefAnalyzer({ manifests: [shadowing, PROMO] });
    const analysis = await withProject.analyze(
      ['---', 'template: promo-curso', '---', '::headline Oi'].join('\n'),
    );

    expect(analysis.manifest?.version).toBe('2.0.0');
    expect(analysis.diagnostics).toEqual([]);
  });
});

describe('briefAnalysisField', () => {
  const stateWith = (...analyses: Parameters<typeof setBriefAnalysis.of>[0][]): EditorState => {
    let state = EditorState.create({ doc: VALID, extensions: [briefAnalysisField] });
    for (const analysis of analyses) {
      state = state.update({ effects: setBriefAnalysis.of(analysis) }).state;
    }
    return state;
  };

  it('starts empty, so completion knows to stay quiet', () => {
    const state = EditorState.create({ extensions: [briefAnalysisField] });
    expect(state.field(briefAnalysisField)).toBeUndefined();
  });

  it('keeps the last manifest when a pass finds none', async () => {
    const good = await analyzer.analyze(VALID);
    const broken = await analyzer.analyze('::titulo {cor : azul}\n');
    expect(broken.manifest).toBeUndefined();

    const state = stateWith(good, broken);

    // Sticky: an author who has just broken the syntax is the author who most wants the
    // completion list, and the template they are writing against has not changed.
    expect(state.field(briefAnalysisField)?.manifest?.name).toBe('carrossel-lista');
  });

  it('replaces the diagnostics outright, so no stale squiggle survives', async () => {
    const withError = await analyzer.analyze(
      ['---', 'template: carrossel-lista', '---', '::titlo Lista', '::item Um'].join('\n'),
    );
    const clean = await analyzer.analyze(VALID);

    const state = stateWith(withError, clean);

    expect(state.field(briefAnalysisField)?.diagnostics).toEqual([]);
  });

  it('swaps the manifest when the frontmatter names another template', async () => {
    const carrossel = await analyzer.analyze(VALID);
    const promo = await analyzer.analyze(
      ['---', 'template: promo-curso', '---', '::titulo Oi'].join('\n'),
    );

    const state = stateWith(carrossel, promo);

    expect(state.field(briefAnalysisField)?.manifest?.name).toBe('promo-curso');
  });
});
