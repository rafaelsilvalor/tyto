import { type Diagnostic, type Result, diagnostic, err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { DataResolver } from './data.js';
import { parseDataReference, readDataArgument, resolvePointer } from './data.js';
import { parseRecipe } from './parse.js';
import { type Verb, createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { Table } from './table.js';

/** A neutral vocabulary, as a rules file beside a recipe would hold one. */
const VOCABULARY = {
  kinds: [
    { name: 'poster', pattern: '^poster\\b' },
    { name: 'banner', pattern: '^banner\\b' },
  ],
  'a/b': { '~tilde': 'escaped' },
  limits: { columns: 3 },
};

const KINDS = z.array(z.object({ name: z.string(), pattern: z.string() }));

const INPUT: Table = {
  columns: [{ name: 'title', type: 'text', origin: 'test' }],
  rows: [
    {
      key: 'ROW-1',
      values: { title: 'Poster for the fair' },
      provenance: { source: 'test', id: 'ROW-1', fetchedAt: '2026-10-24' },
    },
  ],
};

/** A verb that reads its first argument as data and puts how many entries it found in a view. */
const readsKinds: Verb = {
  kind: 'transform',
  async run(context) {
    const [argument] = context.step.positional;
    if (argument === undefined || context.table === undefined) throw new Error('test verb');
    const kinds = await readDataArgument(context, argument, KINDS);
    if (!kinds.ok) return kinds;
    return ok({ table: context.table, view: kinds.value.map((kind) => kind.name).join(',') });
  },
};

function memoryFiles(files: Record<string, unknown>): { resolve: DataResolver; asked: string[] } {
  const asked: string[] = [];
  const resolve: DataResolver = (path) => {
    asked.push(path);
    return Promise.resolve(path in files ? ok(files[path]) : err([]));
  };
  return { resolve, asked };
}

async function run(line: string, resolveData?: DataResolver) {
  const source = `recipe uses-data\n${line}`;
  const recipe = parseRecipe(source);
  if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
  const verbs = createVerbRegistry();
  verbs.register('test.kinds', readsKinds);
  const result = await runRecipe(recipe.value, {
    input: INPUT,
    verbs,
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
    resolveData,
  });
  if (!result.ok) throw new Error('the run must start');
  const problem = result.value.cells.flatMap((cell) => cell.diagnostics)[0];
  const at = problem?.range ? source.slice(problem.range.start, problem.range.end) : undefined;
  return { view: result.value.view, problem, at };
}

describe('parseDataReference', () => {
  it('splits a path from a pointer and unescapes the pointer', () => {
    expect(parseDataReference('@./vocab.json#/a~1b/~0tilde')).toEqual(
      ok({ path: './vocab.json', pointer: '/a~1b/~0tilde', tokens: ['a/b', '~tilde'] }),
    );
  });

  it('reads a file alone as the whole document', () => {
    expect(parseDataReference('@rules/vocab.json')).toEqual(
      ok({ path: 'rules/vocab.json', pointer: '', tokens: [] }),
    );
  });

  it.each([
    ['vocab.json', 'is not a data reference'],
    ['@#/kinds', 'names no file'],
    ['@/etc/vocab.json', 'relative to the recipe'],
    ['@C:\\work\\vocab.json', 'relative to the recipe'],
    ['@https://example.test/vocab.json', 'relative to the recipe'],
    ['@./vocab.json#kinds', "starts with '/'"],
    ['@./vocab.json#/a~2', "'~' is written '~0'"],
  ])('refuses %s', (text, problem) => {
    const parsed = parseDataReference(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(problem);
  });
});

describe('resolvePointer', () => {
  it('walks objects by key and lists by index', () => {
    expect(resolvePointer(VOCABULARY, ['kinds', '1', 'name'])).toEqual(ok('banner'));
    expect(resolvePointer(VOCABULARY, [])).toEqual(ok(VOCABULARY));
  });

  it.each([
    [['missing'], "finds no key 'missing' at the document"],
    [['kinds', '2'], "a list of 2 at '/kinds', with no item 2"],
    [['kinds', '01'], "'01' is not an index"],
    [['kinds', '-'], "'-' is not an index"],
    [['limits', 'columns', 'x'], "reaches a number at '/limits/columns'"],
    [['__proto__'], "finds no key '__proto__'"],
    [['kinds', 'length'], "'length' is not an index"],
  ])('stops at %j and says where', (tokens, problem) => {
    const reached = resolvePointer(VOCABULARY, tokens);
    expect(reached.ok).toBe(false);
    if (!reached.ok) expect(reached.error).toContain(problem);
  });
});

describe('readDataArgument', () => {
  it('reads the slice the pointer names and hands the verb its parsed shape', async () => {
    const files = memoryFiles({ './vocab.json': VOCABULARY });
    const { view, problem } = await run('test.kinds @./vocab.json#/kinds', files.resolve);
    expect(problem).toBeUndefined();
    expect(view).toBe('poster,banner');
    expect(files.asked).toEqual(['./vocab.json']);
  });

  it('puts a file the host did not find at the argument', async () => {
    const { problem, at } = await run('test.kinds @./other.json#/kinds', memoryFiles({}).resolve);
    expect(problem?.code).toBe('E_RECIPE_DATA');
    expect(problem?.message).toBe("Data '@./other.json#/kinds' names a file that was not found.");
    expect(at).toBe('@./other.json#/kinds');
  });

  it("moves the host's own diagnostic to the argument", async () => {
    const restricted: DataResolver = (path) =>
      Promise.resolve(err([diagnostic('E_RECIPE_DATA_RESTRICTED', { reference: path })]));
    const { problem, at } = await run('test.kinds @./vocab.json#/kinds', restricted);
    expect(problem?.code).toBe('E_RECIPE_DATA_RESTRICTED');
    expect(at).toBe('@./vocab.json#/kinds');
  });

  it('says so when the host gives the recipe no data files', async () => {
    const { problem, at } = await run('test.kinds @./vocab.json#/kinds');
    expect(problem?.message).toContain('gives it no data files');
    expect(at).toBe('@./vocab.json#/kinds');
  });

  it('refuses a pointer that reaches nothing, without asking the schema', async () => {
    const files = memoryFiles({ './vocab.json': VOCABULARY });
    const { problem, at } = await run('test.kinds @./vocab.json#/kind', files.resolve);
    expect(problem?.code).toBe('E_RECIPE_DATA_SHAPE');
    expect(problem?.message).toBe(
      "Data '@./vocab.json#/kind' does not hold what this verb reads: its pointer finds no key " +
        "'kind' at the document.",
    );
    expect(at).toBe('@./vocab.json#/kind');
  });

  it("refuses a slice the verb's schema refuses, naming where in the slice", async () => {
    const files = memoryFiles({ './vocab.json': { kinds: [{ name: 'poster' }] } });
    const { problem } = await run('test.kinds @./vocab.json#/kinds', files.resolve);
    expect(problem?.code).toBe('E_RECIPE_DATA_SHAPE');
    expect(problem?.message).toContain("at '/0/pattern'");
  });

  it('refuses a malformed reference before any host is asked', async () => {
    const files = memoryFiles({ './vocab.json': VOCABULARY });
    const { problem } = await run('test.kinds @../../etc#kinds', files.resolve);
    expect(problem?.code).toBe('E_RECIPE_DATA');
    expect(files.asked).toEqual([]);
  });

  it('points at the whole argument text when a parameter changed its length', async () => {
    const source = 'recipe uses-data\nparam file = vocab\ntest.kinds @./{file}.json#/kinds';
    const recipe = parseRecipe(source);
    if (!recipe.ok) throw new Error('parses');
    const verbs = createVerbRegistry();
    verbs.register('test.kinds', readsKinds);
    const result: Result<unknown, readonly Diagnostic[]> = await runRecipe(recipe.value, {
      input: INPUT,
      verbs,
      derivations: createDerivationRegistry(),
      resolveRecipe: () => Promise.resolve(err([])),
      resolveData: memoryFiles({}).resolve,
    });
    if (!result.ok) throw new Error('starts');
    const recipeRun = result.value as { cells: { diagnostics: Diagnostic[] }[] };
    const range = recipeRun.cells[0]?.diagnostics[0]?.range;
    expect(range && source.slice(range.start, range.end)).toBe('@./{file}.json#/kinds');
  });
});
