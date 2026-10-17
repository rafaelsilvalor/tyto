import { codeFolding, ensureSyntaxTree, foldEffect, foldable } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { briefLanguage } from './brief-language.js';
import { json } from './json-language.js';
import {
  STICKY_MAX_ROWS,
  type StickyBlock,
  type StickyMeasure,
  stickyChain,
  stickyRows,
} from './sticky-scroll.js';
import { templateLanguage } from './template-language.js';

const stateOf = (doc: string, language: Extension = briefLanguage): EditorState => {
  const state = EditorState.create({ doc, extensions: [language, codeFolding()] });
  ensureSyntaxTree(state, state.doc.length, 5_000);
  return state;
};

/** The head lines of the chain at the start of line `line`, as text. */
const headsAt = (state: EditorState, line: number): readonly string[] =>
  stickyChain(state, state.doc.line(line).from).map((block) => state.doc.line(block.line).text);

const BRIEF = [
  '---', //                 1
  'template: agenda-semana', // 2
  '---', //                 3
  '::titulo', //            4
  '  AGENDA', //            5
  '::lamina', //            6
  '  FARMÁCIA', //          7
  '    16/09 - 14:00', //   8
  '', //                    9
  '    17/09 - 14:00', //   10
  '  SERVIÇO SOCIAL', //    11
  '', //                    12
  '::lamina', //            13
  '  NUTRIÇÃO', //          14
].join('\n');

describe('the chain of blocks a line is inside', () => {
  const state = stateOf(BRIEF);

  it('names the directive whose body holds the line', () => {
    expect(headsAt(state, 7)).toEqual(['::lamina']);
    expect(headsAt(state, 11)).toEqual(['::lamina']);
    expect(stickyChain(state, state.doc.line(8).from)[0]).toMatchObject({
      line: 6,
      from: state.doc.line(6).from,
    });
  });

  it('pins nothing on the head line itself, or in the frontmatter', () => {
    expect(headsAt(state, 6)).toEqual([]);
    expect(headsAt(state, 2)).toEqual([]);
  });

  it('is still inside after a blank line inside the block (ADR 0087)', () => {
    expect(headsAt(state, 9)).toEqual(['::lamina']);
    expect(headsAt(state, 10)).toEqual(['::lamina']);
  });

  it('is outside on the blank line after the block’s last text', () => {
    expect(headsAt(state, 12)).toEqual([]);
  });

  it('pins nothing inside a folded block', () => {
    const range = foldable(state, state.doc.line(6).from, state.doc.line(6).to)!;
    const folded = state.update({ effects: foldEffect.of(range) }).state;
    expect(headsAt(folded, 8)).toEqual([]);
    // The block after it is untouched.
    expect(headsAt(folded, 14)).toEqual(['::lamina']);
  });

  it('stacks nested template elements, outermost first', () => {
    const markup = stateOf(
      [
        '<div class="page">', //  1
        '  <section>', //         2
        '    <p>', //             3
        '      um', //            4
        '    </p>', //            5
        '  </section>', //        6
        '</div>', //              7
      ].join('\n'),
      templateLanguage,
    );
    expect(headsAt(markup, 4)).toEqual(['<div class="page">', '  <section>', '    <p>']);
    expect(headsAt(markup, 5)).toEqual(['<div class="page">', '  <section>', '    <p>']);
    expect(headsAt(markup, 6)).toEqual(['<div class="page">', '  <section>']);
  });

  it('pins nothing in a language that does not fold', () => {
    const settings = stateOf('{\n  "theme": {\n    "mode": "dark"\n  }\n}\n', json());
    expect(headsAt(settings, 3)).toEqual([]);
  });
});

/** A pane over equal lines of 20 px, the chain given per line number. */
const pane = (
  chains: Readonly<Record<number, readonly StickyBlock[]>>,
  overrides: Partial<StickyMeasure> = {},
): StickyMeasure => ({
  top: 0,
  lineHeight: 20,
  paneHeight: 600,
  chainAt: (height) => chains[Math.floor(height / 20) + 1] ?? [],
  endBottom: (block) => block.end * 20,
  caret: null,
  ...overrides,
});

/** A block opened on `line` whose last line is `end` (both 1-based, `end` read as a line). */
const block = (line: number, end: number): StickyBlock => ({ line, from: line * 100, end });

describe('the rows drawn', () => {
  const outer = block(1, 50);
  const inner = block(3, 40);

  it('pins the chain at the top line, from the top of the pane', () => {
    const rows = stickyRows(pane({ 11: [outer] }, { top: 200 }));
    expect(rows).toEqual([{ block: outer, top: 0 }]);
  });

  it('grows with the chain under the rows until it stops', () => {
    // At the top line only the outer block; under its row, the inner one starts.
    const rows = stickyRows(
      pane({ 11: [outer], 12: [outer, inner], 13: [outer, inner] }, { top: 200 }),
    );
    expect(rows.map((row) => [row.block.line, row.top])).toEqual([
      [1, 0],
      [3, 20],
    ]);
  });

  it('caps the stack at five rows and at a third of the pane', () => {
    const deep = Array.from({ length: 8 }, (_, index) => block(index + 1, 90));
    const tall = stickyRows(pane({ 21: deep }, { top: 400 }));
    expect(tall).toHaveLength(STICKY_MAX_ROWS);
    // A 90 px pane holds one 20 px row in its top third.
    const short = stickyRows(pane({ 21: deep }, { top: 400, paneHeight: 90 }));
    expect(short).toHaveLength(1);
  });

  it('pushes a row up as its block ends under it', () => {
    // The block ends on line 11, whose bottom is 220 px; the pane's top is at 210.
    const ending = block(1, 11);
    const rows = stickyRows(pane({ 11: [ending] }, { top: 210 }));
    expect(rows).toEqual([{ block: ending, top: -10 }]);
  });

  it('leaves out the row that would cover the caret, and any under it', () => {
    const rows = stickyRows(
      pane({ 11: [outer, inner] }, { top: 200, caret: { top: 220, bottom: 240 } }),
    );
    expect(rows.map((row) => row.block.line)).toEqual([1]);
  });
});
