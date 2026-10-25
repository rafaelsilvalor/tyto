import { ok, sourceRange } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { SHOP } from './__fixtures__/rules-harness.js';
import type { Row } from './table.js';
import { type FillMode, bindTemplate, parseTemplate } from './template.js';

function fill(text: string, values: Row['values'], mode: FillMode = {}): string | null {
  const template = parseTemplate(text);
  if (!template.ok) throw new Error(template.error);
  const row: Row = { key: 'R', values, provenance: { source: 't', id: 'R', fetchedAt: '' } };
  const table = { columns: SHOP.columns, rows: [row] };
  const bound = bindTemplate(template.value, table, new Map(), sourceRange(0, 0), mode);
  if (!bound.ok) throw new Error(bound.error.map(({ message }) => message).join('\n'));
  return bound.value.fill(row);
}

describe('parseTemplate', () => {
  it('reads literals, placeholders and their filters in order', () => {
    expect(parseTemplate('{key|}-{title|trim|slug}.png')).toEqual(
      ok({
        text: '{key|}-{title|trim|slug}.png',
        parts: [
          { kind: 'column', column: 'key', filters: [] },
          { kind: 'text', text: '-' },
          { kind: 'column', column: 'title', filters: ['trim', 'slug'] },
          { kind: 'text', text: '.png' },
        ],
      }),
    );
  });

  it.each([
    ['{title|shout}', "uses the filter 'shout', which does not exist"],
    ['{title', 'never closes it'],
    ['title}', "has a '}' at character 6"],
    ['{ti tle}', "has the placeholder '{ti tle}'"],
    ['{}', "has the placeholder '{}'"],
  ])('refuses %s', (text, problem) => {
    const parsed = parseTemplate(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(problem);
  });
});

describe('the filters', () => {
  it.each([
    ['Póster Grande', 'poster-grande'],
    ['  Nº 1 — Ação!  ', 'no-1-acao'],
    ['---Already-a-slug---', 'already-a-slug'],
    ['Café_Ñandú 2026', 'cafe-nandu-2026'],
    ['!!!', ''],
  ])('slug turns %j into %j', (text, expected) => {
    expect(fill('{title|slug}', { title: text }) ?? '').toBe(expected);
  });

  it('trims, upper-cases and lower-cases, left to right', () => {
    expect(fill('[{title|trim|upper}]', { title: '  Ação ' })).toBe('[AÇÃO]');
    expect(fill('{title|lower}', { title: 'ÁRVORE' })).toBe('árvore');
  });

  it('reads a list cell as the text a person would write', () => {
    expect(fill('{title|}', { title: ['a', 'b'] })).toBe('a, b');
  });
});

describe('filling', () => {
  const parts = { format: 'Poster', phase: null, deliverable: 'Fair' };

  it('writes an empty placeholder as nothing in place by default', () => {
    expect(fill('{format}_{phase}_{deliverable}', parts)).toBe('Poster__Fair');
  });

  it('drops an empty placeholder and the separator written before it with skip-empty', () => {
    const skip = { skipEmpty: true };
    expect(fill('{format}_{phase}_{deliverable}', parts, skip)).toBe('Poster_Fair');
    expect(fill('{format}, {phase} and {deliverable}', parts, skip)).toBe('Poster and Fair');
    expect(fill('{format}, {deliverable} and {phase}', parts, skip)).toBe('Poster, Fair');
    expect(fill('{phase}/{format}', parts, skip)).toBe('Poster');
    expect(fill('<{phase}|{format}>', parts, skip)).toBe('<Poster>');
    expect(fill('x-{phase}', parts, skip)).toBeNull();
  });

  it('counts a part that a filter empties as empty', () => {
    expect(
      fill('{format|slug}_{title|slug}', { format: 'A', title: '!!!' }, { skipEmpty: true }),
    ).toBe('a');
  });

  it('is empty when any placeholder is, with required, even with skip-empty', () => {
    expect(fill('{format}-{phase}', parts, { required: true })).toBeNull();
    expect(fill('{format}-{phase}', parts, { required: true, skipEmpty: true })).toBeNull();
    expect(fill('{format}-{deliverable}', parts, { required: true })).toBe('Poster-Fair');
  });

  it('holds null rather than an empty string', () => {
    expect(fill('{phase}', parts)).toBeNull();
  });
});
