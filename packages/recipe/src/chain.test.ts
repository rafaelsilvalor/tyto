import { type SourceRange, err } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import type { Step } from './ast.js';
import { recipeBlocks, recipeSteps } from './blocks.js';
import { chainSegments } from './chain.js';
import openAds from './__fixtures__/open-ads.recipe?raw';
import tasksJson from './__fixtures__/tasks.json';
import { parseRecipe } from './parse.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { Table } from './table.js';

const slice = (text: string, range: SourceRange | undefined) =>
  range === undefined ? undefined : text.slice(range.start, range.end);

const segmentsOf = (line: string): readonly string[] =>
  chainSegments(line).map((segment) => line.slice(segment.from, segment.to));

/** A step with its ranges made relative to the step's start, so two placements compare. */
const shape = (text: string, step: Step) => ({
  verb: step.verb,
  text: step.text,
  positional: step.positional.map((argument) => [argument.value, slice(text, argument.range)]),
  named: step.named.map((argument) => [argument.name, slice(text, argument.range)]),
  range: slice(text, step.range),
  verbRange: slice(text, step.verbRange),
  textRange: slice(text, step.textRange),
});

describe('a | that stands alone chains steps on one line (TYTO-706)', () => {
  it('splits only a | with a blank or the edge on both sides', () => {
    expect(segmentsOf('where a = 1 | sort due | show table')).toEqual([
      'where a = 1',
      'sort due',
      'show table',
    ]);
    expect(segmentsOf('extract title pattern=^(poster|flyer)$')).toEqual([
      'extract title pattern=^(poster|flyer)$',
    ]);
    expect(segmentsOf('where a = 1 |sort due')).toEqual(['where a = 1 |sort due']);
    expect(segmentsOf('where a = 1| sort due')).toEqual(['where a = 1| sort due']);
  });

  it('leaves a | inside double quotes and inside braces', () => {
    expect(segmentsOf('where title matches "copy | web"')).toEqual([
      'where title matches "copy | web"',
    ]);
    expect(segmentsOf('compose "Última Sync"={due|slug}')).toEqual([
      'compose "Última Sync"={due|slug}',
    ]);
    expect(segmentsOf('compose tag={team | upper} | show table')).toEqual([
      'compose tag={team | upper}',
      'show table',
    ]);
    expect(segmentsOf('compose tag="{team | upper}" | show table')).toEqual([
      'compose tag="{team | upper}"',
      'show table',
    ]);
  });

  it('parses a chained line to the steps the same text gives one per line', () => {
    const chained = 'recipe r\n\nwhere status != done | select key, "Última Sync" | sort key\n';
    const lined = 'recipe r\n\nwhere status != done\nselect key, "Última Sync"\nsort key\n';
    const one = parseRecipe(chained);
    const many = parseRecipe(lined);
    expect(one.ok && many.ok).toBe(true);
    if (!one.ok || !many.ok) return;
    expect(one.value.steps.map((step) => shape(chained, step))).toEqual(
      many.value.steps.map((step) => shape(lined, step)),
    );
    expect(one.value.steps.map((step) => slice(chained, step.range))).toEqual([
      'where status != done',
      'select key, "Última Sync"',
      'sort key',
    ]);
  });

  it('keeps a description line, a quoted pattern and a template as they were', () => {
    const text = [
      'recipe r',
      '  | One | two.',
      '',
      'where title matches "copy | web"',
      'compose tag={team|upper}',
      'extract title pattern=^(poster|flyer)$',
    ].join('\n');
    const parsed = parseRecipe(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.description).toBe('One | two.');
    expect(parsed.value.steps.map((step) => step.verb)).toEqual(['where', 'compose', 'extract']);
  });

  it("marks each step's problem at its own segment", () => {
    const text = 'recipe r\n\nwhere a = 1 | select "open | sort key\n';
    const parsed = parseRecipe(text);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.map((found) => slice(text, found.range))).toEqual(['"open | sort key']);
  });

  it('marks a placeholder no param declares in the chained step it is in', () => {
    const text = 'recipe r\n\nwhere a = 1 | where b = {who}\n';
    const parsed = parseRecipe(text);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const found = parsed.error[0];
    expect(found?.code).toBe('E_RECIPE_PARAM');
    expect(found?.range?.start).toBe(text.indexOf('{who}'));
  });

  it('refuses a | with no step after it, at that |', () => {
    for (const line of ['where a = 1 |', 'where a = 1 | | sort key']) {
      const text = `recipe r\n\n${line}\n`;
      const parsed = parseRecipe(text);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.error.map((found) => found.code)).toEqual(['E_RECIPE_SYNTAX']);
      const range = parsed.error[0]?.range;
      expect(slice(text, range)).toBe('|');
      expect(range?.start).toBe(text.indexOf('|', text.indexOf('1')));
    }
  });

  it('refuses a header line or a note after a |, at its first word', () => {
    for (const [line, word] of [
      ['where a = 1 | param who', 'param'],
      ['where a = 1 | every 30m', 'every'],
      ['where a = 1 | # later', '#'],
    ] as const) {
      const text = `recipe r\n\n${line}\n`;
      const parsed = parseRecipe(text);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.error.map((found) => slice(text, found.range))).toEqual([word]);
    }
  });

  it('never splits a header line, a param default included', () => {
    const text = 'recipe r\nparam separator = " | "\nparam other = a | b\n\nwhere a = 1\n';
    const parsed = parseRecipe(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.params.map((param) => param.defaultValue)).toEqual([' | ', 'a | b']);
  });
});

describe('a chained line read as blocks (TYTO-706)', () => {
  const text = [
    'recipe r',
    '',
    'acme.pull | where a = 1',
    'select key | sort key',
    '',
    'show table',
  ].join('\n');

  it("numbers a block's steps by segment, as the parser numbers its cells", () => {
    const parsed = parseRecipe(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.steps).toHaveLength(5);
    const steps = recipeBlocks(text).flatMap((block) =>
      block.steps === undefined ? [] : [block.steps],
    );
    expect(steps).toEqual([
      { first: 0, last: 3, lastFrom: text.indexOf('select') },
      { first: 4, last: 4, lastFrom: text.indexOf('show') },
    ]);
  });

  it("gives each step its own text and its line's start", () => {
    const steps = recipeSteps(text);
    const parsed = parseRecipe(text);
    if (!parsed.ok) throw new Error('the text parses');
    expect(steps.map((step) => text.slice(step.from, step.to))).toEqual(
      parsed.value.steps.map((step) => slice(text, step.range)),
    );
    expect(steps.map((step) => step.line)).toEqual([
      text.indexOf('acme'),
      text.indexOf('acme'),
      text.indexOf('select'),
      text.indexOf('select'),
      text.indexOf('show'),
    ]);
  });
});

describe('a chained line run (TYTO-706)', () => {
  it('runs to the same cells and the same table as its steps one per line', async () => {
    const steps = openAds.split('\n').slice(-7, -1);
    expect(steps[0]).toMatch(/^where kind/u);
    const chained = openAds.replace(steps.join('\n'), steps.join(' | '));
    expect(chained).not.toBe(openAds);
    const ran = async (text: string) => {
      const parsed = parseRecipe(text);
      if (!parsed.ok) throw new Error(parsed.error.map((found) => found.message).join('\n'));
      const result = await runRecipe(parsed.value, {
        input: tasksJson as unknown as Table,
        verbs: createVerbRegistry(),
        derivations: createDerivationRegistry(),
        resolveRecipe: () => Promise.resolve(err([])),
      });
      if (!result.ok) throw new Error('the recipe runs');
      return result.value;
    };
    const one = await ran(chained);
    const many = await ran(openAds);
    expect(one.cells.map((cell) => [cell.step.verb, cell.status])).toEqual(
      many.cells.map((cell) => [cell.step.verb, cell.status]),
    );
    expect(one.cells).toHaveLength(6);
    expect(one.table).toEqual(many.table);
    expect(one.keeps.map((kept) => kept.name)).toEqual(['open-ads']);
  });
});
