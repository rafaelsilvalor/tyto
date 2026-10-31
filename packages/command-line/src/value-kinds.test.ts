import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { type CommandDescription, commandTree } from './commands.js';
import type { CliEnvironment } from './environment.js';
import { BUILT_IN_TYPES, valuesOf } from './value-kinds.js';

/**
 * What an argument or an option takes, said beside its definition and read by the window's
 * completion (TYTO-496): refused for a name the command does not declare, and present on every
 * place a path is typed.
 */

const environment: CliEnvironment = {
  console: { out: () => undefined, err: () => undefined },
  version: '0.0.0-test',
  cwd: '.',
  rasterizer: () => {
    throw new Error('this test rasters nothing');
  },
};

const tree = commandTree(environment);

const find = (path: readonly string[]): CommandDescription | undefined =>
  path.reduce<CommandDescription | undefined>(
    (node, name) => node?.commands.find((command) => command.name === name),
    tree,
  );

describe('saying what a value is', () => {
  it('refuses a name the command does not declare', () => {
    const command = new Command('render').argument('<brief>').option('--out <dir>');
    expect(() => valuesOf(command, { '--outt': { kind: 'folder' } })).toThrow(
      "'render' declares no --outt",
    );
    expect(() => valuesOf(command, { '<brf>': { kind: 'brief' } })).toThrow(
      "'render' declares no <brf>",
    );
    expect(() => valuesOf(command, { '<brief>': { kind: 'brief' } })).not.toThrow();
  });
});

describe('the tree the window completes from', () => {
  it('carries each value, the flags and whether an option takes one', () => {
    const render = find(['render']);
    const option = (long: string) => render?.options.find((each) => each.long === long);

    expect(render?.arguments[0]?.value).toEqual({ kind: 'brief' });
    expect(option('--template')).toMatchObject({
      short: '-t',
      takesValue: true,
      value: { kind: 'template' },
    });
    expect(option('--types')?.value).toEqual({
      kind: 'types',
      list: true,
      choices: [...BUILT_IN_TYPES],
    });
    expect(option('--json')).toMatchObject({ takesValue: false });
    expect(option('--json')?.value).toBeUndefined();
    expect(find(['plugin', 'disable'])?.arguments[0]?.value).toEqual({ kind: 'plugin' });
    expect(find(['delivery', 'new'])?.options[0]?.value).toEqual({ kind: 'template' });
  });

  it('says what every path is, so a new one cannot be left out of completion', () => {
    const paths = /^(?:dir|path|folder|brief)$/u;
    const missing: string[] = [];
    const walk = (node: CommandDescription, at: string): void => {
      for (const argument of node.arguments) {
        if (paths.test(argument.name) && argument.value === undefined) {
          missing.push(`${at} <${argument.name}>`);
        }
      }
      for (const option of node.options) {
        const placeholder = /<(\w+)>/u.exec(option.flags)?.[1] ?? '';
        if (paths.test(placeholder) && option.value === undefined) {
          missing.push(`${at} ${option.flags}`);
        }
      }
      for (const child of node.commands) walk(child, `${at} ${child.name}`);
    };
    walk(tree, 'tyto');

    expect(missing).toEqual([]);
  });
});
