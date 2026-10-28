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
 * It keeps, per document, the last answer shown with its text, so a change of language shows it
 * again ({@link RecipeNotebook.reshow}), and which tables the person folded, for as long as the
 * tab is open: none of it outlives the tab, and none of it is written anywhere.
 *
 * Nothing here touches the DOM or the editor: `recipe-cell-view.ts` builds what goes under each
 * cell, and `main.ts` hands each answer to the tab.
 */

export type RecipeRunRequest = IpcRequest<'recipe:run'>;
export type RecipeRunAnswer = IpcResponse<'recipe:run'>;
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
  /** Shows every open recipe's last answer again: the window's language changed. */
  reshow(): void;
  /** The last answer shown for a document, with the text its request carried. */
  lastOf(
    documentId: string,
  ): { readonly text: string; readonly answer: RecipeRunAnswer } | undefined;
  /** The cells whose table the person folded, by index, while the tab is open. */
  collapsedOf(documentId: string): ReadonlySet<number>;
  setCollapsed(documentId: string, index: number, collapsed: boolean): void;
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
  let requests = 0;

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
    options.show(documentId, text, answer);
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
    reshow() {
      for (const [documentId, shown] of last) options.show(documentId, shown.text, shown.answer);
    },
    lastOf: (documentId) => last.get(documentId),
    collapsedOf: (documentId) => collapsed.get(documentId) ?? new Set(),
    setCollapsed(documentId, index, folded) {
      const cells = collapsed.get(documentId) ?? new Set<number>();
      if (folded) cells.add(index);
      else cells.delete(index);
      collapsed.set(documentId, cells);
    },
    close(documentId) {
      cancel(documentId);
      newest.delete(documentId);
      last.delete(documentId);
      collapsed.delete(documentId);
    },
  };
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

function statusText(
  cell: WireCell,
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
