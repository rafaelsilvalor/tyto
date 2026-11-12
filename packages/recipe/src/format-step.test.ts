import { err } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import tasksJson from './__fixtures__/tasks.json';
import { formatStep, valuesOfStep } from './format-step.js';
import { type FieldKind, GENERIC_VERB_FORMS, type VerbForm, formOfArguments } from './forms.js';
import { parseRecipe } from './parse.js';
import { GENERIC_VERBS, createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { Table } from './table.js';

/** A value of each kind, several of them needing quotes. */
const SAMPLES: Readonly<Record<FieldKind, string>> = {
  column: 'status',
  columns: 'key,status',
  words: 'kind team',
  name: 'open-tasks',
  recipe: 'campaign-map',
  choice: '',
  expression: 'status = done AND team = print',
  pattern: '^(?<code>[A-Z]+) - (?<rest>.+)$',
  template: '{course|slug} {phase|upper}',
  formats: 'dd-MM HH:mm,dd-MM',
  number: '3',
  date: '2026-10-24',
  boolean: 'true',
  text: 'Weekly review',
  list: 'drive.example.com,docs.example.com',
  data: '@./company.vocab.json#/rules/kinds',
  pairs: 'team=design note="two words"',
  flag: 'true',
};

const INLINE_JSON = '[{"when": "", "set": {"kind": "other label"}}]';

function everyField(form: VerbForm, inline: boolean): Record<string, string> {
  return Object.fromEntries(
    form.fields.map((field) => [
      field.name,
      field.kind === 'choice'
        ? (field.values?.[0] ?? '')
        : inline && field.inline === true
          ? INLINE_JSON
          : SAMPLES[field.kind],
    ]),
  );
}

function stepOf(line: string) {
  const parsed = parseRecipe(`recipe probe\n${line}`);
  if (!parsed.ok) throw new Error(parsed.error.map((problem) => problem.message).join('\n'));
  const step = parsed.value.steps[0];
  if (step === undefined) throw new Error(`'${line}' is not a step`);
  return step;
}

const names = (values: readonly string[]) => [...values].sort();

describe('GENERIC_VERB_FORMS', () => {
  it('has one form for every bare verb the registry holds, and no other', () => {
    const registered = createVerbRegistry()
      .names()
      .filter((name) => !name.includes('.'));
    expect(names(Object.keys(GENERIC_VERB_FORMS))).toEqual(names(registered));
  });

  it('covers every generic verb but the two header words the parser reads', () => {
    const cells = GENERIC_VERBS.filter((verb) => verb !== 'param' && verb !== 'apply');
    expect(names(Object.keys(GENERIC_VERB_FORMS))).toEqual(names(cells));
  });

  it.each(Object.values(GENERIC_VERB_FORMS))(
    '$verb has the kind the registry runs it as',
    (form) => {
      expect(form.kind).toBe(createVerbRegistry().get(form.verb)?.kind);
    },
  );
});

describe('formatStep', () => {
  it.each(Object.values(GENERIC_VERB_FORMS))(
    '$verb writes every field into a line that parses and reads back',
    (form) => {
      for (const inline of [false, true]) {
        const values = everyField(form, inline);
        const line = formatStep(form.verb, values);
        if (!line.ok) throw new Error(line.error.map((problem) => problem.message).join('\n'));
        const step = stepOf(line.value);
        expect(step.verb).toBe(form.verb);
        const back = valuesOfStep(form.verb, step);
        expect(back.ok && back.value).toEqual(
          Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '')),
        );
      }
    },
  );

  it.each(Object.values(GENERIC_VERB_FORMS))('$verb reproduces its own example', (form) => {
    const values = valuesOfStep(form.verb, stepOf(form.example));
    if (!values.ok) throw new Error(values.error.map((problem) => problem.message).join('\n'));
    expect(formatStep(form.verb, values.value)).toEqual({
      ok: true,
      value: form.example,
      diagnostics: [],
    });
  });

  it('quotes a value with a blank, and leaves a word bare', () => {
    const line = formatStep('nearest', {
      prefix: 'copy',
      within: 'parent',
      among: 'team = copy',
      by: 'words(title)',
      stopwords: 'a,the',
      bring: 'key',
    });
    expect(line.ok && line.value).toBe(
      'nearest copy within=parent among="team = copy" by=words(title) stopwords=a,the bring=key',
    );
  });

  it('writes inline JSON last, so its words are never read as arguments', () => {
    const line = formatStep('rules', { using: INLINE_JSON, into: 'kind' });
    expect(line.ok && line.value).toBe(`rules into=kind using=${INLINE_JSON}`);
  });

  it('writes a {param} placeholder as typed, whether or not a recipe declares it', () => {
    const line = formatStep('where', { expression: 'project = {project}' });
    expect(line.ok && line.value).toBe('where project = {project}');
  });

  it('quotes a bare value that would read as name=value', () => {
    const line = formatStep('keep', { name: 'a=b' });
    expect(line.ok && line.value).toBe('keep "a=b"');
  });

  it('writes a flag only when it is true', () => {
    expect(formatStep('collect', { column: 'keys', from: 'a,b', 'skip-empty': 'false' })).toEqual({
      ok: true,
      value: 'collect keys from=a,b',
      diagnostics: [],
    });
  });

  it.each([
    ['a verb without a form', 'jira.pull', {}, "'jira.pull' has no form"],
    ['a field the form lacks', 'keep', { name: 'x', colour: 'red' }, "has no field 'colour'"],
    ['a required field left blank', 'join', { prefix: 'task' }, 'needs left, right, on'],
    ['a choice outside its values', 'sort', { column: 'due', direction: 'up' }, 'may be asc, desc'],
    ['a line break', 'where', { expression: 'a = 1\nb = 2' }, 'line break'],
    [
      'a quote in a quoted value',
      'stamp',
      { column: 'at', when: 'x = "a b"', format: 'dd' },
      'double quote',
    ],
    [
      'a column that is no name',
      'compose',
      { column: 'say "hi"', template: 'x' },
      'not a column name',
    ],
  ])('refuses %s', (_case, verb, values, message) => {
    const line = formatStep(verb, values);
    expect(line.ok).toBe(false);
    if (line.ok) return;
    expect(line.error[0]?.message).toContain(message);
    expect(line.error[0]?.range).toBeDefined();
  });
});

describe('valuesOfStep', () => {
  it('reads a flag, a quoted value and a collecting field', () => {
    expect(valuesOfStep('select', stepOf('select key, title status'))).toEqual({
      ok: true,
      value: { columns: 'key, title status' },
      diagnostics: [],
    });
    expect(
      valuesOfStep('map', stepOf('map status reverse into=target using=@./v.json#/m')),
    ).toEqual({
      ok: true,
      value: { column: 'status', reverse: 'true', into: 'target', using: '@./v.json#/m' },
      diagnostics: [],
    });
  });

  it('refuses an argument the form does not take, at its range', () => {
    const step = stepOf('sort due desc extra');
    const values = valuesOfStep('sort', step);
    expect(values.ok).toBe(false);
    if (values.ok) return;
    expect(values.error[0]?.code).toBe('E_RECIPE_FORM');
    expect(values.error[0]?.range).toEqual(step.positional[2]?.range);
  });

  it('refuses a step of another verb', () => {
    expect(valuesOfStep('sort', stepOf('where a = 1')).ok).toBe(false);
  });
});

describe('formOfArguments', () => {
  it("writes a contributed verb's line from its declared arguments", () => {
    const form = formOfArguments('demo.pull', 'source', [
      { name: 'project', type: 'text', positional: true, required: true },
      { name: 'since', type: 'date' },
      { name: 'state', type: 'text', values: ['open', 'closed'] },
    ]);
    expect(form.fields.map((field) => [field.name, field.kind, field.placement])).toEqual([
      ['project', 'text', 'positional'],
      ['since', 'date', 'named'],
      ['state', 'choice', 'named'],
    ]);
    const line = formatStep(form, { project: 'Weekly review', since: '2026-10-24', state: 'open' });
    expect(line.ok && line.value).toBe('demo.pull "Weekly review" since=2026-10-24 state=open');
  });
});

describe('each form against its verb', () => {
  const input = tasksJson as unknown as Table;

  it.each(Object.values(GENERIC_VERB_FORMS))(
    "$verb's example passes the verb's own argument check",
    async (form) => {
      const parsed = parseRecipe(`recipe probe\n${form.example}`);
      if (!parsed.ok) throw new Error(parsed.error.map((problem) => problem.message).join('\n'));
      const run = await runRecipe(parsed.value, {
        input,
        verbs: createVerbRegistry(),
        derivations: createDerivationRegistry(),
        resolveRecipe: () => Promise.resolve(err([])),
      });
      // A missing column, data file or store is the probe's; a refused argument is the form's.
      const refused = (run.ok ? run.value.cells : []).flatMap((cell) =>
        cell.diagnostics.filter((problem) => problem.code === 'E_RECIPE_ARGUMENTS'),
      );
      expect(run.ok).toBe(true);
      expect(refused).toEqual([]);
    },
  );
});
