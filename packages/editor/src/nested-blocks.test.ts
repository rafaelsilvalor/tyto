import { parser } from '@tyto/brief-lang';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { type BriefBlock, briefBlocks } from './brief-blocks.js';
import { BLOCK_INDENT, breadcrumbAt, directiveLabel } from './breadcrumb.js';

/**
 * Blocks nested by the manifest (TYTO-709, ADR 0207; ADR 0095's consequence): the syntax tree is a
 * flat list of directives, and `briefBlocks` gives each the block it sits inside by the rule
 * `resolve` follows, so the breadcrumb names the chain and "Go to Block" draws the tree.
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

const BRIEF = [
  '::lamina Um',
  '  ::bloco A',
  '    ::paragrafo A1',
  '::titulo T',
  '::lamina Dois',
  '  ::nota N',
  '  ::paragrafo órfão',
  '',
].join('\n');

function blocksIn(text: string, manifest?: TemplateManifest): readonly BriefBlock[] {
  return briefBlocks(parser.parse(text), (from, to) => text.slice(from, to), manifest);
}

describe('briefBlocks on a brief nested by its manifest', () => {
  it('gives each block its depth and the block it belongs to', () => {
    const blocks = blocksIn(BRIEF, ANINHADO);

    expect(blocks.map((block) => [block.name, block.depth, block.parent])).toEqual([
      ['lamina', undefined, undefined],
      ['bloco', 1, 0],
      ['paragrafo', 2, 1],
      ['titulo', undefined, undefined],
      ['lamina', undefined, undefined],
      ['nota', 1, 4],
      // `nota` belongs to the slide and closes nothing open in the slide but itself; there is no
      // `bloco` in this slide, so the paragraph has no parent, as `resolve` refuses it.
      ['paragrafo', 2, undefined],
    ]);
  });

  it('is the flat list it was while no manifest is known', () => {
    expect(blocksIn(BRIEF).map((block) => [block.depth, block.parent])).toEqual(
      Array.from({ length: 7 }, () => [undefined, undefined]),
    );
  });

  it('ends a block at its own last line, before the indented directive under it', () => {
    const [lamina, bloco] = blocksIn(BRIEF, ANINHADO);
    expect(BRIEF.slice(lamina?.from, lamina?.to)).toBe('::lamina Um');
    expect(BRIEF.slice(bloco?.from, bloco?.to)).toBe('::bloco A');
  });
});

describe('the breadcrumb and Go to Block on nested blocks', () => {
  const blocks = blocksIn(BRIEF, ANINHADO);
  const slice = (from: number, to: number): string => BRIEF.slice(from, to);
  const caretIn = (needle: string): number => BRIEF.indexOf(needle) + 2;

  it('names the chain from the slide down to the block the caret is in', () => {
    expect(breadcrumbAt(blocks, caretIn('A1'), slice)).toEqual({
      kind: 'directive',
      label: '::lamina 1 › ::bloco › ::paragrafo',
    });
    expect(breadcrumbAt(blocks, caretIn('::nota'), slice)).toEqual({
      kind: 'directive',
      label: '::lamina 2 › ::nota',
    });
    expect(breadcrumbAt(blocks, caretIn('órfão'), slice)).toEqual({
      kind: 'directive',
      label: '::paragrafo',
    });
  });

  it('indents a nested block’s label in the list once per level', () => {
    expect(blocks.map(directiveLabel)).toEqual([
      '::lamina 1',
      `${BLOCK_INDENT}::bloco`,
      `${BLOCK_INDENT}${BLOCK_INDENT}::paragrafo`,
      '::titulo',
      '::lamina 2',
      `${BLOCK_INDENT}::nota`,
      `${BLOCK_INDENT}${BLOCK_INDENT}::paragrafo`,
    ]);
  });
});
