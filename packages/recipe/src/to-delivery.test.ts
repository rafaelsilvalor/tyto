import { type Diagnostic, err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import type { DataResolver } from './data.js';
import { parseRecipe } from './parse.js';
import type { Plan } from './plan.js';
import { createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import type { Table } from './table.js';
import type {
  DeliveryLayout,
  DeliveryListing,
  DeliveryPlace,
  ToDeliveryPorts,
} from './to-delivery.js';

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
  /** Folders the host may not read, by path, with the reason. */
  readonly unreadable = new Map<string, string>();
  list(parent: string) {
    const prefix = parent === '' ? '' : `${parent}/`;
    const names = new Set<string>();
    for (const path of [...this.folders, ...this.files.keys()]) {
      if (!path.startsWith(prefix)) continue;
      const [name] = path.slice(prefix.length).split('/');
      if (name !== undefined && name !== '') names.add(name);
    }
    const listed: DeliveryListing[] = [...names].sort().map((name) => {
      const path = `${prefix}${name}`;
      const problem = this.unreadable.get(path);
      if (problem !== undefined) return { name, path, problem };
      const record = this.files.get(`${path}/editaveis/delivery.json`);
      return record === undefined ? { name, path } : { name, path, record };
    });
    return Promise.resolve(ok(listed));
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

/** Three folders written by `to-delivery` from `TASKS`, applied. */
async function threeFolders(): Promise<FakeWorkspace> {
  const workspace = new FakeWorkspace();
  const first = await plan(LINE, workspace);
  await apply(first.verbs, first.plan);
  return workspace;
}

/** A recipe of several lines with no input table, as a source starts one. */
async function runLines(lines: readonly string[], ports: ToDeliveryPorts | undefined) {
  const recipe = parseRecipe(['recipe deliveries', ...lines].join('\n'));
  if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
  const verbs = createVerbRegistry({ deliveries: ports });
  const result = await runRecipe(recipe.value, {
    input: undefined,
    verbs,
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
  });
  if (!result.ok) throw new Error('the run must start');
  return { verbs, cells: result.value.cells };
}

describe('deliveries (ADR 0211)', () => {
  it('reads one row per record, keyed by its key, with the folder and its path', async () => {
    const workspace = await threeFolders();
    workspace.folders.add('entregas/rascunho');
    workspace.files.set('entregas/zz_broken/editaveis/delivery.json', '{"version":1}');
    const { cells } = await runLines(['deliveries'], workspace);
    const [cell] = cells;
    expect(cell?.table?.rows.map((row) => row.key)).toEqual(['T-0', 'T-1', 'T-2']);
    expect(cell?.table?.columns.map((column) => column.name)).toEqual([
      'folder',
      'path',
      'key',
      'link',
      'formats',
      'stem',
      'copy',
      'due',
      'ship',
      'state',
    ]);
    expect(cell?.table?.rows[0]?.values).toMatchObject({
      folder: 'mca-1_aula',
      path: 'entregas/mca-1_aula',
      formats: 'feed:3,story:1',
      due: '2026-11-20',
      stem: null,
      state: null,
    });
    expect(cell?.note).toBe('Read 3 deliveries; 1 folder has no record and was skipped.');
    expect(cell?.diagnostics.map((found) => [found.code, found.message])).toEqual([
      [
        'W_RECIPE_DELIVERY_RECORD',
        "'deliveries' left out entregas/zz_broken: its record is not a delivery record (key: Invalid input: expected string, received undefined).",
      ],
    ]);
  });

  it('names a folder the host could not read and a key another folder holds, and reads on', async () => {
    const workspace = await threeFolders();
    workspace.unreadable.set('entregas/mca-2_simulado', 'it leads out of the workspace');
    const copy = workspace.files.get(RECORD) ?? '';
    workspace.files.set('entregas/mca-9_copia/editaveis/delivery.json', copy);
    const { cells } = await runLines(['deliveries'], workspace);
    expect(cells[0]?.table?.rows.map((row) => row.key)).toEqual(['T-0', 'T-2']);
    expect(cells[0]?.diagnostics.map((found) => found.message)).toEqual([
      "'deliveries' left out entregas/mca-2_simulado: it leads out of the workspace.",
      "'deliveries' left out entregas/mca-9_copia: its key 'T-0' is entregas/mca-1_aula's too.",
    ]);
  });

  it('plans nothing when its rows go back through to-delivery, transformed or not', async () => {
    const workspace = await threeFolders();
    const { cells } = await runLines(
      [
        'deliveries',
        'where key != T-9',
        'to-delivery name=folder fields=key:key,due:due,formats:formats,link:link',
      ],
      workspace,
    );
    expect(cells.flatMap((cell) => cell.diagnostics)).toEqual([]);
    expect(cells.at(-1)?.plan?.count).toBe(0);
  });

  it('refuses an argument, a host without ports and a restricted folder', async () => {
    const extra = await runLines(['deliveries into=entregas'], new FakeWorkspace());
    expect(extra.cells[0]?.diagnostics[0]?.code).toBe('E_RECIPE_ARGUMENTS');
    const none = await runLines(['deliveries'], undefined);
    expect(none.cells[0]?.diagnostics[0]?.message).toBe(
      "'deliveries' cannot run here: this host reads no deliveries.",
    );
    const restricted = new FakeWorkspace();
    restricted.where = { restricted: true };
    const refused = await runLines(['deliveries'], restricted);
    expect(refused.cells[0]?.diagnostics[0]?.message).toBe(
      "'deliveries' reads nothing in a restricted folder; trust the folder first.",
    );
  });
});

describe('to-delivery inbound= (ADR 0211)', () => {
  const INBOUND = (winner: string) =>
    `to-delivery name=folder fields=key:key,state:status inbound=state:${winner}`;
  const STATUS = (status: string) => tasks(['folder', 'status'], [['mca-1_aula', status]]);

  /** A record whose state came in as `todo`, then set on disk to `onDisk`. */
  async function synced(winner: string, onDisk: string): Promise<FakeWorkspace> {
    const workspace = new FakeWorkspace();
    const first = await plan(INBOUND(winner), workspace, STATUS('todo'));
    await apply(first.verbs, first.plan);
    const record = JSON.parse(workspace.files.get(RECORD) ?? '') as Record<string, unknown>;
    workspace.files.set(RECORD, JSON.stringify({ ...record, state: onDisk }, null, 2));
    return workspace;
  }

  it('lets a declared status from a fixed table into the record', async () => {
    const workspace = await synced('row', 'todo');
    const later = await plan(INBOUND('row'), workspace, STATUS('doing'));
    expect(later.problems).toEqual([]);
    expect(descriptions(later.plan)).toEqual([['T-0', 'entregas/mca-1_aula: updates state']]);
    await apply(later.verbs, later.plan);
    expect(JSON.parse(workspace.files.get(RECORD) ?? '')).toMatchObject({ state: 'doing' });
    expect((await plan(INBOUND('row'), workspace, STATUS('doing'))).plan?.count).toBe(0);
  });

  it('refuses an undeclared status in the plan', async () => {
    const refused = await plan(
      'to-delivery name=folder fields=key:key,state:status',
      new FakeWorkspace(),
      STATUS('doing'),
    );
    expect(refused.plan).toBeUndefined();
    expect(refused.problems[0]?.message).toBe(
      "'to-delivery' never writes 'state', which is the person's.",
    );
  });

  it('lets the row win a status both changed, and says what it overwrote', async () => {
    const workspace = await synced('row', 'doing');
    const later = await plan(INBOUND('row'), workspace, STATUS('review'));
    expect(descriptions(later.plan)).toEqual([
      ['T-0', "entregas/mca-1_aula: updates state (both changed; row wins over 'doing')"],
    ]);
  });

  it('lets the record win a status both changed, and logs it once', async () => {
    const workspace = await synced('record', 'doing');
    const later = await plan(INBOUND('record'), workspace, STATUS('review'));
    expect(descriptions(later.plan)).toEqual([
      ['T-0', "entregas/mca-1_aula: keeps state (both changed; record wins over 'review')"],
    ]);
    await apply(later.verbs, later.plan);
    expect(JSON.parse(workspace.files.get(RECORD) ?? '')).toMatchObject({ state: 'doing' });
    expect((await plan(INBOUND('record'), workspace, STATUS('review'))).plan?.count).toBe(0);
  });

  it('refuses an inbound field without its winner, or not mapped in fields=', async () => {
    const workspace = new FakeWorkspace();
    const bare = await plan(
      'to-delivery name=folder fields=key:key,state:status inbound=state',
      workspace,
      STATUS('doing'),
    );
    expect(bare.problems[0]?.message).toBe(
      "'to-delivery' gives no winner for the inbound field 'state'; write state:record or state:row.",
    );
    const unmapped = await plan(
      'to-delivery name=folder fields=key:key inbound=due:row',
      workspace,
      STATUS('doing'),
    );
    expect(unmapped.problems[0]?.message).toContain("declares 'due' inbound but does not map it");
  });

  it('reads the inbound fields from a data file', async () => {
    const { plan: shown, problems } = await plan(
      'to-delivery name=folder fields=key:key,state:status inbound=@./fields.json#/inbound',
      new FakeWorkspace(),
      STATUS('doing'),
      { './fields.json': { inbound: { state: 'row' } } },
    );
    expect(problems).toEqual([]);
    expect(shown?.count).toBe(1);
  });
});

describe('to-delivery keep= (ADR 0211 note of 2026-11-17)', () => {
  const KEEP = 'to-delivery name=folder fields=key:key,due:due,copy:copy keep=copy';
  const ROWS = (copy: string, due = '2026-11-20') =>
    tasks(
      ['folder', 'due', 'copy'],
      [
        ['mca-1_aula', due, copy],
        ['mca-2_simulado', '2026-11-21', 'https://docs.example/2'],
      ],
    );

  async function linked(line: string): Promise<FakeWorkspace> {
    const workspace = new FakeWorkspace();
    const first = await plan(line, workspace, ROWS('https://docs.example/1'));
    await apply(first.verbs, first.plan);
    return workspace;
  }

  it('keeps the link of an orphan row, plans no write and warns in the note', async () => {
    const workspace = await linked(KEEP);
    const before = workspace.files.get(RECORD);
    const later = await plan(KEEP, workspace, ROWS(''));
    expect(later.problems).toEqual([]);
    expect(later.plan?.count).toBe(0);
    expect(later.note).toBe("Kept 1 value whose cell came back empty: row 'T-0' copy.");
    expect(workspace.files.get(RECORD)).toBe(before);
    const again = await plan(KEEP, workspace, ROWS(''));
    expect(again.plan?.count).toBe(0);
    expect(again.note).toBe(later.note);
  });

  it('says kept: copy (source empty) on a line written for another field', async () => {
    const workspace = await linked(KEEP);
    const later = await plan(KEEP, workspace, ROWS('', '2026-11-25'));
    expect(descriptions(later.plan)).toEqual([
      ['T-0', 'entregas/mca-1_aula: updates due; kept: copy (source empty)'],
    ]);
    await apply(later.verbs, later.plan);
    expect(JSON.parse(workspace.files.get(RECORD) ?? '')).toMatchObject({
      copy: 'https://docs.example/1',
      due: '2026-11-25',
      written: { copy: 'https://docs.example/1', due: '2026-11-25' },
    });
  });

  it('clears the link as before without keep=', async () => {
    const line = 'to-delivery name=folder fields=key:key,due:due,copy:copy';
    const workspace = await linked(line);
    const later = await plan(line, workspace, ROWS(''));
    expect(later.note).toBeUndefined();
    expect(descriptions(later.plan)).toEqual([['T-0', 'entregas/mca-1_aula: updates copy']]);
  });

  it("refuses 'key', an inbound field, an unknown or unmapped field, at the argument", async () => {
    const workspace = new FakeWorkspace();
    const STATUS = tasks(['folder', 'status', 'copy'], [['mca-1_aula', 'todo', 'x']]);
    const cases: [string, string][] = [
      [
        'to-delivery name=folder fields=key:key keep=key',
        "'to-delivery' never keeps 'key': a row without one is refused.",
      ],
      [
        'to-delivery name=folder fields=key:key,state:status inbound=state:row keep=state',
        "'to-delivery' cannot keep 'state', which is declared inbound; name it in keep= or inbound=, not both.",
      ],
      [
        'to-delivery name=folder fields=key:key keep=colour',
        "'to-delivery' has no field 'colour' to keep; a record has key, link, formats, stem, copy, due, ship, state.",
      ],
    ];
    for (const [line, message] of cases) {
      const refused = await plan(line, workspace, STATUS);
      expect(refused.plan).toBeUndefined();
      expect(refused.problems[0]?.message).toBe(message);
      const source = ['recipe deliveries', line].join('\n');
      const range = refused.problems[0]?.range;
      expect(source.slice(range?.start, range?.end)).toMatch(/^keep=/u);
    }
    const unmapped = await plan('to-delivery name=folder fields=key:key keep=copy', workspace);
    expect(unmapped.problems[0]?.message).toContain("keeps 'copy' but does not map it");
    expect(workspace.writes).toEqual([]);
  });
});
