import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { type Diagnostic, createLineIndex, diagnostic, err, lineColumnAtIndex } from '@tyto/core';
import {
  type RecipeStateOptions,
  type WorkspaceDataOptions,
  isInside,
  recipeStateStore,
  workspaceDataResolver,
} from '@tyto/io';
import {
  type DataResolver,
  type RecipeContributions,
  type RecipeRegistries,
  type RecipeState,
  recipeRegistriesOf,
} from '@tyto/plugin-api';
import {
  type Cell,
  type Plan,
  type RecipeAst,
  type RunClock,
  type Step,
  type Table,
  parseRecipe,
  runRecipe,
} from '@tyto/recipe';

/**
 * The recipe notebook's runner, in main (TYTO-377, ADR 0148).
 *
 * The window sends a recipe's text on a pause in typing, on save and on Run; main runs its
 * cells and answers each one's table. What it composes is the desktop's alone: the installed
 * plugins' verbs with each plugin's own project section asked per call (ADR 0147), the
 * workspace's data files behind the folder's trust (ADR 0137), the recipe's state **read-only**
 * (ADR 0140: a run writes no state, an applied plan does, TYTO-378), the clock in the person's
 * zone (ADR 0139), and `run x` reading `x.recipe` beside the recipe and nowhere else.
 *
 * **Cells are kept in memory per document**, with each step's signature, so a run starts at the
 * first step that changed and reads the table the cell before it kept. A change to the header
 * or a `param` line, or to where the recipe is and how far its folder is trusted, reruns them
 * all. Nothing is written to the recipe or to disk (ADR 0128 decision 6), and the cells are
 * forgotten when the document closes.
 *
 * **When cells run** (the maintainer's decision, ADR 0148):
 * - a pause in typing runs from the changed step down, and stops before the first `source`, which
 *   fetches only on save or Run (ADR 0119); that cell and the ones after it are `stale`. A
 *   `run x` whose recipe holds a source, at any depth, counts as one;
 * - a restricted folder runs nothing until Run, which is the approval (as ADR 0147 takes a typed
 *   `--section`): even then its data files stay refused and its sections withheld;
 * - outside any workspace there are no data files and no state, and cells run as in a trusted
 *   folder, as a brief there fetches (ADR 0119 decision 4): nothing a folder ships is involved.
 */

/** Where a recipe is, as main's workspace answers for its folder. */
export interface RecipePlace {
  /** `none` is a recipe in no workspace, or in no file yet. */
  readonly trust: 'trusted' | 'restricted' | 'none';
  /** The workspace folder, absent for `none`: what data files and state are bound to. */
  readonly folder?: string | undefined;
}

/**
 * What a run asks of the plugins' verbs. `refresh` is a run that asked for fresh data: every
 * source's `page` call carries it, so the source skips its private cache (ADR 0148).
 */
export interface RecipeRegistryRequest {
  readonly sectionOf: (plugin: string) => unknown;
  readonly refresh: boolean;
}

export interface RecipeRunnerOptions {
  /** The installed plugins' verbs and derivations, read per lookup (`WindowPlugins`). */
  readonly contributions: RecipeContributions;
  /** The trust and workspace folder for a recipe in `directory`; `undefined` is no file yet. */
  readonly placeOf: (directory: string | undefined) => Promise<RecipePlace>;
  /** A plugin's section for a recipe in `directory`, asked on every verb call (ADR 0147). */
  readonly sectionFor: (directory: string | undefined, plugin: string) => unknown;
  /** `TYTO_HOME`, where the recipe's state lives (ADR 0140). */
  readonly home: string;
  /** The clock in the zone the setting names, read at each run so a save applies at once. */
  readonly clock: () => RunClock;
  /** Overrides for a test; the app takes the defaults. */
  readonly registries?: (request: RecipeRegistryRequest) => RecipeRegistries;
  readonly state?: (options: RecipeStateOptions) => RecipeState;
  readonly data?: (options: WorkspaceDataOptions) => DataResolver;
}

export interface RecipeRunInput {
  readonly documentId: string;
  readonly text: string;
  /** The document's file, which main holds; `undefined` for a tab never saved. */
  readonly path: string | undefined;
  /** Rerun from this cell down, whatever changed. */
  readonly from?: number | undefined;
  /** Run: the person's approval, in a restricted folder and for sources. */
  readonly explicit?: boolean | undefined;
  /** The run after a save, which runs sources (ADR 0119). */
  readonly saved?: boolean | undefined;
  /** Forget this document's cells first. */
  readonly fresh?: boolean | undefined;
}

export type RunnerCellStatus = 'ok' | 'failed' | 'skipped' | 'stale';

export interface RunnerCell {
  readonly index: number;
  /** One-based. */
  readonly line: number;
  readonly status: RunnerCellStatus;
  readonly table?: Table;
  readonly plan?: Plan;
  readonly diagnostics: readonly Diagnostic[];
  /** The host clock's instant when this cell last ran; absent for one that never has. */
  readonly ranAt?: string;
  /** The oldest `fetchedAt` among the table's rows (ADR 0148). */
  readonly oldestFetchedAt?: string;
  /** The step fetches: a source verb, or a `run` whose recipe holds one (Fetch again's cell). */
  readonly source?: true;
}

/** Why cells were left `stale`: a folder not trusted, or a source reached while typing. */
export type RunHeld = 'restricted' | 'source';

export interface RunnerAnswer {
  readonly cells: readonly RunnerCell[];
  /** The whole file's: a syntax error, a parameter without a value. */
  readonly diagnostics: readonly Diagnostic[];
  readonly held?: RunHeld;
  readonly ranAt: string;
}

export interface RecipeRunner {
  run(input: RecipeRunInput): Promise<RunnerAnswer>;
  /** Every verb a recipe may name: the generic ones and every running plugin's. */
  verbs(): readonly string[];
  /** Forgets a document's cells, when its tab closes. */
  close(documentId: string): void;
}

/** A kept cell: the step it answered for, by signature, and the answer. */
type KeptCell = Omit<RunnerCell, 'index'> & { readonly signature: string };

interface Kept {
  readonly header: string;
  readonly cells: readonly KeptCell[];
}

/** A recipe `run` names, read beside the including one: a plain word, as a store's name is. */
const RECIPE_NAME = /^[A-Za-z0-9][\w-]*$/u;

/** An included recipe larger than this is not read; a recipe is tens of lines. */
export const INCLUDED_RECIPE_MAX_BYTES = 1024 * 1024;

export function createRecipeRunner(options: RecipeRunnerOptions): RecipeRunner {
  const kept = new Map<string, Kept>();
  /** The latest run started per document: an older one finishing later keeps nothing. */
  const latest = new Map<string, number>();
  let runs = 0;
  const registriesOf =
    options.registries ??
    ((request: RecipeRegistryRequest) =>
      recipeRegistriesOf(options.contributions, {
        sectionOf: request.sectionOf,
        refresh: request.refresh,
      }));
  const stateOf = options.state ?? recipeStateStore;
  const dataOf = options.data ?? workspaceDataResolver;

  return {
    async run(request) {
      const clock = options.clock();
      const ranAt = clock.now().toISOString();
      if (request.fresh === true) kept.delete(request.documentId);
      runs += 1;
      const run = runs;
      latest.set(request.documentId, run);

      const parsed = parseRecipe(request.text);
      if (!parsed.ok) {
        // The file does not parse as a whole: every cell it had is shown as it was, unrun.
        const before = kept.get(request.documentId)?.cells ?? [];
        return {
          cells: before.map((cell, index) => shown({ ...cell, status: 'stale' }, index)),
          diagnostics: parsed.error,
          ranAt,
        };
      }
      const recipe = parsed.value;
      const directory = request.path === undefined ? undefined : dirname(request.path);
      const place = await options.placeOf(directory);
      const header = headerSignature(recipe, request.path, place);
      const previous = kept.get(request.documentId);
      const reusable = previous?.header === header ? previous.cells : [];

      const registries = registriesOf({
        // Only a trusted folder hands a section on. The workspace already withholds a restricted
        // folder's (ADR 0111) and has none outside a folder; asked again here, so Run in such a
        // place can never hand one on whatever the port answers.
        sectionOf: (plugin) =>
          place.trust === 'trusted' ? options.sectionFor(directory, plugin) : undefined,
        refresh: request.fresh === true,
      });
      const steps = recipe.steps;
      // Each included recipe is read once per run, so the signatures, the policy and the run
      // itself all see the same text.
      const read = includedReader(directory);
      const signatures = await Promise.all(steps.map((step) => signatureOf(step, read)));
      const changed = firstChanged(signatures, reusable);
      const start = request.from === undefined ? changed : Math.min(changed, request.from);
      const { stop, held } = await runPolicy(steps, start, place, request, registries, read);

      const lines = createLineIndex(request.text);
      const lineOf = (step: Step): number => lineColumnAtIndex(lines, step.range.start).line;
      const next: KeptCell[] = reusable.slice(0, start).map((cell, index) => ({
        ...cell,
        line: lineOf(steps[index] as Step),
      }));
      const diagnostics: Diagnostic[] = [];

      if (stop > start) {
        const input = next[start - 1]?.table;
        const result = await runRecipe(
          { ...recipe, steps: steps.slice(start, stop) },
          {
            ...(input === undefined ? {} : { input }),
            verbs: registries.verbs,
            derivations: registries.derivations,
            resolveRecipe: async (name) => {
              const text = await read(name);
              return text === undefined ? err([]) : parseRecipe(text);
            },
            resolveData: dataFor(place, directory, dataOf),
            clock,
            state: stateFor(place, request.path, options.home, stateOf),
          },
        );
        if (result.ok) {
          for (const cell of result.value.cells) {
            next.push(keptOf(cell, signatures[next.length] ?? '', lineOf(cell.step), ranAt));
          }
        } else {
          diagnostics.push(...result.error);
        }
      }
      // Every cell not run this time shows what it last had, marked stale, and runs next time.
      for (let index = next.length; index < steps.length; index += 1) {
        const step = steps[index] as Step;
        next.push({
          ...reusable[index],
          signature: signatures[index] ?? '',
          line: lineOf(step),
          status: 'stale',
          diagnostics: [],
        });
      }

      if (latest.get(request.documentId) === run) {
        kept.set(request.documentId, { header, cells: next });
      }
      // Which cells fetch, for the notebook's Fetch again; the reader already holds every text.
      const sources = await Promise.all(
        steps.map((step) => holdsSource(step, registries, read, new Set(), 0)),
      );
      return {
        cells: next.map((cell, index) => ({
          ...shown(cell, index),
          ...(sources[index] === true ? { source: true as const } : {}),
        })),
        diagnostics,
        ...(held === undefined ? {} : { held }),
        ranAt,
      };
    },

    verbs() {
      return registriesOf({ sectionOf: () => undefined, refresh: false }).verbs.names();
    },

    close(documentId) {
      kept.delete(documentId);
      latest.delete(documentId);
    },
  };
}

/**
 * Where this run stops (ADR 0148): before `start` in a restricted folder until Run, and before
 * the first source from `start` down while typing. Run and a save run to the end.
 */
async function runPolicy(
  steps: readonly Step[],
  start: number,
  place: RecipePlace,
  request: RecipeRunInput,
  registries: RecipeRegistries,
  read: IncludedReader,
): Promise<{ readonly stop: number; readonly held?: RunHeld }> {
  const explicit = request.explicit === true;
  if (place.trust === 'restricted' && !explicit) return { stop: start, held: 'restricted' };
  if (explicit || request.saved === true) return { stop: steps.length };
  for (let index = start; index < steps.length; index += 1) {
    if (await holdsSource(steps[index] as Step, registries, read, new Set(), 0)) {
      return { stop: index, held: 'source' };
    }
  }
  return { stop: steps.length };
}

/** The verb that includes another recipe: `run x` reads `x.recipe`. */
const INCLUDE_VERB = 'run';

/**
 * How deep included recipes are followed when the policy and the signature read them. A
 * recipe including one that includes another is already rare; past this the chain is not
 * read, and the run itself answers whatever it meets there.
 */
export const INCLUDED_DEPTH_MAX = 8;

/**
 * Whether a step fetches: a source verb, or a `run` whose recipe holds one at any depth, read
 * through the run's own reader. A recipe already on the chain (a cycle) or past the depth bound
 * is not followed, and one that cannot be read is not a source: the run fails it as before.
 */
async function holdsSource(
  step: Step,
  registries: RecipeRegistries,
  read: IncludedReader,
  visited: ReadonlySet<string>,
  depth: number,
): Promise<boolean> {
  if (registries.verbs.get(step.verb)?.kind === 'source') return true;
  const included = await includedOf(step, read, visited, depth);
  if (included === undefined) return false;
  const inside = new Set([...visited, included.name]);
  for (const each of included.steps) {
    if (await holdsSource(each, registries, read, inside, depth + 1)) return true;
  }
  return false;
}

interface Included {
  readonly name: string;
  readonly text: string;
  /** None when it does not parse: the run reports that, the policy finds no source in it. */
  readonly steps: readonly Step[];
}

/** The recipe a `run` step includes, when it is one to follow and it was found. */
async function includedOf(
  step: Step,
  read: IncludedReader,
  visited: ReadonlySet<string>,
  depth: number,
): Promise<Included | undefined> {
  const name = step.verb === INCLUDE_VERB ? step.positional[0]?.value : undefined;
  if (name === undefined || visited.has(name) || depth >= INCLUDED_DEPTH_MAX) return undefined;
  const text = await read(name);
  if (text === undefined) return undefined;
  const parsed = parseRecipe(text);
  return { name, text, steps: parsed.ok ? parsed.value.steps : [] };
}

/**
 * A step's identity for the cache: its verb and everything after it, as written, and for a
 * `run` the text of every recipe it includes, so an included recipe edited on disk reruns the
 * cell (ADR 0148 decision 2, amended).
 */
async function signatureOf(step: Step, read: IncludedReader): Promise<string> {
  return [step.verb, step.text, ...(await includedTexts(step, read, new Set(), 0))].join('\u0000');
}

async function includedTexts(
  step: Step,
  read: IncludedReader,
  visited: ReadonlySet<string>,
  depth: number,
): Promise<string[]> {
  const included = await includedOf(step, read, visited, depth);
  if (included === undefined) return [];
  const inside = new Set([...visited, included.name]);
  const texts = [included.text];
  for (const each of included.steps) {
    texts.push(...(await includedTexts(each, read, inside, depth + 1)));
  }
  return texts;
}

/**
 * What every cell depends on besides its own line: the header, the parameters and their
 * defaults, the file and the folder's answer. Any change reruns every cell, since a parameter
 * fills any line and a folder trusted since the last run reads data it did not.
 */
function headerSignature(recipe: RecipeAst, path: string | undefined, place: RecipePlace): string {
  return JSON.stringify([
    recipe.name,
    recipe.description,
    recipe.params.map((param) => [param.name, param.defaultValue ?? null]),
    path ?? null,
    place.trust,
    place.folder ?? null,
  ]);
}

/** The first step to run: one that changed, or one whose last answer was not a table. */
function firstChanged(signatures: readonly string[], kept: readonly KeptCell[]): number {
  const index = signatures.findIndex((signature, at) => {
    const before = kept[at];
    return before?.status !== 'ok' || before.signature !== signature;
  });
  return index === -1 ? signatures.length : index;
}

function keptOf(cell: Cell, signature: string, line: number, ranAt: string): KeptCell {
  const oldest = cell.table === undefined ? undefined : oldestFetchedAt(cell.table);
  return {
    signature,
    line,
    status: cell.status,
    ...(cell.table === undefined ? {} : { table: cell.table }),
    ...(cell.plan === undefined ? {} : { plan: cell.plan }),
    diagnostics: cell.diagnostics,
    // A skipped cell did not run, so it has no time of its own.
    ...(cell.status === 'skipped' ? {} : { ranAt }),
    ...(oldest === undefined ? {} : { oldestFetchedAt: oldest }),
  };
}

function shown(cell: KeptCell, index: number): RunnerCell {
  const { signature: _signature, ...rest } = cell;
  return { index, ...rest };
}

/**
 * The oldest `fetchedAt` among the rows, as the row wrote it. It is the data's age the notebook
 * shows (ADR 0148): a plugin cache's `storedAt` does not reach a verb's result, so the rows'
 * provenance is what a cell can say. A value that is not a date is passed over.
 */
export function oldestFetchedAt(table: Table): string | undefined {
  let oldest: { readonly at: number; readonly text: string } | undefined;
  for (const row of table.rows) {
    const at = Date.parse(row.provenance.fetchedAt);
    if (Number.isNaN(at)) continue;
    if (oldest === undefined || at < oldest.at) oldest = { at, text: row.provenance.fetchedAt };
  }
  return oldest?.text;
}

/**
 * The workspace's data files (ADR 0137), confined to the folder and refused whole when it is
 * restricted. None outside a workspace or for a recipe in no file.
 */
function dataFor(
  place: RecipePlace,
  directory: string | undefined,
  dataOf: (options: WorkspaceDataOptions) => DataResolver,
): DataResolver | undefined {
  if (place.folder === undefined || directory === undefined || place.trust === 'none') {
    return undefined;
  }
  return dataOf({
    workspaceFolder: place.folder,
    recipeFolder: directory,
    trust: place.trust,
  });
}

/**
 * The recipe's state, bound to its workspace and its file (ADR 0140), **read-only**: a run
 * writes no state, an applied plan does (TYTO-378). Read in a restricted folder too, since the
 * data is the machine's. None outside a workspace or for a recipe in no file.
 */
function stateFor(
  place: RecipePlace,
  path: string | undefined,
  home: string,
  stateOf: (options: RecipeStateOptions) => RecipeState,
): RecipeState | undefined {
  if (place.folder === undefined || path === undefined) return undefined;
  return readOnlyState(stateOf({ home, workspace: place.folder, recipe: path }));
}

/** `state` with its reads and without its write, which answers `E_RECIPE_STATE`. */
export function readOnlyState(state: RecipeState): RecipeState {
  return {
    read: (store, keys) => state.read(store, keys),
    entries: (store) => state.entries(store),
    write: (store) =>
      Promise.resolve(
        err([
          diagnostic('E_RECIPE_STATE', {
            store,
            problem: 'is not written by a notebook run; applying the plan writes it',
          }),
        ]),
      ),
  };
}

/**
 * `run <name>`'s recipe: `<name>.recipe` in the including recipe's folder, and only there,
 * checked after `realpath` so a link beside it that leads elsewhere is not followed (ADR 0112).
 * Its text, or `undefined` for none found, which reaches `run` as an empty error: "names no
 * recipe that was found", which `run` words itself.
 */
async function readIncluded(
  directory: string | undefined,
  name: string,
): Promise<string | undefined> {
  if (directory === undefined || !RECIPE_NAME.test(name)) return undefined;
  try {
    const folder = await realpath(directory);
    const file = await realpath(join(directory, `${name}.recipe`));
    if (!isInside(folder, file) || dirname(file) !== folder) return undefined;
    const found = await stat(file);
    if (!found.isFile() || found.size > INCLUDED_RECIPE_MAX_BYTES) return undefined;
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** An included recipe's text by name, `undefined` when none was found. */
type IncludedReader = (name: string) => Promise<string | undefined>;

/** {@link readIncluded}, each name read once: one reader per run. */
function includedReader(directory: string | undefined): IncludedReader {
  const texts = new Map<string, Promise<string | undefined>>();
  return (name) => {
    let text = texts.get(name);
    if (text === undefined) {
      text = readIncluded(directory, name);
      texts.set(name, text);
    }
    return text;
  };
}
