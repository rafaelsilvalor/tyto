import { EditorSelection, EditorState } from '@codemirror/state';
import { parser } from '@tyto/brief-lang';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { briefAnalysisField, setBriefAnalysis } from './analysis.js';
import { blockAt, blocksOf, briefBlocks } from './brief-blocks.js';
import { briefLanguage } from './brief-language.js';

const manifestOf = (yaml: string): TemplateManifest => {
  const parsed = parseManifest(yaml, 'manifest.yaml');
  if (!parsed.ok) throw new Error('fixture manifest does not parse');
  return parsed.value;
};

const AGENDA = manifestOf(`
name: agenda
version: 1.0.0
formats: [grid]
slots:
  titulo: { type: rich-text, required: true }
  lamina: { type: rich-text, repeat: true, min: 1, max: 10 }
`);

const BRIEF = [
  '---', //                         1
  'template: agenda', //            2
  '---', //                         3
  '::titulo Agenda da **semana**', // 4
  '::lamina', //                    5
  '  FARMÁCIA', //                  6
  '', //                            7  between two text lines: inside
  '  16/09 - 14:00', //             8
  '', //                            9  after the last text line: outside
  '::lamina', //                    10
  '  {destaque:x}NUTRIÇÃO{/} hoje', // 11
  '   ', //                         12 spaces only: no text, outside
  '// a comment', //                13
  '::ai/caption', //                14
  '  legenda', //                   15
  '::lamina', //                    16
  '  CARDIOLOGIA', //               17
].join('\n');

const blocksIn = (text: string, manifest?: TemplateManifest) =>
  briefBlocks(parser.parse(text), (from, to) => text.slice(from, to), manifest);

const lineOf = (text: string, pos: number): number => text.slice(0, pos).split('\n').length;

describe('briefBlocks', () => {
  it('lists the frontmatter and every top-level directive, in document order', () => {
    const blocks = blocksIn(BRIEF, AGENDA);
    expect(blocks.map((block) => [block.kind, block.name, block.ordinal])).toEqual([
      ['frontmatter', undefined, undefined],
      ['directive', 'titulo', undefined],
      ['directive', 'lamina', 1],
      ['directive', 'lamina', 2],
      ['directive', 'ai/caption', undefined],
      ['directive', 'lamina', 3],
    ]);
  });

  it('numbers nothing while the manifest is not known', () => {
    expect(blocksIn(BRIEF).every((block) => block.ordinal === undefined)).toBe(true);
  });

  it('numbers only a slot the manifest says repeats, never a plugin directive', () => {
    const notRepeating = manifestOf(`
name: agenda
version: 1.0.0
formats: [grid]
slots:
  lamina: { type: rich-text }
`);
    expect(blocksIn(BRIEF, notRepeating).some((block) => block.ordinal !== undefined)).toBe(false);
  });

  it('gives each block its first words, markup dropped, and the frontmatter its first line', () => {
    const blocks = blocksIn(BRIEF, AGENDA);
    expect(blocks.map((block) => block.firstText)).toEqual([
      'template: agenda',
      'Agenda da semana',
      'FARMÁCIA',
      'NUTRIÇÃO hoje',
      'legenda',
      'CARDIOLOGIA',
    ]);
  });

  it('cuts a long first line to sixty characters', () => {
    const text = `::lamina\n  ${'palavra '.repeat(20)}`;
    const [block] = blocksIn(text);
    expect(block?.firstText).toHaveLength(60);
    expect(block?.firstText?.endsWith('…')).toBe(true);
  });

  it('ends a block at its last line with text: a blank line between lines stays inside', () => {
    const blocks = blocksIn(BRIEF, AGENDA);
    const lines = blocks.map((block) => [
      lineOf(BRIEF, block.from),
      lineOf(BRIEF, block.headTo),
      lineOf(BRIEF, block.to),
    ]);
    expect(lines).toEqual([
      [1, 1, 3],
      [4, 4, 4],
      [5, 5, 8],
      [10, 10, 11],
      [14, 14, 15],
      [16, 16, 17],
    ]);
    // The end is the end of that line, before its break.
    expect(BRIEF.slice(blocks[2]?.from, blocks[2]?.to).endsWith('16/09 - 14:00')).toBe(true);
    expect(BRIEF.slice(blocks[3]?.from, blocks[3]?.to).endsWith('hoje')).toBe(true);
  });

  it('keeps the blocks after a line that does not parse yet', () => {
    const broken = BRIEF.replace('::titulo Agenda da **semana**', '::titulo Agenda da **sem');
    const names = blocksIn(broken, AGENDA).map((block) => block.name ?? block.kind);
    expect(names).toContain('ai/caption');
    expect(names.filter((name) => name === 'lamina')).toHaveLength(3);
  });

  it('reads a brief with no frontmatter and one with nothing', () => {
    expect(blocksIn('::lamina\n  a').map((block) => block.kind)).toEqual(['directive']);
    expect(blocksIn('')).toEqual([]);
  });
});

describe('blockAt', () => {
  const blocks = blocksIn(BRIEF, AGENDA);
  const at = (pos: number) => blockAt(blocks, pos);

  it('answers the block from its first character to the end of its last text line', () => {
    const second = blocks[2];
    if (second === undefined) throw new Error('no block');
    expect(at(second.from)).toBe(second);
    expect(at(second.to)).toBe(second);
    expect(at(second.to + 1)).toBeUndefined(); // the blank line after it
  });

  it('answers the frontmatter inside its fences, and nothing on a comment', () => {
    expect(at(0)?.kind).toBe('frontmatter');
    expect(at(BRIEF.indexOf('// a comment') + 2)).toBeUndefined();
  });
});

describe('blocksOf', () => {
  const stateOf = (manifest?: TemplateManifest): EditorState => {
    const state = EditorState.create({
      doc: BRIEF,
      extensions: [briefLanguage, briefAnalysisField],
    });
    return manifest === undefined
      ? state
      : state.update({
          effects: setBriefAnalysis.of({ source: BRIEF, diagnostics: [], templates: [], manifest }),
        }).state;
  };

  it('numbers against the manifest the analysis named', () => {
    expect(blocksOf(stateOf()).map((block) => block.ordinal)).not.toContain(3);
    expect(blocksOf(stateOf(AGENDA)).map((block) => block.ordinal)).toContain(3);
  });

  it('reads a tree once: a caret move hands back the same list', () => {
    const state = stateOf(AGENDA);
    const first = blocksOf(state);
    const moved = state.update({ selection: EditorSelection.cursor(40) }).state;
    expect(blocksOf(moved)).toBe(first);
    const edited = moved.update({ changes: { from: 0, insert: '\n' } }).state;
    expect(blocksOf(edited)).not.toBe(first);
  });
});
