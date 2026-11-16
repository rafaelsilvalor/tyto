// @vitest-environment jsdom
import { codeFolding, foldEffect, foldGutter, foldable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { briefAnalysisField, setBriefAnalysis } from './analysis.js';
import { nestingChanged } from './brief-blocks.js';
import { briefLanguage } from './brief-language.js';
import { stickyChain } from './sticky-scroll.js';
import { fullyParsed } from './test-parse.js';

/**
 * Folding a slide folds the blocks nested in it (TYTO-748, ADR 0207). The tree is flat, so the
 * nesting reaches the fold and the sticky rows from the manifest of the brief's last analysis.
 */

function manifestOf(yaml: string): TemplateManifest {
  const parsed = parseManifest(yaml, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const ANINHADO = manifestOf(`name: aninhado
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
  lamina: { type: rich-text, repeat: true }
  bloco: { type: rich-text, per: lamina }
  nota: { type: rich-text, per: lamina }
  paragrafo: { type: rich-text, per: bloco }
`);

/** The same slots with no `per`: nothing nests. */
const PLANO = manifestOf(`name: plano
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
  lamina: { type: rich-text, repeat: true }
  bloco: { type: rich-text }
  paragrafo: { type: rich-text }
`);

const BRIEF = [
  '::lamina', //            1
  '  Um', //                2
  '  ::bloco', //           3
  '    A', //               4
  '    ::paragrafo', //     5
  '      A1', //            6
  '  ::bloco', //           7
  '    B', //               8
  '::titulo T', //          9
  '::lamina', //            10
  '  ::bloco', //           11
  '    C', //               12
  '', //                    13
].join('\n');

const stateOf = (doc: string, manifest?: TemplateManifest): EditorState => {
  const state = fullyParsed(
    EditorState.create({ doc, extensions: [briefLanguage, briefAnalysisField, codeFolding()] }),
  );
  if (manifest === undefined) return state;
  return state.update({
    effects: setBriefAnalysis.of({ source: doc, diagnostics: [], templates: [], manifest }),
  }).state;
};

/** The fold of line `line`'s head, as the lines it spans: `[head, last]`; none if it does not fold. */
const foldLines = (state: EditorState, line: number): readonly [number, number] | null => {
  const head = state.doc.line(line);
  const range = foldable(state, head.from, head.to);
  if (range === null) return null;
  return [state.doc.lineAt(range.from).number, state.doc.lineAt(range.to).number];
};

describe('the fold of a directive with blocks nested in it', () => {
  it('runs to the last text of the last block nested in it, at any depth', () => {
    const state = stateOf(BRIEF, ANINHADO);
    expect(foldLines(state, 1)).toEqual([1, 8]);
    expect(foldLines(state, 3)).toEqual([3, 6]);
    expect(foldLines(state, 5)).toEqual([5, 6]);
    expect(foldLines(state, 7)).toEqual([7, 8]);
  });

  it('stops before the next sibling, and before a brief-wide slot between slides', () => {
    const state = stateOf(BRIEF, ANINHADO);
    const head = state.doc.line(1);
    const range = foldable(state, head.from, head.to);
    expect(range?.from).toBe(head.to);
    expect(range?.to).toBe(state.doc.line(8).to);
  });

  it('folds a slide with no body of its own but blocks under it', () => {
    const state = stateOf(BRIEF, ANINHADO);
    expect(foldLines(state, 10)).toEqual([10, 12]);
  });

  it('is the directive’s own body while no analysis is known', () => {
    const state = stateOf(BRIEF);
    expect(foldLines(state, 1)).toEqual([1, 2]);
    expect(foldLines(state, 3)).toEqual([3, 4]);
    expect(foldLines(state, 10)).toBeNull();
  });

  it('is the directive’s own body on a template that declares no nesting', () => {
    const state = stateOf(BRIEF, PLANO);
    expect(foldLines(state, 1)).toEqual([1, 2]);
    expect(foldLines(state, 3)).toEqual([3, 4]);
    expect(foldLines(state, 7)).toEqual([7, 8]);
    expect(foldLines(state, 10)).toBeNull();
  });
});

/** The head lines of the sticky chain at the start of line `line`, as text. */
const headsAt = (state: EditorState, line: number): readonly string[] =>
  stickyChain(state, state.doc.line(line).from).map((block) => state.doc.line(block.line).text);

describe('sticky scroll over nested blocks', () => {
  it('pins the slide above its nested blocks, outermost first', () => {
    const state = stateOf(BRIEF, ANINHADO);
    expect(headsAt(state, 6)).toEqual(['::lamina', '  ::bloco', '    ::paragrafo']);
    expect(headsAt(state, 8)).toEqual(['::lamina', '  ::bloco']);
    expect(headsAt(state, 12)).toEqual(['::lamina', '  ::bloco']);
  });

  it('pins only the block itself on a template that declares no nesting', () => {
    const state = stateOf(BRIEF, PLANO);
    expect(headsAt(state, 6)).toEqual(['    ::paragrafo']);
    expect(headsAt(state, 8)).toEqual(['  ::bloco']);
  });

  it('pins nothing once the slide is over', () => {
    const state = stateOf(BRIEF, ANINHADO);
    expect(headsAt(state, 9)).toEqual([]);
  });

  it('pins nothing inside a folded slide', () => {
    const before = stateOf(BRIEF, ANINHADO);
    const head = before.doc.line(1);
    const range = foldable(before, head.from, head.to);
    if (range === null) throw new Error('the slide does not fold');
    const state = before.update({ effects: foldEffect.of(range) }).state;
    expect(headsAt(state, 6)).not.toContain('::lamina');
  });
});

describe('when the fold gutter and sticky rows redraw for the nesting', () => {
  it('is when the manifest arrives or changes, not on every analysis', () => {
    let state = stateOf(BRIEF);
    let redraws = 0;
    const land = (manifest: TemplateManifest | undefined, doc = BRIEF): void => {
      const next = state.update({
        effects: setBriefAnalysis.of({
          source: doc,
          diagnostics: [],
          templates: [],
          ...(manifest === undefined ? {} : { manifest }),
        }),
      }).state;
      if (nestingChanged({ startState: state, state: next })) redraws += 1;
      state = next;
    };
    land(ANINHADO);
    for (let pass = 0; pass < 10; pass += 1) land(ANINHADO);
    // A pass that does not parse keeps the manifest (briefAnalysisField).
    land(undefined);
    land(PLANO);
    expect(redraws).toBe(2);
  });

  it('puts a fold marker on a body-less slide once the analysis lands, with no edit', () => {
    const markersOf = (manifest?: TemplateManifest): number => {
      const host = document.createElement('div');
      document.body.append(host);
      const gutterView = new EditorView({
        state: EditorState.create({
          doc: BRIEF,
          extensions: [
            briefLanguage,
            briefAnalysisField,
            foldGutter({ foldingChanged: nestingChanged }),
          ],
        }),
        parent: host,
      });
      if (manifest !== undefined) {
        gutterView.dispatch({
          effects: setBriefAnalysis.of({ source: BRIEF, diagnostics: [], templates: [], manifest }),
        });
      }
      const open = gutterView.dom.querySelectorAll('.cm-foldGutter span[title]').length;
      gutterView.destroy();
      host.remove();
      return open;
    };
    expect(markersOf(ANINHADO)).toBeGreaterThan(markersOf());
  });
});
