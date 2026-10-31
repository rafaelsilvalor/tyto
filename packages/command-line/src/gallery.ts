import { type Diagnostics, hasErrors } from '@tyto/core';
import {
  type Gallery,
  type GalleryInstallOutcome,
  GALLERY_TEMPLATES_FILE,
  installGalleryEntry,
  locationOf,
  readGallery,
  updateGalleryEntry,
} from '@tyto/io';
import { DEFAULT_GALLERY_INDEX, type GalleryStatus } from '@tyto/plugin-api';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { homeOf, syncPluginFiles } from './plugin-files.js';
import { displayPath } from './render.js';
import { formatDiagnostics, registerOrigin, registerUnplaced } from './report.js';

/**
 * `tyto gallery`: the maintained list of templates and plugins (ADR 0162).
 *
 * `list` shows each entry against the machine's plugin files; `install` writes an entry into
 * them, pinned to the entry's latest tag; `update` moves a ref to it. **A newer version is
 * shown and waits**: nothing here runs unless somebody typed it, and a render never moves a
 * ref (ADR 0151 decision 3). Both writers splice the file's own bytes, so the person's
 * comments and layout stay, and both sync the machine's folder afterwards, as
 * `tyto plugin sync` would.
 *
 * **The operations are `@tyto/io`'s** (TYTO-504), the ones the window's gallery runs; this
 * module chooses the index, prints what each one answers, and syncs at a terminal.
 */

export { GALLERY_TEMPLATES_FILE };
/** Read when `--index` is not given; the curated index stands in when neither is (TYTO-506). */
export const GALLERY_INDEX_VARIABLE = 'TYTO_GALLERY_INDEX';

export interface GalleryCommandOptions {
  readonly index?: string;
  readonly yes?: boolean;
  readonly force?: boolean;
}

function report(items: Diagnostics, environment: CliEnvironment): void {
  if (items.length > 0) environment.console.err(formatDiagnostics(items));
}

/**
 * Which index a command reads: `--index`, else `TYTO_GALLERY_INDEX`, else the curated one
 * (ADR 0162, TYTO-506). A blank value names nothing and falls through, as an unset one does.
 * This is the CLI's own configuration: it never reads the window's `settings.json` (ADR 0145).
 */
export function galleryIndexOf(
  option: string | undefined,
  variables: Readonly<Record<string, string | undefined>> | undefined,
): string {
  for (const written of [option, variables?.[GALLERY_INDEX_VARIABLE]]) {
    if (written !== undefined && written.trim() !== '') return written;
  }
  return DEFAULT_GALLERY_INDEX;
}

/** The index and the machine's files, read; or the exit code when the index cannot be read. */
async function loadGallery(
  options: GalleryCommandOptions,
  environment: CliEnvironment,
): Promise<Gallery | ExitCode> {
  const index = locationOf(galleryIndexOf(options.index, environment.variables), environment.cwd);
  const read = await readGallery(homeOf(environment), index);
  registerUnplaced(read.fetched.diagnostics);
  report(read.fetched.diagnostics, environment);
  if (read.fetched.text === undefined) return EXIT_DIAGNOSTICS;
  registerOrigin(read.indexDiagnostics, { path: index, source: read.fetched.text });
  report(read.indexDiagnostics, environment);
  return read.gallery ?? EXIT_DIAGNOSTICS;
}

function refs(status: GalleryStatus): string {
  const pinned = [...new Set(status.placements.map((placement) => placement.ref))].join(', ');
  if (status.state === 'not installed') return status.entry.latest;
  if (status.state === 'installed') return pinned;
  return `${pinned} -> ${status.entry.latest}`;
}

export async function galleryListCommand(
  options: GalleryCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const gallery = await loadGallery(options, environment);
  if (typeof gallery === 'number') return gallery;
  const shown = (path: string): string => displayPath(environment.cwd, path);
  for (const status of gallery.statuses) {
    const { entry } = status;
    const state = status.compatible ? status.state : `needs plugin API ${entry.engine}`;
    const files = [...new Set(status.placements.map((placement) => shown(placement.file)))];
    const unsynced = status.placements.some((placement) => !placement.synced)
      ? ' (not synced)'
      : '';
    environment.console.out(
      `${[entry.id, entry.kind, state, refs(status), ...files].join('  ')}${unsynced}\n`,
    );
    environment.console.out(`    ${entry.name}: ${entry.description}\n`);
    if (status.state === 'update available' && entry.changes !== undefined) {
      environment.console.out(`    ${entry.latest}: ${entry.changes}\n`);
    }
  }
  return EXIT_OK;
}

/** Fetches what the machine's files now name, as `tyto plugin sync` does without `--update`. */
async function syncMachine(
  home: string,
  options: GalleryCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const synced = await syncPluginFiles(
    {
      home,
      update: false,
      fetches: true,
      approval: options.yes === true ? 'yes' : environment.confirm === undefined ? 'never' : 'ask',
    },
    environment,
  );
  report(synced.diagnostics, environment);
  if (synced.unapproved.length > 0) {
    environment.console.err(
      `Not approved, so not loaded: ${synced.unapproved.join(', ')}. ` +
        'Run tyto plugin sync at a terminal, or with --yes.\n',
    );
  }
  return hasErrors(synced.diagnostics) ? EXIT_DIAGNOSTICS : EXIT_OK;
}

export async function galleryInstallCommand(
  id: string,
  options: GalleryCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const gallery = await loadGallery(options, environment);
  if (typeof gallery === 'number') return gallery;
  const shown = (path: string): string => displayPath(environment.cwd, path);
  const outcome: GalleryInstallOutcome = await installGalleryEntry(gallery, id, shown);
  if (outcome.kind === 'refused') {
    report([outcome.problem], environment);
    return EXIT_DIAGNOSTICS;
  }
  const { entry } = outcome.status;
  // Already installed, by the gallery or by hand, in whichever file: say where, write nothing.
  if (outcome.kind === 'already installed') {
    for (const placement of outcome.status.placements) {
      environment.console.out(
        `${id} is already in ${shown(placement.file)} at ${placement.ref}; nothing was written.\n`,
      );
    }
    if (outcome.status.state === 'update available') {
      environment.console.out(`tyto gallery update ${id} moves it to ${entry.latest}.\n`);
    }
    return EXIT_OK;
  }
  environment.console.out(`${id} ${entry.latest} written into ${shown(outcome.path)}.\n`);
  return syncMachine(gallery.home, options, environment);
}

export async function galleryUpdateCommand(
  id: string,
  options: GalleryCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const gallery = await loadGallery(options, environment);
  if (typeof gallery === 'number') return gallery;
  const shown = (path: string): string => displayPath(environment.cwd, path);
  const outcome = await updateGalleryEntry(
    gallery,
    id,
    shown,
    options.force === true ? { force: true } : {},
  );
  if (outcome.kind === 'current') {
    environment.console.out(`${id} is already at ${outcome.status.entry.latest}.\n`);
    return EXIT_OK;
  }
  // Said before the refusal too: the places read before it are what the person asked to move.
  const latest = gallery.statuses.find((status) => status.entry.id === id)?.entry.latest;
  for (const placement of outcome.byHand) {
    environment.console.err(
      `${id} in ${shown(placement.file)} was written by hand; moving its ref ${placement.ref} -> ${latest ?? ''}.\n`,
    );
  }
  if (outcome.kind === 'refused') {
    report([outcome.problem], environment);
    return EXIT_DIAGNOSTICS;
  }
  const { entry } = outcome.status;
  for (const placement of outcome.moved) {
    environment.console.out(
      `${id}: ${placement.ref} -> ${entry.latest} in ${shown(placement.file)}.\n`,
    );
  }
  if (entry.changes !== undefined)
    environment.console.out(`    ${entry.latest}: ${entry.changes}\n`);
  return syncMachine(gallery.home, options, environment);
}
