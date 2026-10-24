import { readFile, stat } from 'node:fs/promises';

import {
  type Diagnostic,
  type Result,
  type Trust,
  diagnostic,
  err,
  isAbsolutePath,
  isInsidePath,
  ok,
  resolvePath,
} from '@tyto/core';
import type { DataResolver } from '@tyto/plugin-api';

import { isInside } from './contain.js';
import { readJsoncValue } from './jsonc-text.js';
import { isMissing, realOrResolved } from './real-paths.js';

/**
 * The workspace's answer to a recipe's `@./file.json#/pointer` (ADR 0136, ADR 0137).
 *
 * A data file is a colleague's input, not Tyto's: a shared recipe arrives with it, and the
 * recipe decides which path it names. So it is read on the terms ADR 0111 gives every path a
 * source writes. **A restricted workspace reads none**, because a rules file is the kind of
 * content a person has to have trusted before it steers a run. A trusted one reads only inside
 * its own folder, checked twice as ADR 0112 checks a place: lexically with `core`'s path
 * arithmetic, then again after `realpath`, so a link inside the folder that lands outside is
 * refused too. And a file is read only up to {@link DATA_FILE_MAX_BYTES}, because a pointer
 * names a slice and the whole file is still parsed to find it.
 */

/** 1 MiB: a vocabulary of a few thousand entries is tens of kilobytes. */
export const DATA_FILE_MAX_BYTES = 1024 * 1024;

export interface WorkspaceDataOptions {
  /** The workspace folder, absolute; `loadWorkspace`'s `folder`, which is its real path. */
  readonly workspaceFolder: string;
  /** The folder of the recipe being run, absolute. A reference's path is relative to it. */
  readonly recipeFolder: string;
  /** The workspace's answer from the trust store (ADR 0111). */
  readonly trust: Trust;
  /** A smaller cap, for a test; never a larger one than the default in an app. */
  readonly maxBytes?: number;
}

type Read = Result<unknown, readonly Diagnostic[]>;

export function workspaceDataResolver(options: WorkspaceDataOptions): DataResolver {
  const maxBytes = options.maxBytes ?? DATA_FILE_MAX_BYTES;
  return async (path) => {
    if (options.trust !== 'trusted') {
      return err([diagnostic('E_RECIPE_DATA_RESTRICTED', { reference: path })]);
    }
    const refuse = (problem: string): Read =>
      err([diagnostic('E_RECIPE_DATA', { reference: path, problem })]);

    // Lexical first: no disk is touched for a path that climbs out as written.
    const target = resolvePath(options.recipeFolder, path);
    if (isAbsolutePath(path) || !isInsidePath(options.workspaceFolder, target)) {
      return refuse('leaves the workspace folder, and a data file is read only inside it');
    }
    // Then the real path: a junction or a symbolic link inside the folder may lead out of it.
    const real = await realOrResolved(target);
    const realRoot = await realOrResolved(options.workspaceFolder);
    if (!isInside(realRoot, real)) {
      return refuse('leads out of the workspace folder through a link, and is not read');
    }

    let size: number;
    try {
      const found = await stat(real);
      if (!found.isFile()) return refuse('names a folder, not a file');
      size = found.size;
    } catch (cause) {
      if (isMissing(cause)) return refuse('names a file that was not found');
      return refuse(`cannot be read: ${describe(cause)}`);
    }
    if (size > maxBytes) return refuse(tooLarge(size, maxBytes));

    let text: string;
    try {
      const bytes = await readFile(real);
      // Measured again on what was read: the file may have grown since `stat`.
      if (bytes.byteLength > maxBytes) return refuse(tooLarge(bytes.byteLength, maxBytes));
      text = bytes.toString('utf8');
    } catch (cause) {
      return refuse(`cannot be read: ${describe(cause)}`);
    }

    const parsed = readJsoncValue(text);
    const [first] = parsed.problems;
    if (first !== undefined) {
      return err([diagnostic('E_RECIPE_DATA_SYNTAX', { reference: path, problem: first })]);
    }
    return ok(parsed.value);
  };
}

function tooLarge(size: number, maxBytes: number): string {
  return `is ${String(size)} bytes, above the ${String(maxBytes)} a data file may hold`;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
