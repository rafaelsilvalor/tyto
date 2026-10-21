import { stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import {
  type Diagnostic,
  PROJECT_DIRECTORY,
  PROJECT_FILE_NAME,
  type ProjectLayer,
  type ResolvedProject,
  type Trust,
  type TrustStore,
  profileReferenceOf,
  projectPaths,
  resolveProject,
} from '@tyto/core';

import { isInside } from './contain.js';
import { type LoadedProfile, type ProfileLoad, loadProfile } from './profile.js';
import { readProjectText } from './project-file.js';
import { readSheet, realOfNearest, realOrResolved } from './real-paths.js';

/**
 * A workspace folder on a real disk: where it is, what its project file says, and whether
 * the person trusts it (TYTO-278, ADR 0111, ADR 0112).
 *
 * `core` resolves the file and confines a restricted folder lexically. This is where the
 * second half of ADR 0111's confinement happens, because it needs the disk: every path that
 * passed is followed through `realpath`, and one that a junction or a symbolic link carries
 * out of the folder is refused like one that climbed out with `..`.
 *
 * A folder that names a work profile gets it as the sheet before its own (TYTO-347, ADR
 * 0114), read with its own trust answer and confined, when restricted, to its own folder.
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
  /**
   * The work profile the file names, when there is one to read. A profile that is missing or
   * refused is not here: the reason is a diagnostic in {@link diagnostics}, at the key.
   */
  readonly profile?: LoadedProfile;
}

export interface LoadWorkspaceOptions {
  readonly trustStore: TrustStore;
  /**
   * `TYTO_HOME`, when there is one. A folder whose `.tyto` **is** that folder is never read
   * as a workspace (ADR 0112): its `.tyto/` holds `plugins/` and `trust.json`, and nothing in
   * it is a project's own content. Named work profiles live in its `profiles/` (ADR 0114).
   */
  readonly home?: string;
  /**
   * `tyto render --trust`: the folder **and the profile it names** trusted for this run, and
   * never written to the store (ADR 0111, ADR 0114). The person typed it for the run, so it
   * covers what the run reads; it is not trust travelling from the folder to the profile.
   */
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
  const read = await readSheet(file);
  const answer =
    options.trustForThisRun === true
      ? { trust: 'trusted' as const, diagnostics: [] }
      : await options.trustStore.trustOf(real);

  const text = readProjectText(read.text);
  const own: ProjectLayer = {
    kind: 'folder',
    root: real,
    entries: text.entries,
    trust: answer.trust,
  };
  const named = profileReferenceOf(own);
  const loaded: ProfileLoad =
    named.reference === undefined
      ? { profile: undefined, diagnostics: [] }
      : await loadProfile(named.reference, {
          folder: real,
          folderTrust: answer.trust,
          trustStore: options.trustStore,
          ...(options.home === undefined ? {} : { home: options.home }),
          trustForThisRun: options.trustForThisRun === true,
        });
  const profile = loaded.profile;

  // The profile first, so the folder's own keys win (ADR 0112).
  const layers: readonly ProjectLayer[] =
    profile === undefined
      ? [own]
      : [
          { kind: 'profile', root: profile.root, entries: profile.entries, trust: profile.trust },
          own,
        ];
  const project = resolveProject(layers, { leadsOutside: await linkCheck(layers) });
  const ownIndex = layers.length - 1;

  return {
    folder: real,
    file,
    text: read.text,
    exists: read.exists,
    trust: answer.trust,
    project,
    diagnostics: [
      ...read.diagnostics,
      ...text.syntax,
      ...named.diagnostics,
      ...loaded.diagnostics,
      ...(project.diagnostics[ownIndex] ?? []),
    ],
    trustDiagnostics: answer.diagnostics,
    ...(profile === undefined
      ? {}
      : {
          profile: {
            ...profile,
            diagnostics: [...profile.diagnostics, ...(project.diagnostics[0] ?? [])],
            // One broken `trust.json` is one problem, not one per source that asked it.
            trustDiagnostics: profile.trustDiagnostics.filter(
              (item) => !answer.diagnostics.some((other) => other.message === item.message),
            ),
          },
        }),
  };
}

/**
 * Every path the lexical check let through, followed to where it really is and compared with
 * **its own sheet's** root: a restricted profile is confined to its folder, not to the
 * workspace that names it (ADR 0111). Asked before resolving because the resolver is
 * synchronous and pure; the answers are a lookup to it.
 */
async function linkCheck(
  layers: readonly ProjectLayer[],
): Promise<(layer: number, path: string) => boolean> {
  const outside = new Set<string>();
  const keyOf = (layer: number, path: string): string => `${String(layer)}:${path}`;
  for (const candidate of projectPaths(layers)) {
    const root = layers[candidate.layer]?.root;
    if (root === undefined || !isInside(root, await realOfNearest(candidate.path))) {
      outside.add(keyOf(candidate.layer, candidate.path));
    }
  }
  return (layer, path) => outside.has(keyOf(layer, path));
}

/** Whether `folder/.tyto` and `home` are one folder once links are followed. */
async function isTytoHome(folder: string, home: string): Promise<boolean> {
  const own = join(folder, PROJECT_DIRECTORY);
  const [ownReal, homeReal] = await Promise.all([realOrResolved(own), realOrResolved(home)]);
  return relative(ownReal, homeReal) === '';
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
