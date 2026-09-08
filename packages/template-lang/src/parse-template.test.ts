import { lineColumnAt, sourceRange } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import doc from './__fixtures__/doc-example.html?raw';
import { parseAttributeValue, parseTemplate } from './parse-template.js';

/**
 * The grammar and the tree-to-AST pass, without a manifest in sight.
 *
 * The fixture is a copy of the example `docs/template-authoring.md` prints, so the doc's own
 * template is proven to parse rather than assumed to. What is asserted is the shape the AST
 * promises — the tags, the attributes without their quotes,
 * the value tokens with the slash still in them — and the ranges, because a diagnostic
 * without a place to point at is a diagnostic nobody acts on.
 */

function parsedOrThrow(source: string) {
  const result = parseTemplate(source);
  if (!result.ok) throw new Error(result.error.map((item) => item.message).join('; '));
  return result.value;
}

describe('the example in docs/template-authoring.md', () => {
  it('parses, with the frames at the top level and one stylesheet under them', () => {
    const document = parsedOrThrow(doc);

    expect(document.elements.map((element) => element.tag)).toEqual(['frame', 'frame']);
    expect(document.styles.length).toBeGreaterThan(0);
  });

  it('reads attributes without their quotes and keeps the tree nested', () => {
    const [feed] = parsedOrThrow(doc).elements;

    expect(feed?.attributes.map((item) => [item.name, item.value])).toEqual([
      ['format', 'feed'],
      ['bg', 'none'],
    ]);
    expect(feed?.children.map((child) => child.tag)).toEqual(['image', 'rect', 'group', 'vector']);
    const group = feed?.children[2];
    expect(group?.children.map((child) => child.tag)).toEqual(['text', 'text']);
  });

  it('keeps the slash inside a font value, because it is what separates size from leading', () => {
    const title = parsedOrThrow(doc)
      .styles.flatMap((item) => (item.kind === 'rule' ? item.rule.declarations : []))
      .find((declaration) => declaration.property === 'font');

    expect(title?.value.map((token) => token.kind)).toEqual([
      'dimension',
      'dimension',
      'slash',
      'dimension',
      'string',
    ]);
  });

  it('reads the three at-rules with their preludes', () => {
    const rules = parsedOrThrow(doc).styles.flatMap((item) =>
      item.kind === 'at' ? [item.at] : [],
    );

    expect(rules.map((rule) => rule.keyword)).toEqual(['format', 'if', 'each']);
    expect(
      rules[1]?.prelude.map((token) => (token.kind === 'call' ? token.name : token.kind)),
    ).toEqual(['slot', 'ident', 'ident']);
  });

  it('gives every node a range that slices back to what was written', () => {
    const [feed] = parsedOrThrow(doc).elements;
    const format = feed?.attributes[0];

    expect(doc.slice(format?.nameRange.start ?? 0, format?.nameRange.end ?? 0)).toBe('format');
    expect(doc.slice(format?.valueRange.start ?? 0, format?.valueRange.end ?? 0)).toBe('feed');
  });
});

describe('markup that does not parse', () => {
  it('reports an unclosed tag where the tag is', () => {
    const source = '<frame format="feed"\n<text slot="a" />\n</frame>';
    const result = parseTemplate(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.code).toBe('E_SYNTAX');
    expect(result.error[0]?.range).toBeDefined();
  });

  it('reports text content, which the language has no node for', () => {
    const result = parseTemplate('<frame format="feed">Turma nova</frame>');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.message).toContain("unexpected text 'Turma nova'");
  });

  it('names the line and column of the problem, not only an offset', () => {
    const source = '<frame format="feed">\n  <text slot="a" >>\n</frame>';
    const result = parseTemplate(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(lineColumnAt(source, result.error[0]?.range?.start ?? 0).line).toBe(2);
  });

  it('reports a stylesheet that never closes', () => {
    const result = parseTemplate('<style>.a { w: 1 }');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.message).toContain('</style>');
  });
});

describe('an attribute read as a value', () => {
  it('reads it with the same tokenizer the stylesheet uses', () => {
    const tokens = parseAttributeValue('var(--bg)', sourceRange(10, 19));

    expect(tokens?.[0]?.kind).toBe('call');
    expect(tokens?.[0]?.kind === 'call' ? tokens[0].args[0] : undefined).toMatchObject({
      kind: 'ident',
      text: '--bg',
    });
  });

  it('shifts every range back inside the quotes it came from', () => {
    const tokens = parseAttributeValue('#ff5900', sourceRange(10, 17));

    expect(tokens?.[0]?.range).toEqual({ start: 10, end: 17 });
  });

  it('returns nothing for an attribute that is not a value at all', () => {
    expect(parseAttributeValue('} not a value {', sourceRange(0, 15))).toBeUndefined();
  });
});
