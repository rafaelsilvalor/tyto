import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { type Diagnostic, diagnostic } from '@tyto/core';

/**
 * The disk work a workspace folder and its work profile share (ADR 0111, ADR 0112, ADR 0114):
 * reading a sheet's text, and following a path through `realpath` so a link that leads out of
 * a source is seen for what it is.
 */

export interface SheetText {
  readonly text: string;
  readonly exists: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** A sheet's text; one that is not there is empty, and one that cannot be read says why. */
export async function readSheet(file: string): Promise<SheetText> {
  try {
    return { text: await readFile(file, 'utf8'), exists: true, diagnostics: [] };
  } catch (cause) {
    if (isMissing(cause)) return { text: '', exists: false, diagnostics: [] };
    return {
      text: '',
      exists: true,
      diagnostics: [diagnostic('E_PROJECT_SYNTAX', { problem: describeError(cause) })],
    };
  }
}

/**
 * The real path of `path`, or of its nearest existing ancestor with the rest appended.
 *
 * An output folder is usually not there yet, and `realpath` refuses a path that is not; but a
 * link on the way to it still decides where it would be created, so the part that exists is
 * followed and the rest, which cannot be a link, is kept as written.
 */
export async function realOfNearest(path: string): Promise<string> {
  let existing = resolve(path);
  const rest: string[] = [];
  for (;;) {
    try {
      return join(await realpath(existing), ...rest.reverse());
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return resolve(path);
      rest.push(relative(parent, existing));
      existing = parent;
    }
  }
}

export async function realOrResolved(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

export function isMissing(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause.code === 'ENOENT' || cause.code === 'ENOTDIR')
  );
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
