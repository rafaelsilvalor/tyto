import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { type Diagnostic, type Diagnostics, diagnostic } from '@tyto/core';
import {
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

import {
  type FetchedGalleryIndex,
  type GalleryRecord,
  type GalleryWrite,
  fetchGalleryIndex,
  readGalleryRecord,
  writeFileAtomically,
  writeGalleryRecord,
} from './gallery.js';
import { readPluginFolder } from './plugin-files.js';
import { machinePluginFiles } from './plugin-files-sync.js';

/**
 * The gallery's three operations (ADR 0162), shared by `tyto gallery` and the window's gallery
 * (TYTO-504), so the two never disagree on what install and update write.
 *
 * Each answers **what happened, as data**, and prints nothing: the CLI formats an outcome as
 * lines at a terminal, the window as a card's state. **Neither operation syncs**: install and
 * update write the machine's plugin files and the gallery's record, and the caller then runs
 * the sync it already owns (`tyto plugin sync`'s at a terminal, the window's in main), so a
 * fetched plugin's permissions are asked where that caller asks them.
 */

/** Where templates the gallery installs are written, in the machine's plugin files. */
export const GALLERY_TEMPLATES_FILE = 'gallery.yaml';

/** The index read against the machine's plugin files. */
export interface Gallery {
  readonly home: string;
  /** The machine's plugin files folder, `TYTO_HOME/plugin-files/`. */
  readonly directory: string;
  readonly statuses: readonly GalleryStatus[];
}

export interface ReadGallery {
  /** The fetch: the index's text, when it was fetched, previews, and what the fetch said. */
  readonly fetched: FetchedGalleryIndex;
  /** What reading the index said, with ranges into `fetched.text`. */
  readonly indexDiagnostics: Diagnostics;
  /** Absent when there is no index to list: never fetched, or it does not parse. */
  readonly gallery?: Gallery;
}

export interface ReadGalleryOptions {
  /** Also keep the entries' preview pictures beside the cached index (the window shows them). */
  readonly previews?: boolean;
}

/** Fetches the index at `index` and reads every entry against the machine's plugin files. */
export async function readGallery(
  home: string,
  index: string,
  options: ReadGalleryOptions = {},
): Promise<ReadGallery> {
  const fetched = await fetchGalleryIndex(home, index, options);
  if (fetched.text === undefined) return { fetched, indexDiagnostics: [] };
  const read = parseGalleryIndex(fetched.text, index);
  if (read.value === undefined) return { fetched, indexDiagnostics: read.diagnostics };

  const directory = machinePluginFiles(home);
  // Real paths as the files' names: the writers open them, and each caller shortens them itself.
  const folder = await readPluginFolder(directory, (path) => path);
  return {
    fetched,
    indexDiagnostics: read.diagnostics,
    gallery: {
      home,
      directory,
      statuses: galleryStatus(
        read.value,
        { files: folder.files, lock: folder.lock ?? EMPTY_PLUGIN_FILES_LOCK },
        PLUGIN_API_VERSION,
      ),
    },
  };
}

/** How a path appears inside a diagnostic: the CLI shortens it against its folder. */
export type ShownPath = (path: string) => string;

/** The entry `id` names, if the index lists it and this Tyto can load it. */
function installable(
  gallery: Gallery,
  id: string,
): { readonly status: GalleryStatus } | { readonly problem: Diagnostic } {
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

export type GalleryInstallOutcome =
  | { readonly kind: 'refused'; readonly problem: Diagnostic }
  /** Some file already holds the entry, by the gallery or by hand: nothing was written. */
  | {
      readonly kind: 'already installed';
      readonly status: GalleryStatus;
    }
  | { readonly kind: 'written'; readonly status: GalleryStatus; readonly path: string };

/**
 * Writes entry `id` into the machine's plugin files, pinned to its latest tag (ADR 0162
 * decision 5), and records what it wrote. The caller syncs afterwards.
 */
export async function installGalleryEntry(
  gallery: Gallery,
  id: string,
  shown: ShownPath,
): Promise<GalleryInstallOutcome> {
  const found = installable(gallery, id);
  if ('problem' in found) return { kind: 'refused', problem: found.problem };
  const { entry, placements } = found.status;
  if (placements.length > 0) return { kind: 'already installed', status: found.status };

  const refused = (path: string, problem: string): GalleryInstallOutcome => ({
    kind: 'refused',
    problem: diagnostic('E_GALLERY_WRITE', { entry: id, file: shown(path), problem }),
  });
  const source = { git: entry.git, ref: entry.latest };
  let path: string;
  let text: string;
  let writes: GalleryWrite[];
  if (entry.kind === 'plugin') {
    path = join(gallery.directory, `${entry.id}.yaml`);
    if ((await readIfPresent(path)) !== undefined) return refused(path, 'the file already exists');
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
        return refused(
          path,
          `${shown(file.file)} already names ${taken.name}, from ${taken.source.git}`,
        );
      }
    }
    const edited = addTemplateEntries(
      await readIfPresent(path),
      shown(path),
      entry.templates,
      source,
    );
    if (!edited.ok) return refused(path, edited.error);
    text = edited.value;
    writes = entry.templates.map((template) => ({ file: basename(path), template, ...source }));
  }

  await writeFileAtomically(path, text);
  const record = await readGalleryRecord(gallery.directory);
  await writeGalleryRecord(gallery.directory, { ...record, [id]: writes });
  return { kind: 'written', status: found.status, path };
}

export interface GalleryUpdateOptions {
  /** Moves a place the gallery wrote even when it was changed by hand since (`--force`). */
  readonly force?: boolean;
}

export type GalleryUpdateOutcome =
  | {
      readonly kind: 'refused';
      readonly problem: Diagnostic;
      /** Places written by hand that were read before the refusal, in the order read. */
      readonly byHand: readonly GalleryPlacement[];
    }
  | { readonly kind: 'current'; readonly status: GalleryStatus }
  | {
      readonly kind: 'moved';
      readonly status: GalleryStatus;
      /** Places written by hand, moved because the person asked by name; said before moving. */
      readonly byHand: readonly GalleryPlacement[];
      /** Every place moved, with the ref it had. */
      readonly moved: readonly GalleryPlacement[];
    };

function sameWrite(write: GalleryWrite, placement: GalleryPlacement): boolean {
  return write.file === basename(placement.file) && write.template === placement.template;
}

/**
 * Moves every place that pins entry `id` at a ref other than its latest to the latest (ADR 0162
 * decisions 6 and 8). Every place is checked before any file is written, so a refusal leaves
 * every file as it was. The caller syncs afterwards.
 */
export async function updateGalleryEntry(
  gallery: Gallery,
  id: string,
  shown: ShownPath,
  options: GalleryUpdateOptions = {},
): Promise<GalleryUpdateOutcome> {
  const found = installable(gallery, id);
  if ('problem' in found) return { kind: 'refused', problem: found.problem, byHand: [] };
  const { entry, placements } = found.status;
  if (placements.length === 0) {
    return {
      kind: 'refused',
      problem: diagnostic('E_GALLERY_NOT_INSTALLED', { entry: id }),
      byHand: [],
    };
  }
  const moving = placements.filter((placement) => placement.ref !== entry.latest);
  if (moving.length === 0) return { kind: 'current', status: found.status };

  const record = await readGalleryRecord(gallery.directory);
  const written = record[id] ?? [];
  const byHand: GalleryPlacement[] = [];
  for (const placement of moving) {
    const write = written.find((candidate) => sameWrite(candidate, placement));
    if (write === undefined) {
      byHand.push(placement);
      continue;
    }
    const changed = write.git !== placement.git || write.ref !== placement.ref;
    if (changed && options.force !== true) {
      const was = (git: string, ref: string): string =>
        write.git === placement.git ? ref : `${git} ${ref}`;
      return {
        kind: 'refused',
        problem: diagnostic('E_GALLERY_ENTRY_EDITED', {
          entry: id,
          file: shown(placement.file),
          written: was(write.git, write.ref),
          found: was(placement.git, placement.ref),
        }),
        byHand,
      };
    }
  }

  const edits = new Map<string, string>();
  for (const placement of moving) {
    const text = edits.get(placement.file) ?? (await readFile(placement.file, 'utf8'));
    const moved = moveEntryRef(text, shown(placement.file), placement.template, entry.latest);
    if (!moved.ok) {
      return {
        kind: 'refused',
        problem: diagnostic('E_GALLERY_WRITE', {
          entry: id,
          file: shown(placement.file),
          problem: moved.error,
        }),
        byHand,
      };
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
  return { kind: 'moved', status: found.status, byHand, moved: moving };
}
