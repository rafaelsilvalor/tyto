import { describe, expect, it } from 'vitest';

import { besideTheirTemplates, templateAliasDetail } from './template-aliases.js';

interface Row {
  readonly name: string;
  readonly target?: string;
}

const order = (rows: readonly Row[]): string[] =>
  besideTheirTemplates(
    rows,
    (row) => row.name,
    (row) => row.target,
  ).map((row) => row.name);

describe('besideTheirTemplates', () => {
  it('moves each alias right after its template, keeping both orders', () => {
    expect(
      order([
        { name: 'b' },
        { name: 'a' },
        { name: 'x', target: 'a' },
        { name: 'y', target: 'b' },
        { name: 'w', target: 'a' },
      ]),
    ).toEqual(['b', 'y', 'a', 'x', 'w']);
  });

  it('keeps an alias whose template is missing, at the end', () => {
    expect(order([{ name: 'gone', target: 'nowhere' }, { name: 'a' }])).toEqual(['a', 'gone']);
  });
});

describe('templateAliasDetail', () => {
  it('reads template · configuration', () => {
    expect(templateAliasDetail({ template: 'aviso', configuration: 'laranja' })).toBe(
      'aviso · laranja',
    );
  });
});
