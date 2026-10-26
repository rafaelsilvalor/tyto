import { type Diagnostic, type Diagnostics, type Result, diagnostic, ok } from '@tyto/core';
import type { EditorView } from '@codemirror/view';
import { Vim } from '@replit/codemirror-vim';

import { commandRegistryOf } from './commands.js';
import { type VimExCommand, viewOf } from './vim-mode.js';

/**
 * The adapter of `plugin-api`'s `editor.vim` point (TYTO-417, ADR 0141).
 *
 * A contribution is data: keys bound to an operation **named** here, never a function from the
 * plugin. The operations live in this package and are registered into the engine once; a
 * contribution switched on maps its keys onto them, and switched off unmaps them, so the key
 * does what vim does by default again.
 *
 * **Per window, not per editor.** The engine's keymap is one array for the whole module, so a
 * mapping is in force in every editor of the window or in none. Gating each handler on a facet
 * of its view would leave a switched-off map still matching — and so still swallowing `S` or
 * `ys` — in the editors where it is off; unmapping is what gives vim's own key back.
 */

/** Where a mapping applies: vim's own contexts. The same four `plugin-api` names. */
export type VimContext = 'normal' | 'visual' | 'operatorPending' | 'insert';

export const VIM_CONTEXTS: readonly VimContext[] = [
  'normal',
  'visual',
  'operatorPending',
  'insert',
];

export type VimOperationArgs = Readonly<Record<string, string | number | boolean>>;

/** One mapping, as `plugin-api`'s `EditorVimMapping` spells it (structurally the same). */
export interface VimMapping {
  readonly keys: string;
  readonly context?: VimContext;
  readonly operation: string;
  readonly args?: VimOperationArgs;
}

/**
 * `plugin-api`'s `EditorVimContribution`, repeated rather than imported: the editor does not
 * depend on the plugin API, as `EditorKeymap` in `keymap.ts` does not either.
 */
export interface VimContribution {
  readonly id: string;
  readonly title?: string;
  readonly mappings: readonly VimMapping[];
  readonly ex?: readonly VimExCommand[];
}

/** A range of the document an operator acts on, as offsets. */
export interface VimRange {
  readonly from: number;
  readonly to: number;
}

/**
 * What a named operation does. An **action** runs on its keys alone; an **operator** waits
 * for a motion or a text object and is handed the ranges it covers, as `d` is.
 */
export type VimOperation =
  | {
      readonly kind: 'action';
      run(view: EditorView, args: VimOperationArgs, repeat: number): void;
    }
  | {
      readonly kind: 'operator';
      run(view: EditorView, args: VimOperationArgs, ranges: readonly VimRange[]): void;
    };

/** The engine's own names are global too; a prefix keeps ours from replacing one of vim's. */
const engineName = (operation: string): string => `tyto:${operation}`;

const operations = new Map<string, VimOperation>();

interface Position {
  readonly line: number;
  readonly ch: number;
}

interface EngineRange {
  readonly anchor: Position;
  readonly head: Position;
}

const offsetOf = (view: EditorView, position: Position): number =>
  view.state.doc.line(position.line + 1).from + position.ch;

/**
 * Names an operation a contribution can map keys onto, and registers it into the engine.
 *
 * The handler finds its editor through the adapter it is handed, never by closure, so one
 * registration serves every editor of the window (as `vim-mode.ts` does for `:w`).
 */
export function defineVimOperation(name: string, operation: VimOperation): void {
  operations.set(name, operation);
  if (operation.kind === 'action') {
    Vim.defineAction(engineName(name), (adapter, actionArgs) => {
      const view = viewOf(adapter);
      if (view !== undefined) operation.run(view, argsOf(actionArgs), actionArgs.repeat);
    });
    return;
  }
  Vim.defineOperator(engineName(name), (adapter, operatorArgs, ranges) => {
    const view = viewOf(adapter);
    if (view === undefined) return;
    const covered = (ranges as readonly EngineRange[]).map((range) => {
      const anchor = offsetOf(view, range.anchor);
      const head = offsetOf(view, range.head);
      return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
    });
    operation.run(view, argsOf(operatorArgs), covered);
  });
}

/** The contribution's own args: the engine adds its bookkeeping (`repeat`, registers) beside them. */
const ENGINE_KEYS = new Set(['repeat', 'repeatIsExplicit', 'registerName', 'selectedCharacter']);

const argsOf = (engineArgs: object): VimOperationArgs =>
  Object.fromEntries(
    Object.entries(engineArgs).filter(
      ([key, value]) =>
        !ENGINE_KEYS.has(key) &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
    ),
  );

/** What is mapped into the engine right now, per contribution id, to diff the next call against. */
interface Applied {
  /** The contribution as it was applied, to see whether a later call changed it. */
  readonly signature: string;
  readonly mappings: readonly VimMapping[];
}

const applied = new Map<string, Applied>();

/** The ex commands in force, by name: what a `defineEx` handler looks up when it runs. */
const activeEx = new Map<string, VimExCommand>();

/** Names already handed to `Vim.defineEx`, which has no way back (ADR 0141). */
const definedEx = new Set<string>();

const refused = (id: string, problem: string): Diagnostic =>
  diagnostic('E_VIM_CONTRIBUTION', { id, problem });

const slotOf = (mapping: VimMapping): string => `${mapping.context ?? ''}|${mapping.keys}`;

/**
 * Why a contribution cannot be applied, or nothing. `taken` holds the keys and ex names the
 * contributions accepted before it already hold: two maps of one key in one context would
 * leave `Vim.unmap`, which removes the first match, unable to tell whose it removes.
 */
function problemOf(
  contribution: VimContribution,
  takenKeys: ReadonlyMap<string, string>,
  takenEx: ReadonlyMap<string, string>,
): string | undefined {
  for (const mapping of contribution.mappings) {
    if (mapping.keys.length === 0) return 'a mapping has no keys';
    if (mapping.context !== undefined && !VIM_CONTEXTS.includes(mapping.context)) {
      return `'${String(mapping.context)}' is not a vim context`;
    }
    const operation = operations.get(mapping.operation);
    if (operation === undefined) return `the editor has no operation '${mapping.operation}'`;
    if (operation.kind === 'action' && mapping.context === 'operatorPending') {
      return `'${mapping.operation}' is an action, which never runs while an operator is pending`;
    }
    const owner = takenKeys.get(slotOf(mapping));
    if (owner !== undefined) return `'${mapping.keys}' is already mapped by '${owner}'`;
  }
  for (const entry of contribution.ex ?? []) {
    if (entry.name.length === 0) return 'an ex command has no name';
    if (entry.shortName !== undefined && !entry.name.startsWith(entry.shortName)) {
      return `':${entry.shortName}' is not a prefix of ':${entry.name}'`;
    }
    const owner = takenEx.get(entry.name);
    if (owner !== undefined) return `':${entry.name}' is already defined by '${owner}'`;
  }
  return undefined;
}

const unapply = (state: Applied): void => {
  for (const mapping of state.mappings) Vim.unmap(mapping.keys, mapping.context as string);
};

const apply = (contribution: VimContribution): Applied => {
  for (const mapping of contribution.mappings) {
    const operation = operations.get(mapping.operation);
    if (operation === undefined) continue;
    Vim.mapCommand(
      mapping.keys,
      operation.kind,
      engineName(mapping.operation),
      { ...mapping.args },
      mapping.context === undefined ? {} : { context: mapping.context },
    );
  }
  return { signature: JSON.stringify(contribution), mappings: contribution.mappings };
};

const defineEx = (entry: VimExCommand): void => {
  if (definedEx.has(entry.name)) return;
  definedEx.add(entry.name);
  // Looked up when it runs: a contribution switched off leaves the name behind, doing nothing.
  Vim.defineEx(entry.name, entry.shortName ?? '', (adapter: unknown) => {
    const view = viewOf(adapter);
    const active = activeEx.get(entry.name);
    if (view === undefined || active === undefined) return;
    commandRegistryOf(view)?.run(active.command, { view });
  });
};

/**
 * Brings the engine to "these contributions, and only those whose id is in `enabled`".
 *
 * Diffed against what is already applied, so calling it again with the same answer changes
 * nothing, and a contribution switched off is unmapped exactly once. A contribution that
 * cannot be applied is left out whole and named in an `E_VIM_CONTRIBUTION`, beside the ids
 * that were applied.
 */
export function setVimContributions(
  contributions: readonly VimContribution[],
  enabled: Iterable<string>,
): Result<readonly string[], Diagnostics> {
  const on = new Set(enabled);
  const diagnostics: Diagnostic[] = [];
  const wanted = new Map<string, VimContribution>();
  const takenKeys = new Map<string, string>();
  const takenEx = new Map<string, string>();

  for (const contribution of contributions) {
    if (!on.has(contribution.id) || wanted.has(contribution.id)) continue;
    const problem = problemOf(contribution, takenKeys, takenEx);
    if (problem !== undefined) {
      diagnostics.push(refused(contribution.id, problem));
      continue;
    }
    wanted.set(contribution.id, contribution);
    for (const mapping of contribution.mappings) takenKeys.set(slotOf(mapping), contribution.id);
    for (const entry of contribution.ex ?? []) takenEx.set(entry.name, contribution.id);
  }

  for (const [id, state] of applied) {
    const next = wanted.get(id);
    if (next !== undefined && JSON.stringify(next) === state.signature) continue;
    unapply(state);
    applied.delete(id);
  }
  for (const [id, contribution] of wanted) {
    if (!applied.has(id)) applied.set(id, apply(contribution));
  }

  activeEx.clear();
  for (const contribution of wanted.values()) {
    for (const entry of contribution.ex ?? []) {
      defineEx(entry);
      activeEx.set(entry.name, entry);
    }
  }

  return ok([...wanted.keys()], diagnostics);
}

/** Test seam: the engine is global, so a test unmaps what it applied and forgets its operations. */
export const resetVimContributionsForTest = (): void => {
  for (const state of applied.values()) unapply(state);
  applied.clear();
  activeEx.clear();
  operations.clear();
};
