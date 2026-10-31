import type { BuiltInKind } from '@tyto/pipeline';
import type { Command } from 'commander';

/**
 * What a command's argument or option takes, for completion in the window's command panel
 * (TYTO-496, ADR 0159 decision 5).
 *
 * **Written beside each definition in `program.ts`, never as a second list.** `valuesOf` names
 * the argument or option of the command it is called on, and refuses a name the command does not
 * declare: a renamed option fails `createProgram` and every test that builds it, instead of
 * leaving completion offering a word nothing accepts. Commander's own `choices` would also check
 * the value, which would change what the CLI refuses; this changes nothing a command does.
 */

export type ValueKind =
  /** A `.brief` file. */
  | 'brief'
  /** Any file. */
  | 'file'
  | 'folder'
  /** A template's or an alias's name. */
  | 'template'
  /** Format ids, comma-separated. */
  | 'formats'
  /** Output kinds, comma-separated: the built-in ones in `choices`. */
  | 'types'
  /** An installed plugin's name. */
  | 'plugin';

export interface ValueDescription {
  readonly kind: ValueKind;
  /** The words a value can be, when they are known before anything is installed. */
  readonly choices?: readonly string[];
  /** Several values joined by commas. */
  readonly list?: boolean;
}

/** The four kinds every Tyto renders; an installed exporter's kind is typed out. */
export const BUILT_IN_TYPES = [
  'png',
  'jpeg',
  'webp',
  'svg',
] as const satisfies readonly BuiltInKind[];

// Every built-in kind is listed: a fifth one in `@tyto/pipeline` fails this line.
type Unlisted = Exclude<BuiltInKind, (typeof BUILT_IN_TYPES)[number]>;
export const BUILT_IN_TYPES_ARE_ALL: [Unlisted] extends [never] ? true : never = true;

const VALUES = new WeakMap<Command, ReadonlyMap<string, ValueDescription>>();

/** The key of an argument (`<brief>`) or an option (`--templates`), as `valuesOf` takes it. */
const argumentKey = (name: string): string => `<${name}>`;

/**
 * Says what `command`'s arguments and options take, keyed as `<name>` for an argument and by the
 * long flag for an option. Throws for a key the command does not declare.
 */
export function valuesOf<T extends Command>(
  command: T,
  values: Readonly<Record<string, ValueDescription>>,
): T {
  const declared = new Set([
    ...command.registeredArguments.map((argument) => argumentKey(argument.name())),
    ...command.options.flatMap((option) => (option.long === undefined ? [] : [option.long])),
  ]);
  for (const key of Object.keys(values)) {
    if (!declared.has(key)) {
      throw new Error(
        `'${command.name()}' declares no ${key}, so it can say nothing about its value`,
      );
    }
  }
  VALUES.set(command, new Map([...(VALUES.get(command) ?? []), ...Object.entries(values)]));
  return command;
}

/** What `valuesOf` said about an argument of `command`. */
export const argumentValue = (command: Command, name: string): ValueDescription | undefined =>
  VALUES.get(command)?.get(argumentKey(name));

/** What `valuesOf` said about an option of `command`, by its long flag. */
export const optionValue = (
  command: Command,
  long: string | undefined,
): ValueDescription | undefined =>
  long === undefined ? undefined : VALUES.get(command)?.get(long);
