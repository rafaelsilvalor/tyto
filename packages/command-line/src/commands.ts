import type { Command } from 'commander';

import type { CliEnvironment } from './environment.js';
import { createProgram } from './program.js';

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
  }[];
  readonly options: readonly { readonly flags: string; readonly description: string }[];
  readonly commands: readonly CommandDescription[];
}

function describe(command: Command): CommandDescription {
  return {
    name: command.name(),
    description: command.description(),
    arguments: command.registeredArguments.map((argument) => ({
      name: argument.name(),
      required: argument.required,
      description: argument.description,
    })),
    options: command.options.map((option) => ({
      flags: option.flags,
      description: option.description,
    })),
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
