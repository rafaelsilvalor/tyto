import { parseBrief } from '@tyto/brief-lang';
import { type Diagnostic, type TemplateManifest, err, ok, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import type { DataResolver } from './data.js';
import { parseRecipe } from './parse.js';
import type { Plan } from './plan.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { Table } from './table.js';
import { type BriefFolder, type ToBriefPorts, briefFolder } from './to-brief.js';

const MANIFEST = `name: aula
version: 1.0.0
formats: [feed]
slots:
  titulo: { type: rich-text }
  subtitulo: { type: rich-text }
`;

function manifestOf(source: string): TemplateManifest {
  const parsed = parseManifest(source, 'manifest.yaml');
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return parsed.value;
}

/** A workspace in memory: path → text, its digest the text itself, and every write recorded. */
class FakeWorkspace implements ToBriefPorts {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  where: BriefFolder | undefined = { recipe: 'recipes', restricted: false };

  template(name: string): Promise<TemplateManifest | undefined> {
    return Promise.resolve(name === 'aula' ? manifestOf(MANIFEST) : undefined);
  }
  folder(): BriefFolder | undefined {
    return this.where;
  }
  stat(path: string) {
    const text = this.files.get(path);
    return Promise.resolve(ok(text === undefined ? undefined : `digest:${text}`));
  }
  write(path: string, text: string) {
    this.files.set(path, text);
    this.writes.push(path);
    return Promise.resolve(ok(undefined));
  }
  now(): string {
    return '2026-11-08T12:00:00.000Z';
  }
}

const LESSONS = tasks(
  ['title', 'summary', 'file'],
  [
    ['Direito **Constitucional**', 'Ao vivo', 'Aula 1'],
    ['Português', 'Gravada', 'Aula 2'],
    ['Matemática', 'Ao vivo', 'Aula 3'],
  ],
);

const LINE = 'to-brief template=aula into=../briefs name=file slots=titulo:title,subtitulo:summary';

interface Planned {
  readonly source: string;
  readonly plan: Plan | undefined;
  readonly problems: readonly Diagnostic[];
  readonly at: readonly string[];
}

async function plan(
  line: string,
  ports: ToBriefPorts | undefined,
  input: Table = LESSONS,
  files: Record<string, unknown> = {},
): Promise<Planned & { readonly verbs: ReturnType<typeof createVerbRegistry> }> {
  const source = ['recipe briefs', line].join('\n');
  const recipe = parseRecipe(source);
  if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
  const verbs = createVerbRegistry({ briefs: ports });
  const resolveData: DataResolver = (path) =>
    Promise.resolve(path in files ? ok(files[path]) : err([]));
  const result = await runRecipe(recipe.value, {
    input,
    verbs,
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
    resolveData,
  });
  if (!result.ok) throw new Error('the run must start');
  const problems = result.value.cells.flatMap((cell) => cell.diagnostics);
  return {
    source,
    verbs,
    plan: result.value.cells.at(-1)?.plan,
    problems,
    at: problems.map((problem) =>
      problem.range ? source.slice(problem.range.start, problem.range.end) : '',
    ),
  };
}

async function applied(verbs: ReturnType<typeof createVerbRegistry>, shown: Plan) {
  const answered = await verbs.get('to-brief')?.apply?.(shown);
  if (answered === undefined) throw new Error('to-brief must apply');
  return answered;
}

describe('to-brief', () => {
  it('plans one write per row and writes nothing while it runs', async () => {
    const workspace = new FakeWorkspace();
    const { plan: shown, problems } = await plan(LINE, workspace);
    expect(problems).toEqual([]);
    expect(workspace.writes).toEqual([]);
    expect(shown?.count).toBe(3);
    expect(shown?.target).toBe('briefs in briefs');
    expect(shown?.operations.map((operation) => [operation.rowKey, operation.description])).toEqual(
      [
        ['T-0', 'briefs/Aula-1.brief: new'],
        ['T-1', 'briefs/Aula-2.brief: new'],
        ['T-2', 'briefs/Aula-3.brief: new'],
      ],
    );
  });

  it('writes on Apply briefs that parse back to the row', async () => {
    const workspace = new FakeWorkspace();
    const { plan: shown, verbs } = await plan(LINE, workspace);
    if (shown === undefined) throw new Error('a plan');
    const answer = await applied(verbs, shown);
    expect(answer.ok && answer.value.operations).toEqual([
      { rowKey: 'T-0', status: 'applied', appliedAt: '2026-11-08T12:00:00.000Z' },
      { rowKey: 'T-1', status: 'applied', appliedAt: '2026-11-08T12:00:00.000Z' },
      { rowKey: 'T-2', status: 'applied', appliedAt: '2026-11-08T12:00:00.000Z' },
    ]);
    const first = parseBrief(workspace.files.get('briefs/Aula-1.brief') ?? '');
    expect(first.ok && first.value.frontmatter.data.template).toBe('aula');
    expect(first.ok && first.value.directives.map((directive) => directive.name)).toEqual([
      'titulo',
      'subtitulo',
    ]);
  });

  it('marks a write that overwrites a file', async () => {
    const workspace = new FakeWorkspace();
    workspace.files.set('briefs/Aula-2.brief', 'old');
    const { plan: shown } = await plan(LINE, workspace);
    expect(shown?.operations[1]?.description).toBe('briefs/Aula-2.brief: overwrites');
    expect(shown?.operations[1]?.payload).toMatchObject({ before: 'digest:old' });
  });

  it('fails the write whose file changed since the plan, and still applies the others', async () => {
    const workspace = new FakeWorkspace();
    const { plan: shown, verbs } = await plan(LINE, workspace);
    if (shown === undefined) throw new Error('a plan');
    workspace.files.set('briefs/Aula-2.brief', 'somebody else wrote this');
    const answer = await applied(verbs, shown);
    expect(answer.ok && answer.value.operations.map((operation) => operation.status)).toEqual([
      'applied',
      'failed',
      'applied',
    ]);
    expect(answer.ok && answer.value.operations[1]?.reason).toBe(
      'briefs/Aula-2.brief changed since the plan',
    );
    expect(workspace.files.get('briefs/Aula-2.brief')).toBe('somebody else wrote this');
  });

  it('refuses a plan no to-brief answered', async () => {
    const workspace = new FakeWorkspace();
    const { plan: shown, verbs } = await plan(LINE, workspace);
    if (shown === undefined) throw new Error('a plan');
    const answer = await applied(verbs, { ...shown });
    expect(answer.ok).toBe(false);
    expect(workspace.writes).toEqual([]);
  });

  it('names an unknown slot at the slots argument', async () => {
    const { problems, at } = await plan(
      'to-brief template=aula into=briefs name=file slots=titulo:title,rodape:summary',
      new FakeWorkspace(),
    );
    expect(problems[0]?.code).toBe('E_RECIPE_BRIEF');
    expect(problems[0]?.message).toContain("no slot 'rodape'");
    expect(at[0]).toBe('slots=titulo:title,rodape:summary');
  });

  it('names an unknown template at its argument', async () => {
    const { problems, at } = await plan(
      'to-brief template=nada into=briefs name=file slots=titulo:title',
      new FakeWorkspace(),
    );
    expect(problems[0]?.message).toContain("no template named 'nada'");
    expect(at[0]).toBe('template=nada');
  });

  it('names an unknown column', async () => {
    const { problems } = await plan(
      'to-brief template=aula into=briefs name=file slots=titulo:headline',
      new FakeWorkspace(),
    );
    expect(problems[0]?.code).toBe('E_RECIPE_UNKNOWN_COLUMN');
  });

  it('reads the slots from a data file', async () => {
    const { plan: shown, problems } = await plan(
      'to-brief template=aula into=briefs name=file slots=@./slots.json#/aula',
      new FakeWorkspace(),
      LESSONS,
      { './slots.json': { aula: { titulo: 'title' } } },
    );
    expect(problems).toEqual([]);
    expect(shown?.count).toBe(3);
  });

  it('refuses two rows that would write one file, naming both', async () => {
    const input = tasks(
      ['title', 'file'],
      [
        ['A', 'Aula 1'],
        ['B', 'aula 1'],
      ],
    );
    const { problems, at } = await plan(
      'to-brief template=aula into=briefs name=file slots=titulo:title',
      new FakeWorkspace(),
      input,
    );
    expect(problems.map((problem) => problem.message)).toEqual([
      "'to-brief' would write 'recipes/briefs/aula-1.brief' for both rows 'T-0' and 'T-1'.",
    ]);
    expect(at[0]).toBe('name=file');
  });

  it('refuses a value holding a brace, naming its row and column', async () => {
    const input = tasks(
      ['title', 'file'],
      [
        ['ok', 'a'],
        ['a {b} c', 'b'],
      ],
    );
    const { plan: shown, problems } = await plan(
      'to-brief template=aula into=briefs name=file slots=titulo:title',
      new FakeWorkspace(),
      input,
    );
    expect(shown).toBeUndefined();
    expect(problems.map((problem) => problem.message)).toEqual([
      "'to-brief' row 'T-1', column 'title', holds '{', which brief text cannot hold outside a mark.",
    ]);
  });

  it('refuses a restricted folder, and a recipe in no workspace', async () => {
    const restricted = new FakeWorkspace();
    restricted.where = { recipe: 'recipes', restricted: true };
    const first = await plan(LINE, restricted);
    expect(first.problems[0]?.message).toContain('restricted folder');
    expect(first.at[0]).toBe('into=../briefs');

    const outside = new FakeWorkspace();
    outside.where = undefined;
    expect((await plan(LINE, outside)).problems[0]?.message).toContain('inside a workspace');
  });

  it('refuses an Apply once the folder is restricted', async () => {
    const workspace = new FakeWorkspace();
    const { plan: shown, verbs } = await plan(LINE, workspace);
    if (shown === undefined) throw new Error('a plan');
    workspace.where = { recipe: 'recipes', restricted: true };
    const answer = await applied(verbs, shown);
    expect(answer.ok).toBe(false);
    expect(workspace.writes).toEqual([]);
  });

  it('refuses .tyto and a folder outside the workspace', async () => {
    const { problems } = await plan(
      'to-brief template=aula into=../.TYTO/x name=file slots=titulo:title',
      new FakeWorkspace(),
    );
    expect(problems[0]?.message).toContain("lands in '.tyto'");
    const climbing = await plan(
      'to-brief template=aula into=../../up name=file slots=titulo:title',
      new FakeWorkspace(),
    );
    expect(climbing.problems[0]?.message).toContain('climbs out of the workspace');
  });

  it('says so on a host that writes no briefs', async () => {
    const { problems } = await plan(LINE, undefined);
    expect(problems[0]?.message).toBe("'to-brief' cannot run here: this host writes no briefs.");
  });
});

describe('briefFolder', () => {
  it.each([
    ['recipes', '../briefs', 'briefs'],
    ['', 'out/./briefs', 'out/briefs'],
    ['a/b', '..\\c', 'a/c'],
  ])('reads %s + %s as %s', (recipe, into, expected) => {
    expect(briefFolder(recipe, into)).toEqual(ok(expected));
  });

  it.each([['/abs'], ['C:\\abs'], ['C:abs'], ['../..'], ['.tyto'], ['x/.Tyto/y']])(
    'refuses %s',
    (into) => {
      expect(briefFolder('recipes', into).ok).toBe(false);
    },
  );
});
