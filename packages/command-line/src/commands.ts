import type { Command } from 'commander';

import type { CliEnvironment } from './environment.js';
import { createProgram } from './program.js';
import { type ValueDescription, argumentValue, optionValue } from './value-kinds.js';

/**
 * The command tree as data: what the window's panel offers for help and completion
 * (`cli:commands`, ADR 0159 decision 5), read off the same program `run` parses, so the two
 * can never list different commands.
 */
export interface CommandDescription {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly {
    readonly name: string;
    readonly required: boolean;
    readonly description: string;
    /** What it takes, for completion (TYTO-496, `value-kinds.ts`). */
    readonly value?: ValueDescription;
  }[];
  readonly options: readonly {
    readonly flags: string;
    readonly description: string;
    /** `--templates`, and `-t` where there is a short one. */
    readonly long?: string;
    readonly short?: string;
    /** Whether the word after it is its value (`<dir>`, `[n]`), not a flag of its own. */
    readonly takesValue: boolean;
    readonly value?: ValueDescription;
  }[];
  readonly commands: readonly CommandDescription[];
}

function describe(command: Command): CommandDescription {
  return {
    name: command.name(),
    description: command.description(),
    arguments: command.registeredArguments.map((argument) => {
      const value = argumentValue(command, argument.name());
      return {
        name: argument.name(),
        required: argument.required,
        description: argument.description,
        ...(value === undefined ? {} : { value }),
      };
    }),
    options: command.options.map((option) => {
      const value = optionValue(command, option.long);
      return {
        flags: option.flags,
        description: option.description,
        ...(option.long === undefined ? {} : { long: option.long }),
        ...(option.short === undefined ? {} : { short: option.short }),
        takesValue: option.required || option.optional,
        ...(value === undefined ? {} : { value }),
      };
    }),
    commands: command.commands.map(describe),
  };
}

/**
 * Built and never parsed: building only declares commands and options, and no action runs,
 * so nothing in `environment` is reached but the version `--version` prints.
 */
export function commandTree(environment: CliEnvironment): CommandDescription {
  return describe(createProgram(environment, { code: 0 }));
}
