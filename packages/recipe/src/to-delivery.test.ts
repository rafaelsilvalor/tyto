import { type Diagnostic, err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import type { DataResolver } from './data.js';
import { parseRecipe } from './parse.js';
import type { Plan } from './plan.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { Table } from './table.js';
import type { DeliveryLayout, DeliveryPlace, ToDeliveryPorts } from './to-delivery.js';

/** A workspace in memory: path → text, its digest the text itself, every write recorded. */
class FakeWorkspace implements ToDeliveryPorts {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly writes: string[] = [];
  where: DeliveryPlace | undefined = { restricted: false };
  parent = 'entregas';

  folder(): DeliveryPlace | undefined {
    return this.where;
  }
  layout() {
    const layout: DeliveryLayout = { parent: this.parent, folders: ['assets', 'editaveis'] };
    return Promise.resolve(ok(layout));
  }
  read(path: string) {
    return Promise.resolve(ok(this.files.get(path)));
  }
  stat(path: string) {
    const text = this.files.get(path);
    return Promise.resolve(ok(text === undefined ? undefined : `digest:${text}`));
  }
  make(path: string) {
    this.folders.add(path);
    return Promise.resolve(ok(undefined));
  }
  write(path: string, text: string) {
    this.files.set(path, text);
    this.writes.push(path);
    return Promise.resolve(ok(undefined));
  }
  now(): string {
    return '2026-11-17T12:00:00.000Z';
  }
}

const TASKS = tasks(
  ['folder', 'due', 'formats', 'link'],
  [
    ['mca-1_aula', '2026-11-20', 'feed:3,story:1', 'https://tracker.example/1'],
    ['mca-2_simulado', '2026-11-21', 'feed:1', 'https://tracker.example/2'],
    ['mca-3_banner', '2026-11-22', '', 'https://tracker.example/3'],
  ],
);

const LINE = 'to-delivery name=folder fields=key:key,due:due,formats:formats,link:link';

interface Planned {
  readonly plan: Plan | undefined;
  readonly note: string | undefined;
  readonly problems: readonly Diagnostic[];
  readonly verbs: ReturnType<typeof createVerbRegistry>;
}

async function plan(
  line: string,
  ports: ToDeliveryPorts | undefined,
  input: Table = TASKS,
  files: Record<string, unknown> = {},
): Promise<Planned> {
  const recipe = parseRecipe(['recipe deliveries', line].join('\n'));
  if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
  const verbs = createVerbRegistry({ deliveries: ports });
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
  const last = result.value.cells.at(-1);
  return {
    verbs,
    plan: last?.plan,
    note: last?.note,
    problems: result.value.cells.flatMap((cell) => cell.diagnostics),
  };
}

async function apply(verbs: ReturnType<typeof createVerbRegistry>, shown: Plan | undefined) {
  if (shown === undefined) throw new Error('a plan');
  const answered = await verbs.get('to-delivery')?.apply?.(shown);
  if (answered === undefined) throw new Error('to-delivery must apply');
  return answered;
}

function descriptions(shown: Plan | undefined) {
  return shown?.operations.map((operation) => [operation.rowKey, operation.description]);
}

const RECORD = 'entregas/mca-1_aula/editaveis/delivery.json';

describe('to-delivery', () => {
  it('plans one record per row under delivery.parent and writes nothing while it runs', async () => {
    const workspace = new FakeWorkspace();
    const { plan: shown, problems } = await plan(LINE, workspace);
    expect(problems).toEqual([]);
    expect(workspace.writes).toEqual([]);
    expect(shown?.target).toBe('deliveries in entregas');
    expect(descriptions(shown)).toEqual([
      ['T-0', 'entregas/mca-1_aula: new'],
      ['T-1', 'entregas/mca-2_simulado: new'],
      ['T-2', 'entregas/mca-3_banner: new'],
    ]);
  });

  it('writes on Apply the three records with their folders, and a second run plans none', async () => {
    const workspace = new FakeWorkspace();
    const first = await plan(LINE, workspace);
    const answer = await apply(first.verbs, first.plan);
    expect(answer.ok && answer.value.operations.map((operation) => operation.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    expect(workspace.writes).toEqual([
      RECORD,
      'entregas/mca-2_simulado/editaveis/delivery.json',
      'entregas/mca-3_banner/editaveis/delivery.json',
    ]);
    expect([...workspace.folders].slice(0, 3)).toEqual([
      'entregas/mca-1_aula',
      'entregas/mca-1_aula/assets',
      'entregas/mca-1_aula/editaveis',
    ]);
    expect(JSON.parse(workspace.files.get(RECORD) ?? '')).toEqual({
      version: 1,
      key: 'T-0',
      link: 'https://tracker.example/1',
      formats: [
        { format: 'feed', count: 3 },
        { format: 'story', count: 1 },
      ],
      due: '2026-11-20',
      written: {
        key: 'T-0',
        link: 'https://tracker.example/1',
        formats: [
          { format: 'feed', count: 3 },
          { format: 'story', count: 1 },
        ],
        due: '2026-11-20',
      },
    });

    const second = await plan(LINE, workspace);
    expect(second.problems).toEqual([]);
    expect(second.plan?.count).toBe(0);
  });

  it('keeps a due date a person edited and carries the new link', async () => {
    const workspace = new FakeWorkspace();
    const first = await plan(LINE, workspace);
    await apply(first.verbs, first.plan);
    const record = JSON.parse(workspace.files.get(RECORD) ?? '') as Record<string, unknown>;
    workspace.files.set(
      RECORD,
      JSON.stringify({ ...record, due: '2026-11-19', state: 'doing' }, null, 2),
    );

    const changed = tasks(
      ['folder', 'due', 'formats', 'link'],
      [['mca-1_aula', '2026-11-25', 'feed:3,story:1', 'https://tracker.example/1b']],
    );
    const later = await plan(LINE, workspace, changed);
    expect(descriptions(later.plan)).toEqual([
      ['T-0', 'entregas/mca-1_aula: updates link; kept: due (edited)'],
    ]);
    await apply(later.verbs, later.plan);
    const merged = JSON.parse(workspace.files.get(RECORD) ?? '') as Record<string, unknown>;
    expect(merged).toMatchObject({
      due: '2026-11-19',
      state: 'doing',
      link: 'https://tracker.example/1b',
    });
  });

  it('refuses a row whose name cannot be a folder, names it, and plans the others', async () => {
    const workspace = new FakeWorkspace();
    const titled = tasks(
      ['folder', 'due', 'formats', 'link'],
      [
        ['MCA-1: Aula', '2026-11-20', '', ''],
        ['mca-2_simulado', '2026-11-21', '', ''],
      ],
    );
    const { plan: shown, note, problems } = await plan(LINE, workspace, titled);
    expect(problems).toEqual([]);
    expect(descriptions(shown)).toEqual([['T-1', 'entregas/mca-2_simulado: new']]);
    expect(note).toMatch(/^Refused 1 of the rows, never rewritten: row 'T-0': /u);
    expect(note).toContain('MCA-1: Aula');
  });

  it('refuses a row whose due date is no date, or whose formats do not read', async () => {
    const workspace = new FakeWorkspace();
    const broken = tasks(
      ['folder', 'due', 'formats', 'link'],
      [
        ['a', 'amanhã', '', ''],
        ['b', '2026-11-21', 'feed:0', ''],
      ],
    );
    const { plan: shown, note } = await plan(LINE, workspace, broken);
    expect(shown?.count).toBe(0);
    expect(note).toContain("row 'T-0': column 'due' gives 'amanhã', which is not an ISO date");
    expect(note).toContain("row 'T-1': column 'formats' reads formats as <format>:<count>");
  });

  it('fails the write of a record that changed since the plan, and writes the others', async () => {
    const workspace = new FakeWorkspace();
    const first = await plan(LINE, workspace);
    workspace.files.set(RECORD, '{"version":1,"key":"T-0"}');
    const answer = await apply(first.verbs, first.plan);
    expect(answer.ok && answer.value.operations[0]).toEqual({
      rowKey: 'T-0',
      status: 'failed',
      reason: `${RECORD} changed since the plan`,
    });
    expect(workspace.writes).toEqual([
      'entregas/mca-2_simulado/editaveis/delivery.json',
      'entregas/mca-3_banner/editaveis/delivery.json',
    ]);
  });

  it('plans nothing in a restricted folder, and refuses an Apply restricted since the plan', async () => {
    const workspace = new FakeWorkspace();
    workspace.where = { restricted: true };
    const refused = await plan(LINE, workspace);
    expect(refused.plan).toBeUndefined();
    expect(refused.problems[0]?.message).toBe(
      "'to-delivery' writes nothing in a restricted folder; trust the folder first.",
    );

    workspace.where = { restricted: false };
    const shown = await plan(LINE, workspace);
    workspace.where = { restricted: true };
    const answer = await apply(shown.verbs, shown.plan);
    expect(answer.ok).toBe(false);
    expect(workspace.writes).toEqual([]);
  });

  it("refuses 'state', a field it does not know, and a mapping without 'key'", async () => {
    const workspace = new FakeWorkspace();
    const state = await plan('to-delivery name=folder fields=key:key,state:due', workspace);
    expect(state.problems[0]?.message).toBe(
      "'to-delivery' never writes 'state', which is the person's.",
    );
    const unknown = await plan('to-delivery name=folder fields=key:key,owner:due', workspace);
    expect(unknown.problems[0]?.message).toBe(
      "'to-delivery' has no field 'owner'; a record has key, link, formats, stem, copy, due, ship.",
    );
    const keyless = await plan('to-delivery name=folder fields=due:due', workspace);
    expect(keyless.problems[0]?.code).toBe('E_RECIPE_ARGUMENTS');
  });

  it('reads the fields from a data file', async () => {
    const workspace = new FakeWorkspace();
    const { plan: shown, problems } = await plan(
      'to-delivery name=folder fields=@./fields.json#/task',
      workspace,
      TASKS,
      { './fields.json': { task: { key: 'key', due: 'due' } } },
    );
    expect(problems).toEqual([]);
    expect(shown?.count).toBe(3);
  });

  it('refuses a record on disk that is not one, and never overwrites it', async () => {
    const workspace = new FakeWorkspace();
    workspace.files.set(RECORD, 'notes by hand');
    const { plan: shown, note } = await plan(LINE, workspace);
    expect(shown?.count).toBe(2);
    expect(note).toContain(`row 'T-0': ${RECORD} is not JSON; fix or remove it first`);
  });

  it('says so on a host that lends no ports', async () => {
    const { problems } = await plan(LINE, undefined);
    expect(problems[0]?.message).toBe(
      "'to-delivery' cannot run here: this host writes no deliveries.",
    );
  });
});
