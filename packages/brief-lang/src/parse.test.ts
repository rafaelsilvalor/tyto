import { describe, expect, it } from 'vitest';

import adjustmentsFlag from './__fixtures__/adjustments-flag.brief?raw';
import adjustmentsMany from './__fixtures__/adjustments-many.brief?raw';
import adjustmentsPair from './__fixtures__/adjustments-pair.brief?raw';
import blankLines from './__fixtures__/blank-lines.brief?raw';
import brokenFrontmatter from './__fixtures__/broken-frontmatter.brief?raw';
import brokenNamelessDirective from './__fixtures__/broken-nameless-directive.brief?raw';
import brokenOrphanIndent from './__fixtures__/broken-orphan-indent.brief?raw';
import brokenUnclosedAdjustment from './__fixtures__/broken-unclosed-adjustment.brief?raw';
import brokenUnclosedBold from './__fixtures__/broken-unclosed-bold.brief?raw';
import brokenUnclosedMark from './__fixtures__/broken-unclosed-mark.brief?raw';
import comments from './__fixtures__/comments.brief?raw';
import escapedDirective from './__fixtures__/escaped-directive.brief?raw';
import frontmatter from './__fixtures__/frontmatter.brief?raw';
import frontmatterOnly from './__fixtures__/frontmatter-only.brief?raw';
import full from './__fixtures__/full.brief?raw';
import indentedBlock from './__fixtures__/indented-block.brief?raw';
import inlineBoldItalic from './__fixtures__/inline-bold-italic.brief?raw';
import lineBreak from './__fixtures__/line-break.brief?raw';
import mark from './__fixtures__/mark.brief?raw';
import minimal from './__fixtures__/minimal.brief?raw';
import noTrailingNewline from './__fixtures__/no-trailing-newline.brief?raw';
import pluginDirective from './__fixtures__/plugin-directive.brief?raw';
import repeatable from './__fixtures__/repeatable.brief?raw';
import { parser } from './brief.parser.js';

/**
 * The corpus is the acceptance criterion: every valid brief parses without an error node,
 * every broken one produces an error node over the part that is actually broken. Ranges
 * are asserted rather than counted, because a range that is merely present is what the
 * editor draws a squiggle under, and a squiggle in the wrong place is its own bug.
 *
 * Fixtures are imported as text with `?raw`. Reading them with `node:fs` would be the
 * first Node import in a pure package (ADR 0010), and the lint boundary would stop it.
 */

const valid = {
  'minimal.brief': minimal,
  'frontmatter.brief': frontmatter,
  'frontmatter-only.brief': frontmatterOnly,
  'comments.brief': comments,
  'adjustments-flag.brief': adjustmentsFlag,
  'adjustments-pair.brief': adjustmentsPair,
  'adjustments-many.brief': adjustmentsMany,
  'repeatable.brief': repeatable,
  'inline-bold-italic.brief': inlineBoldItalic,
  'mark.brief': mark,
  'line-break.brief': lineBreak,
  'escaped-directive.brief': escapedDirective,
  'plugin-directive.brief': pluginDirective,
  'indented-block.brief': indentedBlock,
  'blank-lines.brief': blankLines,
  'no-trailing-newline.brief': noTrailingNewline,
  'full.brief': full,
};

const broken = {
  'broken-unclosed-bold.brief': brokenUnclosedBold,
  'broken-unclosed-mark.brief': brokenUnclosedMark,
  'broken-unclosed-adjustment.brief': brokenUnclosedAdjustment,
  'broken-frontmatter.brief': brokenFrontmatter,
  'broken-orphan-indent.brief': brokenOrphanIndent,
  'broken-nameless-directive.brief': brokenNamelessDirective,
};

interface ErrorRange {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** Every error node Lezer left in the tree, with what it covers. */
function errorRanges(text: string): ErrorRange[] {
  const found: ErrorRange[] = [];
  parser.parse(text).iterate({
    enter: (node) => {
      if (node.type.isError) {
        found.push({ from: node.from, to: node.to, text: text.slice(node.from, node.to) });
      }
    },
  });
  return found;
}

/** Node names in document order, which is enough to pin a shape without pinning offsets. */
function shape(text: string): string[] {
  const names: string[] = [];
  parser.parse(text).iterate({
    enter: (node) => {
      names.push(node.name);
    },
  });
  return names;
}

function nodesNamed(text: string, name: string): string[] {
  const found: string[] = [];
  parser.parse(text).iterate({
    enter: (node) => {
      if (node.name === name) found.push(text.slice(node.from, node.to));
    },
  });
  return found;
}

describe('the corpus', () => {
  it('has the twenty fixtures the card asks for', () => {
    expect(Object.keys(valid).length + Object.keys(broken).length).toBeGreaterThanOrEqual(20);
  });

  it('parses every valid brief with no error node anywhere', () => {
    for (const [name, text] of Object.entries(valid)) {
      expect(errorRanges(text), `${name} should parse cleanly`).toEqual([]);
    }
  });

  it('leaves an error node in every broken brief', () => {
    for (const [name, text] of Object.entries(broken)) {
      expect(errorRanges(text).length, `${name} should not parse cleanly`).toBeGreaterThan(0);
    }
  });

  it('keeps parsing past the damage, which is what the editor needs', () => {
    // Highlighting must survive a half-typed brief: the directive after the broken one is
    // still a Directive, not a casualty of the recovery.
    expect(shape(brokenUnclosedAdjustment)).toContain('Directive');
    expect(nodesNamed(brokenUnclosedAdjustment, 'Name')).toEqual(['slide']);
    expect(nodesNamed(brokenUnclosedAdjustment, 'BlockText')).toEqual(['Como estudar']);
  });
});

describe('where the error lands', () => {
  // Lezer recovers from a missing closing token by inserting it, so the error node is
  // empty and sits where the token should have been. That is the position an editor wants
  // for "expected `**` here"; E8.1 can widen it to the line for display.
  it('marks the end of an unclosed bold run, where the closing stars should be', () => {
    expect(errorRanges(brokenUnclosedBold)).toEqual([{ from: 33, to: 33, text: '' }]);
  });

  it('marks the end of a mark that never closed', () => {
    expect(errorRanges(brokenUnclosedMark)).toEqual([{ from: 38, to: 38, text: '' }]);
  });

  it('marks the end of an adjustment list whose brace never closed', () => {
    expect(errorRanges(brokenUnclosedAdjustment)).toEqual([{ from: 17, to: 17, text: '' }]);
  });

  it('blames the opening fence when the frontmatter never closes', () => {
    // With no partner fence there is no frontmatter, so the `---` and the YAML under it
    // are lines the language has no rule for. Every one of them is reported: the whole
    // block is what the author has to fix, not one character of it.
    const ranges = errorRanges(brokenFrontmatter);
    expect(ranges[0]).toEqual({ from: 0, to: 3, text: '---' });
    expect(ranges.length).toBeGreaterThan(1);
  });

  it('blames the indent of a line that belongs to no directive', () => {
    expect(errorRanges(brokenOrphanIndent)[0]).toEqual({ from: 0, to: 2, text: '  ' });
  });

  it('blames the gap where a directive name should be', () => {
    // `:: sem nome` — the marker is fine, what follows it is not, so the error starts
    // after the marker rather than on it.
    expect(errorRanges(brokenNamelessDirective)).toEqual([{ from: 2, to: 3, text: ' ' }]);
  });
});

describe('the shapes the language promises', () => {
  it('takes the frontmatter whole and leaves its YAML alone', () => {
    expect(nodesNamed(frontmatter, 'Frontmatter')).toEqual([
      '---\ntemplate: promo-curso\nformats: [feed, story]\ncor: azul-escuro\n---\n',
    ]);
  });

  it('reads a namespaced directive as a namespace and a name', () => {
    expect(nodesNamed(pluginDirective, 'Namespace')).toEqual(['ai/']);
    expect(nodesNamed(pluginDirective, 'Name')).toEqual(['caption']);
  });

  it('separates a flag adjustment from a keyed one', () => {
    expect(nodesNamed(adjustmentsMany, 'AdjustmentName')).toEqual(['destaque', 'cor']);
    expect(nodesNamed(adjustmentsMany, 'AdjustmentValue')).toEqual(['laranja']);
  });

  it('gives every repeat of a directive its own node', () => {
    expect(nodesNamed(repeatable, 'Name')).toEqual(['slide', 'slide', 'slide']);
  });

  it('reads each indented line of a block as its own body line', () => {
    expect(nodesNamed(indentedBlock, 'BlockText')).toEqual([
      'Primeira linha do bloco',
      'Segunda linha do bloco',
      'Terceira',
    ]);
  });

  it('reads bold and italic without letting either swallow the other', () => {
    expect(nodesNamed(inlineBoldItalic, 'Bold')).toEqual(['**Constitucional**']);
    expect(nodesNamed(inlineBoldItalic, 'Italic')).toEqual(['*Administrativo*']);
  });

  it('reads a mark with its key, its value and the text it wraps', () => {
    expect(nodesNamed(mark, 'MarkName')).toEqual(['cor']);
    expect(nodesNamed(mark, 'MarkValue')).toEqual(['laranja']);
    expect(nodesNamed(mark, 'Mark')).toEqual(['{cor:laranja}nova{/}']);
  });

  it('reads a trailing backslash as a break', () => {
    expect(nodesNamed(lineBreak, 'Break')).toEqual(['\\']);
  });

  it('reads an escaped marker as text, not as a directive', () => {
    expect(nodesNamed(escapedDirective, 'EscapedDirective')).toEqual(['\\::']);
    expect(nodesNamed(escapedDirective, 'Name')).toEqual(['observacao']);
  });

  it('takes a comment line whole and does not treat it as a directive', () => {
    expect(nodesNamed(comments, 'Comment')).toEqual([
      '// escolha do template abaixo',
      '// nota final',
    ]);
  });

  it('ends a directive at a blank line rather than absorbing it', () => {
    expect(nodesNamed(blankLines, 'Name')).toEqual(['titulo', 'subtitulo', 'rodape']);
  });

  it('closes the last directive of a file that has no trailing break', () => {
    // The leading space is inside the body rather than separating it: after the name both
    // readings start with the same token, and only `{` tells them apart. `parseBrief`
    // trims it, and the ranges stay exact either way.
    expect(nodesNamed(noTrailingNewline, 'InlineBody')).toEqual([' Sem quebra no fim']);
  });
});
