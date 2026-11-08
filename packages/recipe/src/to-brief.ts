import { writeBrief } from '@tyto/brief-lang';
import {
  type Diagnostic,
  type Result,
  type SourceRange,
  type TemplateManifest,
  diagnostic,
  err,
  fileSafeName,
  isAbsolutePath,
  ok,
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
import { type Column, cellText } from './table.js';

/**
 * `to-brief template=<name> into=<folder> name=<column> slots=<slot>:<column>,…` (ADR 0172): a
 * sink that writes one brief per row, in the template named, into a folder of the workspace.
 *
 * Running it writes nothing: it answers a plan of one `write` per row, each saying whether it
 * makes a new file or overwrites one, and Apply writes exactly the briefs that plan showed
 * (ADR 0129, ADR 0170). The verb is pure; the host lends it {@link ToBriefPorts}, bound to the
 * workspace and the recipe it runs, through `createVerbRegistry({ briefs })`. A host that lends
 * none (a run outside the desktop, a cloud worker) gets a verb that says so.
 */
export interface ToBriefPorts {
  /** The template's manifest, or `undefined` when no template of that name is installed. */
  template(name: string): Promise<TemplateManifest | undefined>;
  /**
   * Where the running recipe sits in its workspace, asked on every run and every Apply, so a
   * folder restricted since the plan stops the Apply. `undefined` when it is in no workspace.
   */
  folder(): BriefFolder | undefined;
  /**
   * What the file at a workspace path holds, as a digest of the host's choice, or `undefined`
   * when no file is there. The path is relative to the workspace, with `/` separators.
   */
  stat(path: string): Promise<Result<string | undefined, readonly Diagnostic[]>>;
  /** Writes the brief, creating its folder. The host confines the path to the workspace again. */
  write(path: string, text: string): Promise<Result<void, readonly Diagnostic[]>>;
  /** The host's clock as ISO 8601 in UTC, which stamps an applied write; the system's if absent. */
  now?(): string;
}

export interface BriefFolder {
  /** The recipe's folder relative to the workspace, `/`-separated; `''` at its root. */
  readonly recipe: string;
  /** A restricted folder (ADR 0111) reads, and never writes. */
  readonly restricted: boolean;
}

/** The kind of write `to-brief` declares, and the only one its plans hold. */
export const TO_BRIEF_WRITE = 'write';

/**
 * Its own ceilings, narrower in count and wider in payload than {@link PLAN_LIMITS}: a payload
 * carries the whole brief, and a thousand briefs of 16 KB stay near 16 MB of kept plan, inside
 * what ADR 0170 budgets for one.
 */
export const TO_BRIEF_PLAN_LIMITS: PlanLimits = {
  ...PLAN_LIMITS,
  maxOperations: 1000,
  maxPayloadBytes: 16 * 1024,
};

/** A file name past this many characters is cut, so a long title cannot outgrow a path. */
const NAME_LENGTH = 100;

/** How many problems one run names, so a broken column is not a thousand lines. */
const REPORTED = 8;

const NAMES = ['template', 'into', 'name', 'slots'] as const;
const SLOT_MAP = z.record(z.string(), z.string());

/** One brief of a shown plan, as Apply writes it. */
interface BriefWrite {
  readonly rowKey: string;
  readonly path: string;
  readonly text: string;
  /** The digest the file had when the plan was made; `null` when there was no file. */
  readonly before: string | null;
}

/**
 * Every plan a `to-brief` answered, by the plan object the runner keeps, as `shownPlans` in
 * `@tyto/plugin-api` (ADR 0170). Apply writes from here, not from whatever the plan object holds
 * by then, and refuses a plan no `to-brief` answered: a copy, or another verb's.
 */
const shownBriefs = new WeakMap<Plan, readonly BriefWrite[]>();

export function toBriefVerb(ports: ToBriefPorts | undefined): Verb {
  return {
    kind: 'sink',
    run: (context) => planBriefs(context, ports),
    apply: (plan) => applyBriefs(plan, ports),
  };
}

function refuse(problem: string, range: SourceRange): VerbResult {
  return err([diagnostic('E_RECIPE_BRIEF', { problem }, { range })]);
}

async function planBriefs(
  context: VerbContext,
  ports: ToBriefPorts | undefined,
): Promise<VerbResult> {
  const named = refuseNamed(context, [...NAMES]);
  if (named !== undefined) return named;
  const table = requireTable(context);
  if (!table.ok) return table;
  if (ports === undefined)
    return refuse('cannot run here: this host writes no briefs', context.written.verbRange);
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
  const { template, into, name, slots } = argument;
  if (template === undefined || into === undefined || name === undefined || slots === undefined) {
    return argumentsProblem(
      context,
      'needs template=<name> into=<folder> name=<column> slots=<slot>:<column>,…',
    );
  }

  const where = ports.folder();
  if (where === undefined) {
    return refuse('writes only inside a workspace, and this recipe is in none', at(into.range));
  }
  if (where.restricted) {
    return refuse('writes nothing in a restricted folder; trust the folder first', at(into.range));
  }
  const folder = briefFolder(where.recipe, into.value);
  if (!folder.ok) return refuse(`into=${into.value} ${folder.error}`, at(into.range));

  const manifest = await ports.template(template.value);
  if (manifest === undefined) {
    return refuse(`knows no template named '${template.value}'`, at(template.range));
  }
  const mapping = await readSlots(context, slots);
  if (!mapping.ok) return mapping;
  const declared = Object.keys(manifest.slots);
  const columns: { readonly slot: string; readonly column: Column }[] = [];
  for (const [slot, written] of mapping.value) {
    if (!declared.includes(slot)) {
      return refuse(
        `has no slot '${slot}' in the template '${template.value}', which has ${declared.join(', ')}`,
        at(slots.range),
      );
    }
    const column = resolveColumn(table.value, written, at(slots.range), context.aliases);
    if (!column.ok) return column;
    columns.push({ slot, column: column.value });
  }
  const nameColumn = resolveColumn(table.value, name.value, at(name.range), context.aliases);
  if (!nameColumn.ok) return nameColumn;

  const problems: Diagnostic[] = [];
  const report = (problem: string, range: SourceRange) => {
    if (problems.length < REPORTED)
      problems.push(diagnostic('E_RECIPE_BRIEF', { problem }, { range }));
  };
  const writes: BriefWrite[] = [];
  const taken = new Map<string, string>();
  for (const row of table.value.rows) {
    const file = `${fileSafeName(cellText(row.values[nameColumn.value.name])).slice(0, NAME_LENGTH)}.brief`;
    const path = folder.value === '' ? file : `${folder.value}/${file}`;
    // Folded, since the file systems a workspace lives on mostly ignore case.
    const first = taken.get(path.toLowerCase());
    if (first !== undefined) {
      report(`would write '${path}' for both rows '${first}' and '${row.key}'`, at(name.range));
      continue;
    }
    taken.set(path.toLowerCase(), row.key);
    const brief = writeBrief({
      template: template.value,
      slots: columns.map(({ slot, column }) => ({
        name: slot,
        value: cellText(row.values[column.name]),
      })),
    });
    if (!brief.ok) {
      for (const problem of brief.error) {
        const column = columns.find((entry) => entry.slot === problem.slot)?.column.name;
        const whose =
          column === undefined ? `row '${row.key}'` : `row '${row.key}', column '${column}',`;
        report(`${whose} ${problem.problem}`, at(slots.range));
      }
      continue;
    }
    writes.push({ rowKey: row.key, path, text: brief.value, before: null });
  }
  if (problems.length > 0) return err(problems);

  const operations: PlannedOperation[] = [];
  const stated: BriefWrite[] = [];
  for (const write of writes) {
    const before = await ports.stat(write.path);
    if (!before.ok) return err(before.error.map((found) => ({ ...found, range: at(into.range) })));
    const digest = before.value ?? null;
    stated.push({ ...write, before: digest });
    operations.push({
      write: TO_BRIEF_WRITE,
      rowKey: write.rowKey,
      description: `${write.path}: ${digest === null ? 'new' : 'overwrites'}`,
      payload: { path: write.path, text: write.text, before: digest },
    });
  }
  const plan: Plan = {
    target: `briefs in ${folder.value === '' ? 'the workspace' : folder.value}`,
    operations,
    count: operations.length,
  };
  const checked = checkPlan(
    plan,
    { verb: 'to-brief', writes: [TO_BRIEF_WRITE], table: table.value },
    TO_BRIEF_PLAN_LIMITS,
  );
  if (!checked.ok) return checked;
  shownBriefs.set(checked.value, stated);
  return ok({ table: table.value, plan: checked.value });
}

/**
 * The folder the briefs land in, relative to the workspace: `into` read from the recipe's own
 * folder, never climbing out of the workspace and never into `.tyto`, which holds the folder's
 * configuration and trust (ADR 0112). Lexical, like core's paths: the host confines the written
 * path again after following links.
 */
export function briefFolder(recipe: string, into: string): Result<string, string> {
  if (isAbsolutePath(into) || /^[A-Za-z]:/u.test(into)) {
    return err("is a path from the recipe's folder, never an absolute one");
  }
  const parts: string[] = [];
  for (const part of `${recipe}/${into}`.split(/[\\/]/u)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return err('climbs out of the workspace');
      parts.pop();
    } else {
      // Every segment, folded: `.TYTO` is the same folder on Windows and macOS.
      if (part.toLowerCase() === '.tyto')
        return err("lands in '.tyto', which holds the folder's configuration");
      parts.push(part);
    }
  }
  return ok(parts.join('/'));
}

/** `slots=titulo:title,data:when` or `slots=@./slots.json#/aula`, as slot → column, in order. */
async function readSlots(
  context: VerbContext,
  argument: NamedArgument,
): Promise<Result<ReadonlyMap<string, string>, readonly Diagnostic[]>> {
  const at = locate(context);
  const problem = (text: string) =>
    err([
      diagnostic(
        'E_RECIPE_ARGUMENTS',
        { verb: context.step.verb, problem: text },
        { range: at(argument.range) },
      ),
    ]);
  let pairs: [string, string][];
  if (isDataReference(argument.value)) {
    const read = await readDataArgument(context, argument, SLOT_MAP);
    if (!read.ok) return read;
    pairs = Object.entries(read.value);
  } else {
    pairs = [];
    for (const entry of argument.value.split(',')) {
      const [slot, column, ...rest] = entry.split(':').map((part) => part.trim());
      if (
        slot === undefined ||
        slot === '' ||
        column === undefined ||
        column === '' ||
        rest.length > 0
      ) {
        return problem(`reads slots as <slot>:<column>, and '${entry.trim()}' is not one`);
      }
      pairs.push([slot, column]);
    }
  }
  const mapping = new Map<string, string>();
  for (const [slot, column] of pairs) {
    if (mapping.has(slot)) {
      return problem(`fills the slot '${slot}' twice`);
    }
    mapping.set(slot, column);
  }
  return ok(mapping);
}

/**
 * Apply (ADR 0170): the briefs of a plan a `to-brief` answered, written one by one. A folder in
 * no workspace or restricted since the plan refuses the whole Apply before any write. A file
 * whose digest is not the one the plan read changed since, and that write fails while the
 * others still run: the person approved overwriting what they saw, not what is there now.
 */
async function applyBriefs(
  plan: Plan,
  ports: ToBriefPorts | undefined,
): Promise<Result<ApplyOutcome, readonly Diagnostic[]>> {
  const refuseApply = (problem: string) =>
    err([diagnostic('E_RECIPE_APPLY', { verb: 'to-brief', problem })]);
  const shown = shownBriefs.get(plan);
  if (shown === undefined) {
    return refuseApply('no to-brief answered that plan in this session; run its cell again');
  }
  if (ports === undefined) return refuseApply('this host writes no briefs');
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
    const written = await ports.write(write.path, write.text);
    operations.push(
      written.ok
        ? { rowKey: write.rowKey, status: 'applied', appliedAt: now() }
        : failed(`could not write ${write.path}: ${messages(written.error)}`),
    );
  }
  return ok({ operations });
}

function messages(found: readonly Diagnostic[]): string {
  return found.map((item) => item.message.replace(/\.$/u, '')).join('; ') || 'no reason given';
}
