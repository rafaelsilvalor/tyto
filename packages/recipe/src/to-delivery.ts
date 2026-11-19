import {
  DELIVERY_COPY_FILE,
  DELIVERY_RECORD_FIELDS,
  DELIVERY_RECORD_FILE,
  DELIVERY_RECORD_FOLDER,
  DELIVERY_WRITABLE_FIELDS,
  type DeliveryFieldName,
  type DeliveryFieldValue,
  type DeliveryImage,
  type DeliveryInboundWinner,
  type DeliveryInboundWinners,
  type DeliveryRecord,
  type DeliveryRecordMerge,
  type Diagnostic,
  type Result,
  type Size,
  type SourceRange,
  declaredFieldProblem,
  deliveryCopyText,
  deliveryFileBase,
  deliveryFormatsText,
  deliveryNameOf,
  diagnostic,
  err,
  isDeclaredFieldMap,
  isDeliveryDue,
  mergeDeliveryRecord,
  nearFixedField,
  ok,
  parseDeliveryFormats,
  readDeliveryRecord,
  withDeliveryFileBase,
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
 *
 * `inbound=<field>:<winner>,…` (ADR 0211) declares the fields an outside value may change, a
 * sheet's status say, each with the side that wins when both the record and the row changed
 * since the last run: `record` or `row`. The winner is required. `state` may be mapped only when
 * it is declared inbound, and every inbound field must be mapped in `fields=`.
 *
 * `keep=<field>,…` (ADR 0211, note of 2026-11-17) names mapped fields whose empty cell leaves the
 * record's value, and its base, as they are, instead of clearing it: a source that goes blank,
 * an orphan link say. The step's note names every value so kept, on every run, and a plan line
 * written for another reason says `kept: copy (source empty)`. Never `key`, never an inbound field.
 *
 * A name in `fields=` that is not a fixed field is a **declared field** (ADR 0213): text, kept in
 * the record's `fields` map with its own base, read back by `deliveries` as a column. It is
 * lowercase letters, digits, `_` and `-`, and never a column `deliveries` already gives
 * (`folder`, `path` and the fixed fields). A name two edits from a fixed field's is declared all
 * the same, with a warning naming the field it may have meant. `keep=` and `inbound=` take
 * declared fields as they take fixed ones.
 *
 * `create=no` (ADR 0213) writes only into delivery folders that already exist: a row whose
 * folder is not there plans nothing, and the note names it. `create=yes`, the default, makes it.
 *
 * `copy-text=<column>` (ADR 0217) also keeps each delivery's copy in `editaveis/copy.md`: the
 * record's `copy` as a `Source:` line on top, then the cell's text as it is, Markdown or plain.
 * The record keeps the digest of the copy it wrote in `written.files`, so a copy a person edited
 * since is **kept, never overwritten**, and the plan's note names it on every run. A copy file
 * that is missing is written again; an empty cell leaves the file alone.
 */
export interface ToDeliveryPorts {
  /**
   * Whether the running recipe is in a workspace and whether that workspace is restricted,
   * asked on every run and every Apply. `undefined` when it is in no workspace.
   */
  folder(): DeliveryPlace | undefined;
  /** The project's delivery layout as it reads now, relative to the workspace. */
  layout(): Promise<Result<DeliveryLayout, readonly Diagnostic[]>>;
  /**
   * The folders directly inside a workspace folder, by name, each with its record's text
   * (`editaveis/delivery.json`) when it has one, which `deliveries` reads back as rows
   * (ADR 0211). Hidden folders and `.tyto` are not listed. A folder the host may not read, a
   * link out of the workspace say, comes back with the reason instead of its record.
   *
   * Given `exports`, the layout's exports folder relative to each delivery, a folder with a
   * record also comes with the images at that folder's root and how many editables sit beside
   * the record, which `deliveries` checks the record against (ADR 0215).
   */
  list(
    parent: string,
    exports?: string,
  ): Promise<Result<readonly DeliveryListing[], readonly Diagnostic[]>>;
  /** A file's text at a workspace path, or `undefined` when there is none. */
  read(path: string): Promise<Result<string | undefined, readonly Diagnostic[]>>;
  /** A digest of the file at a workspace path, of the host's choice; `undefined` when absent. */
  stat(path: string): Promise<Result<string | undefined, readonly Diagnostic[]>>;
  /** Makes a folder at a workspace path, and the ones above it; one already there is fine. */
  make(path: string): Promise<Result<void, readonly Diagnostic[]>>;
  /** Writes the file. The host confines the path to the workspace again. */
  write(path: string, text: string): Promise<Result<void, readonly Diagnostic[]>>;
  /**
   * Renames a file inside one workspace folder (ADR 0218), both paths relative to the workspace.
   * The host confines both, and refuses when `to` is taken by another file: a name that differs
   * from `from` only in case is the same file. A host without it renames nothing:
   * `rename-exports` stops the step.
   */
  rename?(from: string, to: string): Promise<Result<void, readonly Diagnostic[]>>;
  /** The host's clock as ISO 8601 in UTC, which stamps an applied write; the system's if absent. */
  now?(): string;
  /**
   * The digest `stat` would answer for a file holding exactly this text, as UTF-8 (ADR 0217).
   * A host without it keeps no copy file: `copy-text=` stops the step.
   */
  digest?(text: string): string;
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
  /** `delivery.exports`, relative to each delivery; `.` is its root. The root when absent. */
  readonly exports?: string;
  /**
   * The pixel size each format name is checked at (ADR 0215): `delivery.sizes` over the host's
   * format catalogue. None known when absent.
   */
  readonly sizes?: Readonly<Record<string, Size>>;
}

export interface DeliveryListing {
  /** The folder's name. */
  readonly name: string;
  /** The folder, relative to the workspace and `/`-separated. */
  readonly path: string;
  /** The record's text; absent when the folder has no record. */
  readonly record?: string;
  /** Why the folder could not be read; absent when it could. */
  readonly problem?: string;
  /** The images at the root of its exports folder, when `list` was given one (ADR 0215). */
  readonly images?: readonly DeliveryImage[];
  /** How many files besides the record sit in the record's folder, beside `images`. */
  readonly editables?: number;
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

const NAMES = ['name', 'fields', 'inbound', 'keep', 'create', 'copy-text'] as const;

/** What the plan and its note call the copy file. */
const COPY_NAME = 'copy.md';
const FIELD_MAP = z.record(z.string(), z.string());
const WINNERS: readonly DeliveryInboundWinner[] = ['record', 'row'];

/** One record of a shown plan, as Apply writes it. */
interface RecordWrite {
  readonly rowKey: string;
  /** The folders to make first, the delivery's own first; relative to the workspace. */
  readonly folders: readonly string[];
  readonly path: string;
  readonly text: string;
  /** The digest the record had when the plan was made; `null` when there was none. */
  readonly before: string | null;
  /** The copy file to write before the record (ADR 0217), when the row's copy changed. */
  readonly copy?: CopyWrite;
}

/** One copy file of a shown plan, written before the record that remembers its digest. */
interface CopyWrite {
  readonly path: string;
  readonly text: string;
  /** The digest the copy file had when the plan was made; `null` when there was none. */
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
  const { name, fields, inbound, keep, create } = argument;
  const copyText = argument['copy-text'];
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

  if (create !== undefined && create.value !== 'yes' && create.value !== 'no') {
    return argumentProblem(
      context,
      create,
      `reads create= as yes or no, and '${create.value}' is neither`,
    );
  }
  const creates = create?.value !== 'no';
  const winners = inbound === undefined ? ok(new Map()) : await readInbound(context, inbound);
  if (!winners.ok) return winners;
  const mapping = await readFields(context, fields, winners.value);
  if (!mapping.ok) return mapping;
  const kept =
    keep === undefined
      ? ok(new Set<DeliveryFieldName>())
      : readKeep(context, keep, mapping.value, winners.value);
  if (!kept.ok) return kept;
  const declares = [...mapping.value.keys()].some((field) => !isWritableField(field));
  const columns: { readonly field: DeliveryFieldName; readonly column: Column }[] = [];
  for (const [field, written] of mapping.value) {
    const column = resolveColumn(table.value, written, at(fields.range), context.aliases);
    if (!column.ok) return column;
    columns.push({ field, column: column.value });
  }
  const nameColumn = resolveColumn(table.value, name.value, at(name.range), context.aliases);
  if (!nameColumn.ok) return nameColumn;
  let copyColumn: Column | undefined;
  if (copyText !== undefined) {
    if (ports.digest === undefined) {
      return refuse('cannot keep a copy file: this host gives no digest', at(copyText.range));
    }
    const column = resolveColumn(table.value, copyText.value, at(copyText.range), context.aliases);
    if (!column.ok) return column;
    copyColumn = column.value;
  }

  const layout = await ports.layout();
  if (!layout.ok) return err(layout.error.map((found) => ({ ...found, range: at(name.range) })));
  const parent = layout.value.parent;
  const inside = [...layout.value.folders];
  if (!inside.includes(DELIVERY_RECORD_FOLDER)) inside.push(DELIVERY_RECORD_FOLDER);
  // Under create=no, the folders already there, read once: a row whose folder is missing plans
  // nothing. Folded, as `taken` is, since the file systems a workspace lives on mostly ignore case.
  let existing: ReadonlySet<string> | undefined;
  if (!creates) {
    const listed = await ports.list(parent);
    if (!listed.ok) return err(listed.error.map((found) => ({ ...found, range: at(name.range) })));
    existing = new Set(listed.value.map((entry) => entry.name.toLowerCase()));
  }

  const refused: string[] = [];
  const skipped: string[] = [];
  const held: string[] = [];
  const edited: string[] = [];
  let heldValues = 0;
  const operations: PlannedOperation[] = [];
  const stated: RecordWrite[] = [];
  const taken = new Map<string, string>();
  for (const row of table.value.rows) {
    const folderName = deliveryNameOf(cellText(row.values[nameColumn.value.name]));
    if (!folderName.ok) {
      refused.push(`row '${row.key}': ${messages(folderName.error)}`);
      continue;
    }
    if (existing !== undefined && !existing.has(folderName.value.toLowerCase())) {
      skipped.push(`'${row.key}'`);
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
        const fieldsOnDisk = record.value.fields;
        if (declares && fieldsOnDisk !== undefined && !isDeclaredFieldMap(fieldsOnDisk)) {
          refused.push(
            `row '${row.key}': ${path} holds a 'fields' that is not a map of text, where declared fields go; fix or remove it first`,
          );
          continue;
        }
        onDisk = record.value;
      }
    }
    const merged = mergeDeliveryRecord(onDisk, incoming.value, winners.value, kept.value);
    if (merged.held.length > 0) {
      held.push(`row '${row.key}' ${merged.held.join(', ')}`);
      heldValues += merged.held.length;
    }
    let record = merged.record;
    const parts = merged.changed ? [describeMerge(merged)] : [];
    let copy: CopyWrite | undefined;
    const text = copyColumn === undefined ? '' : cellText(row.values[copyColumn.name]).trim();
    if (text !== '' && ports.digest !== undefined) {
      const planned = await planCopy(ports.digest, ports, folder, onDisk, record, text);
      if (!planned.ok) {
        return err(planned.error.map((found) => ({ ...found, range: at(name.range) })));
      }
      if (planned.value.state === 'edited') {
        edited.push(`'${folder}'`);
        parts.push(`kept: ${COPY_NAME} (edited since the last run)`);
      } else if (planned.value.state !== 'same') {
        record = planned.value.record;
        copy = planned.value.write;
        parts.push(planned.value.says);
      }
    }
    if (!merged.changed && record === merged.record) continue;
    const write: RecordWrite = {
      rowKey: row.key,
      folders: [folder, ...inside.map((item) => `${folder}/${item}`)],
      path,
      text: writeDeliveryRecord(record),
      before: before.value ?? null,
      ...(copy === undefined ? {} : { copy }),
    };
    stated.push(write);
    operations.push({
      write: TO_DELIVERY_WRITE,
      rowKey: row.key,
      description: `${folder}: ${parts.join('; ')}`,
      payload: {
        path,
        text: write.text,
        before: write.before,
        ...(copy === undefined ? {} : { copy: { path: copy.path, before: copy.before } }),
      },
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
  const notes = [
    ...(skipped.length === 0 ? [] : [skippedNote(skipped)]),
    ...(held.length === 0 ? [] : [heldNote(held, heldValues)]),
    ...(edited.length === 0 ? [] : [editedNote(edited)]),
    ...(refused.length === 0 ? [] : [refusedNote(refused)]),
  ];
  return ok(
    {
      table: table.value,
      plan: checked.value,
      ...(notes.length === 0 ? {} : { note: notes.join(' ') }),
    },
    nearWarnings(context, fields, mapping.value),
  );
}

/**
 * A warning for each declared field two edits or fewer from a fixed field's (`lnik`, `link`):
 * declared all the same, since a near name may be meant, but never silently.
 */
function nearWarnings(
  context: VerbContext,
  argument: NamedArgument,
  mapping: ReadonlyMap<DeliveryFieldName, string>,
): Diagnostic[] {
  const warnings: Diagnostic[] = [];
  for (const field of mapping.keys()) {
    if (isWritableField(field)) continue;
    const fixed = nearFixedField(field);
    if (fixed === undefined) continue;
    warnings.push(
      diagnostic(
        'W_RECIPE_DELIVERY_FIELD_NEAR',
        { field, fixed },
        { range: locate(context)(argument.range) },
      ),
    );
  }
  return warnings;
}

/** The rows `create=no` left out because their delivery folder does not exist, named. */
function skippedNote(skipped: readonly string[]): string {
  const named = skipped.slice(0, REPORTED).join(', ');
  const more = skipped.length - REPORTED;
  return `Skipped ${String(skipped.length)} ${
    skipped.length === 1 ? 'row' : 'rows'
  } with no delivery folder: ${named}${more > 0 ? `, and ${String(more)} more` : ''}.`;
}

/**
 * The values `keep=` held while their cell came back empty, by row, on every run and whether or
 * not the record is written: the warning that a source went blank.
 */
function heldNote(held: readonly string[], values: number): string {
  const named = held.slice(0, REPORTED).join('; ');
  const more = held.length - REPORTED;
  return `Kept ${String(values)} ${values === 1 ? 'value' : 'values'} whose cell came back empty: ${named}${
    more > 0 ? `; and ${String(more)} more rows` : ''
  }.`;
}

/**
 * The copy files a person edited since the recipe last wrote them, by folder, on every run: kept,
 * never overwritten, so the row's new copy waits until the file is removed or put back.
 */
function editedNote(edited: readonly string[]): string {
  const named = edited.slice(0, REPORTED).join(', ');
  const more = edited.length - REPORTED;
  return `Kept ${String(edited.length)} ${COPY_NAME} ${
    edited.length === 1 ? 'file' : 'files'
  } edited since the last run, never overwritten: ${named}${
    more > 0 ? `, and ${String(more)} more` : ''
  }.`;
}

/** What a row's copy file needs (ADR 0217), and the record that remembers it. */
type PlannedCopy =
  /** The file and its base already hold the row's copy: nothing to do. */
  | { readonly state: 'same' }
  /** A person edited the file since the recipe last wrote it: kept. */
  | { readonly state: 'edited' }
  /** The file already holds the row's copy, and only the base catches up. */
  | {
      readonly state: 'based';
      readonly record: DeliveryRecord;
      readonly says: string;
      readonly write?: undefined;
    }
  /** The file is missing, or still what the recipe wrote: it takes the row's copy. */
  | {
      readonly state: 'write';
      readonly record: DeliveryRecord;
      readonly says: string;
      readonly write: CopyWrite;
    };

/**
 * The three-way rule of a copy file, the base being the digest the recipe last wrote there
 * (`written.files`). A file the recipe never wrote counts as edited, since it is somebody's.
 */
async function planCopy(
  digest: (text: string) => string,
  ports: ToDeliveryPorts,
  folder: string,
  onDisk: DeliveryRecord | undefined,
  record: DeliveryRecord,
  copy: string,
): Promise<Result<PlannedCopy, readonly Diagnostic[]>> {
  const path = `${folder}/${DELIVERY_COPY_FILE}`;
  const text = deliveryCopyText(record.copy, copy);
  const next = digest(text);
  const current = await ports.stat(path);
  if (!current.ok) return current;
  const base = deliveryFileBase(onDisk, DELIVERY_COPY_FILE);
  if (current.value === next) {
    if (base === next) return ok({ state: 'same' });
    return ok({
      state: 'based',
      record: withDeliveryFileBase(record, DELIVERY_COPY_FILE, next),
      says: `${COPY_NAME} already holds the copy`,
    });
  }
  if (current.value === undefined || current.value === base) {
    return ok({
      state: 'write',
      record: withDeliveryFileBase(record, DELIVERY_COPY_FILE, next),
      says: `${COPY_NAME} ${current.value === undefined ? 'new' : 'replaced'}`,
      write: { path, text, before: current.value ?? null },
    });
  }
  return ok({ state: 'edited' });
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
  columns: readonly { readonly field: DeliveryFieldName; readonly column: Column }[],
): Result<Map<DeliveryFieldName, DeliveryFieldValue | undefined>, string> {
  const incoming = new Map<DeliveryFieldName, DeliveryFieldValue | undefined>();
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

/** A problem with an argument's shape, at the argument. */
function argumentProblem(context: VerbContext, argument: NamedArgument, text: string) {
  return err([
    diagnostic(
      'E_RECIPE_ARGUMENTS',
      { verb: context.step.verb, problem: text },
      { range: locate(context)(argument.range) },
    ),
  ]);
}

/** A field the record will not take from a recipe, at the argument. */
function fieldRefused(context: VerbContext, argument: NamedArgument, text: string) {
  return err([
    diagnostic('E_RECIPE_DELIVERY', { problem: text }, { range: locate(context)(argument.range) }),
  ]);
}

/**
 * `<name>:<value>,…` or `@./file.json#/pointer`, as pairs in order. A pair written without its
 * value has `''` there, for the caller to name; `reads` says what the pairs are.
 */
async function readPairs(
  context: VerbContext,
  argument: NamedArgument,
  reads: string,
): Promise<Result<[string, string][], readonly Diagnostic[]>> {
  if (isDataReference(argument.value)) {
    const read = await readDataArgument(context, argument, FIELD_MAP);
    if (!read.ok) return read;
    return ok(Object.entries(read.value).map(([name, value]) => [name, value.trim()]));
  }
  const pairs: [string, string][] = [];
  for (const entry of argument.value.split(',')) {
    const [name, value = '', ...rest] = entry.split(':').map((part) => part.trim());
    if (name === undefined || name === '' || rest.length > 0) {
      return argumentProblem(context, argument, `reads ${reads}, and '${entry.trim()}' is not one`);
    }
    pairs.push([name, value]);
  }
  return ok(pairs);
}

/**
 * `inbound=state:row,due:record` or `inbound=@./fields.json#/inbound` (ADR 0211), as field →
 * winner. The winner is required: no rule decides it for the recipe.
 */
async function readInbound(
  context: VerbContext,
  argument: NamedArgument,
): Promise<Result<Map<DeliveryFieldName, DeliveryInboundWinner>, readonly Diagnostic[]>> {
  const pairs = await readPairs(context, argument, 'inbound fields as <field>:<winner>');
  if (!pairs.ok) return pairs;
  const winners = new Map<DeliveryFieldName, DeliveryInboundWinner>();
  for (const [field, winner] of pairs.value) {
    const problem = isWritableField(field) ? undefined : declaredFieldProblem(field);
    if (problem !== undefined) {
      return fieldRefused(context, argument, `cannot take a field inbound: ${problem}`);
    }
    if (field === 'key') {
      return fieldRefused(context, argument, "never takes 'key' inbound: it names the delivery");
    }
    if (winner === '') {
      return argumentProblem(
        context,
        argument,
        `gives no winner for the inbound field '${field}'; write ${field}:record or ${field}:row`,
      );
    }
    if (!(WINNERS as readonly string[]).includes(winner)) {
      return argumentProblem(
        context,
        argument,
        `reads the winner of '${field}' as record or row, and '${winner}' is neither`,
      );
    }
    if (winners.has(field)) {
      return argumentProblem(context, argument, `declares '${field}' inbound twice`);
    }
    winners.set(field, winner as DeliveryInboundWinner);
  }
  return ok(winners);
}

/** `fields=key:key,due:due` or `fields=@./fields.json#/task`, as field → column, in order. */
async function readFields(
  context: VerbContext,
  argument: NamedArgument,
  winners: DeliveryInboundWinners,
): Promise<Result<ReadonlyMap<DeliveryFieldName, string>, readonly Diagnostic[]>> {
  const pairs = await readPairs(context, argument, 'fields as <field>:<column>');
  if (!pairs.ok) return pairs;
  const mapping = new Map<DeliveryFieldName, string>();
  for (const [field, column] of pairs.value) {
    if (column === '') {
      return argumentProblem(
        context,
        argument,
        `reads fields as <field>:<column>, and '${field}' is not one`,
      );
    }
    if (field === 'state' && !winners.has('state')) {
      return fieldRefused(context, argument, "never writes 'state', which is the person's");
    }
    const problem = isWritableField(field) ? undefined : declaredFieldProblem(field);
    if (problem !== undefined) {
      return fieldRefused(
        context,
        argument,
        `cannot declare a field: ${problem}; the fixed fields are ${DELIVERY_RECORD_FIELDS.join(', ')}`,
      );
    }
    if (mapping.has(field)) {
      return argumentProblem(context, argument, `fills the field '${field}' twice`);
    }
    mapping.set(field, column);
  }
  if (!mapping.has('key')) {
    return argumentProblem(context, argument, "needs the field 'key', the tracker's key");
  }
  for (const field of winners.keys()) {
    if (!mapping.has(field)) {
      return argumentProblem(
        context,
        argument,
        `declares '${field}' inbound but does not map it; add ${field}:<column>`,
      );
    }
  }
  return ok(mapping);
}

/**
 * `keep=copy,link`: the mapped fields whose empty cell keeps the record's value. Never `key`,
 * which names the delivery, and never a field declared inbound, whose base means something else.
 */
function readKeep(
  context: VerbContext,
  argument: NamedArgument,
  mapping: ReadonlyMap<DeliveryFieldName, string>,
  winners: DeliveryInboundWinners,
): Result<Set<DeliveryFieldName>, readonly Diagnostic[]> {
  const kept = new Set<DeliveryFieldName>();
  for (const entry of argument.value.split(',')) {
    const field = entry.trim();
    if (field === '') {
      return argumentProblem(context, argument, 'reads fields as <field>,…, and one is empty');
    }
    const problem = isWritableField(field) ? undefined : declaredFieldProblem(field);
    if (problem !== undefined) {
      return fieldRefused(context, argument, `cannot keep a field: ${problem}`);
    }
    if (field === 'key') {
      return fieldRefused(context, argument, "never keeps 'key': a row without one is refused");
    }
    if (winners.has(field)) {
      return fieldRefused(
        context,
        argument,
        `cannot keep '${field}', which is declared inbound; name it in keep= or inbound=, not both`,
      );
    }
    if (!mapping.has(field)) {
      return argumentProblem(
        context,
        argument,
        `keeps '${field}' but does not map it; add ${field}:<column> to fields=`,
      );
    }
    if (kept.has(field)) {
      return argumentProblem(context, argument, `keeps '${field}' twice`);
    }
    kept.add(field);
  }
  return ok(kept);
}

/** A fixed field; any other name a recipe maps is a declared one (ADR 0213). */
function isWritableField(field: string): boolean {
  return (DELIVERY_WRITABLE_FIELDS as readonly string[]).includes(field);
}

/**
 * What the plan says of one folder: `new`, the fields it updates, those it keeps as a person's
 * edit, and how each inbound field both sides changed was settled (ADR 0211), e.g.
 * `updates state (both changed; row wins over 'doing')`.
 */
function describeMerge(merged: DeliveryRecordMerge): string {
  if (merged.created) return 'new';
  const settled = (field: DeliveryFieldName) => {
    const conflict = merged.conflicts.find((found) => found.field === field);
    return conflict === undefined
      ? field
      : `${field} (both changed; ${conflict.winner} wins over ${quoted(conflict.lost)})`;
  };
  const parts: string[] = [];
  if (merged.updated.length > 0) parts.push(`updates ${merged.updated.map(settled).join(', ')}`);
  const keeps = merged.based.filter((field) =>
    merged.conflicts.some((found) => found.field === field),
  );
  if (keeps.length > 0) parts.push(`keeps ${keeps.map(settled).join(', ')}`);
  const agreed = merged.based.filter((field) => !keeps.includes(field));
  if (agreed.length > 0) parts.push(`already holds ${agreed.join(', ')} from the row`);
  const held = [
    ...merged.kept.map((field) => `${field} (edited)`),
    ...merged.held.map((field) => `${field} (source empty)`),
  ];
  if (held.length > 0) parts.push(`kept: ${held.join(', ')}`);
  return parts.join('; ');
}

function quoted(value: DeliveryFieldValue | null): string {
  if (value === null) return 'an empty value';
  return `'${typeof value === 'string' ? value : deliveryFormatsText(value)}'`;
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
    if (write.copy !== undefined) {
      const copyNow = await ports.stat(write.copy.path);
      if (!copyNow.ok) {
        operations.push(failed(`could not read ${write.copy.path}: ${messages(copyNow.error)}`));
        continue;
      }
      if ((copyNow.value ?? null) !== write.copy.before) {
        operations.push(failed(`${write.copy.path} changed since the plan`));
        continue;
      }
    }
    const made = await makeAll(ports, write.folders);
    if (made !== undefined) {
      operations.push(failed(made));
      continue;
    }
    // The copy before the record that remembers its digest: a copy that fails leaves the record
    // as it was, and the next run plans the same write again.
    if (write.copy !== undefined) {
      const copied = await ports.write(write.copy.path, write.copy.text);
      if (!copied.ok) {
        operations.push(failed(`could not write ${write.copy.path}: ${messages(copied.error)}`));
        continue;
      }
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
