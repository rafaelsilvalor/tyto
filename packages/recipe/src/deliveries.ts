import {
  DELIVERY_WRITABLE_FIELDS,
  type DeliveryRecord,
  type Diagnostic,
  type SourceRange,
  deliveryFormatsText,
  diagnostic,
  err,
  ok,
  readDeliveryRecord,
} from '@tyto/core';

import { systemClock } from './clock.js';
import type { Verb, VerbContext, VerbResult } from './registry.js';
import { argumentsProblem } from './support.js';
import type { CellValue, Column, Row, Table } from './table.js';
import type { ToDeliveryPorts } from './to-delivery.js';

/**
 * `deliveries` (ADR 0211): a source that reads every delivery record under the project's
 * `delivery.parent` back as one row per delivery, so the folder, on this machine or in a synced
 * cloud folder, is where a recipe's rows come from, and a sheet is a report written from them.
 *
 * It takes no argument: only the project decides where deliveries live (ADR 0157, ADR 0210). It
 * reads one level, `<parent>/<folder>/editaveis/delivery.json`. Each row is keyed by the record's
 * `key` and holds the folder's name and workspace path beside the record's fields; `formats`
 * comes back as `feed:3,story:1`, the text `to-delivery` reads, so a recipe that reads the
 * records and writes them back plans nothing.
 *
 * A record that does not read, a folder the host may not read, or a key a folder before it took
 * is a warning naming the folder, and the other deliveries still read; a folder without a record
 * is not a delivery yet, and the note counts it. It reads only in a trusted workspace, through
 * the same ports `to-delivery` writes through.
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

export function deliveriesVerb(ports: ToDeliveryPorts | undefined): Verb {
  return { kind: 'source', run: (context) => readDeliveries(context, ports) };
}

function refuse(problem: string, range: SourceRange): VerbResult {
  return err([diagnostic('E_RECIPE_DELIVERIES', { problem }, { range })]);
}

async function readDeliveries(
  context: VerbContext,
  ports: ToDeliveryPorts | undefined,
): Promise<VerbResult> {
  const [extra] = [...context.step.named, ...context.step.positional];
  if (extra !== undefined) {
    return argumentsProblem(
      context,
      "takes no argument: the project's delivery.parent says where deliveries are",
      extra.range,
    );
  }
  const at = context.written.verbRange;
  if (ports === undefined) return refuse('cannot run here: this host reads no deliveries', at);
  const where = ports.folder();
  if (where === undefined)
    return refuse('reads only inside a workspace, and this recipe is in none', at);
  if (where.restricted) {
    return refuse('reads nothing in a restricted folder; trust the folder first', at);
  }
  const layout = await ports.layout();
  if (!layout.ok) return refuse(`cannot read the delivery layout: ${messages(layout.error)}`, at);
  const listed = await ports.list(layout.value.parent);
  if (!listed.ok) return refuse(`cannot list the deliveries: ${messages(listed.error)}`, at);

  const fetchedAt = (context.clock ?? systemClock).now().toISOString();
  const warnings: Diagnostic[] = [];
  const leftOut = (folder: string, problem: string) =>
    warnings.push(diagnostic('W_RECIPE_DELIVERY_RECORD', { folder, problem }, { range: at }));
  const rows: Row[] = [];
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
    rows.push({
      key: record.value.key,
      values: valuesOf(entry.name, entry.path, record.value),
      provenance: { source: 'deliveries', id: entry.path, fetchedAt },
    });
  }

  const table: Table = { columns: DELIVERY_COLUMNS, rows };
  const note =
    withoutRecord === 0
      ? undefined
      : `Read ${String(rows.length)} deliveries; ${String(withoutRecord)} ${
          withoutRecord === 1 ? 'folder has' : 'folders have'
        } no record and ${withoutRecord === 1 ? 'was' : 'were'} skipped.`;
  return ok({ table, ...(note === undefined ? {} : { note }) }, warnings);
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
