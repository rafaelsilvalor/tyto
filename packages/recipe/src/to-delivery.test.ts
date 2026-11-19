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
  /** `delivery.exports` and `delivery.sizes` (ADR 0215), when a test sets them. */
  exports: string | undefined;
  sizes: DeliveryLayout['sizes'];
  /** Each delivery's images and editables, by folder path, and the `exports` list was asked. */
  readonly landed = new Map<string, Pick<DeliveryListing, 'images' | 'editables'>>();
  readonly listedExports: (string | undefined)[] = [];

  folder(): DeliveryPlace | undefined {
    return this.where;
  }
  layout() {
    const layout: DeliveryLayout = {
      parent: this.parent,
      folders: ['assets', 'editaveis'],
      ...(this.exports === undefined ? {} : { exports: this.exports }),
      ...(this.sizes === undefined ? {} : { sizes: this.sizes }),
    };
    return Promise.resolve(ok(layout));
  }
  /** Folders the host may not read, by path, with the reason. */
  readonly unreadable = new Map<string, string>();
  list(parent: string, exports?: string) {
    this.listedExports.push(exports);
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
      return record === undefined
        ? { name, path }
        : { name, path, record, ...this.landed.get(path) };
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
  digest(text: string): string {
    return `digest:${text}`;
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

  it("refuses 'state', a name no field may have, and a mapping without 'key'", async () => {
    const workspace = new FakeWorkspace();
    const state = await plan('to-delivery name=folder fields=key:key,state:due', workspace);
    expect(state.problems[0]?.message).toBe(
      "'to-delivery' never writes 'state', which is the person's.",
    );
    const unknown = await plan('to-delivery name=folder fields=key:key,Owner:due', workspace);
    expect(unknown.problems[0]?.message).toBe(
      "'to-delivery' cannot declare a field: 'Owner' is not a field name; a declared field is lowercase letters, digits, _ and -; the fixed fields are key, link, formats, stem, copy, due, ship.",
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
      'check',
      'check_problems',
      'found_formats',
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
        'to-delivery name=folder fields=key:key keep=Colour',
        "'to-delivery' cannot keep a field: 'Colour' is not a field name; a declared field is lowercase letters, digits, _ and -.",
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

describe('to-delivery declared fields (ADR 0213)', () => {
  const ROWS = tasks(
    ['folder', 'due', 'task', 'owner'],
    [
      ['mca-1_aula', '2026-11-20', 'Cover, three slides', 'ana'],
      ['mca-2_simulado', '2026-11-21', '', 'bruno'],
    ],
  );
  const DECLARED = 'to-delivery name=folder fields=key:key,due:due,description:task';

  it('writes a declared field in the fields map, and deliveries reads it back as a column', async () => {
    const workspace = new FakeWorkspace();
    const first = await plan(DECLARED, workspace, ROWS);
    expect(first.problems).toEqual([]);
    await apply(first.verbs, first.plan);
    expect(JSON.parse(workspace.files.get(RECORD) ?? '{}')).toEqual({
      version: 1,
      key: 'T-0',
      due: '2026-11-20',
      fields: { description: 'Cover, three slides' },
      written: { key: 'T-0', due: '2026-11-20', fields: { description: 'Cover, three slides' } },
    });

    const { cells } = await runLines(['deliveries'], workspace);
    const table = cells[0]?.table;
    expect(table?.columns.map((column) => column.name).slice(-3)).toEqual([
      'check_problems',
      'found_formats',
      'description',
    ]);
    expect(table?.rows.map((row) => row.values['description'])).toEqual([
      'Cover, three slides',
      null,
    ]);
    const again = await plan(DECLARED, workspace, ROWS);
    expect(again.plan?.count).toBe(0);
  });

  it('orders declared columns alphabetically, after the fixed ones, across records', async () => {
    const workspace = new FakeWorkspace();
    const first = await plan(
      'to-delivery name=folder fields=key:key,variant:task,assignee:owner',
      workspace,
      ROWS,
    );
    await apply(first.verbs, first.plan);
    const { cells } = await runLines(['deliveries'], workspace);
    expect(cells[0]?.table?.columns.map((column) => column.name).slice(-3)).toEqual([
      'found_formats',
      'assignee',
      'variant',
    ]);
    expect(cells[0]?.table?.rows[1]?.values).toMatchObject({ assignee: 'bruno', variant: null });
  });

  it('keeps a declared field a person edited, and lets keep= and inbound= name one', async () => {
    const workspace = new FakeWorkspace();
    const line =
      'to-delivery name=folder fields=key:key,description:task,assignee:owner inbound=assignee:row keep=description';
    const first = await plan(line, workspace, ROWS);
    expect(first.problems).toEqual([]);
    await apply(first.verbs, first.plan);
    const record = JSON.parse(workspace.files.get(RECORD) ?? '{}') as Record<string, unknown>;
    workspace.files.set(
      RECORD,
      JSON.stringify({ ...record, fields: { description: 'Cover', assignee: 'carla' } }),
    );
    const later = await plan(
      line,
      workspace,
      tasks(
        ['folder', 'task', 'owner'],
        [
          ['mca-1_aula', '', 'dora'],
          ['mca-2_simulado', '', 'bruno'],
        ],
      ),
    );
    expect(descriptions(later.plan)).toEqual([
      [
        'T-0',
        "entregas/mca-1_aula: updates assignee (both changed; row wins over 'carla'); kept: description (source empty)",
      ],
    ]);
  });

  it('refuses a name a delivery row already has, at the argument, for fields=, keep= and inbound=', async () => {
    const workspace = new FakeWorkspace();
    const cases = [
      'to-delivery name=folder fields=key:key,folder:task',
      'to-delivery name=folder fields=key:key,path:task',
      'to-delivery name=folder fields=key:key,my.field:task',
      'to-delivery name=folder fields=key:key,due:due keep=path',
      'to-delivery name=folder fields=key:key,due:due inbound=folder:row',
    ];
    for (const line of cases) {
      const refused = await plan(line, workspace, ROWS);
      expect(refused.plan).toBeUndefined();
      expect(refused.problems[0]?.code).toBe('E_RECIPE_DELIVERY');
      const source = ['recipe deliveries', line].join('\n');
      const range = refused.problems[0]?.range;
      expect(source.slice(range?.start, range?.end)).toMatch(/^(fields|keep|inbound)=/u);
    }
    expect(workspace.writes).toEqual([]);
  });

  it('warns at fields= when a declared name is two edits from a fixed field', async () => {
    const workspace = new FakeWorkspace();
    const line = 'to-delivery name=folder fields=key:key,lnik:task,description:task';
    const near = await plan(line, workspace, ROWS);
    expect(near.plan?.count).toBe(2);
    expect(near.problems.map((found) => [found.code, found.message])).toEqual([
      ['W_RECIPE_DELIVERY_FIELD_NEAR', "'lnik' is declared as a new field; did you mean 'link'?"],
    ]);
    const source = ['recipe deliveries', line].join('\n');
    const range = near.problems[0]?.range;
    expect(source.slice(range?.start, range?.end)).toMatch(/^fields=/u);
  });

  it("reads a hand-made 'fields' that is not a map, warns, and refuses to write over it", async () => {
    const workspace = new FakeWorkspace();
    const first = await plan(DECLARED, workspace, ROWS);
    await apply(first.verbs, first.plan);
    workspace.files.set(
      RECORD,
      JSON.stringify({ version: 1, key: 'T-0', fields: ['by', 'hand'], written: { key: 'T-0' } }),
    );
    const { cells } = await runLines(['deliveries'], workspace);
    expect(cells[0]?.table?.rows.map((row) => row.key)).toEqual(['T-0', 'T-1']);
    expect(cells[0]?.diagnostics.map((found) => found.message)).toEqual([
      "'deliveries' read entregas/mca-1_aula without its declared fields: its 'fields' is not a map of text.",
    ]);
    const write = await plan(DECLARED, workspace, ROWS);
    expect(write.note).toContain(
      "row 'T-0': entregas/mca-1_aula/editaveis/delivery.json holds a 'fields' that is not a map of text",
    );
    const fixedOnly = await plan('to-delivery name=folder fields=key:key,due:due', workspace, ROWS);
    expect(fixedOnly.note).toBeUndefined();
  });
});

describe('to-delivery create= (ADR 0213)', () => {
  it('skips a row whose folder does not exist under create=no, and names it', async () => {
    const workspace = await threeFolders();
    const rows = tasks(
      ['folder', 'due'],
      [
        ['mca-1_aula', '2026-12-01'],
        ['mca-9_nova', '2026-12-02'],
      ],
    );
    const line = 'to-delivery name=folder fields=key:key,due:due create=no';
    const skipped = await plan(line, workspace, rows);
    expect(descriptions(skipped.plan)).toEqual([['T-0', 'entregas/mca-1_aula: updates due']]);
    expect(skipped.note).toBe("Skipped 1 row with no delivery folder: 'T-1'.");
    await apply(skipped.verbs, skipped.plan);
    expect([...workspace.folders].some((folder) => folder.includes('mca-9_nova'))).toBe(false);
    expect(workspace.writes).not.toContain('entregas/mca-9_nova/editaveis/delivery.json');

    const created = await plan(line.replace('create=no', 'create=yes'), workspace, rows);
    expect(descriptions(created.plan)).toEqual([['T-1', 'entregas/mca-9_nova: new']]);
    expect(created.note).toBeUndefined();
  });

  it('matches an existing folder whatever its case, and refuses a value that is not yes or no', async () => {
    const workspace = await threeFolders();
    const rows = tasks(['folder', 'due'], [['MCA-1_AULA', '2026-11-20']]);
    const folded = await plan(
      'to-delivery name=folder fields=key:key,due:due create=no',
      workspace,
      rows,
    );
    expect(folded.note).toBeUndefined();
    const wrong = await plan('to-delivery name=folder fields=key:key create=maybe', workspace);
    expect(wrong.problems[0]?.message).toBe(
      "'to-delivery' reads create= as yes or no, and 'maybe' is neither.",
    );
  });
});

describe('with-deliveries (TYTO-779)', () => {
  /** Counts the port calls, so a test can hold the verb to one `list` and no `read`. */
  class CountingWorkspace extends FakeWorkspace {
    lists = 0;
    reads = 0;
    override list(parent: string) {
      this.lists += 1;
      return super.list(parent);
    }
    override read(path: string) {
      this.reads += 1;
      return super.read(path);
    }
  }

  async function described(): Promise<CountingWorkspace> {
    const workspace = new CountingWorkspace();
    const rows = tasks(
      ['folder', 'due', 'task'],
      [
        ['mca-1_aula', '2026-11-20', 'Cover, three slides'],
        ['mca-2_simulado', '2026-11-21', ''],
      ],
    );
    const first = await plan(
      'to-delivery name=folder fields=key:key,due:due,link:link,description:task',
      workspace,
      { ...rows, columns: [...rows.columns, { name: 'link', type: 'link', origin: 'test' }] },
    );
    await apply(first.verbs, first.plan);
    workspace.lists = 0;
    workspace.reads = 0;
    return workspace;
  }

  /** Rows from elsewhere, keyed by their own key, naming a folder in `pasta`. */
  const PULLED = tasks(
    ['pasta', 'summary'],
    [
      ['MCA-1_AULA', 'Aula'],
      ['mca-2_simulado', 'Simulado'],
      ['mca-7_nova', 'Nova'],
      ['', 'Sem pasta'],
    ],
  );

  async function bring(
    line: string,
    ports: ToDeliveryPorts | undefined,
    input: Table | null = PULLED,
  ) {
    const recipe = parseRecipe(['recipe deliveries', line].join('\n'));
    if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
    const result = await runRecipe(recipe.value, {
      input: input ?? undefined,
      verbs: createVerbRegistry({ deliveries: ports }),
      derivations: createDerivationRegistry(),
      resolveRecipe: () => Promise.resolve(err([])),
    });
    if (!result.ok) throw new Error('the run must start');
    const cell = result.value.cells.at(-1);
    return {
      table: cell?.table,
      note: cell?.note,
      problems: result.value.cells.flatMap((found) => found.diagnostics),
    };
  }

  it("brings each row's record beside its columns, and empty cells where no folder is", async () => {
    const workspace = await described();
    const { table, note, problems } = await bring('with-deliveries by=pasta', workspace);
    expect(problems).toEqual([]);
    expect(table?.rows.map((row) => row.key)).toEqual(['T-0', 'T-1', 'T-2', 'T-3']);
    expect(table?.columns.map((column) => [column.name, column.type])).toEqual([
      ['key', 'text'],
      ['pasta', 'text'],
      ['summary', 'text'],
      ['record_folder', 'text'],
      ['record_path', 'text'],
      ['record_key', 'text'],
      ['record_link', 'link'],
      ['record_formats', 'text'],
      ['record_stem', 'text'],
      ['record_copy', 'text'],
      ['record_due', 'text'],
      ['record_ship', 'text'],
      ['record_state', 'text'],
      ['record_check', 'text'],
      ['record_check_problems', 'text'],
      ['record_found_formats', 'text'],
      ['record_description', 'text'],
    ]);
    const cells = (name: string) => table?.rows.map((row) => row.values[name]);
    expect(cells('record_description')).toEqual(['Cover, three slides', null, null, null]);
    expect(cells('record_folder')).toEqual(['mca-1_aula', 'mca-2_simulado', null, null]);
    expect(cells('record_key')).toEqual(['T-0', 'T-1', null, null]);
    expect(cells('record_due')).toEqual(['2026-11-20', '2026-11-21', null, null]);
    expect(cells('summary')).toEqual(['Aula', 'Simulado', 'Nova', 'Sem pasta']);
    expect(note).toBe("2 of 4 rows have no delivery record: 'T-2', 'T-3'.");
  });

  it('reads the records from one list per run, and no file', async () => {
    const workspace = await described();
    await bring('with-deliveries by=pasta', workspace);
    expect([workspace.lists, workspace.reads, workspace.writes.length]).toEqual([1, 0, 2]);
  });

  it('refuses a column it would add that the table already has', async () => {
    const workspace = await described();
    const input = tasks(['pasta', 'Record_Due'], [['mca-1_aula', 'x']]);
    const { problems } = await bring('with-deliveries by=pasta', workspace, input);
    expect(problems.map((found) => [found.code, found.message])).toEqual([
      [
        'E_RECIPE_WITH_DELIVERIES',
        "'with-deliveries' would add 'record_due', which this table already has; select it away first.",
      ],
    ]);
  });

  it('matches the first of two folders one case apart, and names the other', async () => {
    const workspace = await described();
    const copy = (workspace.files.get(RECORD) ?? '').replace('"T-0"', '"T-5"');
    workspace.files.set('entregas/MCA-1_aula/editaveis/delivery.json', copy);
    const { table, problems } = await bring('with-deliveries by=pasta', workspace);
    expect(table?.rows[0]?.values['record_folder']).toBe('MCA-1_aula');
    expect(problems.map((found) => found.message)).toEqual([
      "'with-deliveries' left out entregas/mca-1_aula: its name differs from entregas/MCA-1_aula's only in case.",
    ]);
  });

  it('refuses a missing or stray argument, an unknown column, no table and no ports', async () => {
    const workspace = await described();
    const message = async (line: string) => (await bring(line, workspace)).problems[0]?.message;
    expect(await message('with-deliveries')).toBe(
      "'with-deliveries' needs by=<column>, the column naming each delivery folder.",
    );
    expect(await message('with-deliveries pasta')).toBe(
      "'with-deliveries' takes no bare word, and 'pasta' is one.",
    );
    expect(await message('with-deliveries by=pasta into=x')).toContain("does not take 'into='");
    expect(await message('with-deliveries by=nada')).toContain("'nada'");
    expect((await bring('with-deliveries by=pasta', workspace, null)).problems[0]?.code).toBe(
      'E_RECIPE_NO_TABLE',
    );
    expect((await bring('with-deliveries by=pasta', undefined)).problems[0]?.message).toBe(
      "'with-deliveries' cannot run here: this host reads no deliveries.",
    );
    workspace.where = { restricted: true };
    expect(await message('with-deliveries by=pasta')).toBe(
      "'with-deliveries' reads nothing in a restricted folder; trust the folder first.",
    );
  });

  describe('fields= (TYTO-784)', () => {
    const FIXED = ['folder', 'path', 'key', 'link', 'formats', 'stem', 'copy', 'due', 'ship'];
    const names = (table: Table | undefined) => table?.columns.map((column) => column.name);

    it('gives a listed field no record holds an empty column a later compose reads', async () => {
      const workspace = await threeFolders();
      const { table, problems } = await bring(
        'with-deliveries by=pasta fields=description\ncompose shown="[{record_description|}]"',
        workspace,
      );
      expect(problems).toEqual([]);
      expect(names(table)?.slice(-2)).toEqual(['record_description', 'shown']);
      expect(table?.rows.map((row) => row.values['record_description'])).toEqual([
        null,
        null,
        null,
        null,
      ]);
      expect(table?.rows.map((row) => row.values['shown'])).toEqual(['[]', '[]', '[]', '[]']);
    });

    it('gives the listed columns on a first run with no record at all', async () => {
      const empty = new FakeWorkspace();
      const source = await bring('deliveries fields=variante,description', empty, null);
      expect(source.problems).toEqual([]);
      expect(names(source.table)).toEqual([
        ...FIXED,
        'state',
        'check',
        'check_problems',
        'found_formats',
        'description',
        'variante',
      ]);
      expect(source.table?.rows).toEqual([]);
      const brought = await bring('with-deliveries by=pasta fields=variante', empty);
      expect(brought.problems).toEqual([]);
      expect(names(brought.table)?.slice(-2)).toEqual(['record_found_formats', 'record_variante']);
      expect(brought.table?.rows.map((row) => row.values['record_variante'])).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });

    it('merges the listed fields with those the records hold, alphabetical', async () => {
      const workspace = await described();
      const source = await bring('deliveries fields=variante,assignee', workspace, null);
      expect(names(source.table)?.slice(-3)).toEqual(['assignee', 'description', 'variante']);
      expect(source.table?.rows.map((row) => row.values['description'])).toEqual([
        'Cover, three slides',
        null,
      ]);
      const brought = await bring('with-deliveries by=pasta fields=variante,assignee', workspace);
      expect(names(brought.table)?.slice(-3)).toEqual([
        'record_assignee',
        'record_description',
        'record_variante',
      ]);
      const listedAndHeld = await bring('deliveries fields=description', workspace, null);
      expect(names(listedAndHeld.table)?.slice(-2)).toEqual(['found_formats', 'description']);
    });

    it('refuses a column a listed field would add that the table already has', async () => {
      const input = tasks(['pasta', 'record_variante'], [['mca-1_aula', 'x']]);
      const { problems } = await bring(
        'with-deliveries by=pasta fields=variante',
        new FakeWorkspace(),
        input,
      );
      expect(problems.map((found) => [found.code, found.message])).toEqual([
        [
          'E_RECIPE_WITH_DELIVERIES',
          "'with-deliveries' would add 'record_variante', which this table already has; select it away first.",
        ],
      ]);
    });

    it('refuses a fixed or invalid name at fields=, under the verb its own code', async () => {
      const workspace = await described();
      const refused = async (line: string, input: Table | null = PULLED) => {
        const [found] = (await bring(line, workspace, input)).problems;
        const text = `recipe deliveries\n${line}`;
        return [
          found?.code,
          found?.message,
          text.slice(found?.range?.start, found?.range?.end).split('=')[0],
        ];
      };
      expect(await refused('with-deliveries by=pasta fields=key')).toEqual([
        'E_RECIPE_WITH_DELIVERIES',
        "'with-deliveries' cannot list a declared field: 'key' is a column every delivery already has, so it cannot be declared.",
        'fields',
      ]);
      expect(await refused('deliveries fields=description,folder', null)).toEqual([
        'E_RECIPE_DELIVERIES',
        "'deliveries' cannot list a declared field: 'folder' is a column every delivery already has, so it cannot be declared.",
        'fields',
      ]);
      expect(await refused('deliveries fields=Variante', null)).toEqual([
        'E_RECIPE_DELIVERIES',
        "'deliveries' cannot list a declared field: 'Variante' is not a field name; a declared field is lowercase letters, digits, _ and -.",
        'fields',
      ]);
      expect((await refused('deliveries fields=a,,b', null)).slice(0, 2)).toEqual([
        'E_RECIPE_ARGUMENTS',
        "'deliveries' reads fields as <field>,…, and one is empty.",
      ]);
      expect((await refused('with-deliveries by=pasta fields=a,a')).slice(0, 2)).toEqual([
        'E_RECIPE_ARGUMENTS',
        "'with-deliveries' lists the field 'a' twice.",
      ]);
      expect((await refused('deliveries fields=a fields=b', null)).slice(0, 2)).toEqual([
        'E_RECIPE_ARGUMENTS',
        "'deliveries' was given 'fields=' twice.",
      ]);
      expect((await refused('deliveries entregas', null)).slice(0, 2)).toEqual([
        'E_RECIPE_ARGUMENTS',
        "'deliveries' takes no bare word: the project's delivery.parent says where deliveries are.",
      ]);
    });
  });
});

describe('deliveries check (ADR 0215)', () => {
  const owing = (key: string) =>
    JSON.stringify({
      version: 1,
      key,
      formats: [
        { format: 'feed', count: 1 },
        { format: 'story', count: 1 },
      ],
    });

  async function checked(workspace: FakeWorkspace) {
    const { cells } = await runLines(['deliveries'], workspace);
    return cells[0]?.table?.rows.map((row) => [
      row.key,
      row.values['check'],
      row.values['check_problems'],
      row.values['found_formats'],
    ]);
  }

  it('checks each record against the images its exports folder holds', async () => {
    const workspace = new FakeWorkspace();
    workspace.exports = 'final';
    workspace.sizes = { feed: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 } };
    workspace.files.set('entregas/a/editaveis/delivery.json', owing('T-1'));
    workspace.files.set('entregas/b/editaveis/delivery.json', owing('T-2'));
    workspace.files.set('entregas/c/editaveis/delivery.json', owing('T-3'));
    workspace.landed.set('entregas/a', {
      images: [
        { name: 'feed.png', size: { w: 1080, h: 1350 } },
        { name: 'story.png', size: { w: 1080, h: 1920 } },
      ],
      editables: 1,
    });
    workspace.landed.set('entregas/b', {
      images: [
        { name: 'feed.png', size: { w: 1080, h: 1080 } },
        { name: 'story.png', size: { w: 1080, h: 1920 } },
      ],
      editables: 1,
    });
    expect(await checked(workspace)).toEqual([
      ['T-1', 'ready', null, '4:5:1,9:16:1'],
      [
        'T-2',
        'incomplete',
        "'feed' has 0 of 1 at 1080×1350; 'feed.png' is 1080×1080, and the record owes feed 1080×1350, story 1080×1920",
        '1:1:1,9:16:1',
      ],
      ['T-3', 'in-progress', null, null],
    ]);
    expect(workspace.listedExports).toEqual(['final']);
  });

  it("asks for the delivery's root when the layout names no exports folder, and names a format with no size", async () => {
    const workspace = new FakeWorkspace();
    workspace.files.set('entregas/a/editaveis/delivery.json', owing('T-1'));
    expect(await checked(workspace)).toEqual([
      [
        'T-1',
        'in-progress',
        "no size is known for 'feed'; add it to delivery.sizes; no size is known for 'story'; add it to delivery.sizes",
        null,
      ],
    ]);
    expect(workspace.listedExports).toEqual(['.']);
  });
});

describe('to-delivery copy-text= (ADR 0217)', () => {
  const COPY = 'entregas/mca-1_aula/editaveis/copy.md';
  const COPY_LINE = 'to-delivery name=folder fields=key:key,copy:source copy-text=text';
  const DOC = 'https://docs.example/d/1';

  function copyRows(text: string, source = DOC) {
    return tasks(['folder', 'source', 'text'], [['mca-1_aula', source, text]]);
  }

  async function applied(workspace: FakeWorkspace, input: Table) {
    const shown = await plan(COPY_LINE, workspace, input);
    const answer = await apply(shown.verbs, shown.plan);
    return answer.ok ? answer.value.operations.map((operation) => operation.status) : answer;
  }

  it('plans copy.md with the record, writes it first with its source on top, and a second run plans none', async () => {
    const workspace = new FakeWorkspace();
    const first = await plan(COPY_LINE, workspace, copyRows('# Aula\n\nTrês peças.\n\n'));
    expect(first.problems).toEqual([]);
    expect(workspace.writes).toEqual([]);
    expect(descriptions(first.plan)).toEqual([['T-0', 'entregas/mca-1_aula: new; copy.md new']]);
    expect(first.plan?.operations[0]?.payload).toMatchObject({
      copy: { path: COPY, before: null },
    });

    const answer = await apply(first.verbs, first.plan);
    expect(answer.ok && answer.value.operations.map((operation) => operation.status)).toEqual([
      'applied',
    ]);
    expect(workspace.writes).toEqual([COPY, RECORD]);
    const text = `Source: ${DOC}\n\n# Aula\n\nTrês peças.\n`;
    expect(workspace.files.get(COPY)).toBe(text);
    const record = JSON.parse(workspace.files.get(RECORD) ?? '') as Record<string, unknown>;
    expect(record['written']).toEqual({
      key: 'T-0',
      copy: DOC,
      files: { 'editaveis/copy.md': `digest:${text}` },
    });

    const second = await plan(COPY_LINE, workspace, copyRows('# Aula\n\nTrês peças.\n\n'));
    expect(second.problems).toEqual([]);
    expect(second.plan?.count).toBe(0);
    expect(second.note).toBeUndefined();
  });

  it('replaces a copy nobody touched when the row brings a new one', async () => {
    const workspace = new FakeWorkspace();
    await applied(workspace, copyRows('first'));
    const later = await plan(COPY_LINE, workspace, copyRows('second'));
    expect(descriptions(later.plan)).toEqual([['T-0', 'entregas/mca-1_aula: copy.md replaced']]);
    await apply(later.verbs, later.plan);
    expect(workspace.files.get(COPY)).toBe(`Source: ${DOC}\n\nsecond\n`);
    expect((await plan(COPY_LINE, workspace, copyRows('second'))).plan?.count).toBe(0);
  });

  it('keeps a copy a person edited, never overwrites it, and says so on every run', async () => {
    const workspace = new FakeWorkspace();
    await applied(workspace, copyRows('first'));
    workspace.files.set(COPY, `Source: ${DOC}\n\nfirst, fixed by hand\n`);

    const later = await plan(COPY_LINE, workspace, copyRows('second'));
    expect(later.plan?.count).toBe(0);
    expect(later.note).toBe(
      "Kept 1 copy.md file edited since the last run, never overwritten: 'entregas/mca-1_aula'.",
    );
    const moved = await plan(COPY_LINE, workspace, copyRows('second', 'https://docs.example/d/2'));
    expect(descriptions(moved.plan)).toEqual([
      ['T-0', 'entregas/mca-1_aula: updates copy; kept: copy.md (edited since the last run)'],
    ]);
    expect(moved.plan?.operations[0]?.payload).not.toHaveProperty('copy');
    await apply(moved.verbs, moved.plan);
    expect(workspace.files.get(COPY)).toBe(`Source: ${DOC}\n\nfirst, fixed by hand\n`);
    expect((await plan(COPY_LINE, workspace, copyRows('second'))).note).toContain('Kept 1 copy.md');
  });

  it('writes a missing copy again, and counts a file the recipe never wrote as edited', async () => {
    const workspace = new FakeWorkspace();
    await applied(workspace, copyRows('first'));
    workspace.files.delete(COPY);
    const again = await plan(COPY_LINE, workspace, copyRows('first'));
    expect(descriptions(again.plan)).toEqual([['T-0', 'entregas/mca-1_aula: copy.md new']]);

    const someone = new FakeWorkspace();
    someone.files.set(COPY, 'notes of my own\n');
    const fresh = await plan(COPY_LINE, someone, copyRows('first'));
    expect(descriptions(fresh.plan)).toEqual([
      ['T-0', 'entregas/mca-1_aula: new; kept: copy.md (edited since the last run)'],
    ]);
    await apply(fresh.verbs, fresh.plan);
    expect(someone.files.get(COPY)).toBe('notes of my own\n');
  });

  it('lets the base catch up with a copy that already holds the row, writing only the record', async () => {
    const workspace = new FakeWorkspace();
    await applied(workspace, copyRows('first'));
    workspace.files.set(COPY, `Source: ${DOC}\n\nsecond\n`);
    const later = await plan(COPY_LINE, workspace, copyRows('second'));
    expect(descriptions(later.plan)).toEqual([
      ['T-0', 'entregas/mca-1_aula: copy.md already holds the copy'],
    ]);
    workspace.writes.length = 0;
    await apply(later.verbs, later.plan);
    expect(workspace.writes).toEqual([RECORD]);
    expect((await plan(COPY_LINE, workspace, copyRows('second'))).plan?.count).toBe(0);
  });

  it('fails a row whose copy changed since the plan, and leaves its record as it was', async () => {
    const workspace = new FakeWorkspace();
    await applied(workspace, copyRows('first'));
    const before = workspace.files.get(RECORD);
    const later = await plan(COPY_LINE, workspace, copyRows('second'));
    workspace.files.set(COPY, 'edited while the plan was open\n');
    workspace.writes.length = 0;
    const answer = await apply(later.verbs, later.plan);
    expect(answer.ok && answer.value.operations).toEqual([
      { rowKey: 'T-0', status: 'failed', reason: `${COPY} changed since the plan` },
    ]);
    expect(workspace.writes).toEqual([]);
    expect(workspace.files.get(RECORD)).toBe(before);
  });

  it('leaves the copy alone for an empty cell, and stops on a host that gives no digest', async () => {
    const workspace = new FakeWorkspace();
    const empty = await plan(COPY_LINE, workspace, copyRows('  '));
    expect(descriptions(empty.plan)).toEqual([['T-0', 'entregas/mca-1_aula: new']]);

    const bare: ToDeliveryPorts = {
      folder: () => workspace.folder(),
      layout: () => workspace.layout(),
      list: (parent, exports) => workspace.list(parent, exports),
      read: (path) => workspace.read(path),
      stat: (path) => workspace.stat(path),
      make: (path) => workspace.make(path),
      write: (path, text) => workspace.write(path, text),
    };
    const refused = await plan(COPY_LINE, bare, copyRows('first'));
    expect(refused.plan).toBeUndefined();
    expect(refused.problems[0]?.message).toBe(
      "'to-delivery' cannot keep a copy file: this host gives no digest.",
    );
  });
});
