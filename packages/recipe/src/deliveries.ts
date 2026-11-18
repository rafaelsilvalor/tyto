import {
  DELIVERY_WRITABLE_FIELDS,
  type DeliveryRecord,
  type Diagnostic,
  type Result,
  type SourceRange,
  deliveryFormatsText,
  declaredFieldProblem,
  deliveryNameOf,
  diagnostic,
  err,
  isDeclaredFieldMap,
  ok,
  readDeliveryRecord,
} from '@tyto/core';

import type { NamedArgument } from './ast.js';
import { systemClock } from './clock.js';
import { resolveColumn } from './columns.js';
import type { Verb, VerbContext, VerbResult } from './registry.js';
import { argumentsProblem, locate, refuseNamed, requireTable } from './support.js';
import {
  type CellValue,
  type Column,
  type Row,
  type Table,
  cellText,
  findColumn,
} from './table.js';
import type { ToDeliveryPorts } from './to-delivery.js';

/**
 * `deliveries` (ADR 0211): a source that reads every delivery record under the project's
 * `delivery.parent` back as one row per delivery, so the folder, on this machine or in a synced
 * cloud folder, is where a recipe's rows come from, and a sheet is a report written from them.
 *
 * Only the project decides where deliveries live (ADR 0157, ADR 0210), so no argument says where.
 * It reads one level, `<parent>/<folder>/editaveis/delivery.json`. Each row is keyed by the record's
 * `key` and holds the folder's name and workspace path beside the record's fields; `formats`
 * comes back as `feed:3,story:1`, the text `to-delivery` reads, so a recipe that reads the
 * records and writes them back plans nothing.
 *
 * A record that does not read, a folder the host may not read, or a key a folder before it took
 * is a warning naming the folder, and the other deliveries still read; a folder without a record
 * is not a delivery yet, and the note counts it. It reads only in a trusted workspace, through
 * the same ports `to-delivery` writes through.
 *
 * Fields a recipe declared (ADR 0213) come after the fixed columns, one text column per name any
 * record read holds, in alphabetical order; a record without one gives an empty cell.
 * `fields=<name>,…` (TYTO-784) names declared fields whose columns exist even when no record
 * holds them yet, as on a recipe's first run, so a later step that reads one runs. A record
 * whose `fields` is not a map of text, written by hand before ADR 0213, still reads, without
 * declared fields, and a warning names its folder.
 *
 * `with-deliveries by=<column>` (TYTO-779, ADR 0213's note of 2026-11-18) reads the same records
 * beside rows that came from elsewhere. It is a transform, not a source, so it is its own verb:
 * a verb has one kind whatever its arguments.
 */

/** The columns, in order: where the delivery is, then the record's fields. */
export const DELIVERY_COLUMNS: readonly Column[] = [
  { name: 'folder', type: 'text', origin: 'deliveries' },
  { name: 'path', type: 'text', origin: 'deliveries' },
  ...DELIVERY_WRITABLE_FIELDS.map((field): Column => ({
    name: field,
    type: field === 'link' ? 'link' : 'text',
    origin: 'deliveries',
  })),
];

/** What `with-deliveries` puts before each column it brings, so none shadows a row's own. */
export const RECORD_COLUMN_PREFIX = 'record_';

export function deliveriesVerb(ports: ToDeliveryPorts | undefined): Verb {
  return { kind: 'source', run: (context) => readDeliveries(context, ports) };
}

export function withDeliveriesVerb(ports: ToDeliveryPorts | undefined): Verb {
  return { kind: 'transform', run: (context) => bringDeliveries(context, ports) };
}

function refuse(
  context: VerbContext,
  problem: string,
  range: SourceRange,
): Result<never, readonly Diagnostic[]> {
  // Each verb its own code: a handler reads the code, and `with-deliveries` refuses for one more
  // reason than `deliveries` does.
  const found =
    context.step.verb === 'with-deliveries'
      ? diagnostic('E_RECIPE_WITH_DELIVERIES', { problem }, { range })
      : diagnostic('E_RECIPE_DELIVERIES', { problem }, { range });
  return err([found]);
}

/** `E_RECIPE_ARGUMENTS` typed for a helper whose success is not a verb's. */
function argumentsRefused(
  context: VerbContext,
  problem: string,
  range: SourceRange,
): Result<never, readonly Diagnostic[]> {
  return err([diagnostic('E_RECIPE_ARGUMENTS', { verb: context.step.verb, problem }, { range })]);
}

/** One record read: its folder, its row's cells and its declared fields. */
interface Found {
  readonly name: string;
  readonly path: string;
  readonly values: Readonly<Record<string, CellValue>>;
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * `fields=description,variante`: declared fields whose columns always exist, merged with those
 * the records hold (TYTO-784). A name a declared field may not have, a fixed column's included,
 * is refused under the verb's own code, by the rules `to-delivery` declares by (ADR 0213).
 */
function readListedFields(
  context: VerbContext,
  written: NamedArgument | undefined,
): Result<readonly string[], readonly Diagnostic[]> {
  if (written === undefined) return ok([]);
  const range = locate(context)(written.range);
  const listed: string[] = [];
  for (const entry of written.value.split(',')) {
    const name = entry.trim();
    if (name === '') {
      return argumentsRefused(context, 'reads fields as <field>,…, and one is empty', range);
    }
    const problem = declaredFieldProblem(name);
    if (problem !== undefined) {
      return refuse(context, `cannot list a declared field: ${problem}`, range);
    }
    if (listed.includes(name)) {
      return argumentsRefused(context, `lists the field '${name}' twice`, range);
    }
    listed.push(name);
  }
  return ok(listed);
}

/** The one `fields=` a verb was given, or the diagnostic for a second one. */
function fieldsArgument(
  context: VerbContext,
): Result<NamedArgument | undefined, readonly Diagnostic[]> {
  let fields: NamedArgument | undefined;
  for (const written of context.step.named) {
    if (written.name !== 'fields') continue;
    if (fields !== undefined) {
      return argumentsRefused(context, "was given 'fields=' twice", locate(context)(written.range));
    }
    fields = written;
  }
  return ok(fields);
}

interface Read {
  readonly found: readonly Found[];
  /** Every declared name any record read holds, in alphabetical order. */
  readonly declared: readonly string[];
  readonly warnings: readonly Diagnostic[];
  /** Folders with no record: not a delivery yet. */
  readonly withoutRecord: number;
}

/**
 * Every record under `delivery.parent`, from one `list`: the port hands each folder's record
 * text with its name, so no folder is read again. Both verbs check and warn the same way.
 */
async function readRecords(
  context: VerbContext,
  ports: ToDeliveryPorts | undefined,
  at: SourceRange,
  wanted: readonly string[],
): Promise<Result<Read, readonly Diagnostic[]>> {
  if (ports === undefined) {
    return refuse(context, 'cannot run here: this host reads no deliveries', at);
  }
  const where = ports.folder();
  if (where === undefined) {
    return refuse(context, 'reads only inside a workspace, and this recipe is in none', at);
  }
  if (where.restricted) {
    return refuse(context, 'reads nothing in a restricted folder; trust the folder first', at);
  }
  const layout = await ports.layout();
  if (!layout.ok) {
    return refuse(context, `cannot read the delivery layout: ${messages(layout.error)}`, at);
  }
  const listed = await ports.list(layout.value.parent);
  if (!listed.ok) {
    return refuse(context, `cannot list the deliveries: ${messages(listed.error)}`, at);
  }

  const verb = context.step.verb;
  const warnings: Diagnostic[] = [];
  const leftOut = (folder: string, problem: string) =>
    warnings.push(diagnostic('W_RECIPE_DELIVERY_RECORD', { verb, folder, problem }, { range: at }));
  const found: Found[] = [];
  const declared = new Set<string>(wanted);
  const keys = new Map<string, string>();
  let withoutRecord = 0;
  for (const entry of listed.value) {
    if (entry.problem !== undefined) {
      leftOut(entry.path, entry.problem);
      continue;
    }
    if (entry.record === undefined) {
      withoutRecord += 1;
      continue;
    }
    const record = readDeliveryRecord(entry.record);
    if (!record.ok) {
      leftOut(entry.path, `its record ${record.error}`);
      continue;
    }
    const first = keys.get(record.value.key);
    if (first !== undefined) {
      leftOut(entry.path, `its key '${record.value.key}' is ${first}'s too`);
      continue;
    }
    keys.set(record.value.key, entry.path);
    let fields: Readonly<Record<string, string>> = {};
    if (isDeclaredFieldMap(record.value.fields)) {
      fields = record.value.fields;
      for (const field of Object.keys(fields)) declared.add(field);
    } else if (record.value.fields !== undefined) {
      warnings.push(
        diagnostic('W_RECIPE_DELIVERY_FIELDS_UNREAD', { verb, folder: entry.path }, { range: at }),
      );
    }
    found.push({
      name: entry.name,
      path: entry.path,
      values: valuesOf(entry.name, entry.path, record.value),
      fields,
    });
  }
  // Declared fields after the fixed columns, alphabetical, so a column keeps its place across runs
  // and a listed one sits where it will sit once a record holds it.
  return ok({ found, declared: [...declared].sort(), warnings, withoutRecord });
}

async function readDeliveries(
  context: VerbContext,
  ports: ToDeliveryPorts | undefined,
): Promise<VerbResult> {
  const named = refuseNamed(context, ['fields']);
  if (named !== undefined) return named;
  const [extra] = context.step.positional;
  if (extra !== undefined) {
    return argumentsProblem(
      context,
      "takes no bare word: the project's delivery.parent says where deliveries are",
      locate(context)(extra.range),
    );
  }
  const fields = fieldsArgument(context);
  if (!fields.ok) return fields;
  const listed = readListedFields(context, fields.value);
  if (!listed.ok) return listed;
  const read = await readRecords(context, ports, context.written.verbRange, listed.value);
  if (!read.ok) return read;
  const { found, declared, warnings, withoutRecord } = read.value;

  const fetchedAt = (context.clock ?? systemClock).now().toISOString();
  const rows = found.map((delivery): Row => {
    const values: Record<string, CellValue> = { ...delivery.values };
    for (const field of declared) values[field] = delivery.fields[field] ?? null;
    return {
      key: cellText(delivery.values['key']),
      values,
      provenance: { source: 'deliveries', id: delivery.path, fetchedAt },
    };
  });
  const table: Table = {
    columns: [
      ...DELIVERY_COLUMNS,
      ...declared.map((field): Column => ({ name: field, type: 'text', origin: 'deliveries' })),
    ],
    rows,
  };
  const note =
    withoutRecord === 0
      ? undefined
      : `Read ${String(rows.length)} deliveries; ${String(withoutRecord)} ${
          withoutRecord === 1 ? 'folder has' : 'folders have'
        } no record and ${withoutRecord === 1 ? 'was' : 'were'} skipped.`;
  return ok({ table, ...(note === undefined ? {} : { note }) }, warnings);
}

/**
 * `with-deliveries by=<column>`: for each row, the record of the delivery folder its `<column>`
 * names, as columns after its own. Each brought column is a `deliveries` column with `record_`
 * before it, of the same kind, so `record_link` stays a link. `record_folder` is the folder
 * matched, empty when the row has none, which tells a missing folder from an empty field.
 *
 * The cell is read as a folder name the way `to-delivery name=` reads it, and matched with case
 * folded, as `to-delivery create=no` matches, since the file systems a workspace lives on mostly
 * ignore case. A row whose cell is empty, is no folder name, or names no folder with a record
 * gets empty cells, and the note names it. It reads, and never writes. `fields=<name>,…` brings
 * `record_<name>` whether or not a record holds that field, as `deliveries fields=` does.
 */
async function bringDeliveries(
  context: VerbContext,
  ports: ToDeliveryPorts | undefined,
): Promise<VerbResult> {
  const named = refuseNamed(context, ['by', 'fields']);
  if (named !== undefined) return named;
  const [extra] = context.step.positional;
  if (extra !== undefined) {
    return argumentsProblem(
      context,
      `takes no bare word, and '${extra.value}' is one`,
      extra.range,
    );
  }
  const at = locate(context);
  let by: NamedArgument | undefined;
  for (const written of context.step.named) {
    if (written.name !== 'by') continue;
    if (by !== undefined) {
      return argumentsProblem(context, "was given 'by=' twice", at(written.range));
    }
    by = written;
  }
  if (by === undefined) {
    return argumentsProblem(context, 'needs by=<column>, the column naming each delivery folder');
  }
  const table = requireTable(context);
  if (!table.ok) return table;
  const column = resolveColumn(table.value, by.value, at(by.range), context.aliases);
  if (!column.ok) return column;
  const fields = fieldsArgument(context);
  if (!fields.ok) return fields;
  const listed = readListedFields(context, fields.value);
  if (!listed.ok) return listed;

  // The listed names are among `declared`, so the clash check below counts them too.
  const read = await readRecords(context, ports, at(by.range), listed.value);
  if (!read.ok) return read;
  const { found, declared } = read.value;
  const warnings = [...read.value.warnings];

  const brought: Column[] = [
    ...DELIVERY_COLUMNS.map((fixed): Column => ({
      name: `${RECORD_COLUMN_PREFIX}${fixed.name}`,
      type: fixed.type,
      origin: 'deliveries',
    })),
    ...declared.map((field): Column => ({
      name: `${RECORD_COLUMN_PREFIX}${field}`,
      type: 'text',
      origin: 'deliveries',
    })),
  ];
  const clash = brought.find((added) => findColumn(table.value, added.name) !== undefined);
  if (clash !== undefined) {
    return refuse(
      context,
      `would add '${clash.name}', which this table already has; select it away first`,
      at(by.range),
    );
  }

  // By folder name, folded. Two folders one fold apart are one folder where case is ignored:
  // the first listed wins, and the other is named rather than matched at random.
  const byFolder = new Map<string, Found>();
  for (const delivery of found) {
    const folded = delivery.name.toLowerCase();
    const first = byFolder.get(folded);
    if (first !== undefined) {
      const problem = `its name differs from ${first.path}'s only in case`;
      warnings.push(
        diagnostic(
          'W_RECIPE_DELIVERY_RECORD',
          { verb: context.step.verb, folder: delivery.path, problem },
          { range: at(by.range) },
        ),
      );
      continue;
    }
    byFolder.set(folded, delivery);
  }

  const unmatched: string[] = [];
  const rows = table.value.rows.map((row): Row => {
    const values: Record<string, CellValue> = { ...row.values };
    const folderName = deliveryNameOf(cellText(row.values[column.value.name]));
    const delivery = folderName.ok ? byFolder.get(folderName.value.toLowerCase()) : undefined;
    if (delivery === undefined) unmatched.push(`'${row.key}'`);
    for (const fixed of DELIVERY_COLUMNS) {
      values[`${RECORD_COLUMN_PREFIX}${fixed.name}`] = delivery?.values[fixed.name] ?? null;
    }
    for (const field of declared) {
      values[`${RECORD_COLUMN_PREFIX}${field}`] = delivery?.fields[field] ?? null;
    }
    return { ...row, values };
  });
  const note =
    unmatched.length === 0
      ? undefined
      : `${String(unmatched.length)} of ${String(rows.length)} ${
          rows.length === 1 ? 'row has' : 'rows have'
        } no delivery record: ${unmatched.join(', ')}.`;
  return ok(
    {
      table: { columns: [...table.value.columns, ...brought], rows },
      ...(note === undefined ? {} : { note }),
    },
    warnings,
  );
}

/** A row's cells: an absent field is an empty cell, and `formats` is the text a cell writes. */
function valuesOf(
  name: string,
  path: string,
  record: DeliveryRecord,
): Readonly<Record<string, CellValue>> {
  const values: Record<string, CellValue> = { folder: name, path };
  for (const field of DELIVERY_WRITABLE_FIELDS) {
    if (field === 'formats') {
      values[field] = record.formats === undefined ? null : deliveryFormatsText(record.formats);
    } else {
      values[field] = record[field] ?? null;
    }
  }
  return values;
}

function messages(found: readonly Diagnostic[]): string {
  return found.map((item) => item.message.replace(/\.$/u, '')).join('; ') || 'no reason given';
}
