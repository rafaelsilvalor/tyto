import type { BriefAst, Directive, Inline } from '@tyto/core';
import { type SourceRange, isOk, sliceRange } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import adjustmentsFlag from './__fixtures__/adjustments-flag.brief?raw';
import adjustmentsMany from './__fixtures__/adjustments-many.brief?raw';
import adjustmentsPair from './__fixtures__/adjustments-pair.brief?raw';
import blankLines from './__fixtures__/blank-lines.brief?raw';
import brokenAdjacentEmphasis from './__fixtures__/broken-adjacent-emphasis.brief?raw';
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
import nestedEmphasis from './__fixtures__/nested-emphasis.brief?raw';
import noTrailingNewline from './__fixtures__/no-trailing-newline.brief?raw';
import pluginDirective from './__fixtures__/plugin-directive.brief?raw';
import repeatable from './__fixtures__/repeatable.brief?raw';
import { parseBrief } from './parse-brief.js';

/**
 * The same corpus E3.1 parses, read one level up: `parse.test.ts` pins the tree, this
 * pins the meaning. The snapshot is the record of what every fixture compiles to, and the
 * assertions under it are the properties a snapshot cannot state — that every range in
 * every AST still points at the characters it came from, and that the shapes the grammar
 * forced on the tokenizer are gone by the time a caller sees them.
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
  'nested-emphasis.brief': nestedEmphasis,
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
  'broken-adjacent-emphasis.brief': brokenAdjacentEmphasis,
  'broken-unclosed-mark.brief': brokenUnclosedMark,
  'broken-unclosed-adjustment.brief': brokenUnclosedAdjustment,
  'broken-frontmatter.brief': brokenFrontmatter,
  'broken-orphan-indent.brief': brokenOrphanIndent,
  'broken-nameless-directive.brief': brokenNamelessDirective,
};

/** The AST of a fixture that must parse; fails loudly rather than returning undefined. */
function astOf(name: string, text: string): BriefAst {
  const result = parseBrief(text);
  if (!isOk(result)) {
    throw new Error(`${name} should parse: ${result.error.map((item) => item.message).join('; ')}`);
  }
  return result.value;
}

function messagesOf(text: string): string[] {
  const result = parseBrief(text);
  return isOk(result) ? [] : result.error.map((item) => item.message);
}

interface Visited {
  readonly label: string;
  readonly range: SourceRange;
  readonly children: readonly Visited[];
}

function visitInline(inline: Inline): Visited {
  const children = inline.kind === 'text' || inline.kind === 'break' ? [] : inline.children;
  return { label: inline.kind, range: inline.range, children: children.map(visitInline) };
}

function visitDirective(directive: Directive): Visited {
  return {
    label: 'directive',
    range: directive.range,
    children: [
      ...directive.adjustments.map((adjustment) => ({
        label: 'adjustment',
        range: adjustment.range,
        children: [],
      })),
      ...directive.body.map(visitInline),
    ],
  };
}

function visitAst(ast: BriefAst): Visited {
  return { label: 'brief', range: ast.range, children: ast.directives.map(visitDirective) };
}

/** Every node, parents before children, so a check can be written once and run on all. */
function* everyNode(node: Visited): Generator<Visited> {
  yield node;
  for (const child of node.children) yield* everyNode(child);
}

describe('the corpus, one level up from the tree', () => {
  it('turns every valid brief into an AST', () => {
    for (const [name, text] of Object.entries(valid)) {
      expect(parseBrief(text).ok, `${name} should parse`).toBe(true);
    }
  });

  it('turns every broken brief into diagnostics instead of an AST', () => {
    for (const [name, text] of Object.entries(broken)) {
      const result = parseBrief(text);
      expect(result.ok, `${name} should not parse`).toBe(false);
      if (!result.ok) {
        expect(result.error.length, `${name} should say why`).toBeGreaterThan(0);
        for (const item of result.error) expect(item.code).toBe('E_SYNTAX');
      }
    }
  });

  it('matches the recorded AST of every fixture', () => {
    for (const [name, text] of Object.entries(valid)) {
      expect(parseBrief(text), name).toMatchSnapshot(name);
    }
    for (const [name, text] of Object.entries(broken)) {
      expect(parseBrief(text), name).toMatchSnapshot(name);
    }
  });
});

describe('every range maps back to the source', () => {
  it('stays inside the file', () => {
    for (const [name, text] of Object.entries(valid)) {
      for (const node of everyNode(visitAst(astOf(name, text)))) {
        expect(node.range.start, `${name} ${node.label}`).toBeGreaterThanOrEqual(0);
        expect(node.range.end, `${name} ${node.label}`).toBeLessThanOrEqual(text.length);
        expect(node.range.end, `${name} ${node.label}`).toBeGreaterThanOrEqual(node.range.start);
      }
    }
  });

  it('nests the way the nodes nest, and never runs backwards between siblings', () => {
    for (const [name, text] of Object.entries(valid)) {
      for (const node of everyNode(visitAst(astOf(name, text)))) {
        let previousEnd = node.range.start;
        for (const child of node.children) {
          expect(
            child.range.start,
            `${name} ${node.label} > ${child.label}`,
          ).toBeGreaterThanOrEqual(previousEnd);
          expect(child.range.end, `${name} ${node.label} > ${child.label}`).toBeLessThanOrEqual(
            node.range.end,
          );
          previousEnd = child.range.end;
        }
      }
    }
  });

  it('puts the markup it names at both ends of the span', () => {
    // A range that is merely well formed still tells the editor nothing. These say the
    // span is the construct: a bold node's range starts and ends on its own stars.
    for (const [name, text] of Object.entries(valid)) {
      for (const node of everyNode(visitAst(astOf(name, text)))) {
        const source = sliceRange(text, node.range);
        const where = `${name} ${node.label} '${source}'`;
        switch (node.label) {
          case 'directive':
            expect(source, where).toMatch(/^::/u);
            expect(source, where).not.toMatch(/\n$/u);
            break;
          case 'bold':
            expect(source, where).toMatch(/^\*\*[\s\S]*\*\*$/u);
            break;
          case 'italic':
            expect(source, where).toMatch(/^\*[\s\S]*\*$/u);
            break;
          case 'mark':
            expect(source, where).toMatch(/^\{[\s\S]*\{\/\}$/u);
            break;
          case 'break':
            expect(source, where).toMatch(/^[\\\n]$/u);
            break;
          default:
            break;
        }
      }
    }
  });
});

describe('the shapes the grammar forced, undone', () => {
  it('drops the slash the Namespace token has to carry', () => {
    const [directive] = astOf('plugin-directive.brief', pluginDirective).directives;
    expect(directive?.namespace).toBe('ai');
    expect(directive?.name).toBe('caption');
  });

  it('leaves namespace absent on a directive that has none', () => {
    const [directive] = astOf('minimal.brief', minimal).directives;
    expect(directive).not.toHaveProperty('namespace');
  });

  it('drops the space between the directive name and its inline body', () => {
    const [directive] = astOf('minimal.brief', minimal).directives;
    expect(directive?.body).toEqual([
      { kind: 'text', value: 'Direito Constitucional', range: { start: 9, end: 31 } },
    ]);
  });

  it('merges the Space nodes that only exist because Text may not start with one', () => {
    // `Turma {cor:laranja}nova{/} agora` — the tree splits the tail into Space and Text.
    const [directive] = astOf('mark.brief', mark).directives;
    expect(directive?.body.map((inline) => inline.kind)).toEqual(['text', 'mark', 'text']);
    expect(directive?.body[2]).toEqual({
      kind: 'text',
      value: ' agora',
      range: { start: 35, end: 41 },
    });
  });

  it('ends a directive before the line break that ends it', () => {
    const [directive] = astOf('minimal.brief', minimal).directives;
    expect(directive?.range).toEqual({ start: 0, end: 31 });
    expect(minimal).toHaveLength(32);
  });

  it('ranges the name apart from the directive, so a body does not widen it', () => {
    // `::slide` over three indented lines: the name is seven characters into a span of
    // sixty-odd, and a squiggle for a misspelled name has to be the seven.
    const [directive] = astOf('indented-block.brief', indentedBlock).directives;
    expect(directive?.nameRange).toEqual({ start: 2, end: 7 });
    expect(indentedBlock.slice(2, 7)).toBe('slide');
    expect(directive?.range.end).toBeGreaterThan(7);
  });

  it('takes the namespace and its slash into the name range, but never the ::', () => {
    const [directive] = astOf('plugin-directive.brief', pluginDirective).directives;
    expect(directive?.nameRange).toEqual({ start: 2, end: 12 });
    expect(pluginDirective.slice(2, 12)).toBe('ai/caption');
  });

  it('ranges the name on a directive that has no body at all', () => {
    const [directive] = astOf('minimal.brief', minimal).directives;
    expect(minimal.slice(directive!.nameRange.start, directive!.nameRange.end)).toBe('titulo');
  });
});

describe('what a directive says', () => {
  it('reads a flag adjustment as a name with no value', () => {
    const [directive] = astOf('adjustments-flag.brief', adjustmentsFlag).directives;
    expect(directive?.adjustments).toEqual([{ name: 'destaque', range: { start: 9, end: 17 } }]);
    expect(directive?.adjustments[0]).not.toHaveProperty('value');
  });

  it('reads a keyed adjustment alongside a flag one', () => {
    const [directive] = astOf('adjustments-many.brief', adjustmentsMany).directives;
    expect(directive?.adjustments).toEqual([
      { name: 'destaque', range: { start: 9, end: 17 } },
      { name: 'cor', value: 'laranja', range: { start: 19, end: 31 } },
    ]);
  });

  it('reads a mark as a key, a value and the text it wraps', () => {
    const [directive] = astOf('mark.brief', mark).directives;
    expect(directive?.body[1]).toEqual({
      kind: 'mark',
      key: 'cor',
      value: 'laranja',
      children: [{ kind: 'text', value: 'nova', range: { start: 28, end: 32 } }],
      range: { start: 15, end: 35 },
    });
  });

  it('nests emphasis in both directions', () => {
    const [, subtitle] = astOf('nested-emphasis.brief', nestedEmphasis).directives;
    const [italic] = subtitle?.body ?? [];
    expect(italic?.kind).toBe('italic');
    expect(italic?.kind === 'italic' ? italic.children.map((child) => child.kind) : []).toEqual([
      'text',
      'bold',
      'text',
    ]);
  });

  it('reads a trailing backslash as a break', () => {
    const [directive] = astOf('line-break.brief', lineBreak).directives;
    expect(directive?.body.at(-1)).toEqual({ kind: 'break', range: { start: 26, end: 27 } });
  });

  it('decodes an escaped marker to the text it stands for', () => {
    const [directive] = astOf('escaped-directive.brief', escapedDirective).directives;
    // Three source characters, two in the value; the range still covers all three, which
    // is the one place a text node's length and its range's length differ.
    expect(directive?.body).toEqual([
      { kind: 'text', value: ':: isto e texto, nao diretiva', range: { start: 15, end: 45 } },
    ]);
  });

  it('separates the lines of a block body with a break', () => {
    const [directive] = astOf('indented-block.brief', indentedBlock).directives;
    expect(directive?.body).toEqual([
      { kind: 'text', value: 'Primeira linha do bloco', range: { start: 10, end: 33 } },
      { kind: 'break', range: { start: 33, end: 34 } },
      { kind: 'text', value: 'Segunda linha do bloco', range: { start: 36, end: 58 } },
      { kind: 'break', range: { start: 58, end: 59 } },
      { kind: 'text', value: 'Terceira', range: { start: 61, end: 69 } },
    ]);
  });

  it('does not open a block body with a break', () => {
    // The boundary before the first line separates the body from the directive name, not
    // one line of text from the next.
    const [directive] = astOf('repeatable.brief', repeatable).directives;
    expect(directive?.body[0]?.kind).toBe('text');
  });

  it('gives every repeat of a directive its own entry', () => {
    const ast = astOf('repeatable.brief', repeatable);
    expect(ast.directives.map((directive) => directive.name)).toEqual(['slide', 'slide', 'slide']);
  });

  it('drops comments and blank lines, which say nothing about the artwork', () => {
    expect(astOf('comments.brief', comments).directives.map((item) => item.name)).toEqual([
      'titulo',
    ]);
    expect(astOf('blank-lines.brief', blankLines).directives.map((item) => item.name)).toEqual([
      'titulo',
      'subtitulo',
      'rodape',
    ]);
  });
});

describe('the frontmatter', () => {
  it('parses the YAML the grammar deliberately left alone', () => {
    expect(astOf('frontmatter.brief', frontmatter).frontmatter.data).toEqual({
      template: 'promo-curso',
      formats: ['feed', 'story'],
      cor: 'azul-escuro',
    });
  });

  it('is an empty object on a brief that has none', () => {
    expect(astOf('minimal.brief', minimal).frontmatter.data).toEqual({});
  });

  it('is an empty object between two fences with nothing in them', () => {
    const result = parseBrief('---\n---\n::titulo Um\n');
    expect(isOk(result) && result.value.frontmatter.data).toEqual({});
  });

  it('reports invalid YAML at the offset inside the block', () => {
    const text = '---\ntemplate: [feed\n---\n::titulo Um\n';
    const result = parseBrief(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.message).toMatch(/frontmatter is not valid YAML/u);
      const range = result.error[0]?.range;
      expect(range?.start).toBeGreaterThanOrEqual(4);
      expect(range?.end).toBeLessThanOrEqual(text.length);
    }
  });

  it('refuses a block that is valid YAML but not a mapping', () => {
    expect(messagesOf('---\n- feed\n- story\n---\n')).toEqual([
      'Syntax error: the frontmatter must be a mapping of keys to values.',
    ]);
  });

  it('does not validate the keys, which is resolve’s job', () => {
    // No `template`, and `formats` is a number. Both are E3.3 diagnostics, not syntax.
    expect(astOf('loose', '---\nformats: 7\n---\n').frontmatter.data).toEqual({ formats: 7 });
  });
});

describe('what a syntax error says', () => {
  it('names the closer a bold run never got', () => {
    expect(messagesOf(brokenUnclosedBold)).toEqual([
      'Syntax error: a bold run is missing its closing **.',
    ]);
  });

  it('names the closer a mark never got', () => {
    expect(messagesOf(brokenUnclosedMark)).toEqual([
      'Syntax error: a mark is missing its closing {/}.',
    ]);
  });

  it('names the brace an adjustment list never got', () => {
    expect(messagesOf(brokenUnclosedAdjustment)).toEqual([
      'Syntax error: an adjustment list is missing its closing }.',
    ]);
  });

  it('collapses the four error nodes two touching closers leave into one', () => {
    // `**Constitucional *aplicado***` leaves both runs open, and recovery closes each of
    // them at the end of the line. One mistake, one diagnostic.
    expect(messagesOf(brokenAdjacentEmphasis)).toEqual([
      'Syntax error: an italic run is missing its closing *.',
    ]);
    expect(parseBrief(brokenAdjacentEmphasis).ok).toBe(false);
  });

  it('blames the indent of a line that belongs to no directive', () => {
    const result = parseBrief(brokenOrphanIndent);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.message).toBe(
        'Syntax error: an indented line must follow a directive.',
      );
      expect(result.error[0]?.range).toEqual({ start: 0, end: 2 });
    }
  });

  it('quotes what it did not expect when there is something to quote', () => {
    // No closing fence, so `---` and the YAML under it are lines the language cannot place.
    expect(messagesOf(brokenFrontmatter)[0]).toBe("Syntax error: unexpected '---'.");
  });

  it('reports every problem in one pass, in source order', () => {
    const result = parseBrief(brokenFrontmatter);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(1);
      const starts = result.error.map((item) => item.range?.start ?? -1);
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    }
  });

  it('falls back to the enclosing construct when the gap has no text', () => {
    expect(messagesOf(brokenNamelessDirective)).toEqual([
      'Syntax error: this directive is incomplete.',
    ]);
  });
});

describe('the edges', () => {
  it('reads an empty file as a brief with nothing in it', () => {
    expect(parseBrief('')).toEqual({
      ok: true,
      value: {
        frontmatter: { data: {}, ranges: {} },
        directives: [],
        range: { start: 0, end: 0 },
      },
      warnings: [],
    });
  });

  it('reads a directive with no body as an empty body', () => {
    const [directive] = astOf('bare', '::titulo\n').directives;
    expect(directive?.body).toEqual([]);
    expect(directive?.range).toEqual({ start: 0, end: 8 });
  });

  it('closes the last directive of a file with no trailing break', () => {
    const [directive] = astOf('no-trailing-newline.brief', noTrailingNewline).directives;
    expect(directive?.range).toEqual({ start: 0, end: noTrailingNewline.length });
    expect(directive?.body).toEqual([
      { kind: 'text', value: 'Sem quebra no fim', range: { start: 9, end: 26 } },
    ]);
  });

  it('joins an inline body to the indented block under it with a break', () => {
    const [directive] = astOf('both', '::titulo Uma linha\n  e outra\n').directives;
    expect(directive?.body).toEqual([
      { kind: 'text', value: 'Uma linha', range: { start: 9, end: 18 } },
      { kind: 'break', range: { start: 18, end: 19 } },
      { kind: 'text', value: 'e outra', range: { start: 21, end: 28 } },
    ]);
  });
});

describe('the frontmatter carries where each key was written', () => {
  it('gives every top-level key its own range', () => {
    // `resolve` (E3.3) reports an unknown slot against the key that named it; without
    // these the only honest range would be the whole block.
    const ast = astOf('frontmatter.brief', frontmatter);
    expect(ast.frontmatter.ranges.template).toBeDefined();
    const range = ast.frontmatter.ranges.template;
    expect(range && sliceRange(frontmatter, range)).toBe('template');
    expect(Object.keys(ast.frontmatter.ranges)).toEqual(['template', 'formats', 'cor']);
  });

  it('carries the whole block too, for a diagnostic that belongs to no one key', () => {
    const ast = astOf('frontmatter-only.brief', frontmatterOnly);
    expect(ast.frontmatter.range).toEqual({ start: 0, end: 30 });
  });

  it('leaves the block range absent on a brief that has no frontmatter', () => {
    expect(astOf('minimal.brief', minimal).frontmatter).not.toHaveProperty('range');
  });
});
