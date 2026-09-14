import { type Diagnostic as LintDiagnostic, forEachDiagnostic } from '@codemirror/lint';
import { type DiagnosticCode, type TemplateManifest, diagnostic, parseManifest } from '@tyto/core';
import { afterEach, describe, expect, it } from 'vitest';

import { type BriefAnalysis, type BriefAnalyzer, createBriefAnalyzer } from './analysis.js';
import { createEditor, type EditorHandle } from './editor.js';
import { BRIEF_LINT_DELAY, briefLint, suggestionFor } from './lint.js';

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

const analyzer = createBriefAnalyzer({ manifests: [CARROSSEL] });

const brief = (...lines: readonly string[]): string =>
  ['---', 'template: carrossel-lista', '---', ...lines].join('\n');

let handle: EditorHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

const open = (
  doc: string,
  options: { analyzer?: BriefAnalyzer; delay?: number } = {},
): EditorHandle => {
  const parent = document.createElement('div');
  document.body.append(parent);
  handle = createEditor(parent, {
    doc,
    extensions: [briefLint(options.analyzer ?? analyzer, { delay: options.delay ?? 0 })],
  });
  return handle;
};

const markers = (editor: EditorHandle): LintDiagnostic[] => {
  const found: LintDiagnostic[] = [];
  forEachDiagnostic(editor.view.state, (item) => found.push(item));
  return found;
};

/**
 * Markers are looked up by code and never by index.
 *
 * One mistake usually produces two diagnostics — writing `::titlo` both names a slot that
 * does not exist *and* leaves the required `titulo` unset — and they are ordered by
 * position, so the one a test means is not reliably the first.
 */
const markerFor = (editor: EditorHandle, code: DiagnosticCode): LintDiagnostic | undefined =>
  markers(editor).find((item) => item.source === code);

/**
 * Polls rather than sleeps a fixed amount: the lint source is a debounce followed by a
 * promise, and how long the promise takes is the machine's business, not the test's.
 */
const waitForMarker = async (
  editor: EditorHandle,
  code: DiagnosticCode,
  budget: number,
): Promise<{ marker: LintDiagnostic; elapsed: number }> => {
  const started = Date.now();
  for (;;) {
    const marker = markerFor(editor, code);
    const elapsed = Date.now() - started;
    if (marker) return { marker, elapsed };
    if (elapsed > budget) throw new Error(`no ${code} marker within ${budget} ms`);
    await new Promise((resume) => setTimeout(resume, 1));
  }
};

describe('briefLint', () => {
  it('underlines an unknown slot where the compiler says it is', async () => {
    const editor = open(brief('::titlo Lista', '::item Um'));
    const { marker } = await waitForMarker(editor, 'E_UNKNOWN_SLOT', 2000);

    expect(marker.severity).toBe('error');
    // The span covers the name and nothing else — not the `::`, not the body.
    expect(editor.view.state.sliceDoc(marker.from, marker.to)).toBe('titlo');
  });

  it('puts the hint in the message, where a hover shows it', async () => {
    const editor = open(brief('::titlo Lista', '::item Um'));
    const { marker } = await waitForMarker(editor, 'E_UNKNOWN_SLOT', 2000);

    expect(marker.message).toContain("Unknown slot 'titlo'");
    expect(marker.message).toContain("Did you mean 'titulo'?");
  });

  it('offers the closest valid slot as a fix that rewrites the name', async () => {
    const editor = open(brief('::titlo Lista', '::item Um'));
    const { marker } = await waitForMarker(editor, 'E_UNKNOWN_SLOT', 2000);

    const action = marker.actions?.[0];
    expect(action?.name).toBe("Replace with 'titulo'");

    action?.apply(editor.view, marker.from, marker.to);

    expect(editor.getValue()).toContain('::titulo Lista');
    expect(editor.getValue()).not.toContain('::titlo');
  });

  it('clears the marker once the brief is fixed', async () => {
    const editor = open(brief('::titlo Lista', '::item Um'));
    await waitForMarker(editor, 'E_UNKNOWN_SLOT', 2000);

    editor.setValue(brief('::titulo Lista', '::item Um'));

    const started = Date.now();
    while (markers(editor).length > 0) {
      if (Date.now() - started > 2000) throw new Error('marker outlived the mistake');
      await new Promise((resume) => setTimeout(resume, 1));
    }
    expect(markers(editor)).toEqual([]);
  });

  it('shows a warning as a warning', async () => {
    const editor = open(
      [
        '---',
        'template: carrossel-lista',
        'titulo: Direito **Constitucional**',
        '---',
        '::item Um',
      ].join('\n'),
    );
    const { marker } = await waitForMarker(editor, 'W_MARKUP_IN_FRONTMATTER', 2000);

    expect(marker.severity).toBe('warning');
  });

  /**
   * Every diagnostic `parse` and `resolve` produce today carries a range, so the fallback
   * is reached through a stubbed analyzer rather than a brief. That is the point of the
   * analyzer being a port: the mapping can be asked a question the compiler does not
   * currently ask it, instead of the branch going untested until one day it fires.
   */
  it('lands a diagnostic with no range on the first line, where it can be seen', async () => {
    const positionless: BriefAnalyzer = {
      analyze: (source: string): Promise<BriefAnalysis> =>
        Promise.resolve({ source, templates: [], diagnostics: [diagnostic('E_NO_TEMPLATE', {})] }),
    };
    const editor = open('::titulo Sem frontmatter\n', { analyzer: positionless });
    const { marker } = await waitForMarker(editor, 'E_NO_TEMPLATE', 2000);

    expect(marker.from).toBe(0);
    // A real span rather than a zero-width caret: `to` is the end of line one.
    expect(marker.to).toBe(editor.view.state.doc.line(1).to);
    expect(marker.to).toBeGreaterThan(0);
  });

  it('marks a misplaced adjustment on its name, and offers no fix for a name spelled right', async () => {
    // `destaque` is declared on `item` only, so writing it on `titulo` is
    // `E_BAD_ADJUSTMENT`. The word is not a typo — it is in the wrong place — and a fix
    // that replaced `destaque` with `destaque` would be noise.
    const editor = open(brief('::titulo {destaque} Lista', '::item Um'));
    const { marker } = await waitForMarker(editor, 'E_BAD_ADJUSTMENT', 2000);

    expect(editor.view.state.sliceDoc(marker.from, marker.to)).toBe('destaque');
    expect(marker.actions ?? []).toEqual([]);
  });

  it('fixes a misspelled adjustment, which is ranged on its name', async () => {
    const editor = open(brief('::titulo Lista', '::item {destaqe} Um'));
    const { marker } = await waitForMarker(editor, 'E_BAD_ADJUSTMENT', 2000);

    expect(marker.actions?.[0]?.name).toBe("Replace with 'destaque'");

    marker.actions?.[0]?.apply(editor.view, marker.from, marker.to);
    expect(editor.getValue()).toContain('{destaque}');
  });

  /**
   * The card asks for the underline "within 200 ms". That budget is the debounce plus one
   * analysis, and the debounce is the half that can regress — CodeMirror's own default is
   * 750, which this extension has to override and could stop overriding.
   *
   * So the constant is asserted directly and the wall clock is given a loose ceiling. A
   * 200 ms assertion here would be measuring how loaded the CI runner is: the analysis
   * itself is sub-millisecond over a brief this size, and nothing in it grows with the
   * machine.
   */
  it('keeps the debounce well inside the budget the card sets', async () => {
    expect(BRIEF_LINT_DELAY).toBeLessThan(200);

    const editor = open(brief('::titlo Lista', '::item Um'), { delay: BRIEF_LINT_DELAY });
    await waitForMarker(editor, 'E_UNKNOWN_SLOT', 400);
  });
});

describe('suggestionFor', () => {
  const analysis = (manifest?: TemplateManifest): BriefAnalysis => ({
    source: '',
    diagnostics: [],
    templates: ['carrossel-lista', 'promo-curso'],
    ...(manifest === undefined ? {} : { manifest }),
  });

  it('suggests a slot for an unknown slot', () => {
    const item = { severity: 'error', code: 'E_UNKNOWN_SLOT', message: '' } as const;
    expect(suggestionFor(item, analysis(CARROSSEL), 'titlo')).toBe('titulo');
  });

  it('suggests a template for an unknown template, which needs no manifest', () => {
    const item = { severity: 'error', code: 'E_UNKNOWN_TEMPLATE', message: '' } as const;
    expect(suggestionFor(item, analysis(), 'promo-curse')).toBe('promo-curso');
  });

  it('suggests a format for an unknown format', () => {
    const item = { severity: 'error', code: 'E_UNKNOWN_FORMAT', message: '' } as const;
    expect(suggestionFor(item, analysis(CARROSSEL), 'stor')).toBe('story');
  });

  it('refuses anything that is not a bare name, whatever the code says', () => {
    const item = { severity: 'error', code: 'E_UNKNOWN_SLOT', message: '' } as const;
    expect(suggestionFor(item, analysis(CARROSSEL), '::titlo Lista')).toBeUndefined();
    expect(suggestionFor(item, analysis(CARROSSEL), 'ai/caption')).toBeUndefined();
  });

  it('says nothing when nothing is close enough, rather than guessing', () => {
    const item = { severity: 'error', code: 'E_UNKNOWN_SLOT', message: '' } as const;
    expect(suggestionFor(item, analysis(CARROSSEL), 'rodape')).toBeUndefined();
  });

  it('says nothing for a code that has no list to suggest from', () => {
    const item = { severity: 'error', code: 'E_BAD_SLOT_VALUE', message: '' } as const;
    expect(suggestionFor(item, analysis(CARROSSEL), 'titulo')).toBeUndefined();
  });
});
