import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import {
  type Diagnostic,
  PROJECT_DIRECTORY,
  PROJECT_FILE_NAME,
  type ResolvedProject,
  type Trust,
  type TrustStore,
  diagnostic,
  projectPaths,
  resolveProject,
} from '@tyto/core';

import { isInside } from './contain.js';
import { readProjectText } from './project-file.js';

/**
 * A workspace folder on a real disk: where it is, what its project file says, and whether
 * the person trusts it (TYTO-278, ADR 0111, ADR 0112).
 *
 * `core` resolves the file and confines a restricted folder lexically. This is where the
 * second half of ADR 0111's confinement happens, because it needs the disk: every path that
 * passed is followed through `realpath`, and one that a junction or a symbolic link carries
 * out of the folder is refused like one that climbed out with `..`.
 */

export interface LoadedWorkspace {
  /** The folder, as its real path. */
  readonly folder: string;
  /** Its `.tyto/project.json`, which may not exist: a folder with none is a workspace too. */
  readonly file: string;
  /** The file's text, empty when there is none, so a diagnostic's range has something to index. */
  readonly text: string;
  readonly exists: boolean;
  readonly trust: Trust;
  readonly project: ResolvedProject;
  /** About the file, indexing {@link text}. */
  readonly diagnostics: readonly Diagnostic[];
  /** About the trust answer, which no text holds: a `trust.json` that could not be read. */
  readonly trustDiagnostics: readonly Diagnostic[];
}

export interface LoadWorkspaceOptions {
  readonly trustStore: TrustStore;
  /**
   * `TYTO_HOME`, when there is one. A folder whose `.tyto` **is** that folder is never read
   * as a workspace (ADR 0112): its `.tyto/` holds `plugins/` and `trust.json`, and nothing in
   * it is a project's own content.
   */
  readonly home?: string;
  /** `tyto render --trust`: trusted for this run, and never written to the store (ADR 0111). */
  readonly trustForThisRun?: boolean;
}

/** The project file's path inside a workspace folder. */
export function projectFileOf(folder: string): string {
  return join(folder, PROJECT_DIRECTORY, PROJECT_FILE_NAME);
}

/**
 * The workspace `start` is in: the nearest folder at or above it holding a
 * `.tyto/project.json`.
 *
 * The walk stops at whichever comes first (ADR 0112): that folder, a folder whose `.tyto` is
 * `TYTO_HOME` — usually the home directory, which is not anybody's project — or the root.
 */
export async function findWorkspace(
  start: string,
  options: { readonly home?: string } = {},
): Promise<string | undefined> {
  let folder = resolve(start);
  for (;;) {
    if (options.home !== undefined && (await isTytoHome(folder, options.home))) return undefined;
    if (await isFile(projectFileOf(folder))) return folder;
    const parent = dirname(folder);
    if (parent === folder) return undefined;
    folder = parent;
  }
}

/**
 * Reads a workspace folder, or answers `undefined` for the one folder that is never one:
 * the folder whose `.tyto` is `TYTO_HOME`.
 */
export async function loadWorkspace(
  folder: string,
  options: LoadWorkspaceOptions,
): Promise<LoadedWorkspace | undefined> {
  const real = await realOrResolved(folder);
  if (options.home !== undefined && (await isTytoHome(real, options.home))) return undefined;

  const file = projectFileOf(real);
  const read = await readText(file);
  const answer =
    options.trustForThisRun === true
      ? { trust: 'trusted' as const, diagnostics: [] }
      : await options.trustStore.trustOf(real);

  const text = readProjectText(read.text);
  const layers = [
    { kind: 'folder' as const, root: real, entries: text.entries, trust: answer.trust },
  ];

  // Every path the lexical check let through, followed to where it really is. Asked before
  // resolving because the resolver is synchronous and pure; the answers are a lookup to it.
  const outside = new Set<string>();
  for (const candidate of projectPaths(layers)) {
    if (!isInside(real, await realOfNearest(candidate.path))) outside.add(candidate.path);
  }
  const project = resolveProject(layers, { leadsOutside: (_layer, path) => outside.has(path) });

  return {
    folder: real,
    file,
    text: read.text,
    exists: read.exists,
    trust: answer.trust,
    project,
    diagnostics: [...read.diagnostics, ...text.syntax, ...(project.diagnostics[0] ?? [])],
    trustDiagnostics: answer.diagnostics,
  };
}

async function readText(file: string): Promise<{
  readonly text: string;
  readonly exists: boolean;
  readonly diagnostics: readonly Diagnostic[];
}> {
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

/** Whether `folder/.tyto` and `home` are one folder once links are followed. */
async function isTytoHome(folder: string, home: string): Promise<boolean> {
  const own = join(folder, PROJECT_DIRECTORY);
  const [ownReal, homeReal] = await Promise.all([realOrResolved(own), realOrResolved(home)]);
  return relative(ownReal, homeReal) === '';
}

/**
 * The real path of `path`, or of its nearest existing ancestor with the rest appended.
 *
 * An output folder is usually not there yet, and `realpath` refuses a path that is not; but a
 * link on the way to it still decides where it would be created, so the part that exists is
 * followed and the rest, which cannot be a link, is kept as written.
 */
async function realOfNearest(path: string): Promise<string> {
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

async function realOrResolved(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function isMissing(cause: unknown): boolean {
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
