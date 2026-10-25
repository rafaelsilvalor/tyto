import { describe, expect, it } from 'vitest';

import { columnOf, runOverShop } from './__fixtures__/rules-harness.js';
import { parseRecipe } from './parse.js';

const CLASSIFY = [
  'rules into=kind,label using=@./vocabulary.json#/kinds',
  'rules into=first using=@./vocabulary.json#/first',
];

/**
 * The private plugin's `name` derivation (TYTO-391) re-expressed as configuration: its folder
 * joins the slugs of the parts that exist with `_`, its file puts the key's slug first, and its
 * display name keeps accents and case, joined with ` - `. The expectations mirror the shape of
 * its unit tests with neutral words.
 */
describe('compose, as the names a row is filed under', () => {
  const NAMES = [
    ...CLASSIFY,
    'compose folder=@./vocabulary.json#/folder skip-empty',
    'compose file_name="{key|slug}_{folder|}" skip-empty',
    'compose display="{first|trim} - {phase|trim} - {deliverable|trim}" skip-empty',
  ];

  it('joins the slugs of the parts and leaves an absent part out rather than writing __', async () => {
    const { table, problem } = await runOverShop(NAMES);
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'folder')).toEqual({
      'RW-1073960': 'poster-grande_lancamento-unico_feira-de-primavera',
      'RW-2': 'site_pagina-de-vendas',
      'RW-3': 'other_no-1-acao',
      'RW-4': 'poster-grande_feira-de-primavera',
    });
  });

  it('puts the key first in the file name and does not repeat a part', async () => {
    const { table } = await runOverShop(NAMES);
    const name = columnOf(table, 'file_name')['RW-1073960'];
    expect(name).toBe('rw-1073960_poster-grande_lancamento-unico_feira-de-primavera');
    expect(String(name).split('lancamento-unico')).toHaveLength(2);
  });

  it('keeps accents and case in the display name', async () => {
    const { table } = await runOverShop(NAMES);
    expect(columnOf(table, 'display')).toMatchObject({
      'RW-1073960': 'Póster Grande - Lançamento Único - Feira de Primavera',
      'RW-2': 'Site - Página de Vendas',
    });
    expect(table?.columns.at(-1)).toEqual({ name: 'display', type: 'text', origin: 'compose' });
  });

  it('leaves the cell empty with required when a part is', async () => {
    const { table } = await runOverShop(['compose code="{format|slug}-{phase|slug}" required']);
    expect(columnOf(table, 'code')).toEqual({
      'RW-1073960': 'poster-grande-lancamento-unico',
      'RW-2': null,
      'RW-3': null,
      'RW-4': null,
    });
  });
});

describe('a template beside the recipe parameters', () => {
  it('fills a declared {name} as the parameter and reads {column|…} as a column', async () => {
    const { table, problem } = await runOverShop([
      'param edition = 7',
      'compose tag="{team|upper}-{edition}"',
    ]);
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'tag')).toMatchObject({ 'RW-2': 'WEB-7' });
  });

  it('refuses an undeclared {name} in a recipe line, where a column is written {name|}', () => {
    const parsed = parseRecipe('recipe shop\ncompose tag="{team}"');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.map(({ code }) => code)).toEqual(['E_RECIPE_PARAM']);
    expect(parseRecipe('recipe shop\ncompose tag="{team|}"').ok).toBe(true);
  });

  it('reads {column} bare in a data file, which no parameter fills', async () => {
    const { table } = await runOverShop(['compose tag=@./t.json#/tag'], {
      './t.json': { tag: '{team}' },
    });
    expect(columnOf(table, 'tag')).toMatchObject({ 'RW-2': 'web' });
  });
});

describe('compose refuses', () => {
  it.each([
    [
      'compose tag="{team|shout}"',
      'E_RECIPE_TEMPLATE',
      "uses the filter 'shout'",
      'tag="{team|shout}"',
    ],
    ['compose tag="{colour|}"', 'E_RECIPE_UNKNOWN_COLUMN', "'colour'", 'tag="{colour|}"'],
    ['compose tag="{team|}" loud', 'E_RECIPE_ARGUMENTS', "not 'loud'", 'loud'],
    ['compose', 'E_RECIPE_ARGUMENTS', 'takes one column and its template', undefined],
    ['compose a="{team|}" b="{team|}"', 'E_RECIPE_ARGUMENTS', 'takes one column', undefined],
  ])('%s', async (line, code, message, at) => {
    const { problem, at: found } = await runOverShop([line]);
    expect(problem?.code).toBe(code);
    expect(problem?.message).toContain(message);
    if (at !== undefined) expect(found).toBe(at);
  });
});

/**
 * The private plugin's `pairing` derivation offers each right-hand row several keys, one per
 * strategy, written `<strategy>:<key>`, and `join` looks under each (ADR 0133). The keys are
 * two `compose ... required` lines, and `collect` makes them one list.
 */
describe('collect, as the keys a row offers a join', () => {
  const KEYS = [
    'compose by_title="title:{deliverable|slug}" required',
    'compose by_format="format:{format|slug}:{deliverable|slug}" required',
  ];

  it('gathers the columns into a list, with a slot for an empty one', async () => {
    const { table } = await runOverShop([...KEYS, 'collect keys from=by_title,by_format']);
    expect(columnOf(table, 'keys')).toMatchObject({
      'RW-1073960': ['title:feira-de-primavera', 'format:poster-grande:feira-de-primavera'],
      'RW-2': ['title:pagina-de-vendas', null],
    });
    expect(table?.columns.at(-1)).toEqual({ name: 'keys', type: 'list', origin: 'collect' });
  });

  it('leaves empty items out with skip-empty, and adds a list cell item by item', async () => {
    const { table } = await runOverShop([
      ...KEYS,
      'collect keys from=by_title,by_format skip-empty',
      'collect all from=keys,team skip-empty',
    ]);
    expect(columnOf(table, 'keys')).toMatchObject({ 'RW-2': ['title:pagina-de-vendas'] });
    expect(columnOf(table, 'all')).toMatchObject({ 'RW-2': ['title:pagina-de-vendas', 'web'] });
  });

  it('is the right side a join pairs on', async () => {
    const { table, problem } = await runOverShop([
      ...KEYS,
      'collect keys from=by_title,by_format skip-empty',
      'join copy left="team = design" right="team = copy" on=keys bring=key',
    ]);
    expect(problem).toBeUndefined();
    expect(columnOf(table, 'copy_key')).toMatchObject({ 'RW-1073960': 'RW-4', 'RW-3': null });
  });

  it.each([
    ['collect keys', 'takes one column to write and from='],
    ['collect keys from=colour', "No column named 'colour'"],
    ['collect keys from=team loud', "not 'loud'"],
    ['collect keys from=team to=x', "does not take 'to='"],
  ])('refuses %s', async (line, message) => {
    const { problem } = await runOverShop([line]);
    expect(problem?.message).toContain(message);
  });
});
