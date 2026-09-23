import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { BUILT_IN_FORMATS, BUILT_IN_PACK } from './paths.ts';
import type { PreviewTarget } from './session.ts';

/**
 * Turns the command line into the one render this tool repeats.
 *
 * `<template>` is a name in the built-in pack or a path to a template folder. Everything
 * else has a default a person would have typed anyway: the first brief in the template's
 * `examples/`, the folder around the template as `--templates`, and that folder's
 * `formats.yaml` — or the pack's, when it has none.
 */

export interface PreviewArguments {
  readonly template: string;
  readonly brief?: string;
  readonly formatsFile?: string;
  readonly types?: readonly string[];
  readonly port?: number;
}

export const DEFAULT_PORT = 4174;
export const DEFAULT_TYPES = ['png'] as const;

export class UsageError extends Error {}

export function parseArguments(argv: readonly string[]): PreviewArguments {
  let template: string | undefined;
  const options: { brief?: string; formatsFile?: string; types?: string[]; port?: number } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined) throw new UsageError(`${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === '--') continue;
    else if (argument === '--brief') options.brief = value();
    else if (argument === '--formats-file') options.formatsFile = value();
    else if (argument === '--types') options.types = value().split(',');
    else if (argument === '--port') {
      const port = Number(value());
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new UsageError('--port takes a port number');
      }
      options.port = port;
    } else if (argument.startsWith('-')) throw new UsageError(`unknown option ${argument}`);
    else if (template === undefined) template = argument;
    else throw new UsageError(`one template at a time; got ${template} and ${argument}`);
  }

  if (template === undefined) {
    throw new UsageError(
      'usage: pnpm template:preview <template-name-or-folder> [--brief <file>] ' +
        '[--formats-file <file>] [--types png,svg] [--port <n>]',
    );
  }
  return { template, ...options };
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function isInside(folder: string, path: string): boolean {
  const inside = relative(folder, path);
  return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside);
}

export function resolveTarget(argumentsGiven: PreviewArguments, cwd: string): PreviewTarget {
  const asPath = resolve(cwd, argumentsGiven.template);
  const folder = isDirectory(asPath) ? asPath : join(BUILT_IN_PACK, argumentsGiven.template);
  if (!existsSync(join(folder, 'manifest.yaml'))) {
    throw new UsageError(
      `${argumentsGiven.template} is neither a template folder nor a template in the built-in pack`,
    );
  }

  let brief: string;
  if (argumentsGiven.brief !== undefined) {
    brief = resolve(cwd, argumentsGiven.brief);
  } else {
    const examples = join(folder, 'examples');
    const first = isDirectory(examples)
      ? readdirSync(examples)
          .filter((name) => name.endsWith('.brief'))
          .sort()[0]
      : undefined;
    if (first === undefined) {
      throw new UsageError(`${folder} has no examples/*.brief; name one with --brief`);
    }
    brief = join(examples, first);
  }

  const templates = dirname(folder);
  const beside = join(templates, 'formats.yaml');
  const formatsFile =
    argumentsGiven.formatsFile !== undefined
      ? resolve(cwd, argumentsGiven.formatsFile)
      : existsSync(beside)
        ? beside
        : BUILT_IN_FORMATS;

  return {
    template: basename(folder),
    brief,
    templates,
    formatsFile,
    types: argumentsGiven.types ?? DEFAULT_TYPES,
    // Code runs only when it is compiled into the build (ADR 0007, TYTO-166), and the build
    // is `@tyto/templates`. A `template.ts` anywhere else is inert, and `tyto render` says so.
    compiled: isInside(BUILT_IN_PACK, folder) && existsSync(join(folder, 'template.ts')),
  };
}
