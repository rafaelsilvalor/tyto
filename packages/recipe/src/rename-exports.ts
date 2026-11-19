import {
  type DeliveryFormatCount,
  type Diagnostic,
  type Result,
  type SourceRange,
  deliveryExportNames,
  diagnostic,
  err,
  ok,
  readDeliveryRecord,
} from '@tyto/core';

import type { NamedArgument } from './ast.js';
import { resolveColumn } from './columns.js';
import { type Plan, type PlannedOperation, checkPlan } from './plan.js';
import type { Verb, VerbContext, VerbResult } from './registry.js';
import type { AppliedOperation, ApplyOutcome } from './state.js';
import { argumentsProblem, locate, refuseNamed, requireTable } from './support.js';
import { cellText } from './table.js';
import {
  type DeliveryListing,
  TO_DELIVERY_PLAN_LIMITS,
  type ToDeliveryPorts,
} from './to-delivery.js';

/**
 * `rename-exports stem=<column> [digits=2] [path=<column>]` (ADR 0218): a sink that renames the
 * images in each delivery's exports folder to the names they ship under, `<stem>-01.png`,
 * `<stem>-02.png`…, numbered in the record's order of formats (`deliveryExportNames` in `core`).
 *
 * The rows are deliveries, as `deliveries` gives them: `path=` is the column holding each
 * delivery's folder relative to the workspace, `path` by default (`record_path` after
 * `with-deliveries`). `stem=` is the column holding each one's file-name stem, the record's
 * `stem` say, or a declared field.
 *
 * Running it renames nothing: it answers a plan of one `rename` per file whose name changes,
 * `<folder>: feed.png → mca-1-01.png`. A file that already has its name has no operation, so a
 * second run plans none. A delivery it cannot rename (no record, an empty stem, more images than
 * the digits number) is refused in the cell's note, and the others still plan.
 *
 * Apply renames exactly what the plan showed, a delivery at a time: every file it names must
 * still hold the bytes the plan read, and every new name must be free or one of the files being
 * renamed, or the whole delivery fails and nothing of it is renamed. When a new name is another
 * file's old one (two files swap their numbers), the files go through a hidden name first.
 */

/**
 * A rename a `rename-exports` plan holds, both paths relative to the workspace: what a step
 * below it plans against under `apply together` (ADR 0219).
 */
export interface PlannedRename {
  readonly from: string;
  readonly to: string;
}

/**
 * The renames a cell's plan holds, when its verb is `rename-exports`; none for any other verb.
 * Read from the operations' payloads, which only this verb writes in that shape.
 */
export function plannedRenamesOf(
  verb: string | undefined,
  plan: Plan | undefined,
): PlannedRename[] {
  if (verb !== 'rename-exports' || plan === undefined) return [];
  const renames: PlannedRename[] = [];
  for (const operation of plan.operations) {
    const payload = operation.payload as { from?: unknown; to?: unknown } | undefined;
    if (operation.write !== RENAME_EXPORTS_WRITE || payload === undefined) continue;
    if (typeof payload.from === 'string' && typeof payload.to === 'string') {
      renames.push({ from: payload.from, to: payload.to });
    }
  }
  return renames;
}

/** The kind of write `rename-exports` declares, and the only one its plans hold. */
export const RENAME_EXPORTS_WRITE = 'rename';

const NAMES = ['stem', 'digits', 'path'] as const;
const DEFAULT_DIGITS = 2;
const MAXIMUM_DIGITS = 4;
const REPORTED = 8;

/** One file of a shown plan, as Apply renames it. */
interface FileRename {
  /** The file now and its new name, relative to the workspace. */
  readonly from: string;
  readonly to: string;
  /** The digest the file had when the plan was made. */
  readonly before: string;
}

/** One delivery's renames, applied together. */
interface DeliveryRenames {
  readonly rowKey: string;
  readonly files: readonly FileRename[];
}

/** Every plan a `rename-exports` answered, by the plan object the runner keeps (ADR 0170). */
const shownRenames = new WeakMap<Plan, readonly DeliveryRenames[]>();

export function renameExportsVerb(ports: ToDeliveryPorts | undefined): Verb {
  return {
    kind: 'sink',
    run: (context) => planRenames(context, ports),
    apply: (plan) => applyRenames(plan, ports),
  };
}

function refuse(problem: string, range: SourceRange): VerbResult {
  return err([diagnostic('E_RECIPE_RENAME_EXPORTS', { problem }, { range })]);
}

async function planRenames(
  context: VerbContext,
  ports: ToDeliveryPorts | undefined,
): Promise<VerbResult> {
  const named = refuseNamed(context, [...NAMES]);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  const at = locate(context);
  const [extra] = context.step.positional;
  if (extra !== undefined) {
    return argumentsProblem(
      context,
      `takes no bare word, and '${extra.value}' is one`,
      at(extra.range),
    );
  }
  const argument: Partial<Record<(typeof NAMES)[number], NamedArgument>> = {};
  for (const written of context.step.named) {
    const name = written.name as (typeof NAMES)[number];
    if (argument[name] !== undefined) {
      return argumentsProblem(context, `was given '${name}=' twice`, at(written.range));
    }
    argument[name] = written;
  }
  const { stem, digits, path } = argument;
  if (stem === undefined) {
    return argumentsProblem(context, 'needs stem=<column>, the column holding each file-name stem');
  }
  let width = DEFAULT_DIGITS;
  if (digits !== undefined) {
    const value = /^\d+$/u.test(digits.value) ? Number(digits.value) : Number.NaN;
    if (!(value >= 1 && value <= MAXIMUM_DIGITS)) {
      return argumentsProblem(
        context,
        `reads digits= as a whole number from 1 to ${String(MAXIMUM_DIGITS)}, and '${digits.value}' is not one`,
        at(digits.range),
      );
    }
    width = value;
  }
  if (ports?.rename === undefined) {
    return refuse('cannot run here: this host renames no files', context.written.verbRange);
  }
  const where = ports.folder();
  if (where === undefined) {
    return refuse('renames only inside a workspace, and this recipe is in none', at(stem.range));
  }
  if (where.restricted) {
    return refuse('renames nothing in a restricted folder; trust the folder first', at(stem.range));
  }
  const stemColumn = resolveColumn(table.value, stem.value, at(stem.range), context.aliases);
  if (!stemColumn.ok) return stemColumn;
  const pathRange = path === undefined ? context.written.verbRange : at(path.range);
  const pathColumn = resolveColumn(table.value, path?.value ?? 'path', pathRange, context.aliases);
  if (!pathColumn.ok) return pathColumn;

  const layout = await ports.layout();
  if (!layout.ok) return err(layout.error.map((found) => ({ ...found, range: at(stem.range) })));
  const exports = layout.value.exports ?? '.';
  const listed = await ports.list(layout.value.parent, exports);
  if (!listed.ok) return err(listed.error.map((found) => ({ ...found, range: at(stem.range) })));
  // Folded, since the file systems a workspace lives on mostly ignore case.
  const byPath = new Map<string, DeliveryListing>();
  for (const listing of listed.value) byPath.set(listing.path.toLowerCase(), listing);

  const refused: string[] = [];
  const operations: PlannedOperation[] = [];
  const stated: DeliveryRenames[] = [];
  const taken = new Map<string, string>();
  for (const row of table.value.rows) {
    const folder = cellText(row.values[pathColumn.value.name]).trim();
    const listing = folder === '' ? undefined : byPath.get(folder.toLowerCase());
    if (listing === undefined) {
      refused.push(
        folder === ''
          ? `row '${row.key}': its ${pathColumn.value.name} is empty`
          : `row '${row.key}': '${folder}' is no delivery folder under delivery.parent`,
      );
      continue;
    }
    if (listing.problem !== undefined || listing.record === undefined) {
      refused.push(`row '${row.key}': '${listing.path}' ${listing.problem ?? 'has no record'}`);
      continue;
    }
    const first = taken.get(listing.path.toLowerCase());
    if (first !== undefined) {
      refused.push(`row '${row.key}': '${listing.path}' is row '${first}''s delivery too`);
      continue;
    }
    taken.set(listing.path.toLowerCase(), row.key);
    const record = readDeliveryRecord(listing.record);
    if (!record.ok) {
      refused.push(`row '${row.key}': '${listing.path}' has a record that does not read`);
      continue;
    }
    const formats: readonly DeliveryFormatCount[] | undefined = record.value.formats;
    const names = deliveryExportNames({
      formats,
      sizes: layout.value.sizes ?? {},
      images: listing.images ?? [],
      stem: cellText(row.values[stemColumn.value.name]).trim(),
      digits: width,
    });
    if ('problem' in names) {
      refused.push(`row '${row.key}': '${listing.path}' ${names.problem}`);
      continue;
    }
    const exportsFolder = exports === '.' ? listing.path : `${listing.path}/${exports}`;
    const files: FileRename[] = [];
    for (const { from, to } of names.names) {
      if (from === to) continue;
      const source = `${exportsFolder}/${from}`;
      const digest = await ports.stat(source);
      if (!digest.ok) {
        return err(digest.error.map((found) => ({ ...found, range: at(stem.range) })));
      }
      // Listed a moment ago and gone now: somebody is moving files; the row waits for a run.
      if (digest.value === undefined) {
        refused.push(`row '${row.key}': '${source}' went away while the plan was made`);
        files.length = 0;
        break;
      }
      files.push({ from: source, to: `${exportsFolder}/${to}`, before: digest.value });
      operations.push({
        write: RENAME_EXPORTS_WRITE,
        rowKey: row.key,
        description: `${exportsFolder}: ${from} → ${to}`,
        payload: { from: source, to: `${exportsFolder}/${to}`, before: digest.value },
      });
    }
    if (files.length > 0) stated.push({ rowKey: row.key, files });
  }
  // A row refused after some of its operations were pushed takes them back out.
  const kept = new Set(stated.map((delivery) => delivery.rowKey));
  const shownOperations = operations.filter(
    (operation) => operation.rowKey !== undefined && kept.has(operation.rowKey),
  );

  const plan: Plan = {
    target: `exports of the deliveries in ${
      layout.value.parent === '' ? 'the workspace' : layout.value.parent
    }`,
    operations: shownOperations,
    count: shownOperations.length,
  };
  const checked = checkPlan(
    plan,
    { verb: 'rename-exports', writes: [RENAME_EXPORTS_WRITE], table: table.value },
    TO_DELIVERY_PLAN_LIMITS,
  );
  if (!checked.ok) return checked;
  shownRenames.set(checked.value, stated);
  return ok({
    table: table.value,
    plan: checked.value,
    ...(refused.length === 0 ? {} : { note: refusedNote(refused) }),
  });
}

function refusedNote(refused: readonly string[]): string {
  const named = refused.slice(0, REPORTED).join('; ');
  const more = refused.length - REPORTED;
  return `Left ${String(refused.length)} ${refused.length === 1 ? 'delivery' : 'deliveries'} unrenamed: ${named}${
    more > 0 ? `; and ${String(more)} more` : ''
  }.`;
}

/**
 * Apply (ADR 0170): the renames of a plan a `rename-exports` answered, a delivery at a time. A
 * folder in no workspace or restricted since the plan refuses the whole Apply before any rename.
 * Within a delivery, every file is checked before the first rename, so a file changed since the
 * plan, or a new name another file took since, fails that delivery whole and renames nothing of
 * it; the other deliveries still run.
 */
async function applyRenames(
  plan: Plan,
  ports: ToDeliveryPorts | undefined,
): Promise<Result<ApplyOutcome, readonly Diagnostic[]>> {
  const refuseApply = (problem: string) =>
    err([diagnostic('E_RECIPE_APPLY', { verb: 'rename-exports', problem })]);
  const shown = shownRenames.get(plan);
  if (shown === undefined) {
    return refuseApply('no rename-exports answered that plan in this session; run its cell again');
  }
  if (ports?.rename === undefined) return refuseApply('this host renames no files');
  const where = ports.folder();
  if (where === undefined) return refuseApply('the recipe is in no workspace any more');
  if (where.restricted) return refuseApply('its folder is restricted; trust it first');
  const rename = ports.rename.bind(ports);

  const now = ports.now ?? (() => new Date().toISOString());
  const operations: AppliedOperation[] = [];
  for (const delivery of shown) {
    const problem = await blocked(ports, delivery);
    if (problem !== undefined) {
      operations.push(
        ...delivery.files.map((): AppliedOperation => ({
          rowKey: delivery.rowKey,
          status: 'failed',
          reason: problem,
        })),
      );
      continue;
    }
    operations.push(...(await renameDelivery(rename, delivery, now)));
  }
  return ok({ operations });
}

/** Why a delivery may not be renamed as planned, or `undefined` when every file stands as read. */
async function blocked(
  ports: ToDeliveryPorts,
  delivery: DeliveryRenames,
): Promise<string | undefined> {
  const sources = new Set(delivery.files.map((file) => file.from.toLowerCase()));
  for (const file of delivery.files) {
    const current = await ports.stat(file.from);
    if (!current.ok) return `could not read ${file.from}: ${messages(current.error)}`;
    if (current.value !== file.before) return `${file.from} changed since the plan`;
  }
  for (const file of delivery.files) {
    if (sources.has(file.to.toLowerCase())) continue;
    const target = await ports.stat(file.to);
    if (!target.ok) return `could not read ${file.to}: ${messages(target.error)}`;
    if (target.value !== undefined) return `${file.to} is taken by another file since the plan`;
  }
  return undefined;
}

/**
 * One delivery's renames. When a new name is another file's old one, every file takes a hidden
 * name first, so no rename lands on a file not yet moved; otherwise each goes straight.
 */
async function renameDelivery(
  rename: (from: string, to: string) => Promise<Result<void, readonly Diagnostic[]>>,
  delivery: DeliveryRenames,
  now: () => string,
): Promise<AppliedOperation[]> {
  // A file whose new name is its own in another case moves straight; only another file's old
  // name needs the hidden step.
  const swaps = delivery.files.some((file) =>
    delivery.files.some(
      (other) => other !== file && other.from.toLowerCase() === file.to.toLowerCase(),
    ),
  );
  const operations: AppliedOperation[] = [];
  const failed = (reason: string): AppliedOperation => ({
    rowKey: delivery.rowKey,
    status: 'failed',
    reason,
  });
  if (!swaps) {
    for (const file of delivery.files) {
      const renamed = await rename(file.from, file.to);
      operations.push(
        renamed.ok
          ? { rowKey: delivery.rowKey, status: 'applied', appliedAt: now() }
          : failed(`could not rename ${file.from}: ${messages(renamed.error)}`),
      );
    }
    return operations;
  }
  const hidden = delivery.files.map((file, index) => hiddenName(file.from, index));
  for (const [index, file] of delivery.files.entries()) {
    const moved = await rename(file.from, hidden[index] ?? file.from);
    if (!moved.ok) {
      // Put back what already moved, so the delivery stands as it was and the next run plans it.
      for (let back = index - 1; back >= 0; back -= 1) {
        const earlier = delivery.files[back];
        if (earlier !== undefined) await rename(hidden[back] ?? earlier.from, earlier.from);
      }
      const reason = `could not rename ${file.from}: ${messages(moved.error)}`;
      return delivery.files.map(() => failed(reason));
    }
  }
  for (const [index, file] of delivery.files.entries()) {
    const renamed = await rename(hidden[index] ?? file.from, file.to);
    operations.push(
      renamed.ok
        ? { rowKey: delivery.rowKey, status: 'applied', appliedAt: now() }
        : failed(
            `could not rename ${file.from} to ${file.to}, and it is left as ${hidden[index] ?? ''}: ${messages(renamed.error)}`,
          ),
    );
  }
  return operations;
}

/** A hidden name beside the file, which listing and the check leave out. */
function hiddenName(path: string, index: number): string {
  const slash = path.lastIndexOf('/');
  return `${path.slice(0, slash + 1)}.tyto-rename-${String(index)}-${path.slice(slash + 1)}`;
}

function messages(found: readonly Diagnostic[]): string {
  return found.map((item) => item.message.replace(/\.$/u, '')).join('; ') || 'no reason given';
}
