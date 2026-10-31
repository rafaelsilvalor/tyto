import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { type Diagnostic, type Diagnostics, diagnostic, hasErrors } from '@tyto/core';
import {
  type GalleryRecord,
  type GalleryWrite,
  fetchGalleryIndex,
  locationOf,
  readGalleryRecord,
  readPluginFolder,
  writeFileAtomically,
  writeGalleryRecord,
} from '@tyto/io';
import {
  DEFAULT_GALLERY_INDEX,
  EMPTY_PLUGIN_FILES_LOCK,
  type GalleryPlacement,
  type GalleryStatus,
  PLUGIN_API_VERSION,
  addTemplateEntries,
  galleryStatus,
  moveEntryRef,
  newPluginFileText,
  parseGalleryIndex,
} from '@tyto/plugin-api';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { homeOf, machinePluginFiles, syncPluginFiles } from './plugin-files.js';
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
 */

/** Where templates the gallery installs are written, in the machine's plugin files. */
export const GALLERY_TEMPLATES_FILE = 'gallery.yaml';
/** Read when `--index` is not given; the curated index stands in when neither is (TYTO-506). */
export const GALLERY_INDEX_VARIABLE = 'TYTO_GALLERY_INDEX';

export interface GalleryCommandOptions {
  readonly index?: string;
  readonly yes?: boolean;
  readonly force?: boolean;
}

interface Gallery {
  readonly home: string;
  readonly directory: string;
  readonly statuses: readonly GalleryStatus[];
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
  const home = homeOf(environment);
  const index = locationOf(galleryIndexOf(options.index, environment.variables), environment.cwd);
  const fetched = await fetchGalleryIndex(home, index);
  registerUnplaced(fetched.diagnostics);
  report(fetched.diagnostics, environment);
  if (fetched.text === undefined) return EXIT_DIAGNOSTICS;

  const read = parseGalleryIndex(fetched.text, index);
  registerOrigin(read.diagnostics, { path: index, source: fetched.text });
  report(read.diagnostics, environment);
  if (read.value === undefined) return EXIT_DIAGNOSTICS;

  const directory = machinePluginFiles(home);
  // Real paths as the files' names: the writers open them, and output shortens them itself.
  const folder = await readPluginFolder(directory, (path) => path);
  return {
    home,
    directory,
    statuses: galleryStatus(
      read.value,
      { files: folder.files, lock: folder.lock ?? EMPTY_PLUGIN_FILES_LOCK },
      PLUGIN_API_VERSION,
    ),
  };
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

/** The entry `id` names, if the index lists it and this Tyto can load it. */
function installable(
  gallery: Gallery,
  id: string,
): { status: GalleryStatus } | { problem: Diagnostic } {
  const status = gallery.statuses.find((candidate) => candidate.entry.id === id);
  if (status === undefined)
    return { problem: diagnostic('E_GALLERY_ENTRY_UNKNOWN', { entry: id }) };
  if (!status.compatible) {
    return {
      problem: diagnostic('E_GALLERY_ENGINE', {
        entry: id,
        range: status.entry.engine,
        version: PLUGIN_API_VERSION,
      }),
    };
  }
  return { status };
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw cause;
  }
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

function refuse(problem: Diagnostic, environment: CliEnvironment): ExitCode {
  report([problem], environment);
  return EXIT_DIAGNOSTICS;
}

export async function galleryInstallCommand(
  id: string,
  options: GalleryCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const gallery = await loadGallery(options, environment);
  if (typeof gallery === 'number') return gallery;
  const shown = (path: string): string => displayPath(environment.cwd, path);
  const found = installable(gallery, id);
  if ('problem' in found) return refuse(found.problem, environment);
  const { entry, placements } = found.status;

  // Already installed, by the gallery or by hand, in whichever file: say where, write nothing.
  if (placements.length > 0) {
    for (const placement of placements) {
      environment.console.out(
        `${id} is already in ${shown(placement.file)} at ${placement.ref}; nothing was written.\n`,
      );
    }
    if (found.status.state === 'update available') {
      environment.console.out(`tyto gallery update ${id} moves it to ${entry.latest}.\n`);
    }
    return EXIT_OK;
  }

  const source = { git: entry.git, ref: entry.latest };
  let path: string;
  let text: string;
  let writes: GalleryWrite[];
  if (entry.kind === 'plugin') {
    path = join(gallery.directory, `${entry.id}.yaml`);
    if ((await readIfPresent(path)) !== undefined) {
      return refuse(
        diagnostic('E_GALLERY_WRITE', {
          entry: id,
          file: shown(path),
          problem: 'the file already exists',
        }),
        environment,
      );
    }
    text = newPluginFileText(source);
    writes = [{ file: basename(path), ...source }];
  } else {
    path = join(gallery.directory, GALLERY_TEMPLATES_FILE);
    // A name another file already holds, from another repository, would be a duplicate in
    // this folder (ADR 0151 decision 7): neither would load.
    const folder = await readPluginFolder(gallery.directory, (file) => file);
    for (const file of folder.files) {
      const taken = file.templates.find((template) => entry.templates.includes(template.name));
      if (taken !== undefined) {
        return refuse(
          diagnostic('E_GALLERY_WRITE', {
            entry: id,
            file: shown(path),
            problem: `${shown(file.file)} already names ${taken.name}, from ${taken.source.git}`,
          }),
          environment,
        );
      }
    }
    const edited = addTemplateEntries(
      await readIfPresent(path),
      shown(path),
      entry.templates,
      source,
    );
    if (!edited.ok) {
      return refuse(
        diagnostic('E_GALLERY_WRITE', { entry: id, file: shown(path), problem: edited.error }),
        environment,
      );
    }
    text = edited.value;
    writes = entry.templates.map((template) => ({ file: basename(path), template, ...source }));
  }

  await writeFileAtomically(path, text);
  const record = await readGalleryRecord(gallery.directory);
  await writeGalleryRecord(gallery.directory, { ...record, [id]: writes });
  environment.console.out(`${id} ${entry.latest} written into ${shown(path)}.\n`);
  return syncMachine(gallery.home, options, environment);
}

function sameWrite(write: GalleryWrite, placement: GalleryPlacement): boolean {
  return write.file === basename(placement.file) && write.template === placement.template;
}

export async function galleryUpdateCommand(
  id: string,
  options: GalleryCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const gallery = await loadGallery(options, environment);
  if (typeof gallery === 'number') return gallery;
  const shown = (path: string): string => displayPath(environment.cwd, path);
  const found = installable(gallery, id);
  if ('problem' in found) return refuse(found.problem, environment);
  const { entry, placements } = found.status;
  if (placements.length === 0) {
    return refuse(diagnostic('E_GALLERY_NOT_INSTALLED', { entry: id }), environment);
  }
  const moving = placements.filter((placement) => placement.ref !== entry.latest);
  if (moving.length === 0) {
    environment.console.out(`${id} is already at ${entry.latest}.\n`);
    return EXIT_OK;
  }

  // Every place is checked before any is written, so a refusal leaves every file as it was.
  const record = await readGalleryRecord(gallery.directory);
  const written = record[id] ?? [];
  for (const placement of moving) {
    const write = written.find((candidate) => sameWrite(candidate, placement));
    if (write === undefined) {
      environment.console.err(
        `${id} in ${shown(placement.file)} was written by hand; moving its ref ${placement.ref} -> ${entry.latest}.\n`,
      );
      continue;
    }
    const changed = write.git !== placement.git || write.ref !== placement.ref;
    if (changed && options.force !== true) {
      const was = (git: string, ref: string): string =>
        write.git === placement.git ? ref : `${git} ${ref}`;
      return refuse(
        diagnostic('E_GALLERY_ENTRY_EDITED', {
          entry: id,
          file: shown(placement.file),
          written: was(write.git, write.ref),
          found: was(placement.git, placement.ref),
        }),
        environment,
      );
    }
  }

  const edits = new Map<string, string>();
  for (const placement of moving) {
    const text = edits.get(placement.file) ?? (await readFile(placement.file, 'utf8'));
    const moved = moveEntryRef(text, shown(placement.file), placement.template, entry.latest);
    if (!moved.ok) {
      return refuse(
        diagnostic('E_GALLERY_WRITE', {
          entry: id,
          file: shown(placement.file),
          problem: moved.error,
        }),
        environment,
      );
    }
    edits.set(placement.file, moved.value);
  }
  for (const [path, text] of edits) await writeFileAtomically(path, text);

  const kept = written.filter((write) => !moving.some((placement) => sameWrite(write, placement)));
  const moved = moving.map((placement) => ({
    file: basename(placement.file),
    ...(placement.template === undefined ? {} : { template: placement.template }),
    git: placement.git,
    ref: entry.latest,
  }));
  const next: GalleryRecord = { ...record, [id]: [...kept, ...moved] };
  await writeGalleryRecord(gallery.directory, next);
  for (const placement of moving) {
    environment.console.out(
      `${id}: ${placement.ref} -> ${entry.latest} in ${shown(placement.file)}.\n`,
    );
  }
  if (entry.changes !== undefined)
    environment.console.out(`    ${entry.latest}: ${entry.changes}\n`);
  return syncMachine(gallery.home, options, environment);
}
