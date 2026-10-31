import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

import type { Diagnostic } from '@tyto/core';
import {
  type Gallery,
  type ReadGallery,
  installGalleryEntry,
  readGallery,
  updateGalleryEntry,
} from '@tyto/io';
import type { GalleryStatus } from '@tyto/plugin-api';

import type { GalleryAction, GalleryEntryView, GalleryView } from '../../shared/ipc.js';

/**
 * The gallery, for the window (TYTO-504, ADR 0162).
 *
 * **The operations are `@tyto/io`'s**, the ones `tyto gallery` runs: this module reads the
 * index the `galleryIndex` setting names, turns what each operation answers into what the
 * window draws, and syncs the machine's plugin files afterwards through the sync the window
 * already owns (`plugin-files.ts`). So a fetched plugin's permissions are asked in the same box
 * Plugins: Sync Plugin Files asks them in, its problems reach the problems panel the same way,
 * and the template list is read again on `templates:changed` with no restart.
 *
 * **Nothing here moves a ref unless the person clicked** (ADR 0151 decision 3): `list` only
 * reads, and only `update` moves. There is no `--force`: a place changed by hand since the
 * gallery wrote it is refused, and the refusal names the CLI's flag.
 */

/** A picture larger than this is listed without it: the answer crosses IPC as base64. */
export const PREVIEW_LIMIT_BYTES = 2 * 1024 * 1024;

const PICTURE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export interface DesktopGalleryOptions {
  readonly home: string;
  /** The `galleryIndex` setting as it is now: read on every request, never cached. */
  readonly index: () => string;
  /** Syncs the machine's plugin files without moving a ref, and tells the window. */
  readonly sync: () => Promise<void>;
  /** `@tyto/io`'s operations; injected so a test can count what ran. */
  readonly read?: typeof readGallery;
  readonly install?: typeof installGalleryEntry;
  readonly update?: typeof updateGalleryEntry;
}

export interface DesktopGallery {
  list(): Promise<GalleryView>;
  install(id: string): Promise<GalleryAction>;
  update(id: string): Promise<GalleryAction>;
}

/** The picture at `path` as a `data:` URL, or nothing when it is not one the window shows. */
export async function previewUrl(path: string | undefined): Promise<string | undefined> {
  if (path === undefined) return undefined;
  const type = PICTURE_TYPES[extname(path).toLowerCase()];
  if (type === undefined) return undefined;
  const found = await stat(path).catch(() => undefined);
  if (found === undefined || found.size > PREVIEW_LIMIT_BYTES) return undefined;
  return `data:${type};base64,${(await readFile(path)).toString('base64')}`;
}

/** One card: an entry's status as the window draws it. */
export async function entryView(
  status: GalleryStatus,
  previews: ReadonlyMap<string, string>,
): Promise<GalleryEntryView> {
  const { entry, placements } = status;
  const preview =
    entry.preview === undefined ? undefined : await previewUrl(previews.get(entry.preview));
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    description: entry.description,
    latest: entry.latest,
    ...(entry.changes === undefined ? {} : { changes: entry.changes }),
    configurations: [...entry.configurations],
    state: status.state,
    compatible: status.compatible,
    engine: entry.engine,
    pinned: [...new Set(placements.map((placement) => placement.ref))],
    files: [...new Set(placements.map((placement) => placement.file))],
    synced: placements.every((placement) => placement.synced),
    ...(preview === undefined ? {} : { preview }),
  };
}

/** A diagnostic as the window prints it: the code a person can search for, and the message. */
const sentence = (item: Diagnostic): string => `${item.code}: ${item.message}`;

/** The gallery as read, for the window: every entry, and what the fetch and the index said. */
export async function galleryView(index: string, read: ReadGallery): Promise<GalleryView> {
  const problems = [...read.fetched.diagnostics, ...read.indexDiagnostics].map(sentence);
  const offline = read.fetched.diagnostics.some((item) => item.code === 'W_GALLERY_INDEX_OFFLINE');
  const entries =
    read.gallery === undefined
      ? undefined
      : await Promise.all(
          read.gallery.statuses.map((status) => entryView(status, read.fetched.previews)),
        );
  return {
    index,
    ...(entries === undefined ? {} : { entries }),
    ...(offline && read.fetched.fetched !== undefined
      ? { cached: read.fetched.fetched.toISOString() }
      : {}),
    problems,
  };
}

/** Paths stay whole: the machine's plugin files are `TYTO_HOME`'s, which may be anywhere. */
const whole = (path: string): string => path;

export function createDesktopGallery(options: DesktopGalleryOptions): DesktopGallery {
  const read = options.read ?? readGallery;
  const install = options.install ?? installGalleryEntry;
  const update = options.update ?? updateGalleryEntry;
  let running: Promise<unknown> = Promise.resolve();

  /** One operation at a time: two clicks would race on one plugin file and one record. */
  const queued = <T>(work: () => Promise<T>): Promise<T> => {
    const next = running.then(work);
    running = next.catch(() => undefined);
    return next;
  };

  const fetch = async (): Promise<{ index: string; read: ReadGallery }> => {
    const index = options.index();
    return { index, read: await read(options.home, index, { previews: true }) };
  };

  const list = async (): Promise<GalleryView> => {
    const fetched = await fetch();
    return galleryView(fetched.index, fetched.read);
  };

  /** Reads the gallery, runs `act` on it, and syncs when it wrote; then reads it again. */
  const acting = async (
    act: (gallery: Gallery) => Promise<Omit<GalleryAction, 'view'>>,
  ): Promise<GalleryAction> => {
    const before = await fetch();
    if (before.read.gallery === undefined) {
      const view = await galleryView(before.index, before.read);
      return { outcome: 'refused', problem: view.problems.join('\n'), byHand: [], view };
    }
    const done = await act(before.read.gallery);
    if (done.outcome === 'written' || done.outcome === 'moved') await options.sync();
    return { ...done, view: await list() };
  };

  return {
    list: () => queued(list),
    install: (id) =>
      queued(() =>
        acting(async (gallery) => {
          const outcome = await install(gallery, id, whole);
          if (outcome.kind === 'refused') {
            return { outcome: 'refused', problem: sentence(outcome.problem), byHand: [] };
          }
          return { outcome: outcome.kind, byHand: [] };
        }),
      ),
    update: (id) =>
      queued(() =>
        acting(async (gallery) => {
          const outcome = await update(gallery, id, whole);
          if (outcome.kind === 'current') return { outcome: 'current', byHand: [] };
          const byHand = outcome.byHand.map((placement) => ({
            file: placement.file,
            ref: placement.ref,
          }));
          if (outcome.kind === 'refused') {
            return { outcome: 'refused', problem: sentence(outcome.problem), byHand };
          }
          return { outcome: 'moved', byHand };
        }),
      ),
  };
}
