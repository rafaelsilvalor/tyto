import { dirname, join } from 'node:path';

import { type Diagnostics, type TrustStore, ok } from '@tyto/core';
import {
  type LoadedWorkspace,
  TRUST_FILE,
  findWorkspace,
  fsTrustStore,
  loadWorkspace,
} from '@tyto/io';

import type { CliEnvironment } from './environment.js';
import { registerOrigin } from './report.js';

/**
 * The workspace a brief on the command line belongs to (TYTO-278, ADR 0112).
 *
 * Found by walking up from the brief's folder, as `git` finds a repository, so `tyto render
 * briefs/promo.brief` inside a project needs nothing typed to use its folders. The walk and
 * what stops it are `@tyto/io`'s; this composes the trust store the window composes too
 * (ADR 0111: the CLI follows the same rule), and registers where each diagnostic points —
 * into the project file, or into the work profile it names (ADR 0114).
 */
export interface BriefWorkspace {
  readonly loaded: LoadedWorkspace;
  /** What the project file and the trust answer had to say, origins registered. */
  readonly diagnostics: Diagnostics;
}

/** Everything restricted, for an environment that names no home and so has no store. */
const NO_STORE: TrustStore = {
  trustOf: () => Promise.resolve({ trust: 'restricted', diagnostics: [] }),
  grant: () => Promise.resolve(ok(false)),
  revoke: () => Promise.resolve(ok(false)),
};

export async function workspaceOfBrief(
  briefPath: string,
  options: { readonly trust?: boolean },
  environment: CliEnvironment,
  shown: (path: string) => string,
): Promise<BriefWorkspace | undefined> {
  const home = environment.home;
  const folder = await findWorkspace(dirname(briefPath), home === undefined ? {} : { home });
  if (folder === undefined) return undefined;

  const loaded = await loadWorkspace(folder, {
    trustStore: home === undefined ? NO_STORE : fsTrustStore({ home }),
    ...(home === undefined ? {} : { home }),
    trustForThisRun: options.trust === true,
  });
  if (loaded === undefined) return undefined;

  registerOrigin(loaded.diagnostics, { path: shown(loaded.file), source: loaded.text });
  // A work profile's problems point into the profile's own file (ADR 0114).
  const profile = loaded.profile;
  if (profile !== undefined) {
    registerOrigin(profile.diagnostics, { path: shown(profile.file), source: profile.text });
  }
  const trustDiagnostics = [...loaded.trustDiagnostics, ...(profile?.trustDiagnostics ?? [])];
  if (home !== undefined) {
    registerOrigin(trustDiagnostics, { path: shown(join(home, TRUST_FILE)), source: '' });
  }
  return {
    loaded,
    diagnostics: [...trustDiagnostics, ...(profile?.diagnostics ?? []), ...loaded.diagnostics],
  };
}
