import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { BUILT_IN_FORMATS, BUILT_IN_PACK } from './paths.ts';
import {
  type TemplateRepository,
  readTemplateRepository,
  repositoryTemplates,
} from './repository.ts';
import type { PreviewTarget } from './session.ts';

/**
 * Turns the command line into the one render this tool repeats.
 *
 * `<template>` is a name in the built-in pack, a path to a template folder, or a path to a
 * template's own repository — the folder with its `tyto-plugin.json` (TYTO-485). Everything
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

/**
 * The template folder a repository argument means, and the repository: its root names the one
 * template under `templates/`, and `templates/<name>` inside one names that template.
 */
function inRepository(
  folder: string,
): { readonly folder: string; readonly repository: TemplateRepository } | undefined {
  const atRoot = readTemplateRepository(folder);
  if (atRoot !== undefined) {
    const names = repositoryTemplates(atRoot);
    if (names.length !== 1) {
      throw new UsageError(
        names.length === 0
          ? `${folder} has a tyto-plugin.json and no templates/<name>/manifest.yaml`
          : `${folder} holds ${String(names.length)} templates (${names.join(', ')}); ` +
              `name one as ${join(folder, 'templates', '<name>')}`,
      );
    }
    return { folder: join(folder, 'templates', names[0] ?? ''), repository: atRoot };
  }
  const templates = dirname(folder);
  if (basename(templates) !== 'templates') return undefined;
  const around = readTemplateRepository(dirname(templates));
  return around === undefined ? undefined : { folder, repository: around };
}

export function resolveTarget(argumentsGiven: PreviewArguments, cwd: string): PreviewTarget {
  const asPath = resolve(cwd, argumentsGiven.template);
  const found = isDirectory(asPath) ? inRepository(asPath) : undefined;
  const folder =
    found?.folder ?? (isDirectory(asPath) ? asPath : join(BUILT_IN_PACK, argumentsGiven.template));
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
    // is `@tyto/templates` — or, for a template in its own repository, the plugin's bundle,
    // which the preview builds and installs (TYTO-485). A `template.ts` anywhere else is inert,
    // and `tyto render` says so.
    compiled:
      found !== undefined ||
      (isInside(BUILT_IN_PACK, folder) && existsSync(join(folder, 'template.ts'))),
    ...(found === undefined ? {} : { repository: found.repository }),
  };
}
