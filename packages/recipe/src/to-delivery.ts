import {
  DELIVERY_RECORD_FIELDS,
  DELIVERY_RECORD_FILE,
  DELIVERY_RECORD_FOLDER,
  type DeliveryFieldValue,
  type DeliveryRecord,
  type DeliveryRecordField,
  type Diagnostic,
  type Result,
  type SourceRange,
  deliveryNameOf,
  diagnostic,
  err,
  isDeliveryDue,
  mergeDeliveryRecord,
  ok,
  parseDeliveryFormats,
  readDeliveryRecord,
  writeDeliveryRecord,
} from '@tyto/core';
import { z } from 'zod';

import type { NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import { isDataReference, readDataArgument } from './data.js';
import {
  PLAN_LIMITS,
  type Plan,
  type PlanLimits,
  type PlannedOperation,
  checkPlan,
} from './plan.js';
import type { Verb, VerbContext, VerbResult } from './registry.js';
import type { AppliedOperation, ApplyOutcome } from './state.js';
import { argumentsProblem, locate, refuseNamed, requireTable } from './support.js';
import { type Column, type Row, cellText } from './table.js';

/**
 * `to-delivery name=<column> fields=<field>:<column>,…` (ADR 0210): a sink that keeps one
 * delivery folder per row, with its record at `editaveis/delivery.json`, under the project's
 * `delivery.parent` (ADR 0157). No `into=`: only the project decides where a delivery lives.
 *
 * Running it writes nothing: it answers a plan of one `record` per folder that needs a write,
 * `<folder>: new` or `<folder>: updates due, link`, and a row whose record would not change has
 * no operation, so a second run over the same rows plans none. Apply writes exactly what the
 * plan showed (ADR 0129, ADR 0170). A record already on disk is merged field by field
 * (`mergeDeliveryRecord`): a field a person edited is kept.
 *
 * A row whose folder name cannot be one folder's (ADR 0157 §4), or whose values the record cannot
 * hold, is **refused, never rewritten**, and named in the cell's note; the other rows still plan.
 * A recipe that needs such a name changes it with `rewrite` before this step.
 */
export interface ToDeliveryPorts {
  /**
   * Whether the running recipe is in a workspace and whether that workspace is restricted,
   * asked on every run and every Apply. `undefined` when it is in no workspace.
   */
  folder(): DeliveryPlace | undefined;
  /** The project's delivery layout as it reads now, relative to the workspace. */
  layout(): Promise<Result<DeliveryLayout, readonly Diagnostic[]>>;
  /** A file's text at a workspace path, or `undefined` when there is none. */
  read(path: string): Promise<Result<string | undefined, readonly Diagnostic[]>>;
  /** A digest of the file at a workspace path, of the host's choice; `undefined` when absent. */
  stat(path: string): Promise<Result<string | undefined, readonly Diagnostic[]>>;
  /** Makes a folder at a workspace path, and the ones above it; one already there is fine. */
  make(path: string): Promise<Result<void, readonly Diagnostic[]>>;
  /** Writes the file. The host confines the path to the workspace again. */
  write(path: string, text: string): Promise<Result<void, readonly Diagnostic[]>>;
  /** The host's clock as ISO 8601 in UTC, which stamps an applied write; the system's if absent. */
  now?(): string;
}

export interface DeliveryPlace {
  /** A restricted folder (ADR 0111) reads, and never writes. */
  readonly restricted: boolean;
}

export interface DeliveryLayout {
  /** `delivery.parent`, relative to the workspace and `/`-separated; `''` at its root. */
  readonly parent: string;
  /** `delivery.folders`, made inside every delivery, relative to it. */
  readonly folders: readonly string[];
}

/** The kind of write `to-delivery` declares, and the only one its plans hold. */
export const TO_DELIVERY_WRITE = 'record';

/** A thousand records of a few hundred bytes: well inside what ADR 0170 budgets for a plan. */
export const TO_DELIVERY_PLAN_LIMITS: PlanLimits = {
  ...PLAN_LIMITS,
  maxOperations: 1000,
  maxPayloadBytes: 16 * 1024,
};

/** How many refused rows the note names, so a broken column is not a thousand lines. */
const REPORTED = 8;

const NAMES = ['name', 'fields'] as const;
const FIELD_MAP = z.record(z.string(), z.string());

/** One record of a shown plan, as Apply writes it. */
interface RecordWrite {
  readonly rowKey: string;
  /** The folders to make first, the delivery's own first; relative to the workspace. */
  readonly folders: readonly string[];
  readonly path: string;
  readonly text: string;
  /** The digest the record had when the plan was made; `null` when there was none. */
  readonly before: string | null;
}

/** Every plan a `to-delivery` answered, by the plan object the runner keeps (ADR 0170). */
const shownRecords = new WeakMap<Plan, readonly RecordWrite[]>();

export function toDeliveryVerb(ports: ToDeliveryPorts | undefined): Verb {
  return {
    kind: 'sink',
    run: (context) => planDeliveries(context, ports),
    apply: (plan) => applyDeliveries(plan, ports),
  };
}

function refuse(problem: string, range: SourceRange): VerbResult {
  return err([diagnostic('E_RECIPE_DELIVERY', { problem }, { range })]);
}

async function planDeliveries(
  context: VerbContext,
  ports: ToDeliveryPorts | undefined,
): Promise<VerbResult> {
  const named = refuseNamed(context, [...NAMES]);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  if (ports === undefined) {
    return refuse('cannot run here: this host writes no deliveries', context.written.verbRange);
  }
  const [extra] = context.step.positional;
  if (extra !== undefined) {
    return argumentsProblem(
      context,
      `takes no bare word, and '${extra.value}' is one`,
      extra.range,
    );
  }
  const at = locate(context);
  const argument: Partial<Record<(typeof NAMES)[number], NamedArgument>> = {};
  for (const written of context.step.named) {
    const name = written.name as (typeof NAMES)[number];
    if (argument[name] !== undefined) {
      return argumentsProblem(context, `was given '${name}=' twice`, at(written.range));
    }
    argument[name] = written;
  }
  const { name, fields } = argument;
  if (name === undefined || fields === undefined) {
    return argumentsProblem(context, 'needs name=<column> fields=<field>:<column>,…');
  }

  const where = ports.folder();
  if (where === undefined) {
    return refuse('writes only inside a workspace, and this recipe is in none', at(name.range));
  }
  if (where.restricted) {
    return refuse('writes nothing in a restricted folder; trust the folder first', at(name.range));
  }

  const mapping = await readFields(context, fields);
  if (!mapping.ok) return mapping;
  const columns: { readonly field: DeliveryRecordField; readonly column: Column }[] = [];
  for (const [field, written] of mapping.value) {
    const column = resolveColumn(table.value, written, at(fields.range), context.aliases);
    if (!column.ok) return column;
    columns.push({ field, column: column.value });
  }
  const nameColumn = resolveColumn(table.value, name.value, at(name.range), context.aliases);
  if (!nameColumn.ok) return nameColumn;

  const layout = await ports.layout();
  if (!layout.ok) return err(layout.error.map((found) => ({ ...found, range: at(name.range) })));
  const parent = layout.value.parent;
  const inside = [...layout.value.folders];
  if (!inside.includes(DELIVERY_RECORD_FOLDER)) inside.push(DELIVERY_RECORD_FOLDER);

  const refused: string[] = [];
  const operations: PlannedOperation[] = [];
  const stated: RecordWrite[] = [];
  const taken = new Map<string, string>();
  for (const row of table.value.rows) {
    const folderName = deliveryNameOf(cellText(row.values[nameColumn.value.name]));
    if (!folderName.ok) {
      refused.push(`row '${row.key}': ${messages(folderName.error)}`);
      continue;
    }
    const folder = parent === '' ? folderName.value : `${parent}/${folderName.value}`;
    // Folded, since the file systems a workspace lives on mostly ignore case.
    const first = taken.get(folder.toLowerCase());
    if (first !== undefined) {
      refused.push(`row '${row.key}': '${folder}' is row '${first}''s folder too`);
      continue;
    }
    taken.set(folder.toLowerCase(), row.key);
    const incoming = incomingOf(row, columns);
    if (!incoming.ok) {
      refused.push(`row '${row.key}': ${incoming.error}`);
      continue;
    }

    const path = `${folder}/${DELIVERY_RECORD_FOLDER}/${DELIVERY_RECORD_FILE}`;
    const before = await ports.stat(path);
    if (!before.ok) return err(before.error.map((found) => ({ ...found, range: at(name.range) })));
    let onDisk: DeliveryRecord | undefined;
    if (before.value !== undefined) {
      const text = await ports.read(path);
      if (!text.ok) return err(text.error.map((found) => ({ ...found, range: at(name.range) })));
      if (text.value !== undefined) {
        const record = readDeliveryRecord(text.value);
        if (!record.ok) {
          refused.push(`row '${row.key}': ${path} ${record.error}; fix or remove it first`);
          continue;
        }
        onDisk = record.value;
      }
    }
    const merged = mergeDeliveryRecord(onDisk, incoming.value);
    if (!merged.changed) continue;
    const kept =
      merged.kept.length === 0
        ? ''
        : `; kept: ${merged.kept.map((field) => `${field} (edited)`).join(', ')}`;
    const write: RecordWrite = {
      rowKey: row.key,
      folders: [folder, ...inside.map((item) => `${folder}/${item}`)],
      path,
      text: writeDeliveryRecord(merged.record),
      before: before.value ?? null,
    };
    stated.push(write);
    operations.push({
      write: TO_DELIVERY_WRITE,
      rowKey: row.key,
      description: merged.created
        ? `${folder}: new`
        : `${folder}: updates ${merged.updated.join(', ')}${kept}`,
      payload: { path, text: write.text, before: write.before },
    });
  }

  const plan: Plan = {
    target: `deliveries in ${parent === '' ? 'the workspace' : parent}`,
    operations,
    count: operations.length,
  };
  const checked = checkPlan(
    plan,
    { verb: 'to-delivery', writes: [TO_DELIVERY_WRITE], table: table.value },
    TO_DELIVERY_PLAN_LIMITS,
  );
  if (!checked.ok) return checked;
  shownRecords.set(checked.value, stated);
  return ok({
    table: table.value,
    plan: checked.value,
    ...(refused.length === 0 ? {} : { note: refusedNote(refused) }),
  });
}

/** The refused rows, named, so the person sees which rows the plan leaves out and why. */
function refusedNote(refused: readonly string[]): string {
  const named = refused.slice(0, REPORTED).join('; ');
  const more = refused.length - REPORTED;
  return `Refused ${String(refused.length)} of the rows, never rewritten: ${named}${
    more > 0 ? `; and ${String(more)} more` : ''
  }.`;
}

/** One row's mapped values, as the record holds them, or why the record cannot hold them. */
function incomingOf(
  row: Row,
  columns: readonly { readonly field: DeliveryRecordField; readonly column: Column }[],
): Result<Map<DeliveryRecordField, DeliveryFieldValue | undefined>, string> {
  const incoming = new Map<DeliveryRecordField, DeliveryFieldValue | undefined>();
  for (const { field, column } of columns) {
    const text = cellText(row.values[column.name]).trim();
    if (text === '') {
      if (field === 'key') return err(`column '${column.name}' gives no key`);
      incoming.set(field, undefined);
      continue;
    }
    if (field === 'formats') {
      const formats = parseDeliveryFormats(text);
      if (!formats.ok) return err(`column '${column.name}' ${formats.error}`);
      incoming.set(field, formats.value);
    } else if (field === 'due' && !isDeliveryDue(text)) {
      return err(`column '${column.name}' gives '${text}', which is not an ISO date`);
    } else {
      incoming.set(field, text);
    }
  }
  return ok(incoming);
}

/** `fields=key:key,due:due` or `fields=@./fields.json#/task`, as field → column, in order. */
async function readFields(
  context: VerbContext,
  argument: NamedArgument,
): Promise<Result<ReadonlyMap<DeliveryRecordField, string>, readonly Diagnostic[]>> {
  const at = locate(context);
  const problem = (text: string) =>
    err([
      diagnostic(
        'E_RECIPE_ARGUMENTS',
        { verb: context.step.verb, problem: text },
        { range: at(argument.range) },
      ),
    ]);
  const refuseField = (text: string) =>
    err([diagnostic('E_RECIPE_DELIVERY', { problem: text }, { range: at(argument.range) })]);
  let pairs: [string, string][];
  if (isDataReference(argument.value)) {
    const read = await readDataArgument(context, argument, FIELD_MAP);
    if (!read.ok) return read;
    pairs = Object.entries(read.value);
  } else {
    pairs = [];
    for (const entry of argument.value.split(',')) {
      const [field, column, ...rest] = entry.split(':').map((part) => part.trim());
      if (
        field === undefined ||
        field === '' ||
        column === undefined ||
        column === '' ||
        rest.length > 0
      ) {
        return problem(`reads fields as <field>:<column>, and '${entry.trim()}' is not one`);
      }
      pairs.push([field, column]);
    }
  }
  const mapping = new Map<DeliveryRecordField, string>();
  for (const [field, column] of pairs) {
    if (field === 'state') return refuseField("never writes 'state', which is the person's");
    if (!isRecordField(field)) {
      return refuseField(
        `has no field '${field}'; a record has ${DELIVERY_RECORD_FIELDS.join(', ')}`,
      );
    }
    if (mapping.has(field)) return problem(`fills the field '${field}' twice`);
    mapping.set(field, column);
  }
  if (!mapping.has('key')) return problem("needs the field 'key', the tracker's key");
  return ok(mapping);
}

function isRecordField(field: string): field is DeliveryRecordField {
  return (DELIVERY_RECORD_FIELDS as readonly string[]).includes(field);
}

/**
 * Apply (ADR 0170): the records of a plan a `to-delivery` answered, written one by one, each
 * after its folders. A folder in no workspace or restricted since the plan refuses the whole
 * Apply before any write. A record whose digest is not the one the plan read changed since, and
 * that write fails while the others still run: the person approved the merge they saw.
 */
async function applyDeliveries(
  plan: Plan,
  ports: ToDeliveryPorts | undefined,
): Promise<Result<ApplyOutcome, readonly Diagnostic[]>> {
  const refuseApply = (problem: string) =>
    err([diagnostic('E_RECIPE_APPLY', { verb: 'to-delivery', problem })]);
  const shown = shownRecords.get(plan);
  if (shown === undefined) {
    return refuseApply('no to-delivery answered that plan in this session; run its cell again');
  }
  if (ports === undefined) return refuseApply('this host writes no deliveries');
  const where = ports.folder();
  if (where === undefined) return refuseApply('the recipe is in no workspace any more');
  if (where.restricted) return refuseApply('its folder is restricted; trust it first');

  const now = ports.now ?? (() => new Date().toISOString());
  const operations: AppliedOperation[] = [];
  for (const write of shown) {
    const failed = (reason: string): AppliedOperation => ({
      rowKey: write.rowKey,
      status: 'failed',
      reason,
    });
    const current = await ports.stat(write.path);
    if (!current.ok) {
      operations.push(failed(`could not read ${write.path}: ${messages(current.error)}`));
      continue;
    }
    if ((current.value ?? null) !== write.before) {
      operations.push(failed(`${write.path} changed since the plan`));
      continue;
    }
    const made = await makeAll(ports, write.folders);
    if (made !== undefined) {
      operations.push(failed(made));
      continue;
    }
    const written = await ports.write(write.path, write.text);
    operations.push(
      written.ok
        ? { rowKey: write.rowKey, status: 'applied', appliedAt: now() }
        : failed(`could not write ${write.path}: ${messages(written.error)}`),
    );
  }
  return ok({ operations });
}

async function makeAll(
  ports: ToDeliveryPorts,
  folders: readonly string[],
): Promise<string | undefined> {
  for (const folder of folders) {
    const made = await ports.make(folder);
    if (!made.ok) return `could not make ${folder}: ${messages(made.error)}`;
  }
  return undefined;
}

function messages(found: readonly Diagnostic[]): string {
  return found.map((item) => item.message.replace(/\.$/u, '')).join('; ') || 'no reason given';
}
