import { ALIAS_NAME } from '@tyto/core';

import type { PanelAlias } from '../../shared/command-aliases.js';
import type { IpcResponse } from '../../shared/ipc.js';
import type { BuiltinContext, BuiltinOutcome, PanelBuiltin } from './command-builtins.js';
import { VARIABLE_NAME } from './command-aliases.js';

/**
 * `alias`, `unalias` and `set` (TYTO-536, ADR 0200 note of 2026-11-15): the panel's own
 * commands for its aliases and its session's variables.
 *
 * `alias name='line'` writes the person's `commandAliases` setting through `commands:set-alias`,
 * never a file of the window's own. A workspace's aliases are read here, and written by hand in
 * its `.tyto/project.json`.
 */

/** What the window says the aliases in force are, as `commands:aliases` answers. */
export type AliasesInForce = IpcResponse<'commands:aliases'>;

/** What the alias commands reach: main's aliases, and which names the panel keeps for itself. */
export interface PanelAliasPorts {
  readonly list: () => Promise<AliasesInForce>;
  readonly set: (name: string, body: string | null) => Promise<IpcResponse<'commands:set-alias'>>;
  /** A built-in's name or `tyto`: never an alias's (TYTO-536). */
  readonly reserved: (name: string) => boolean;
}

/** This session's variables, which only `set` changes. */
export interface PanelVariables {
  readonly all: () => ReadonlyMap<string, string>;
  readonly set: (name: string, value: string) => void;
}

const fill = (text: string, values: Readonly<Record<string, string>>): string =>
  text.replace(/\{(\w+)\}/gu, (whole, name: string) => values[name] ?? whole);

function failed(lines: readonly string[]): BuiltinOutcome {
  return { kind: 'printed', lines, failed: true };
}

function whereOf(context: BuiltinContext, alias: Pick<PanelAlias, 'definedIn'>): string {
  return context.say(
    alias.definedIn === 'user'
      ? 'commandPanel.alias.where.user'
      : 'commandPanel.alias.where.workspace',
  );
}

/** A name `alias` may write, or the line that says why not. */
function nameProblem(context: BuiltinContext, name: string): string | undefined {
  if (!ALIAS_NAME.test(name)) return fill(context.say('commandPanel.alias.badName'), { name });
  if (context.aliases.reserved(name))
    return fill(context.say('commandPanel.alias.reserved'), { name });
  return undefined;
}

const REFUSED_KEYS = {
  invalid: 'commandPanel.alias.refused.invalid',
  syntax: 'commandPanel.alias.refused.syntax',
} as const;

async function write(
  context: BuiltinContext,
  name: string,
  body: string | null,
): Promise<BuiltinOutcome> {
  const written = await context.aliases.set(name, body);
  if (!written.ok) {
    return failed([
      fill(context.say(REFUSED_KEYS[written.reason]), { name, where: 'settings.json' }),
    ]);
  }
  const key = body === null ? 'commandPanel.alias.removed.user' : 'commandPanel.alias.saved.user';
  return { kind: 'printed', lines: [fill(context.say(key), { name })] };
}

function listing(context: BuiltinContext, aliases: readonly PanelAlias[]): readonly string[] {
  const width = Math.max(0, ...aliases.map((alias) => alias.name.length));
  return aliases.map(
    (alias) => `${alias.name.padEnd(width)}  '${alias.body}'  (${whereOf(context, alias)})`,
  );
}

const alias: PanelBuiltin = {
  name: 'alias',
  help: 'commandPanel.builtin.alias',
  // Writing the person's own settings is not the folder's to allow.
  runsInRestrictedFolder: true,
  run: async (context) => {
    const words = context.args.map((word) => word.text);
    const inForce = await context.aliases.list();
    const usable = inForce.aliases.filter((each) => !context.aliases.reserved(each.name));
    if (words.length === 0) {
      return {
        kind: 'printed',
        lines:
          usable.length === 0 ? [context.say('commandPanel.alias.none')] : listing(context, usable),
      };
    }
    if (words.length > 1) return failed([context.say('commandPanel.alias.usage')]);
    const word = words[0] ?? '';
    const equals = word.indexOf('=');
    if (equals < 0) {
      const found = usable.find((each) => each.name === word);
      return found === undefined
        ? failed([fill(context.say('commandPanel.alias.unknown'), { name: word })])
        : { kind: 'printed', lines: listing(context, [found]) };
    }
    const name = word.slice(0, equals);
    const body = word.slice(equals + 1);
    const problem = nameProblem(context, name);
    if (problem !== undefined) return failed([problem]);
    if (body.trim() === '') return failed([context.say('commandPanel.alias.usage')]);
    return write(context, name, body);
  },
};

const unalias: PanelBuiltin = {
  name: 'unalias',
  help: 'commandPanel.builtin.unalias',
  runsInRestrictedFolder: true,
  run: async (context) => {
    const words = context.args.map((word) => word.text);
    const name = words[0];
    if (name === undefined || words.length > 1) {
      return failed([context.say('commandPanel.unalias.usage')]);
    }
    const inForce = await context.aliases.list();
    const found = inForce.aliases.find((each) => each.name === name);
    if (found === undefined) {
      return failed([fill(context.say('commandPanel.alias.unknown'), { name })]);
    }
    // The name in force may hide the person's own under the workspace's: say where it is.
    if (found.definedIn === 'workspace') {
      return failed([fill(context.say('commandPanel.alias.inWorkspace'), { name })]);
    }
    return write(context, name, null);
  },
};

const set: PanelBuiltin = {
  name: 'set',
  help: 'commandPanel.builtin.set',
  runsInRestrictedFolder: true,
  run: (context) => {
    const words = context.args.map((word) => word.text);
    if (words.length === 0) {
      const all = [...context.variables.all()].sort(([left], [right]) => left.localeCompare(right));
      return {
        kind: 'printed',
        lines:
          all.length === 0
            ? [context.say('commandPanel.variable.none')]
            : all.map(([name, value]) => `${name}=${value}`),
      };
    }
    const word = words[0] ?? '';
    const equals = word.indexOf('=');
    if (words.length > 1 || equals < 0) return failed([context.say('commandPanel.set.usage')]);
    const name = word.slice(0, equals);
    if (!VARIABLE_NAME.test(name)) {
      return failed([fill(context.say('commandPanel.variable.badName'), { name })]);
    }
    context.variables.set(name, word.slice(equals + 1));
    return { kind: 'acted', ok: true };
  },
};

/** The three, in the order `help` lists them. */
export const ALIAS_BUILTINS: readonly PanelBuiltin[] = [alias, unalias, set];
