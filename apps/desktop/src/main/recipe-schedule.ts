import { randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { isError } from '@tyto/core';
import { isInside } from '@tyto/io';
import { type RecipeAst, parseRecipe } from '@tyto/recipe';

import { ignoredByTheWatcher } from './explorer.js';
import {
  INCLUDED_RECIPE_MAX_BYTES,
  type RecipeRunInput,
  type RunnerAnswer,
} from './recipe-runner.js';

/**
 * Recipes on an interval while the app is open (TYTO-385, ADR 0175), in main.
 *
 * **Which recipes**: every `*.recipe` in the open workspace folder whose header says `every`,
 * found by walking the folder (skipping what the explorer's watcher skips) and walked again
 * when a burst of changes names a `.recipe`. The text run is the file's on disk, read at each
 * run, never a tab's unsaved buffer. A recipe whose `param` has no default is listed with what
 * it needs and never run: nobody is there to supply it.
 *
 * **When**: one interval after it is found, then one interval after the start of each run, by
 * a chained timer per recipe. A tick that finds the last run still going is skipped, not
 * queued. After the machine resumes, a recipe whose time passed while it slept runs once, never
 * once per missed tick. Everything stops when the window closes.
 *
 * **What a run may do** is the runner's: `scheduled` counts as Run in a trusted folder and as
 * nothing anywhere else (ADR 0175 decision 4), and its cells are kept under
 * `schedule:<realpath>`, apart from any tab's.
 *
 * **How loud**: the first run with a problem after a clean one is handed to `notify`, and later
 * runs with problems are not, until a clean run resets it. The notice names the recipe and a
 * diagnostic code, never a row's values.
 */

/** A recipe's interval is in minutes (`RecipeAst.every`); timers count milliseconds. */
const MINUTE_MS = 60_000;

/** How many entries one walk reads before it stops, so a huge folder cannot stall main. */
export const SCHEDULE_WALK_CAP = 50_000;

/** How many scheduled recipes one workspace may hold; past this the rest are not scheduled. */
export const SCHEDULE_CAP = 500;

/** What went wrong in a run, as the notice says it: never a row's values. */
export type ScheduleProblem =
  /** The first error diagnostic of the file or of a cell. */
  | { readonly kind: 'diagnostic'; readonly code: string }
  /** Operations an `apply auto` applied that came back failed, without an error diagnostic. */
  | { readonly kind: 'operations'; readonly failed: number }
  /** A failed cell that said nothing, or a run that threw. */
  | { readonly kind: 'failed' };

/** One OS notification's worth: the composition root words it and shows it. */
export interface ScheduleNotice {
  readonly scheduleId: string;
  /** The recipe's name from its header. */
  readonly recipe: string;
  readonly problem: ScheduleProblem;
}

/** How the last run ended. `waiting` is a plan waiting for Apply, which is not a problem. */
export type ScheduleOutcome = 'ok' | 'problem' | 'held' | 'waiting';

/** One scheduled recipe as the Schedules panel lists it. */
export interface ScheduleView {
  /** Main's id for it, which Run now and Open name; never a path (ADR 0086). */
  readonly scheduleId: string;
  readonly name: string;
  /** Where it is, relative to the workspace folder, with `/` between folders. */
  readonly file: string;
  readonly minutes: number;
  /** The parameters without a default it would need: listed, never run. */
  readonly needs: readonly string[];
  readonly running: boolean;
  readonly lastRunAt?: string;
  readonly nextRunAt?: string;
  readonly outcome?: ScheduleOutcome;
  /** The problem's diagnostic code, when the outcome is a problem that has one. */
  readonly code?: string;
}

export interface RecipeScheduleOptions {
  /** The recipe runner's `run`. */
  readonly run: (input: RecipeRunInput) => Promise<RunnerAnswer>;
  /** Shows one OS notification; Electron's `Notification` in the app, a spy in a test. */
  readonly notify: (notice: ScheduleNotice) => void;
  /** The list changed: a recipe found or gone, a run started or ended. */
  readonly changed: () => void;
  readonly onError?: (message: string, cause: unknown) => void;
  /** The wall clock, which a resume is measured against. */
  readonly now?: () => number;
}

export interface RecipeSchedule {
  /** Schedules the recipes of `folder` from now on, or none; the same folder again re-walks. */
  setFolder(folder: string | undefined): Promise<void>;
  /** A burst of changes in the open folder, as the explorer heard it. */
  filesChanged(names: readonly (string | null)[]): void;
  list(): readonly ScheduleView[];
  /** Starts the recipe now; `false` when it is unknown, needs a parameter or is running. */
  runNow(scheduleId: string): boolean;
  /** The recipe file a schedule id names, for main's own use: Open, and a notice's click. */
  pathOf(scheduleId: string): string | undefined;
  /** The machine woke: every recipe whose time passed runs once. */
  resumed(): void;
  /** The window closed: no timer is left and nothing runs or notifies again. */
  stop(): void;
  /** Settles once every walk and run under way has ended; for a test. */
  idle(): Promise<void>;
}

interface Entry {
  readonly id: string;
  /** The real path: the key runs are held under, and the file read. */
  readonly real: string;
  file: string;
  name: string;
  minutes: number;
  needs: readonly string[];
  timer?: ReturnType<typeof setTimeout> | undefined;
  dueAt?: number | undefined;
  running: boolean;
  lastRunAt?: number | undefined;
  outcome?: ScheduleOutcome | undefined;
  code?: string | undefined;
  /** A problem was notified and no clean run has followed it. */
  notified: boolean;
}

export function createRecipeSchedule(options: RecipeScheduleOptions): RecipeSchedule {
  const now = options.now ?? Date.now;
  const report = (message: string, cause: unknown): void => options.onError?.(message, cause);
  let folder: { readonly given: string; readonly real: string } | undefined;
  /** Bumped when the folder changes and on stop: work from an older one ends quietly. */
  let generation = 0;
  let stopped = false;
  const entries = new Map<string, Entry>();
  const pending = new Set<Promise<unknown>>();
  let walking: Promise<void> = Promise.resolve();

  const track = <T>(work: Promise<T>): Promise<T> => {
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => undefined);
    return work;
  };

  const clear = (entry: Entry): void => {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.dueAt = undefined;
  };

  const forgetAll = (): void => {
    for (const entry of entries.values()) clear(entry);
    entries.clear();
  };

  /** The next tick, `delay` from now; a recipe needing a parameter gets none. */
  const time = (entry: Entry, delay: number): void => {
    clear(entry);
    if (stopped || entry.needs.length > 0) return;
    entry.dueAt = now() + delay;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      tick(entry);
    }, delay);
  };

  const tick = (entry: Entry): void => {
    if (stopped || entries.get(entry.real) !== entry) return;
    if (entry.running) {
      // ADR 0175 decision 3: skipped, not queued; the next tick is one interval on.
      time(entry, entry.minutes * MINUTE_MS);
      return;
    }
    void track(execute(entry));
  };

  async function execute(entry: Entry): Promise<void> {
    const mine = generation;
    entry.running = true;
    entry.lastRunAt = now();
    // Chained from the start of this run, so a long run does not push the cadence back.
    time(entry, entry.minutes * MINUTE_MS);
    options.changed();
    let problem: ScheduleProblem | undefined;
    let outcome: ScheduleOutcome;
    try {
      const text = await readRecipe(entry.real);
      if (mine !== generation) return;
      if (text === undefined) {
        // Gone, or grown past a recipe's size: the next walk forgets it.
        problem = { kind: 'failed' };
        outcome = 'problem';
      } else {
        const parsed = parseRecipe(text);
        if (parsed.ok && described(entry, parsed.value) === 'unscheduled') {
          entries.delete(entry.real);
          clear(entry);
          options.changed();
          return;
        }
        if (entry.needs.length > 0) {
          clear(entry);
          outcome = 'held';
        } else {
          const answer = await options.run({
            documentId: `schedule:${entry.real}`,
            text,
            path: entry.real,
            scheduled: true,
            // Every scheduled run reads its sources again, from the first cell.
            from: 0,
          });
          problem = problemOf(answer);
          outcome =
            answer.held !== undefined
              ? 'held'
              : problem !== undefined
                ? 'problem'
                : answer.cells.some((cell) => cell.applicable === true)
                  ? 'waiting'
                  : 'ok';
        }
      }
    } catch (cause) {
      report('schedule: a recipe run failed', cause);
      problem = { kind: 'failed' };
      outcome = 'problem';
    } finally {
      entry.running = false;
    }
    if (mine !== generation || stopped) return;
    entry.outcome = outcome;
    entry.code = problem?.kind === 'diagnostic' ? problem.code : undefined;
    if (problem !== undefined) {
      // ADR 0175 decision 5: one notice on the change from clean to a problem, then quiet.
      if (!entry.notified) {
        entry.notified = true;
        options.notify({ scheduleId: entry.id, recipe: entry.name, problem });
      }
    } else if (outcome !== 'held') {
      entry.notified = false;
    }
    options.changed();
  }

  /** Walks the folder and brings the entries in line with what it found. */
  async function discover(): Promise<void> {
    const mine = generation;
    const root = folder;
    if (root === undefined) return;
    const files = await walkRecipes(root.given, report);
    const found = new Map<string, { file: string; recipe: RecipeAst | undefined }>();
    for (const path of files) {
      if (found.size >= SCHEDULE_CAP) {
        report('schedule: too many scheduled recipes; the rest are not scheduled', files.length);
        break;
      }
      const real = await realpath(path).catch(() => undefined);
      // A link that leads out of the folder is not followed (ADR 0112).
      if (real === undefined || !isInside(root.real, real) || found.has(real)) continue;
      const text = await readRecipe(real);
      if (text === undefined) continue;
      const parsed = parseRecipe(text);
      const recipe = parsed.ok ? parsed.value : undefined;
      // A file that does not parse stays scheduled if it was: its next run reports the error.
      if (recipe?.every === undefined && !(recipe === undefined && entries.has(real))) continue;
      found.set(real, { file: labelOf(root.given, path), recipe });
    }
    if (mine !== generation || stopped) return;
    for (const [real, entry] of entries) {
      if (!found.has(real)) {
        clear(entry);
        entries.delete(real);
      }
    }
    for (const [real, { file, recipe }] of found) {
      const known = entries.get(real);
      if (known === undefined) {
        if (recipe === undefined) continue;
        const entry: Entry = {
          id: randomUUID(),
          real,
          file,
          name: recipe.name,
          minutes: recipe.every?.minutes ?? 0,
          needs: needsOf(recipe),
          running: false,
          notified: false,
        };
        entries.set(real, entry);
        time(entry, entry.minutes * MINUTE_MS);
        continue;
      }
      known.file = file;
      if (recipe === undefined) continue;
      const before = { minutes: known.minutes, needs: known.needs.length };
      described(known, recipe);
      // A new interval, or a parameter given a default, is timed again from now.
      const retime = before.minutes !== known.minutes || before.needs !== known.needs.length;
      if (retime && !known.running) time(known, known.minutes * MINUTE_MS);
      if (known.needs.length > 0) clear(known);
    }
    options.changed();
  }

  const walkAgain = (): Promise<void> => {
    walking = walking
      .then(discover)
      .catch((cause: unknown) => report('schedule: the workspace could not be walked', cause));
    return track(walking);
  };

  return {
    async setFolder(next) {
      stopped = false;
      const real = next === undefined ? undefined : await realpath(next).catch(() => undefined);
      if (next !== undefined && real !== undefined && folder?.real === real) {
        await walkAgain();
        return;
      }
      generation += 1;
      forgetAll();
      folder = next === undefined || real === undefined ? undefined : { given: next, real };
      options.changed();
      if (folder !== undefined) await walkAgain();
    },

    filesChanged(names) {
      if (folder === undefined || stopped) return;
      if (names.some((name) => name === null || /\.recipe$/iu.test(name))) void walkAgain();
    },

    list() {
      return [...entries.values()]
        .map((entry) => viewOf(entry))
        .sort((a, b) => a.file.localeCompare(b.file));
    },

    runNow(scheduleId) {
      const entry = [...entries.values()].find((each) => each.id === scheduleId);
      if (stopped || entry === undefined || entry.running || entry.needs.length > 0) return false;
      void track(execute(entry));
      return true;
    },

    pathOf(scheduleId) {
      return [...entries.values()].find((each) => each.id === scheduleId)?.real;
    },

    resumed() {
      if (stopped) return;
      const at = now();
      for (const entry of entries.values()) {
        // Once, whatever number of ticks the sleep swallowed.
        if (entry.dueAt !== undefined && entry.dueAt <= at) {
          clear(entry);
          tick(entry);
        }
      }
    },

    stop() {
      stopped = true;
      generation += 1;
      forgetAll();
      folder = undefined;
    },

    async idle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}

/**
 * Brings an entry in line with its recipe's header: name, interval, what it needs. Answers
 * `unscheduled` when the header no longer says `every`.
 */
function described(entry: Entry, recipe: RecipeAst): 'scheduled' | 'unscheduled' {
  if (recipe.every === undefined) return 'unscheduled';
  entry.name = recipe.name;
  entry.minutes = recipe.every.minutes;
  entry.needs = needsOf(recipe);
  return 'scheduled';
}

function needsOf(recipe: RecipeAst): readonly string[] {
  return recipe.params.filter((param) => param.defaultValue === undefined).map((each) => each.name);
}

function viewOf(entry: Entry): ScheduleView {
  return {
    scheduleId: entry.id,
    name: entry.name,
    file: entry.file,
    minutes: entry.minutes,
    needs: [...entry.needs],
    running: entry.running,
    ...(entry.lastRunAt === undefined
      ? {}
      : { lastRunAt: new Date(entry.lastRunAt).toISOString() }),
    ...(entry.dueAt === undefined ? {} : { nextRunAt: new Date(entry.dueAt).toISOString() }),
    ...(entry.outcome === undefined ? {} : { outcome: entry.outcome }),
    ...(entry.code === undefined ? {} : { code: entry.code }),
  };
}

/**
 * What in a run's answer is a problem (ADR 0175 decision 5): an error diagnostic of the file or
 * of a cell, a failed cell, or a failed operation of an applied plan. A plan waiting for Apply
 * and a held run are not.
 */
export function problemOf(answer: RunnerAnswer): ScheduleProblem | undefined {
  const error = [...answer.diagnostics, ...answer.cells.flatMap((cell) => cell.diagnostics)].find(
    isError,
  );
  if (error !== undefined) return { kind: 'diagnostic', code: error.code };
  const failed = answer.cells
    .flatMap((cell) => cell.applied?.operations ?? [])
    .filter((operation) => operation.status === 'failed').length;
  if (failed > 0) return { kind: 'operations', failed };
  if (answer.cells.some((cell) => cell.status === 'failed')) return { kind: 'failed' };
  return undefined;
}

/** The file's text, or nothing for one gone or larger than a recipe is. */
async function readRecipe(path: string): Promise<string | undefined> {
  try {
    const found = await stat(path);
    if (!found.isFile() || found.size > INCLUDED_RECIPE_MAX_BYTES) return undefined;
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

function labelOf(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

/**
 * Every `*.recipe` under `folder`, breadth first, skipping what the explorer's watcher skips
 * (`.git`, `node_modules`) and following no link to a folder. Stops after
 * {@link SCHEDULE_WALK_CAP} entries, and says so.
 */
export async function walkRecipes(
  folder: string,
  report: (message: string, cause: unknown) => void = () => undefined,
  cap: number = SCHEDULE_WALK_CAP,
): Promise<readonly string[]> {
  const found: string[] = [];
  const queue: string[] = [folder];
  let seen = 0;
  while (queue.length > 0) {
    const directory = queue.shift() as string;
    const children = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      seen += 1;
      if (seen > cap) {
        report('schedule: the workspace walk stopped at its cap', cap);
        return found;
      }
      const path = join(directory, child.name);
      if (ignoredByTheWatcher(child.name)) continue;
      if (child.isDirectory()) queue.push(path);
      else if (child.isFile() && /\.recipe$/iu.test(child.name)) found.push(path);
    }
  }
  return found;
}
