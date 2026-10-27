import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import { PARENT_RULES } from './__fixtures__/parents.js';
import { column, runWithState } from './__fixtures__/state-harness.js';
import type { CellValue } from './table.js';

/**
 * A parent's decision as a recipe: three counts over the children, the ordered rules table in
 * `__fixtures__/parents.ts` over them, and a `where` that drops the parents already moved on.
 */
const FILES = { './parents.json': { decision: PARENT_RULES } };

const ROLLUPS = [
  'rollup open_artwork parent=parent when="kind = artwork AND ready = no"',
  'rollup posting parent=parent when="kind = posting"',
  'rollup open_animation parent=parent when="kind = animation AND ready = no"',
];
const DECIDE_PARENTS = [
  ...ROLLUPS,
  'where posting is not empty',
  'rules into=decision using=@./parents.json#/decision',
  'where status not in (to-post, concluded)',
];

const PHRASE =
  'Designer: when you finish, move the artwork task and the card as a whole to "Concluded"';

type Child = readonly [kind: string, ready: 'yes' | 'no'];

/** A parent `T-0` in status doing, with `description`, and its children after it. */
function family(children: readonly Child[], description = '') {
  return tasks(
    ['kind', 'ready', 'parent', 'status', 'description'],
    [
      ['parent', null, null, 'doing', description],
      ...children.map(([kind, ready]) => [kind, ready, 'T-0', 'doing', null]),
    ],
  );
}

async function decisionOf(children: readonly Child[], description = ''): Promise<CellValue> {
  const ran = await runWithState(
    DECIDE_PARENTS,
    family(children, description),
    undefined,
    {},
    {
      files: FILES,
    },
  );
  expect(ran.errors).toEqual([]);
  expect(column(ran.table, 'key')).toEqual(['T-0']);
  return column(ran.table, 'decision')[0] ?? null;
}

/** Buraqueira's `tests/test_pai.py`, the decidir_pai cases, in the neutral kinds. */
describe('a parent decided by rollups and rules, ported from decidir_pai', () => {
  it('posting_child_posts: a posting child sends the parent to post', async () => {
    expect(
      await decisionOf([
        ['artwork', 'yes'],
        ['posting', 'no'],
        ['ads', 'no'],
      ]),
    ).toBe('post');
  });

  it('open_animation_holds: an open animation holds a parent that would post', async () => {
    expect(
      await decisionOf([
        ['artwork', 'yes'],
        ['posting', 'no'],
        ['animation', 'no'],
      ]),
    ).toBe('wait-animation');
  });

  it('ready_animation_releases: a ready animation lets it post', async () => {
    expect(
      await decisionOf([
        ['artwork', 'yes'],
        ['posting', 'yes'],
        ['animation', 'yes'],
      ]),
    ).toBe('post');
  });

  it('other_open_artwork_waits: another open artwork holds the parent', async () => {
    expect(
      await decisionOf([
        ['artwork', 'yes'],
        ['artwork', 'no'],
        ['posting', 'yes'],
      ]),
    ).toBe('wait-artwork');
  });

  it('no_posting_with_phrase_concludes: the phrase concludes a parent with no posting', async () => {
    expect(await decisionOf([['artwork', 'yes']], PHRASE)).toBe('conclude');
  });

  it('no_posting_no_phrase_nothing: ads and video are no posting', async () => {
    expect(
      await decisionOf(
        [
          ['artwork', 'yes'],
          ['ads', 'yes'],
          ['video', 'yes'],
        ],
        'Hello everyone',
      ),
    ).toBe('none');
  });

  it('posting_beats_phrase: a posting child wins over the phrase', async () => {
    expect(
      await decisionOf(
        [
          ['artwork', 'yes'],
          ['posting', 'yes'],
        ],
        PHRASE,
      ),
    ).toBe('post');
  });

  it('phrase_ignores_case: the phrase is found whatever its case and accents', async () => {
    expect(await decisionOf([['artwork', 'yes']], 'move the CARD AS A WHOLE')).toBe('conclude');
    expect(await decisionOf([['artwork', 'yes']], 'move the cárd as a whole')).toBe('conclude');
  });
});

describe('rollup', () => {
  const TREE = tasks(
    ['kind', 'ready', 'parent', 'status', 'description'],
    [
      ['parent', null, null, 'doing', ''],
      ['artwork', 'no', 'T-0', 'doing', null],
      ['posting', 'yes', ' T-0 ', 'doing', null],
      ['parent', null, null, 'to-post', ''],
      ['artwork', 'yes', 'T-3', 'done', null],
      ['artwork', 'no', 'X-9', 'doing', null],
      ['artwork', 'no', 'X-8', 'doing', null],
    ],
  );

  it('counts the children when keeps on each parent, and leaves every other row empty', async () => {
    const ran = await runWithState(ROLLUPS, TREE, undefined);
    expect(ran.errors).toEqual([]);
    expect(column(ran.table, 'open_artwork')).toEqual([1, null, null, 0, null, null, null]);
    expect(column(ran.table, 'posting')).toEqual([1, null, null, 0, null, null, null]);
    expect(ran.table?.columns.at(-1)).toEqual({
      name: 'open_animation',
      type: 'number',
      origin: 'rollup open_animation',
    });
  });

  it('counts every child without when=', async () => {
    const ran = await runWithState(['rollup children parent=parent'], TREE, undefined);
    expect(column(ran.table, 'children')).toEqual([2, null, null, 1, null, null, null]);
  });

  it('warns once per step about children whose parent the table lacks', async () => {
    const ran = await runWithState(['rollup children parent=parent'], TREE, undefined);
    const warnings = ran.run.cells.flatMap((cell) => cell.diagnostics);
    expect(warnings.map(({ code, message }) => [code, message])).toEqual([
      [
        'W_RECIPE_ROLLUP_ORPHANS',
        "2 row(s) name a parent in 'parent' that the table lacks: T-5 → X-9, T-6 → X-8.",
      ],
    ]);
  });

  it('drops the parents that already moved, as decidir_pai skipped them', async () => {
    const ran = await runWithState(DECIDE_PARENTS, TREE, undefined, {}, { files: FILES });
    expect(column(ran.table, 'key')).toEqual(['T-0']);
    expect(column(ran.table, 'decision')).toEqual(['wait-artwork']);
  });

  describe('refuses', () => {
    async function refusal(line: string) {
      const { errors, at } = await runWithState([line], TREE, undefined);
      return [errors[0]?.code, at];
    }

    it.each([
      ['no parent=', 'rollup open parent', 'E_RECIPE_ARGUMENTS', 'open parent'],
      ['a second column', 'rollup open more parent=parent', 'E_RECIPE_ARGUMENTS', 'more'],
      ['a name that cannot be a column', 'rollup 1st parent=parent', 'E_RECIPE_ARGUMENTS', '1st'],
      [
        'an argument given twice',
        'rollup a parent=parent parent=kind',
        'E_RECIPE_ARGUMENTS',
        'parent=kind',
      ],
      [
        'an argument it does not take',
        'rollup a parent=parent by=key',
        'E_RECIPE_ARGUMENTS',
        'by=key',
      ],
      [
        'writing over the parent column',
        'rollup Parent parent=parent',
        'E_RECIPE_ARGUMENTS',
        'Parent',
      ],
      [
        'a parent column the table lacks',
        'rollup a parent=mother',
        'E_RECIPE_UNKNOWN_COLUMN',
        'parent=mother',
      ],
      [
        'a when= column the table lacks',
        'rollup a parent=parent when="team = x"',
        'E_RECIPE_UNKNOWN_COLUMN',
        'team',
      ],
      [
        'a when= it cannot read',
        'rollup a parent=parent when="kind = x OR ready = no"',
        'E_RECIPE_WHERE',
        'OR',
      ],
    ])('%s', async (_case, line, code, at) => {
      expect(await refusal(line)).toEqual([code, at]);
    });
  });
});
