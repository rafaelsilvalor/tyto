import type { CatalogueKey } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';
import {
  ALIAS_BUILTINS,
  type PanelAliasPorts,
  type PanelVariables,
} from './command-alias-builtins.js';
import { FILE_BUILTINS } from './command-file-builtins.js';
import { FILE_WRITES } from './command-file-writes.js';
import type { ListById } from './command-paths.js';
import { type LineWord, parseCommandLine } from './command-steps.js';

/**
 * The command panel's own commands (TYTO-535, ADR 0200): the few things a terminal has that are
 * not `tyto` commands — `clear`, `history`, `help`, `exit`, `last`.
 *
 * **A registry, not a switch.** Each entry says its name, the line `help` shows for it, whether
 * it runs in a restricted folder, and what it does through a small context the panel gives it.
 * The panel hands a step's first word here; what no entry claims goes to `tyto` (`cli:run`), and
 * a line that starts with `tyto` always does. File commands (TYTO-537) and aliases (TYTO-536)
 * add entries, or a lookup before this one, without touching the line's parser.
 *
 * **A built-in never starts a program.** What one runs, it runs as a `tyto` command through the
 * same port as a typed line, so main's refusals and the folder's trust apply to it exactly as they
 * would (ADR 0159 decisions 2 and 8). The file commands (`command-file-builtins.ts`, ADR 0201)
 * reach the workspace only through the explorer's ids, and never outside it.
 */

/** How a built-in ended, which decides whether an `&&` after it goes on. */
export type BuiltinOutcome =
  /**
   * It printed these lines, as a block of its own; `failed` ends it as exit code 1. `notes` come
   * after them as the panel's own lines (TYTO-725): what `cat` says about a file it cut short.
   */
  | {
      readonly kind: 'printed';
      readonly lines: readonly string[];
      readonly notes?: readonly string[];
      readonly failed?: boolean;
      /**
       * The folder, as steps under the root, its relative paths are in: what a name `ls` printed
       * links to (TYTO-537). The session's working folder when absent.
       */
      readonly base?: readonly string[];
    }
  /** It acted, or ran a `tyto` command that drew its own block; `ok` is how that went. */
  | { readonly kind: 'acted'; readonly ok: boolean }
  /** The session is gone (`exit`): nothing after it runs. */
  | { readonly kind: 'ended' };

/** What a built-in may do: the panel's, never main's. */
export interface BuiltinContext {
  /** The words after the built-in's name. */
  readonly args: readonly LineWord[];
  /** The lines run before in this folder, oldest first, as `history` numbers them. */
  readonly history: () => readonly string[];
  /** Runs `words` as a `tyto` command in this session, its own block; answers whether it ended 0. */
  readonly runTyto: (line: string, words: readonly string[]) => Promise<boolean>;
  /** Empties this session's output. */
  readonly clear: () => void;
  /** Closes this session, stopping what it runs. */
  readonly exit: () => void;
  /** The CLI's own commands, for `help`: its tree's first level. */
  readonly commands: () => Promise<
    readonly { readonly name: string; readonly description: string }[]
  >;
  readonly say: (key: CatalogueKey) => string;
  /** Every entry, for `help`. */
  readonly registry: BuiltinRegistry;
  /** The open workspace folder, for the file commands (TYTO-537); `undefined` with none open. */
  readonly files: PanelFiles | undefined;
  /** The aliases in force and their writes, for `alias` and `unalias` (TYTO-536). */
  readonly aliases: PanelAliasPorts;
  /** This session's variables, for `set` (TYTO-536). */
  readonly variables: PanelVariables;
}

/** What `cat` gets for a file: its text, or why there is none (`explorer:read`). */
export type FileRead =
  | { readonly ok: true; readonly text: string; readonly truncated: boolean }
  | { readonly ok: false; readonly reason: 'gone' | 'folder' | 'binary' };

/**
 * The workspace as the file commands reach it (TYTO-537, ADR 0201): by the explorer's ids, from
 * the session's working folder. No path is handed to main.
 */
export interface PanelFiles {
  /** The open workspace folder, absolute: what `pwd` prints the working folder under. */
  readonly folder: string;
  /** The session's working folder, as steps under the root (ADR 0200 decision 5). */
  readonly workingFolder: readonly string[];
  /** Moves the session's working folder; `cd` is the only built-in that calls it. */
  readonly changeFolder: (steps: readonly string[]) => void;
  readonly list: ListById;
  readonly read: (entryId: string) => Promise<FileRead>;
  /** Whether this platform compares names without case. */
  readonly caseless: boolean;
  /** The Explorer's own writes, for the file commands that change the folder (TYTO-537). */
  readonly writes: PanelWrites;
}

/**
 * What the file commands that write reach (TYTO-537, ADR 0201 decision 5): the Explorer's own
 * window ports, so a tab follows a move and lets go of a file sent to the bin as it does there.
 */
export interface PanelWrites {
  /** `explorer:create`; `brief` is the skeleton text of `new x.brief --template t`. */
  readonly create: (
    parentId: string | null,
    name: string,
    kind: 'file' | 'folder',
    brief?: string,
  ) => Promise<IpcResponse<'explorer:create'>>;
  /** `explorer:rename` into the folder `parentId` names: `mv`. */
  readonly move: (
    entryId: string,
    parentId: string | null,
    name: string,
  ) => Promise<IpcResponse<'explorer:rename'>>;
  readonly copy: (
    entryId: string,
    parentId: string | null,
    name: string,
  ) => Promise<IpcResponse<'explorer:copy'>>;
  /** How many tabs under an entry hold unsaved text: `rm` asks first only then. */
  readonly unsavedUnder: (entryId: string) => Promise<number>;
  /** The Explorer's question before a delete, answered in the window's own box. */
  readonly confirmRemove: (
    entry: { readonly name: string; readonly kind: 'folder' | 'brief' | 'file' },
    unsaved: number,
  ) => Promise<boolean>;
  /** `explorer:delete`: the system's bin and nothing else. */
  readonly remove: (entryId: string) => Promise<IpcResponse<'explorer:delete'>>;
  /** Opens the file in a tab as the Explorer does; answers whether a tab opened. */
  readonly open: (entryId: string) => Promise<boolean>;
  /** Selects the entry in the Explorer, expanding the folders on the way. */
  readonly reveal: (ids: readonly string[]) => void;
  /** The skeleton the window writes for a template, or none for a name it does not know. */
  readonly skeletonOf: (template: string) => string | undefined;
  /** The system's bin by its name on this platform, for what `rm` says. */
  readonly bin: string;
}

export interface PanelBuiltin {
  readonly name: string;
  /** Other names it answers to (`cls` for `clear`). */
  readonly aliases?: readonly string[];
  /** The line `help` and completion show for it. */
  readonly help: CatalogueKey;
  /**
   * Whether it runs in a restricted folder. One that only reads does (ADR 0201); one that
   * writes does not. A `tyto` command one runs keeps its own trust rules either way.
   */
  readonly runsInRestrictedFolder: boolean;
  /** What its arguments are, for completion: paths under the working folder (TYTO-537). */
  readonly arguments?: 'folder' | 'path';
  readonly run: (context: BuiltinContext) => Promise<BuiltinOutcome> | BuiltinOutcome;
}

export class BuiltinRegistry {
  private readonly byName = new Map<string, PanelBuiltin>();

  constructor(readonly entries: readonly PanelBuiltin[]) {
    for (const entry of entries) {
      for (const name of [entry.name, ...(entry.aliases ?? [])]) {
        if (this.byName.has(name)) throw new Error(`two built-ins named ${name}`);
        this.byName.set(name, entry);
      }
    }
  }

  /** The built-in a step's first word names; a quoted word names none, so it reaches `tyto`. */
  find(first: LineWord | undefined): PanelBuiltin | undefined {
    if (first === undefined || first.quoted) return undefined;
    return this.byName.get(first.text);
  }

  /** Every name and alias, sorted: completion's first word. */
  names(): readonly { readonly name: string; readonly entry: PanelBuiltin }[] {
    return [...this.byName]
      .map(([name, entry]) => ({ name, entry }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

/** The single `tyto` command a history line holds, or `undefined`: what `last` may rerun. */
export function tytoCommandOf(
  line: string,
  registry: BuiltinRegistry,
): readonly string[] | undefined {
  const parsed = parseCommandLine(line);
  if (!parsed.ok || parsed.steps.length !== 1) return undefined;
  const words = parsed.steps[0]?.words ?? [];
  const first = words[0];
  if (first === undefined) return undefined;
  if (!first.quoted && first.text === 'tyto') return words.slice(1).map((word) => word.text);
  if (registry.find(first) !== undefined) return undefined;
  if (!first.quoted && /^!\d+$/u.test(first.text)) return undefined;
  return words.map((word) => word.text);
}

const clear: PanelBuiltin = {
  name: 'clear',
  aliases: ['cls'],
  help: 'commandPanel.builtin.clear',
  runsInRestrictedFolder: true,
  run: (context) => {
    context.clear();
    return { kind: 'acted', ok: true };
  },
};

const history: PanelBuiltin = {
  name: 'history',
  help: 'commandPanel.builtin.history',
  runsInRestrictedFolder: true,
  run: (context) => {
    const lines = context.history();
    const width = String(lines.length).length;
    return {
      kind: 'printed',
      lines:
        lines.length === 0
          ? [context.say('commandPanel.builtin.history.empty')]
          : lines.map((line, index) => `${String(index + 1).padStart(width)}  ${line}`),
    };
  },
};

const exit: PanelBuiltin = {
  name: 'exit',
  help: 'commandPanel.builtin.exit',
  runsInRestrictedFolder: true,
  run: (context) => {
    context.exit();
    return { kind: 'ended' };
  },
};

const last: PanelBuiltin = {
  name: 'last',
  help: 'commandPanel.builtin.last',
  runsInRestrictedFolder: true,
  run: async (context) => {
    const entries = context.history();
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const line = entries[index] ?? '';
      const words = tytoCommandOf(line, context.registry);
      if (words !== undefined) return { kind: 'acted', ok: await context.runTyto(line, words) };
    }
    return {
      kind: 'printed',
      lines: [context.say('commandPanel.builtin.last.none')],
      failed: true,
    };
  },
};

/** The column a list of names is padded to, so the help lines start together. */
const pad = (names: readonly string[]): number => Math.max(0, ...names.map((name) => name.length));

const help: PanelBuiltin = {
  name: 'help',
  help: 'commandPanel.builtin.help',
  runsInRestrictedFolder: true,
  run: async (context) => {
    const asked = context.args.map((word) => word.text);
    if (asked.length > 0) {
      const own = context.registry.find(context.args[0]);
      if (own !== undefined && asked.length === 1) {
        return { kind: 'printed', lines: [`${asked[0] ?? ''}  ${context.say(own.help)}`] };
      }
      // A `tyto` command's own help, from the CLI itself.
      const words = [...asked, '--help'];
      return { kind: 'acted', ok: await context.runTyto(words.join(' '), words) };
    }
    const own = context.registry.entries.map((entry) => ({
      name: [entry.name, ...(entry.aliases ?? [])].join(', '),
      text: context.say(entry.help),
    }));
    const syntax = [
      { name: '!N', text: context.say('commandPanel.builtin.rerun') },
      { name: 'a && b', text: context.say('commandPanel.builtin.and') },
      { name: '*  ?', text: context.say('commandPanel.builtin.glob') },
      { name: '$name', text: context.say('commandPanel.builtin.variable') },
    ];
    const commands = await context.commands();
    const width = pad([...own, ...syntax, ...commands].map((item) => item.name));
    const row = (name: string, text: string): string => `  ${name.padEnd(width)}  ${text}`;
    return {
      kind: 'printed',
      lines: [
        context.say('commandPanel.builtin.help.panel'),
        ...own.map((item) => row(item.name, item.text)),
        ...syntax.map((item) => row(item.name, item.text)),
        '',
        context.say('commandPanel.builtin.help.tyto'),
        ...commands.map((command) => row(command.name, command.description)),
      ],
    };
  },
};

/** The panel's built-ins, in the order `help` lists them. */
export const PANEL_BUILTINS = new BuiltinRegistry([
  help,
  ...FILE_BUILTINS,
  ...FILE_WRITES,
  ...ALIAS_BUILTINS,
  clear,
  history,
  last,
  exit,
]);
