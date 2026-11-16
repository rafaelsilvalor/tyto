// @vitest-environment jsdom
import { parser } from '@tyto/brief-lang';
import { codeFolding, foldable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { briefAnalysisField, setBriefAnalysis } from './analysis.js';
import { briefBlocks } from './brief-blocks.js';
import { briefLanguage } from './brief-language.js';
import { BLOCK_INDENT, breadcrumbAt, directiveLabel } from './breadcrumb.js';
import { fullyParsed } from './test-parse.js';

/**
 * Several blocks of one slot inside one parent (TYTO-746, ADR 0207 note of 2026-11-16): two
 * `::bloco` in a slide and two `::paragrafo` in each. Each sibling is a block of its own in the
 * block list, the breadcrumb, "Go to Block" and the fold, and belongs to the parent above it.
 */

function manifestOf(yaml: string): TemplateManifest {
  const parsed = parseManifest(yaml, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

const LISTAS = manifestOf(`name: listas
version: 1.0.0
formats: [feed]
slots:
  lamina: { type: rich-text, repeat: true }
  bloco: { type: rich-text, per: lamina, multiple: true }
  paragrafo: { type: rich-text, per: bloco, multiple: true }
`);

const BRIEF = [
  '::lamina', //              1
  '  Um', //                  2
  '  ::bloco A', //           3
  '    ::paragrafo', //       4
  '      A1', //              5
  '    ::paragrafo A2', //    6
  '  ::bloco B', //           7
  '    ::paragrafo B1', //    8
  '    ::paragrafo', //       9
  '      B2', //              10
  '::lamina', //              11
  '  ::bloco C', //           12
  '    ::paragrafo C1', //    13
  '', //                      14
].join('\n');

const blocks = briefBlocks(parser.parse(BRIEF), (from, to) => BRIEF.slice(from, to), LISTAS);
const slice = (from: number, to: number): string => BRIEF.slice(from, to);

describe('briefBlocks with siblings', () => {
  it('lists every sibling, each belonging to the parent open above it', () => {
    expect(blocks.map((block) => [block.name, block.depth, block.parent])).toEqual([
      ['lamina', undefined, undefined],
      ['bloco', 1, 0],
      ['paragrafo', 2, 1],
      ['paragrafo', 2, 1],
      ['bloco', 1, 0],
      ['paragrafo', 2, 4],
      ['paragrafo', 2, 4],
      ['lamina', undefined, undefined],
      ['bloco', 1, 7],
      ['paragrafo', 2, 8],
    ]);
  });
});

describe('the breadcrumb and Go to Block with siblings', () => {
  it('names the chain through the second block, not the first', () => {
    expect(breadcrumbAt(blocks, BRIEF.indexOf('B2') + 1, slice)).toEqual({
      kind: 'directive',
      label: '::lamina 1 › ::bloco › ::paragrafo',
    });
    expect(breadcrumbAt(blocks, BRIEF.indexOf('::bloco B') + 2, slice)).toEqual({
      kind: 'directive',
      label: '::lamina 1 › ::bloco',
    });
  });

  it('lists each sibling as an entry of its own, indented by its level', () => {
    const one = BLOCK_INDENT;
    const two = `${BLOCK_INDENT}${BLOCK_INDENT}`;
    expect(blocks.map(directiveLabel)).toEqual([
      '::lamina 1',
      `${one}::bloco`,
      `${two}::paragrafo`,
      `${two}::paragrafo`,
      `${one}::bloco`,
      `${two}::paragrafo`,
      `${two}::paragrafo`,
      '::lamina 2',
      `${one}::bloco`,
      `${two}::paragrafo`,
    ]);
  });
});

describe('the fold of a block with siblings', () => {
  const state = fullyParsed(
    EditorState.create({
      doc: BRIEF,
      extensions: [briefLanguage, briefAnalysisField, codeFolding()],
    }),
  ).update({
    effects: setBriefAnalysis.of({
      source: BRIEF,
      diagnostics: [],
      templates: [],
      manifest: LISTAS,
    }),
  }).state;
  const foldLines = (line: number): readonly [number, number] | null => {
    const head = state.doc.line(line);
    const range = foldable(state, head.from, head.to);
    if (range === null) return null;
    return [state.doc.lineAt(range.from).number, state.doc.lineAt(range.to).number];
  };

  it('stops each block before its next sibling, and the slide after the last', () => {
    expect(foldLines(1)).toEqual([1, 10]);
    expect(foldLines(3)).toEqual([3, 6]);
    expect(foldLines(4)).toEqual([4, 5]);
    expect(foldLines(7)).toEqual([7, 10]);
    expect(foldLines(9)).toEqual([9, 10]);
    expect(foldLines(11)).toEqual([11, 13]);
  });
});
