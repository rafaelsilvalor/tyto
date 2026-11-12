import { type Step, parseRecipe } from '@tyto/recipe';

import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';
import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';

/**
 * A `.recipe` tab's side of the notebook (TYTO-377, ADR 0148): when to ask main to run it, which
 * answer to keep, and the line each cell shows under it. Main runs the cells and keeps them; this
 * decides nothing about a run beyond its two flags.
 *
 * - **A pause in typing** runs it as typed, so main stops before a source and runs nothing in a
 *   folder not trusted. The pause is per document, as a brief's compile is: a person types, moves
 *   to another tab and types again inside it.
 * - **A save** runs it with `saved`, and **Run recipe** with `explicit`, at once.
 * - **Only the newest request's answer is kept**, per document: a run fired on a pause can land
 *   after the one that replaced it (`requestId`, as `brief:preview` has).
 * - **Run from here** and **Fetch again** are Run too (`explicit`), with `from` a cell or
 *   `fresh`: each fetches and runs in a folder not trusted, so each is the person's approval.
 *
 * - **Apply** (TYTO-378, ADR 0170) names the cell and the plan's id over `recipe:apply`. The cell
 *   main answers replaces the shown one when it still holds that plan; an answer with no new
 *   outcome is a refusal, kept here, on that cell, until the next run's answer.
 *
 * It keeps, per document, the last answer shown with its text, so a change of language shows it
 * again ({@link RecipeNotebook.reshow}), and which tables the person folded, by their line and
 * following it through each edit, for as long as the tab is open: none of it outlives the tab,
 * and none of it is written anywhere.
 *
 * Nothing here touches the DOM or the editor: `recipe-cell-view.ts` builds what goes under each
 * cell, and `main.ts` hands each answer to the tab.
 */

export type RecipeRunRequest = IpcRequest<'recipe:run'>;
export type RecipeRunAnswer = IpcResponse<'recipe:run'>;
export type RecipeApplyRequest = IpcRequest<'recipe:apply'>;
export type RecipeApplyAnswer = IpcResponse<'recipe:apply'>;
type WireCell = RecipeRunAnswer['cells'][number];

/** How a run was asked for: a pause in typing, a save, or Run recipe. */
export type RecipeTrigger = 'typed' | 'saved' | 'explicit';

/** Where a run starts: from a cell down (Run from here), or forgetting every kept cell. */
export interface RecipeRunScope {
  readonly from?: number;
  readonly fresh?: boolean;
}

export interface RecipeNotebookOptions {
  /** `recipe:run` over the bridge. */
  readonly run: (request: RecipeRunRequest) => Promise<RecipeRunAnswer>;
  /** `recipe:apply` over the bridge. */
  readonly apply: (request: RecipeApplyRequest) => Promise<RecipeApplyAnswer>;
  /** Why an Apply was refused when main gave no reason, in the window's language. */
  readonly refusedWithoutReason: () => string;
  /** The document's text now, or `undefined` once its tab is gone. */
  readonly textOf: (documentId: string) => string | undefined;
  /** The newest answer for a document, with the text its request carried. */
  readonly show: (documentId: string, text: string, answer: RecipeRunAnswer) => void;
  /** The pause, in milliseconds; the brief's compile waits as long. */
  readonly delay: number;
  /** Injected so a test drives time itself. */
  readonly timers?: {
    readonly set: (run: () => void, delay: number) => unknown;
    readonly clear: (handle: unknown) => void;
  };
}

export interface RecipeNotebook {
  /** A keystroke: a run after the pause, replacing one still waiting. */
  typed(documentId: string): void;
  /** Runs now, as the trigger says; a run waiting on the pause is dropped for it. */
  runNow(documentId: string, trigger: RecipeTrigger, scope?: RecipeRunScope): Promise<void>;
  /** Run from here: Run, from this cell down whatever changed. */
  runFrom(documentId: string, index: number): Promise<void>;
  /** Fetch again: Run, the whole document, every source skipping its cache. */
  fetchAgain(documentId: string): Promise<void>;
  /** Apply: the plan main stamped `planId` on cell `index`, shown again once main answers. */
  apply(documentId: string, index: number, planId: number): Promise<void>;
  /** The cells whose Apply is on its way, by index. */
  applyingOf(documentId: string): ReadonlySet<number>;
  /** Why a cell's last Apply was refused, by index, until the next run's answer. */
  refusalsOf(documentId: string): ReadonlyMap<number, string>;
  /** Shows every open recipe's last answer again: the window's language changed. */
  reshow(): void;
  /** The last answer shown for a document, with the text its request carried. */
  lastOf(
    documentId: string,
  ): { readonly text: string; readonly answer: RecipeRunAnswer } | undefined;
  /**
   * The cells whose table the person folded, while the tab is open, by the start of the cell's
   * line ({@link CellStatus.at}): an index names another cell once a step is inserted above.
   */
  collapsedOf(documentId: string): ReadonlySet<number>;
  setCollapsed(documentId: string, at: number, collapsed: boolean): void;
  /**
   * The `run` cells the person opened onto their included recipe's cells (TYTO-449), keyed
   * as folds are: every `run` cell starts closed.
   */
  expandedOf(documentId: string): ReadonlySet<number>;
  setExpanded(documentId: string, at: number, expanded: boolean): void;
  /**
   * The person edited the text: each fold, and each opened `run` cell, follows its line through
   * `map`, which answers where a line start went, or `undefined` when its line is gone, and
   * then it is gone too (TYTO-451).
   */
  edited(documentId: string, map: (at: number) => number | undefined): void;
  /** The tab closed: nothing waits for it, an answer on its way is dropped, and all is forgotten. */
  close(documentId: string): void;
}

export function createRecipeNotebook(options: RecipeNotebookOptions): RecipeNotebook {
  const timers = options.timers ?? {
    set: (run: () => void, delay: number): unknown => setTimeout(run, delay),
    clear: (handle: unknown) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
  const waiting = new Map<string, unknown>();
  /** The newest request per document: every other answer is dropped. */
  const newest = new Map<string, number>();
  const last = new Map<string, { readonly text: string; readonly answer: RecipeRunAnswer }>();
  const collapsed = new Map<string, Set<number>>();
  const expanded = new Map<string, Set<number>>();
  const applying = new Map<string, Set<number>>();
  const refusals = new Map<string, Map<number, string>>();
  let requests = 0;

  const reshowOne = (documentId: string): void => {
    const shown = last.get(documentId);
    if (shown !== undefined) options.show(documentId, shown.text, shown.answer);
  };

  const cancel = (documentId: string): void => {
    const handle = waiting.get(documentId);
    if (handle === undefined) return;
    timers.clear(handle);
    waiting.delete(documentId);
  };

  const runNow = async (
    documentId: string,
    trigger: RecipeTrigger,
    scope: RecipeRunScope = {},
  ): Promise<void> => {
    cancel(documentId);
    const text = options.textOf(documentId);
    if (text === undefined) return;
    requests += 1;
    const requestId = requests;
    newest.set(documentId, requestId);
    const answer = await options.run({
      requestId,
      documentId,
      text,
      ...(trigger === 'saved' ? { saved: true } : {}),
      ...(trigger === 'explicit' ? { explicit: true } : {}),
      ...(scope.from === undefined ? {} : { from: scope.from }),
      ...(scope.fresh === true ? { fresh: true } : {}),
    });
    if (!isNewest(newest, documentId, answer.requestId)) return;
    last.set(documentId, { text, answer });
    // A refusal is said once: the run that follows it has the cell's own word.
    refusals.delete(documentId);
    options.show(documentId, text, answer);
  };

  const apply = async (documentId: string, index: number, planId: number): Promise<void> => {
    const cells = applying.get(documentId) ?? new Set<number>();
    if (cells.has(index)) return;
    cells.add(index);
    applying.set(documentId, cells);
    reshowOne(documentId);
    let answer: RecipeApplyAnswer | undefined;
    try {
      answer = await options.apply({ documentId, index, planId });
    } catch {
      answer = undefined;
    }
    cells.delete(index);
    const shown = last.get(documentId);
    if (shown === undefined) return;
    const before = shown.answer.cells.find((cell) => cell.index === index);
    const after = answer?.cell;
    if (after?.applied !== undefined && after.applied.at !== before?.applied?.at) {
      // Only onto the cell still showing this plan: a run since may have planned it again.
      if (before?.plan?.planId === planId) {
        const cellsNow = shown.answer.cells.map((cell) => (cell.index === index ? after : cell));
        last.set(documentId, { text: shown.text, answer: { ...shown.answer, cells: cellsNow } });
      }
      refusals.get(documentId)?.delete(index);
    } else {
      const said = new Set(before?.diagnostics.map((found) => found.message) ?? []);
      const reasons = (after?.diagnostics ?? [])
        .filter((found) => found.severity === 'error' && !said.has(found.message))
        .map((found) => found.message);
      const kept = refusals.get(documentId) ?? new Map<number, string>();
      kept.set(index, reasons.length > 0 ? reasons.join(' ') : options.refusedWithoutReason());
      refusals.set(documentId, kept);
    }
    reshowOne(documentId);
  };

  return {
    typed(documentId) {
      cancel(documentId);
      waiting.set(
        documentId,
        timers.set(() => {
          waiting.delete(documentId);
          void runNow(documentId, 'typed');
        }, options.delay),
      );
    },
    runNow,
    // Both are Run, the person's approval: they fetch, and they run in a folder not trusted.
    runFrom: (documentId, index) => runNow(documentId, 'explicit', { from: index }),
    fetchAgain: (documentId) => runNow(documentId, 'explicit', { fresh: true }),
    apply,
    applyingOf: (documentId) => applying.get(documentId) ?? new Set(),
    refusalsOf: (documentId) => refusals.get(documentId) ?? new Map(),
    reshow() {
      for (const [documentId, shown] of last) options.show(documentId, shown.text, shown.answer);
    },
    lastOf: (documentId) => last.get(documentId),
    collapsedOf: (documentId) => collapsed.get(documentId) ?? new Set(),
    setCollapsed: (documentId, at, folded) => {
      mark(collapsed, documentId, at, folded);
    },
    expandedOf: (documentId) => expanded.get(documentId) ?? new Set(),
    setExpanded: (documentId, at, open) => {
      mark(expanded, documentId, at, open);
    },
    edited(documentId, map) {
      for (const marks of [collapsed, expanded]) {
        const cells = marks.get(documentId);
        if (cells === undefined || cells.size === 0) continue;
        const moved = new Set<number>();
        for (const at of cells) {
          const now = map(at);
          if (now !== undefined) moved.add(now);
        }
        marks.set(documentId, moved);
      }
    },
    close(documentId) {
      cancel(documentId);
      newest.delete(documentId);
      last.delete(documentId);
      collapsed.delete(documentId);
      expanded.delete(documentId);
      applying.delete(documentId);
      refusals.delete(documentId);
    },
  };
}

/** Adds or drops one line start in a document's set of them. */
function mark(marks: Map<string, Set<number>>, documentId: string, at: number, on: boolean): void {
  const cells = marks.get(documentId) ?? new Set<number>();
  if (on) cells.add(at);
  else cells.delete(at);
  marks.set(documentId, cells);
}

/**
 * The diagnostics an answer marks in the editor and lists in Problems: the file's and each
 * cell's. An included recipe's cells are left out (TYTO-449): their lines are in another file,
 * and what failed in them already reached the `run` line's own diagnostics.
 */
export function answerDiagnostics(
  answer: Pick<RecipeRunAnswer, 'cells' | 'diagnostics'>,
): RecipeRunAnswer['diagnostics'] {
  return [...answer.diagnostics, ...answer.cells.flatMap((cell) => cell.diagnostics)];
}

/** Whether an answer is for the newest request this document made. */
export const isNewest = (
  newest: ReadonlyMap<string, number>,
  documentId: string,
  requestId: number,
): boolean => newest.get(documentId) === requestId;

/**
 * The cell the cursor's line belongs to (Run from here as a command): the nearest at or above
 * it, by the lines the last answer gave; the first cell when the cursor is above them all.
 */
export function cellAtOrAbove(answer: RecipeRunAnswer, line: number): number | undefined {
  let found: WireCell | undefined;
  for (const cell of answer.cells) {
    if (cell.line <= line && (found === undefined || cell.line > found.line)) found = cell;
  }
  return (found ?? answer.cells[0])?.index;
}

/**
 * Where Add step writes its line (TYTO-402): below the step at or above the cursor's line, or
 * at the end of the text when the cursor is above every step, the recipe has none, or it does
 * not parse. `before` is the new step's index among the steps, which the form's column offers
 * are read before; `undefined` when the text does not parse, and every cell counts.
 */
export interface StepSlot {
  readonly at: number;
  /** What goes before and after the line, so it lands on a line of its own. */
  readonly prefix: string;
  readonly suffix: string;
  readonly before: number | undefined;
}

export function stepSlot(text: string, cursorLine: number): StepSlot {
  const parsed = parseRecipe(text);
  const steps = parsed.ok ? parsed.value.steps : [];
  const starts = lineStarts(text);
  let above: number | undefined;
  steps.forEach((step, index) => {
    if (lineOf(starts, step.range.start) <= cursorLine) above = index;
  });
  const step = above === undefined ? undefined : steps[above];
  if (step === undefined || above === undefined) {
    const ended = text === '' || text.endsWith('\n');
    return {
      at: text.length,
      prefix: ended ? '' : '\n',
      suffix: ended ? '\n' : '',
      before: parsed.ok ? steps.length : undefined,
    };
  }
  const lineEnd = text.indexOf('\n', step.range.start);
  return {
    at: lineEnd === -1 ? text.length : lineEnd,
    prefix: '\n',
    suffix: '',
    before: above + 1,
  };
}

/**
 * The step on the cursor's line, for Edit step (TYTO-402): its index among the steps and its
 * line's range, or `undefined` when that line is no step or the text does not parse.
 */
export function stepOnLine(
  text: string,
  cursorLine: number,
): { readonly index: number; readonly step: Step } | undefined {
  const parsed = parseRecipe(text);
  if (!parsed.ok) return undefined;
  const starts = lineStarts(text);
  const index = parsed.value.steps.findIndex(
    (step) => lineOf(starts, step.range.start) === cursorLine,
  );
  const step = parsed.value.steps[index];
  return step === undefined ? undefined : { index, step };
}

/**
 * The columns a step's form offers (TYTO-402): the table of the nearest cell before step
 * `before` that has one, from the last answer shown. A cell that did not run this time still
 * shows the table it had, and so does its offer.
 */
export function columnsBefore(
  answer: Pick<RecipeRunAnswer, 'cells'> | undefined,
  before: number | undefined,
): readonly string[] {
  let found: WireCell | undefined;
  for (const cell of answer?.cells ?? []) {
    if (cell.table === undefined) continue;
    if (before !== undefined && cell.index >= before) continue;
    if (found === undefined || cell.index > found.index) found = cell;
  }
  return found?.table?.columns.map((column) => column.name) ?? [];
}

/** The one-based line a character offset is on, by the starts of the lines. */
function lineOf(starts: readonly number[], offset: number): number {
  let line = 1;
  while (line < starts.length && (starts[line] ?? Infinity) <= offset) line += 1;
  return line;
}

/** One cell's line: where it goes, what it says, and whether it is a failure. */
export interface CellStatus {
  /** The start of the cell's line in the text the request carried. */
  readonly at: number;
  readonly index: number;
  readonly text: string;
  readonly failed: boolean;
  /** The cell as it came, for its table, its age and whether it fetches. */
  readonly cell: WireCell;
  readonly held: RecipeRunAnswer['held'];
}

/**
 * The line under each cell (Rafael's choice for this pull request): a table's size, a plan's
 * count, a failure that points at Problems, or why it did not run. A cell that ran and answered
 * neither a table nor a plan shows nothing.
 */
export function cellStatuses(
  text: string,
  answer: Pick<RecipeRunAnswer, 'cells' | 'held'>,
  locale: Locale,
): readonly CellStatus[] {
  const starts = lineStarts(text);
  const statuses: CellStatus[] = [];
  for (const cell of answer.cells) {
    const said = statusText(cell, answer.held, locale);
    if (said === undefined) continue;
    const at = starts[Math.min(cell.line, starts.length) - 1] ?? 0;
    statuses.push({
      at,
      index: cell.index,
      text: said,
      failed: cell.status === 'failed',
      cell,
      held: answer.held,
    });
  }
  return statuses;
}

/** What a cell's status line says; also a `run` cell's included cells' (TYTO-449). */
export function statusText(
  cell: {
    readonly status: WireCell['status'];
    readonly table?: WireCell['table'];
    readonly plan?: { readonly target: string; readonly count: number } | undefined;
  },
  held: RecipeRunAnswer['held'],
  locale: Locale,
): string | undefined {
  const say = (key: CatalogueKey): string => translate(locale, key);
  switch (cell.status) {
    case 'failed':
      return say('recipe.cell.failed');
    case 'skipped':
      return say('recipe.cell.skipped');
    case 'stale':
      if (held === 'source') return say('recipe.cell.held.source');
      if (held === 'restricted') return say('recipe.cell.held.restricted');
      // `apply` holds no cell stale (it stops after the plans): the plan view says it.
      return say('recipe.cell.stale');
    case 'ok':
      if (cell.table !== undefined) {
        const rows = counted(locale, 'recipe.cell.rows', cell.table.total);
        const columns = counted(locale, 'recipe.cell.columns', cell.table.columns.length);
        return `${rows} · ${columns}`;
      }
      if (cell.plan !== undefined) {
        return say('recipe.cell.plan')
          .replace('{count}', String(cell.plan.count))
          .replace('{target}', cell.plan.target);
      }
      return undefined;
  }
}

function counted(
  locale: Locale,
  key: 'recipe.cell.rows' | 'recipe.cell.columns',
  count: number,
): string {
  const one = key === 'recipe.cell.rows' ? 'recipe.cell.rows.one' : 'recipe.cell.columns.one';
  return translate(locale, count === 1 ? one : key).replace('{count}', String(count));
}

/** Each line's start, by index: `starts[n - 1]` is line `n`'s. */
function lineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}
