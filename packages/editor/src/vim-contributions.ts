import { type Diagnostic, type Diagnostics, type Result, diagnostic, ok } from '@tyto/core';
import type { EditorView } from '@codemirror/view';
import { Vim } from '@replit/codemirror-vim';

import { commandRegistryOf } from './commands.js';
import { type VimExCommand, viewOf } from './vim-mode.js';
import { VIM_COMMENT_OPERATIONS } from './vim-comment.js';
import { VIM_EXCHANGE_OPERATIONS } from './vim-exchange.js';
import { type VimPosition, offsetOf, positionOf } from './vim-positions.js';
import { VIM_REPLACE_WITH_REGISTER_OPERATIONS } from './vim-replace-with-register.js';
import { VIM_SURROUND_OPERATIONS } from './vim-surround.js';
import { BUILT_IN_VIM_OPERATIONS } from './vim-text-objects.js';
import { VIM_UNIMPAIRED_OPERATIONS } from './vim-unimpaired.js';

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
 * What a text object answers. `linewise` means whole lines: the object covers every line from
 * the one `from` is on to the one `to` is on, as `ip` does. Otherwise `to` is exclusive.
 */
export interface VimTextObjectRange extends VimRange {
  readonly linewise: boolean;
}

/**
 * What a named operation does. An **action** runs on its keys alone; an **operator** waits
 * for a motion or a text object and is handed the ranges it covers, as `d` is; a **text
 * object** answers the range around the cursor, for an operator or a visual selection to use,
 * as `ip` does (ADR 0142). `inner` (`i` versus `a`) is the contribution's own arg, and `count`
 * is the repeat typed before the operator or the object.
 */
export type VimOperation =
  | {
      readonly kind: 'action';
      /**
       * The action changes the document, so `.` repeats it (TYTO-418). The engine records the
       * last edit only for a keymap entry marked so; an operator is always recorded.
       */
      readonly isEdit?: boolean;
      run(view: EditorView, args: VimOperationArgs, repeat: number): void;
    }
  | {
      readonly kind: 'operator';
      readonly isEdit?: boolean;
      run(view: EditorView, args: VimOperationArgs, ranges: readonly VimRange[]): void;
    }
  | {
      readonly kind: 'textObject';
      select(
        view: EditorView,
        head: number,
        args: VimOperationArgs,
        count: number,
      ): VimTextObjectRange | undefined;
    }
  | {
      /**
       * An operation whose contract with the engine the kinds above cannot carry, which
       * registers itself under the name it is given (TYTO-418, ADR 0143 amendment). Surround
       * is one: its `s` motion reads the operator pending before it, and the keys typed after
       * it. Only the editor writes one; a plugin still only names it.
       */
      readonly kind: 'engine';
      readonly type: 'motion' | 'operator';
      readonly isEdit?: boolean;
      define(engineName: string, nameOf: (operation: string) => string): void;
    };

/** The engine's own names are global too; a prefix keeps ours from replacing one of vim's. */
const engineName = (operation: string): string => `tyto:${operation}`;

/**
 * The engine's command type for each kind. A text object has no type of its own in the
 * engine: its built-in objects are a motion that returns two positions (TYTO-420).
 */
const ENGINE_TYPES = { action: 'action', operator: 'operator', textObject: 'motion' } as const;

const engineTypeOf = (operation: VimOperation): 'action' | 'operator' | 'motion' =>
  operation.kind === 'engine' ? operation.type : ENGINE_TYPES[operation.kind];

const operations = new Map<string, VimOperation>();

type Position = VimPosition;

interface EngineRange {
  readonly anchor: Position;
  readonly head: Position;
}

/** The part of the engine's state a text object reads and writes. */
interface EngineObjectState {
  visualMode: boolean;
  visualLine: boolean;
  readonly inputState: { readonly operatorArgs?: { linewise?: boolean } | null | undefined };
}

/**
 * Turns a text object's range into the `[anchor, head]` the engine's motion returns.
 *
 * Linewise is the engine's own bookkeeping, done here as its `ip` does it, so an operation
 * never touches engine state: the motion is marked linewise, and so is the visual selection
 * or, with an operator pending, the operator. Without it `dii` would delete from the first
 * line's start to the last line's start, leaving the last line behind. A charwise object in
 * visual mode ends on its last character, because a visual head is inclusive.
 */
function enginePositions(
  view: EditorView,
  range: VimTextObjectRange,
  motionArgs: { linewise?: boolean },
  vim: EngineObjectState,
): [Position, Position] {
  if (range.linewise) {
    motionArgs.linewise = true;
    if (vim.visualMode) vim.visualLine = true;
    else if (vim.inputState.operatorArgs) vim.inputState.operatorArgs.linewise = true;
    return [
      { line: view.state.doc.lineAt(range.from).number - 1, ch: 0 },
      { line: view.state.doc.lineAt(range.to).number - 1, ch: 0 },
    ];
  }
  const head = vim.visualMode ? Math.max(range.from, range.to - 1) : range.to;
  return [positionOf(view, range.from), positionOf(view, head)];
}

/**
 * Names an operation a contribution can map keys onto, and registers it into the engine.
 *
 * The handler finds its editor through the adapter it is handed, never by closure, so one
 * registration serves every editor of the window (as `vim-mode.ts` does for `:w`).
 */
export function defineVimOperation(name: string, operation: VimOperation): void {
  operations.set(name, operation);
  if (operation.kind === 'engine') {
    operation.define(engineName(name), engineName);
    return;
  }
  if (operation.kind === 'action') {
    Vim.defineAction(engineName(name), (adapter, actionArgs) => {
      const view = viewOf(adapter);
      if (view !== undefined) operation.run(view, argsOf(actionArgs), actionArgs.repeat);
    });
    return;
  }
  if (operation.kind === 'textObject') {
    Vim.defineMotion(engineName(name), (adapter, head, motionArgs, vim) => {
      const view = viewOf(adapter);
      if (view === undefined) return null;
      const range = operation.select(
        view,
        offsetOf(view, head),
        argsOf(motionArgs),
        motionArgs.repeat ?? 1,
      );
      return range === undefined ? null : enginePositions(view, range, motionArgs, vim);
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

/**
 * The contribution's own args: the engine adds its bookkeeping (`repeat`, registers) beside
 * them, and a text object's `linewise` stays on the motion's args when `.` replays it.
 *
 * `selectedCharacter` is let through (TYTO-418): it is the key a `<character>` in the
 * mapping's keys stood for, as in `ys{motion}<character>`, and the operation is what reads it.
 */
const ENGINE_KEYS = new Set(['repeat', 'repeatIsExplicit', 'registerName', 'linewise']);

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

/** One key of vim's notation: `<C-a>` is one key, as `x` is. */
const KEY = /<[^<>]+>|[\s\S]/gu;

/**
 * Keys that start with `i` or `a` and go on for two keys or more, such as `in(` (TYTO-420).
 *
 * The engine's built-in objects are `i<register>` and `a<register>`, which take any one key
 * after `i` or `a`. After the second key they are a full match while `in(` is still a partial
 * one, and the dispatcher prefers any full match, so the built-in object runs (with `n`, which
 * it does not know) and `(` is read as the next command. Measured: the motion behind `din(`
 * ran 0 times. A two-key mapping such as `ii` is fine, because a mapping is ahead of the
 * defaults and both are full matches. In normal mode `i` and `a` are whole commands after one
 * key, so the same holds there. Insert mode never consults these entries.
 */
const shadowedByBuiltInObject = (keys: string): boolean => {
  const pressed = keys.match(KEY) ?? [];
  return (pressed[0] === 'i' || pressed[0] === 'a') && pressed.length > 2;
};

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
    if (
      engineTypeOf(operation) === 'motion' &&
      mapping.context !== 'visual' &&
      mapping.context !== 'operatorPending'
    ) {
      return (
        `'${mapping.operation}' is a ${operation.kind === 'textObject' ? 'text object' : 'motion'}, which is mapped in 'visual' and ` +
        `'operatorPending', not in '${mapping.context ?? 'every context'}'`
      );
    }
    if (mapping.context !== 'insert' && shadowedByBuiltInObject(mapping.keys)) {
      return (
        `'${mapping.keys}' can never be reached: vim's own 'i' and 'a' match it whole ` +
        `after its second key, and a whole match wins over a longer mapping`
      );
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
      engineTypeOf(operation),
      engineName(mapping.operation),
      { ...mapping.args },
      {
        ...(mapping.context === undefined ? {} : { context: mapping.context }),
        // On the keymap entry, where the engine looks before it records the edit for `.`.
        ...(operation.kind !== 'textObject' && operation.isEdit === true ? { isEdit: true } : {}),
      },
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
 * The operations the editor ships (`vim-text-objects.ts`, `vim-comment.ts` and the other
 * `vim-*.ts` plugins), registered on the first call rather than when the module loads: the
 * package is free of side effects on import.
 */
const defineBuiltInOperations = (): void => {
  for (const [name, operation] of [
    ...BUILT_IN_VIM_OPERATIONS,
    ...VIM_COMMENT_OPERATIONS,
    ...VIM_SURROUND_OPERATIONS,
    ...VIM_REPLACE_WITH_REGISTER_OPERATIONS,
    ...VIM_EXCHANGE_OPERATIONS,
    ...VIM_UNIMPAIRED_OPERATIONS,
  ]) {
    if (!operations.has(name)) defineVimOperation(name, operation);
  }
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
  defineBuiltInOperations();
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
