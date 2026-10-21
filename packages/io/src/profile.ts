import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  type Diagnostic,
  PROFILES_DIRECTORY,
  PROFILE_FILE_NAME,
  type ProfileReference,
  type ProjectEntry,
  type Trust,
  type TrustStore,
  diagnostic,
} from '@tyto/core';

import { isInside } from './contain.js';
import { readProjectText } from './project-file.js';
import { readSheet, realOfNearest, realOrResolved } from './real-paths.js';

/**
 * The work profile a workspace names, read from the disk (TYTO-347, ADR 0114).
 *
 * `core` decided which form the `profile` key took and, for a path in a restricted folder,
 * refused one that climbs out lexically. This finds the file, refuses a path a link carries
 * out of a restricted folder, and asks for the profile's **own** trust answer: trust never
 * travels along a reference (ADR 0111), so a trusted folder naming a profile does not vouch
 * for it, and a restricted one does not hold it back.
 */

export interface LoadedProfile {
  /** What the `profile` key said, as `core` read it. */
  readonly reference: ProfileReference;
  /** The profile file, as its real path. */
  readonly file: string;
  /** The folder its relative paths resolve against: the one holding the file. */
  readonly root: string;
  /** The file's text, so a diagnostic's range has something to index. */
  readonly text: string;
  readonly entries: readonly ProjectEntry[];
  readonly trust: Trust;
  /** About the file, indexing {@link text}: its syntax and its read. */
  readonly diagnostics: readonly Diagnostic[];
  /** About the trust answer, which no text holds. */
  readonly trustDiagnostics: readonly Diagnostic[];
}

export interface ProfileLoad {
  /** `undefined` when the profile is not there or may not be followed. */
  readonly profile: LoadedProfile | undefined;
  /** For the workspace's own file, at the `profile` key: why no profile was read. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface LoadProfileOptions {
  /** The workspace folder naming the profile, as its real path. */
  readonly folder: string;
  /** The workspace's trust: a restricted folder's path stays inside it, after links too. */
  readonly folderTrust: Trust;
  readonly trustStore: TrustStore;
  readonly home?: string;
  /** `tyto render --trust`, which the person typed for every source the run reads. */
  readonly trustForThisRun?: boolean;
}

export async function loadProfile(
  reference: ProfileReference,
  options: LoadProfileOptions,
): Promise<ProfileLoad> {
  const range = reference.range === undefined ? {} : { range: reference.range };
  if (reference.kind === 'name' && options.home === undefined) {
    // No home, no profiles folder: said as plainly as a profile that is not in it.
    const path = join('TYTO_HOME', PROFILES_DIRECTORY, reference.name, PROFILE_FILE_NAME);
    return {
      profile: undefined,
      diagnostics: [
        diagnostic('W_PROJECT_PROFILE_MISSING', { profile: reference.written, path }, range),
      ],
    };
  }
  const located = await locate(reference, options);
  if (located === 'outside') {
    return {
      profile: undefined,
      diagnostics: [
        diagnostic('W_PROJECT_PATH_OUTSIDE', { key: 'profile', path: reference.written }, range),
      ],
    };
  }

  const read = await readSheet(located);
  if (!read.exists) {
    return {
      profile: undefined,
      diagnostics: [
        diagnostic(
          'W_PROJECT_PROFILE_MISSING',
          { profile: reference.written, path: located },
          range,
        ),
      ],
    };
  }

  const file = await realOrResolved(located);
  const answer = await trustOf(file, options);
  const text = readProjectText(read.text);
  return {
    profile: {
      reference,
      file,
      root: dirname(file),
      text: read.text,
      entries: text.entries,
      trust: answer.trust,
      diagnostics: [...read.diagnostics, ...text.syntax],
      trustDiagnostics: answer.diagnostics,
    },
    diagnostics: [],
  };
}

/**
 * Where the profile file is, or `'outside'` for a path a restricted folder may not follow.
 *
 * A name is a folder under `TYTO_HOME/profiles/`, and a path that names a folder means the
 * `profile.json` in it, so the two forms describe one layout. On Windows the name is found
 * without case because the file system finds it so; elsewhere `Saude` and `saude` are two.
 */
async function locate(
  reference: ProfileReference,
  options: LoadProfileOptions,
): Promise<string | 'outside'> {
  if (reference.kind === 'name') {
    return join(options.home ?? '', PROFILES_DIRECTORY, reference.name, PROFILE_FILE_NAME);
  }
  const file = (await isFolder(reference.path))
    ? join(reference.path, PROFILE_FILE_NAME)
    : reference.path;
  // The file itself, followed: a `profile.json` that is a link out of the folder is outside
  // as surely as a folder on the way to it.
  if (
    options.folderTrust === 'restricted' &&
    !isInside(options.folder, await realOfNearest(file))
  ) {
    return 'outside';
  }
  return file;
}

/**
 * The profile's own answer (ADR 0111): trusted by location inside `TYTO_HOME`, which only the
 * person writes to; trusted for this run when the person typed `--trust`; otherwise whatever
 * `trust.json` says about the profile file itself.
 */
async function trustOf(
  file: string,
  options: LoadProfileOptions,
): Promise<{ readonly trust: Trust; readonly diagnostics: readonly Diagnostic[] }> {
  if (options.home !== undefined && isInside(await realOrResolved(options.home), file)) {
    return { trust: 'trusted', diagnostics: [] };
  }
  if (options.trustForThisRun === true) return { trust: 'trusted', diagnostics: [] };
  return options.trustStore.trustOf(file);
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
