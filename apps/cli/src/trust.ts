import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type { Diagnostics } from '@tyto/core';
import { type FsTrustStore, TRUST_FILE, fsTrustStore, isInside, loadWorkspace } from '@tyto/io';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { displayPath } from './render.js';
import { formatDiagnostics, registerOrigin } from './report.js';
import { ALWAYS_RESTRICTED, workspaceDiagnostics } from './workspace.js';

/**
 * `tyto trust add | list | remove` — the approvals of `TYTO_HOME/trust.json` from the command
 * line (ADR 0111, ADR 0112, ADR 0114), the same file the window's banner writes.
 *
 * `add` never asks y/N, so a script can run it: the person typing the command is the approval.
 * What it does print first is what the folder does while restricted, so the approval is given
 * knowing what it lifts. `--trust` on a render stays the run-only form and writes nothing.
 */

function homeOf(environment: CliEnvironment): string {
  if (environment.home === undefined) {
    throw new TypeError(
      'This environment names no home folder, so there is no trust.json to edit. ' +
        'defaultEnvironment() sets ~/.tyto.',
    );
  }
  return environment.home;
}

function absolute(path: string, environment: CliEnvironment): string {
  return isAbsolute(path) ? path : resolve(environment.cwd, path);
}

/** `trust.json`'s own problems point at it, as a render prints them. */
function trustFileProblems(items: Diagnostics, home: string, environment: CliEnvironment): string {
  registerOrigin(items, { path: displayPath(environment.cwd, join(home, TRUST_FILE)), source: '' });
  return formatDiagnostics(items);
}

export async function trustAddCommand(
  target: string,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const home = homeOf(environment);
  const path = absolute(target, environment);
  const kind = await kindOf(path);
  if (kind === undefined) {
    environment.console.err(`error: no such folder or file: ${path}. Nothing was trusted.\n`);
    return EXIT_DIAGNOSTICS;
  }
  const store = fsTrustStore({ home });
  return kind === 'file'
    ? addProfileFile(path, home, store, environment)
    : addFolder(path, home, store, environment);
}

/** A shared work profile: trusted on its own, by its file (ADR 0114). */
async function addProfileFile(
  path: string,
  home: string,
  store: FsTrustStore,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const real = await realpath(path);
  if (isInside(await realpath(home), real)) {
    environment.console.out(
      `Already trusted by where it lives: ${real} is inside TYTO_HOME, so there is no approval to write.\n`,
    );
    return EXIT_OK;
  }
  return grant(path, real, home, store, environment);
}

async function addFolder(
  path: string,
  home: string,
  store: FsTrustStore,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const shown = (file: string): string => displayPath(environment.cwd, file);
  // Read as restricted on purpose, whatever trust.json says: what it reports is what the
  // approval is about to lift.
  const restricted = await loadWorkspace(path, { home, trustStore: ALWAYS_RESTRICTED });
  if (restricted === undefined) {
    environment.console.err(
      `error: ${path} is not a workspace: its .tyto folder is TYTO_HOME, which holds plugins/ ` +
        'and trust.json and is never read as a project (ADR 0112). Nothing was trusted.\n',
    );
    return EXIT_DIAGNOSTICS;
  }
  const reported = workspaceDiagnostics(restricted, home, shown);
  // A folder already trusted does none of what the restricted read reports: printing it
  // would describe limits that are not there.
  const already = (await store.trustOf(path)).trust === 'trusted';
  if (reported.length > 0 && !already) {
    environment.console.err(formatDiagnostics(reported));
    environment.console.err(
      'Above: what this folder does while restricted; trusting it lifts that.\n',
    );
  }
  if (!restricted.exists) {
    environment.console.out(
      `${restricted.folder} has no .tyto/project.json; it is trusted as a folder all the same, as the window trusts one.\n`,
    );
  }

  const code = await grant(path, restricted.folder, home, store, environment);
  if (code !== EXIT_OK) return code;

  // Read again now it is trusted, because a restricted folder may not follow a profile path
  // that leads out of it: only now is the profile it names known.
  const trusted = await loadWorkspace(path, { home, trustStore: store });
  const profile = trusted?.profile;
  if (profile !== undefined && !profile.byLocation && profile.trust === 'restricted') {
    environment.console.out(
      `It names the work profile ${profile.file}, which is trusted on its own (ADR 0114): ` +
        `tyto trust add "${profile.file}"\n`,
    );
  }
  return EXIT_OK;
}

async function grant(
  path: string,
  real: string,
  home: string,
  store: FsTrustStore,
  environment: CliEnvironment,
): Promise<ExitCode> {
  // The path as typed: the store follows it to its real path itself (ADR 0111).
  const granted = await store.grant(path);
  if (!granted.ok) {
    environment.console.err(trustFileProblems(granted.error, home, environment));
    return EXIT_DIAGNOSTICS;
  }
  if (!granted.value) {
    environment.console.out(`Already trusted: ${real}\n`);
    return EXIT_OK;
  }
  const listed = await store.list();
  // A grant appends, so the newest entry is this one.
  const since = listed.ok ? listed.value.at(-1)?.since : undefined;
  environment.console.out(`Trusted: ${real}${since === undefined ? '' : ` (since ${since})`}\n`);
  return EXIT_OK;
}

/** `tyto trust list`: every approval, and which of them point at nothing any more. */
export async function trustListCommand(environment: CliEnvironment): Promise<ExitCode> {
  const home = homeOf(environment);
  const listed = await fsTrustStore({ home }).list();
  if (!listed.ok) {
    environment.console.err(trustFileProblems(listed.error, home, environment));
    return EXIT_DIAGNOSTICS;
  }
  if (listed.value.length === 0) {
    environment.console.out(
      'Nothing is trusted yet. Trust a folder with tyto trust add <folder>, or once with render --trust.\n',
    );
    return EXIT_OK;
  }
  const lines: string[] = [];
  for (const entry of listed.value) {
    const missing = (await kindOf(entry.path)) === undefined ? ' (missing)' : '';
    const since = entry.since === undefined ? '' : `  since ${entry.since}`;
    lines.push(`${entry.path}${since}${missing}\n`);
  }
  environment.console.out(lines.join(''));
  environment.console.out('Take one back with tyto trust remove <path>.\n');
  return EXIT_OK;
}

/**
 * `tyto trust remove <folder>` — take back an approval (ADR 0111): a workspace folder's, or a
 * work profile file's, which is its own source (ADR 0114).
 */
export async function trustRemoveCommand(
  folder: string,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const home = homeOf(environment);
  const path = absolute(folder, environment);
  const removed = await fsTrustStore({ home }).revoke(path);
  if (!removed.ok) {
    environment.console.err(formatDiagnostics(removed.error));
    return EXIT_DIAGNOSTICS;
  }
  environment.console.out(
    removed.value
      ? `No longer trusted: ${path}. It opens restricted from its next run.\n`
      : `Not trusted, so nothing to remove: ${path}.\n`,
  );
  return EXIT_OK;
}

async function kindOf(path: string): Promise<'file' | 'folder' | undefined> {
  try {
    return (await stat(path)).isDirectory() ? 'folder' : 'file';
  } catch {
    return undefined;
  }
}
