import { z } from 'zod';

import { type Result, err, ok } from '../result/result.js';

/**
 * A delivery's record (TYTO-755, ADR 0210): what a delivery folder is for when no brief says it.
 * A creative piece made in another program has no brief, so the record is the folder's identity:
 * the tracker key and link, the formats it owes and how many of each, the file-name stem, where
 * its copy comes from, the due date and where it ships.
 *
 * It lives at `<delivery>/editaveis/delivery.json`. A recipe writes it (`to-delivery`) and a
 * person may edit it; **a field the person edited is never written over**. The record keeps,
 * under `written`, the value the recipe last wrote for each field: a field whose value on disk is
 * still that one takes the new value, and one that differs was edited and is kept. That base is
 * what lets a due date changed in the tracker still reach a record nobody touched.
 *
 * `state` is the person's: the recipe never writes it unless the recipe declares it inbound
 * (ADR 0211). A key the schema does not know is kept as it was, so a record a newer Tyto or a
 * person extended survives this one.
 */

export const DELIVERY_RECORD_VERSION = 1;

/** The record's folder inside the delivery, and its file. */
export const DELIVERY_RECORD_FOLDER = 'editaveis';
export const DELIVERY_RECORD_FILE = 'delivery.json';

/** The fields a recipe may write, in the order a new record holds them. */
export const DELIVERY_RECORD_FIELDS = [
  'key',
  'link',
  'formats',
  'stem',
  'copy',
  'due',
  'ship',
] as const;

export type DeliveryRecordField = (typeof DELIVERY_RECORD_FIELDS)[number];

/**
 * The fields a recipe may bring into a record: the ones it maps, and `state` when the recipe
 * declares it inbound (ADR 0211), in the order a new record holds them.
 */
export const DELIVERY_WRITABLE_FIELDS = [...DELIVERY_RECORD_FIELDS, 'state'] as const;

export type DeliveryWritableField = (typeof DELIVERY_WRITABLE_FIELDS)[number];

/**
 * Who wins a declared inbound field when both the record and the outside value changed since
 * the last run (ADR 0211): the record in the folder, or the row the recipe brings.
 */
export type DeliveryInboundWinner = 'record' | 'row';

/** The fields a recipe declared inbound, each with the side that wins when both changed. */
export type DeliveryInboundWinners = ReadonlyMap<DeliveryWritableField, DeliveryInboundWinner>;

/** A declared inbound field both sides changed: who won, and the value that lost. */
export interface DeliveryConflict {
  readonly field: DeliveryWritableField;
  readonly winner: DeliveryInboundWinner;
  /** The value that did not enter: the record's when the row wins, the row's otherwise. */
  readonly lost: DeliveryFieldValue | null;
}

export interface DeliveryFormatCount {
  readonly format: string;
  readonly count: number;
}

/** A field's value as the record holds it; `null` in the base stands for a field not written. */
export type DeliveryFieldValue = string | readonly DeliveryFormatCount[];

const FORMAT_NAME = /^[A-Za-z0-9][\w-]*$/u;

/** `2026-11-17`, or a full ISO 8601 time with its offset. */
const isoDue = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

const formatCount = z.object({
  format: z.string().regex(FORMAT_NAME),
  count: z.number().int().positive(),
});

export const deliveryRecordSchema = z.looseObject({
  version: z.literal(DELIVERY_RECORD_VERSION),
  key: z.string().min(1),
  link: z.string().optional(),
  formats: z.array(formatCount).optional(),
  stem: z.string().optional(),
  copy: z.string().optional(),
  due: isoDue.optional(),
  ship: z.string().optional(),
  state: z.string().optional(),
  written: z.record(z.string(), z.unknown()).optional(),
});

export type DeliveryRecord = z.infer<typeof deliveryRecordSchema>;

/** Whether `text` is a due date the record accepts. */
export function isDeliveryDue(text: string): boolean {
  return isoDue.safeParse(text).success;
}

/**
 * `feed:3,story:1` as the formats a delivery owes, in the order written. A format without a
 * count owes one. An empty text owes none, and answers an empty list.
 */
export function parseDeliveryFormats(text: string): Result<DeliveryFormatCount[], string> {
  const formats: DeliveryFormatCount[] = [];
  if (text.trim() === '') return ok(formats);
  for (const entry of text.split(',')) {
    const [format = '', count, ...rest] = entry.split(':').map((part) => part.trim());
    const number = count === undefined ? 1 : Number(count);
    if (
      !FORMAT_NAME.test(format) ||
      rest.length > 0 ||
      !Number.isInteger(number) ||
      number < 1 ||
      (count !== undefined && !/^\d+$/u.test(count))
    ) {
      return err(`reads formats as <format>:<count>, and '${entry.trim()}' is not one`);
    }
    if (formats.some((item) => item.format === format)) {
      return err(`names the format '${format}' twice`);
    }
    formats.push({ format, count: number });
  }
  return ok(formats);
}

/** Formats as a cell writes them, `feed:3,story:1`, which `parseDeliveryFormats` reads back. */
export function deliveryFormatsText(formats: readonly DeliveryFormatCount[]): string {
  return formats.map(({ format, count }) => `${format}:${String(count)}`).join(',');
}

/** A record read from disk: the file's text as a record, or why it is not one. */
export function readDeliveryRecord(text: string): Result<DeliveryRecord, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err('is not JSON');
  }
  const checked = deliveryRecordSchema.safeParse(parsed);
  if (checked.success) return ok(checked.data);
  const [issue] = checked.error.issues;
  const where = issue === undefined || issue.path.length === 0 ? '' : `${issue.path.join('.')}: `;
  return err(`is not a delivery record (${where}${issue?.message ?? 'unknown shape'})`);
}

/** The text a record is written as: two-space JSON and a final newline. */
export function writeDeliveryRecord(record: DeliveryRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * What a recipe brings for one delivery: the fields it maps, each with the row's value, or
 * `undefined` for an empty cell, which leaves the field out of a new record.
 */
export type IncomingDeliveryFields = ReadonlyMap<
  DeliveryWritableField,
  DeliveryFieldValue | undefined
>;

export interface DeliveryRecordMerge {
  /** The record to write; the one on disk, unchanged, when nothing changes. */
  readonly record: DeliveryRecord;
  /** True when no record was on disk. */
  readonly created: boolean;
  /** The fields the recipe changes, in the order it maps them. */
  readonly updated: readonly DeliveryWritableField[];
  /** The fields a person edited since the recipe last wrote them, which keep the person's value. */
  readonly kept: readonly DeliveryWritableField[];
  /** Declared inbound fields both sides changed, each settled by its winner (ADR 0211). */
  readonly conflicts: readonly DeliveryConflict[];
  /**
   * Declared inbound fields whose value stays and whose base alone moves to the outside value:
   * the record already agrees with it, or the record won a conflict.
   */
  readonly based: readonly DeliveryWritableField[];
  /** Whether the file must be written at all. */
  readonly changed: boolean;
}

/**
 * The three-way merge of a record on disk with what a recipe brings now, the base being what the
 * recipe last wrote (`written`). For each field the recipe maps:
 *
 * - the value on disk is already the new one: nothing to do;
 * - the value on disk is the base: nobody edited it, so it takes the new value, and so does the base;
 * - otherwise a person edited it, and it is kept.
 *
 * A field with no base counts as last written empty, so a field a person filled by hand before
 * the recipe mapped it is theirs. Fields the recipe does not map, `state`, and keys the schema
 * does not know are left as they are.
 *
 * **A declared inbound field (ADR 0211)** is one whose value may come back from outside, a
 * sheet's status say, and `winners` names the side that wins it. Its base is the last value that
 * came from outside, **whether or not it entered**, so a conflict is settled once:
 *
 * - the record already holds the outside value: it stays, and the base catches up;
 * - the record is the base: the outside value enters;
 * - the outside value is the base: the record moved alone, and is kept;
 * - neither: both changed, the winner decides, and the merge names the conflict. When the
 *   record wins, the base still moves to the outside value, so the next run sees nothing new.
 */
export function mergeDeliveryRecord(
  onDisk: DeliveryRecord | undefined,
  incoming: IncomingDeliveryFields,
  winners: DeliveryInboundWinners = new Map(),
): DeliveryRecordMerge {
  if (onDisk === undefined) {
    const record: Record<string, unknown> = { version: DELIVERY_RECORD_VERSION };
    const written: Record<string, unknown> = {};
    for (const field of DELIVERY_WRITABLE_FIELDS) {
      if (!incoming.has(field)) continue;
      const value = incoming.get(field);
      if (value !== undefined) record[field] = value;
      written[field] = value ?? null;
    }
    record['written'] = written;
    return {
      record: record as DeliveryRecord,
      created: true,
      updated: [...incoming.keys()],
      kept: [],
      conflicts: [],
      based: [],
      changed: true,
    };
  }

  const disk = onDisk as Readonly<Record<string, unknown>>;
  const base: Record<string, unknown> = { ...(onDisk.written ?? {}) };
  const values = new Map<string, unknown>();
  const updated: DeliveryWritableField[] = [];
  const kept: DeliveryWritableField[] = [];
  const conflicts: DeliveryConflict[] = [];
  const based: DeliveryWritableField[] = [];
  for (const [field, value] of incoming) {
    const next = value ?? null;
    const current = disk[field] ?? null;
    const last = base[field] ?? null;
    const enter = () => {
      values.set(field, next);
      base[field] = next;
      updated.push(field);
    };
    const moveBase = () => {
      base[field] = next;
      based.push(field);
    };
    const winner = winners.get(field);
    if (winner === undefined) {
      if (same(current, next)) continue;
      if (same(current, last)) enter();
      else kept.push(field);
      continue;
    }
    if (same(current, next)) {
      if (!same(last, next)) moveBase();
    } else if (same(current, last)) {
      enter();
    } else if (same(next, last)) {
      kept.push(field);
    } else if (winner === 'row') {
      conflicts.push({ field, winner, lost: current as DeliveryFieldValue | null });
      enter();
    } else {
      conflicts.push({ field, winner, lost: next });
      moveBase();
    }
  }
  if (updated.length === 0 && based.length === 0) {
    return { record: onDisk, created: false, updated, kept, conflicts, based, changed: false };
  }

  // The disk's own order, a new field before `written`, which stays last.
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(disk)) {
    if (key === 'written') continue;
    if (!values.has(key)) {
      record[key] = value;
      continue;
    }
    const next = values.get(key);
    if (next !== null) record[key] = next;
  }
  for (const [key, value] of values) {
    if (!(key in disk) && value !== null) record[key] = value;
  }
  record['written'] = base;
  return {
    record: record as DeliveryRecord,
    created: false,
    updated,
    kept,
    conflicts,
    based,
    changed: true,
  };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
