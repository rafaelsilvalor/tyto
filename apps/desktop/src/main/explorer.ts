import { randomUUID } from 'node:crypto';
import { type Dirent, type FSWatcher, watch as watchFolder } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

import { isInside } from '@tyto/io';

import type { ExplorerPlace } from '../../shared/file-icons.js';
import type { IpcResponse } from '../../shared/ipc.js';

/**
 * The files of the open workspace folder, as the explorer may know them (TYTO-279, ADR 0115).
 *
 * **The window gets names and ids, never a path** (ADR 0010, ADR 0086). Every entry main lists
 * is given an id it mints and keeps beside the path; the window asks for a folder's children
 * and opens a brief by that id, and an id main did not mint, or minted for a folder that has
 * since closed, names nothing. The ids live as long as the folder is open, so a re-list after a
 * change answers the same id for the same path and the tree keeps what was expanded.
 *
 * **Listed one folder at a time**, when the window asks — a folder nobody expanded is never
 * read, which is why the cap is per folder and not on the whole tree.
 *
 * **Nothing here runs anything** (ADR 0111): an untrusted folder lists exactly as a trusted one,
 * and the only thing an entry can be used for is opening a `.brief` as text.
 */

export type ExplorerListing = IpcResponse<'explorer:list'>;
export type ExplorerEntry = ExplorerListing['entries'][number];

/** The most entries one folder's listing carries; the rest are counted, not sent. */
export const EXPLORER_ENTRY_CAP = 2000;

/** How long a burst of watcher events has to go quiet before the window is told. */
export const EXPLORER_SETTLE_MS = 150;

/**
 * Not listed: Git's own folder, which nobody edits and which churns on every commit.
 * `node_modules` is listed — VS Code shows it too, and a person may want to look — but see
 * `IGNORED_BY_THE_WATCHER`.
 */
const HIDDEN: ReadonlySet<string> = new Set(['.git']);

/**
 * Changes under these never reach the window. Both churn by the thousand on an install or a
 * checkout, and a burst that size would re-list every expanded folder for nothing a person is
 * looking at. An expanded `node_modules` is therefore not live; it is as of its last listing.
 */
const IGNORED_BY_THE_WATCHER: ReadonlySet<string> = new Set(['.git', 'node_modules']);

const NOTHING: ExplorerListing = { entries: [], more: 0, gone: true };

/**
 * The folders the resolved project names, as the workspace read them (TYTO-282, ADR 0116): only
 * what survived, so a key a restricted folder refused names nothing here and flags nothing.
 */
export interface ExplorerPlaces {
  readonly output: string | undefined;
  readonly assets: readonly string[];
  readonly templates: readonly string[];
}

export const NO_PLACES: ExplorerPlaces = { output: undefined, assets: [], templates: [] };

export interface ExplorerService {
  /**
   * Lists `folder` from now on, or nothing. Replaces the ids and the watcher of whatever was
   * listed before; the same folder again keeps both, so re-reading a folder after a trust
   * change does not collapse the tree. `places` flag the entries a name cannot tell; when they
   * change for the same folder, the window is told to list again.
   */
  setRoot(folder: string | undefined, places?: ExplorerPlaces): Promise<void>;
  /**
   * The children of the folder `entryId` names, or of the root for `null`. An id that names
   * nothing — never minted, minted for another folder, or a path that has since gone — answers
   * an empty listing with `gone: true`, never a throw: the window drops that branch.
   */
  list(entryId: string | null): Promise<ExplorerListing>;
  /** The brief `entryId` names, while it still lives inside the root; nothing otherwise. */
  briefPath(entryId: string): Promise<string | undefined>;
  /** Stops watching. Nothing is emitted afterwards. */
  close(): void;
}

/** The part of `fs.watch` this uses, injected so a test can stand in for the platform. */
export type WatchFolder = (
  folder: string,
  onChange: (name: string | null) => void,
  onError: (cause: unknown) => void,
) => { close(): void };

export interface ExplorerServiceOptions {
  /** Something in the listed folder changed. The composition root pushes `explorer:changed`. */
  readonly onChange: () => void;
  readonly onError?: (message: string, cause: unknown) => void;
  readonly watch?: WatchFolder;
  readonly settleMs?: number;
  readonly cap?: number;
}

/** Recursive `fs.watch`: native on Windows and macOS, Node's own walk on Linux. */
export const watchRecursively: WatchFolder = (folder, onChange, onError) => {
  const watcher: FSWatcher = watchFolder(folder, { recursive: true }, (_event, name) => {
    onChange(name === null ? null : String(name));
  });
  watcher.on('error', onError);
  return watcher;
};

/** Whether a watcher's relative name lies under a folder it ignores, at any depth. */
export const ignoredByTheWatcher = (name: string | null): boolean =>
  name !== null && name.split(/[\\/]/).some((segment) => IGNORED_BY_THE_WATCHER.has(segment));

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const kindOf = (isFolder: boolean, name: string): ExplorerEntry['kind'] =>
  isFolder ? 'folder' : extname(name).toLowerCase() === '.brief' ? 'brief' : 'file';

/** The places by real path, which is what a listed entry is compared by. */
interface RealPlaces {
  readonly output: string | undefined;
  readonly templates: ReadonlySet<string>;
  readonly assets: ReadonlySet<string>;
}

const NO_REAL_PLACES: RealPlaces = { output: undefined, templates: new Set(), assets: new Set() };

const realOrNothing = async (path: string): Promise<string | undefined> => {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
};

async function realPlaces(places: ExplorerPlaces): Promise<RealPlaces> {
  const each = async (paths: readonly string[]): Promise<ReadonlySet<string>> =>
    new Set(
      (await Promise.all(paths.map(realOrNothing))).filter(
        (path): path is string => path !== undefined,
      ),
    );
  return {
    output: places.output === undefined ? undefined : await realOrNothing(places.output),
    templates: await each(places.templates),
    assets: await each(places.assets),
  };
}

const samePlaces = (a: RealPlaces, b: RealPlaces): boolean =>
  a.output === b.output &&
  a.templates.size === b.templates.size &&
  [...a.templates].every((path) => b.templates.has(path)) &&
  a.assets.size === b.assets.size &&
  [...a.assets].every((path) => b.assets.has(path));

/**
 * What a listed entry is, beyond its name. **One answer, in a fixed order** (ADR 0116 rule 3):
 * the output folder, then a templates folder, then a folder directly inside one, then an assets
 * folder — so an output folder the project also names under `assets` is the output folder.
 * The project file is `.tyto/project.json` at the root, the one file a place names.
 */
export function placeOf(
  real: string,
  isFolder: boolean,
  rootReal: string,
  places: RealPlaces,
): ExplorerPlace | undefined {
  if (!isFolder) {
    return real === join(rootReal, '.tyto', 'project.json') ? 'project' : undefined;
  }
  if (real === places.output) return 'output';
  if (places.templates.has(real)) return 'templates';
  if (places.templates.has(dirname(real))) return 'template';
  if (places.assets.has(real)) return 'assets';
  return undefined;
}

export function createExplorerService(options: ExplorerServiceOptions): ExplorerService {
  const watch = options.watch ?? watchRecursively;
  const settleMs = options.settleMs ?? EXPLORER_SETTLE_MS;
  const cap = options.cap ?? EXPLORER_ENTRY_CAP;

  /** The folder as given, and its real path — what every entry is held inside. */
  let root: { folder: string; real: string } | undefined;
  let places: RealPlaces = NO_REAL_PLACES;
  let idOfPath = new Map<string, string>();
  let entryOf = new Map<string, { path: string; kind: ExplorerEntry['kind'] }>();
  let watcher: { close(): void } | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  /**
   * Bumped on every root change and on close. A watcher callback from an older generation is
   * ignored: `close()` on a platform watcher does not promise that no event already queued is
   * delivered afterwards. The settle timer needs no check of its own — `stopWatching` clears
   * the one pending, and an old callback can no longer start another.
   */
  let generation = 0;

  const stopWatching = (): void => {
    generation += 1;
    if (settle !== undefined) clearTimeout(settle);
    settle = undefined;
    watcher?.close();
    watcher = undefined;
  };

  const startWatching = (folder: string): void => {
    const mine = generation;
    const changed = (name: string | null): void => {
      if (mine !== generation || ignoredByTheWatcher(name)) return;
      if (settle !== undefined) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = undefined;
        options.onChange();
      }, settleMs);
    };
    try {
      watcher = watch(folder, changed, (cause) => {
        options.onError?.('explorer: the watcher stopped', cause);
      });
    } catch (cause) {
      // A folder that cannot be watched still lists; it is simply not live.
      options.onError?.('explorer: the folder could not be watched', cause);
    }
  };

  const idFor = (path: string, kind: ExplorerEntry['kind']): string => {
    const known = idOfPath.get(path);
    if (known !== undefined) {
      entryOf.set(known, { path, kind });
      return known;
    }
    const id = randomUUID();
    idOfPath.set(path, id);
    entryOf.set(id, { path, kind });
    return id;
  };

  /**
   * One child, or nothing when it leads outside the root. Every entry is resolved, not only the
   * ones that say they are links: a Windows junction and a symbolic link both count, and the
   * cost is one call per listed entry, of which there are at most `cap`.
   */
  const entryFrom = async (
    folder: string,
    dirent: Dirent,
    rootReal: string,
  ): Promise<ExplorerEntry | undefined> => {
    const path = join(folder, dirent.name);
    try {
      const real = await realpath(path);
      if (!isInside(rootReal, real)) return undefined;
      const isFolder = dirent.isSymbolicLink()
        ? (await stat(real)).isDirectory()
        : dirent.isDirectory();
      const kind = kindOf(isFolder, dirent.name);
      const place = placeOf(real, isFolder, rootReal, places);
      return {
        id: idFor(path, kind),
        name: dirent.name,
        kind,
        ...(place === undefined ? {} : { place }),
      };
    } catch {
      // A broken link, or a file gone between the listing and this look at it.
      return undefined;
    }
  };

  const listFolder = async (folder: string): Promise<ExplorerListing> => {
    const current = root;
    if (current === undefined) return NOTHING;
    let dirents: Dirent[];
    try {
      dirents = await readdir(folder, { withFileTypes: true });
    } catch {
      return NOTHING;
    }
    // Folders first, then by name as a person reads numbers: `slide 2` before `slide 10`.
    const ordered = dirents
      .filter((dirent) => !HIDDEN.has(dirent.name))
      .sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) || collator.compare(a.name, b.name),
      );
    const shown = ordered.slice(0, cap);
    const resolved = await Promise.all(shown.map((each) => entryFrom(folder, each, current.real)));
    // The root may have changed while this was reading; an answer for the old one is nothing.
    if (root !== current) return NOTHING;
    return {
      entries: resolved.filter((entry): entry is ExplorerEntry => entry !== undefined),
      more: ordered.length - shown.length,
      gone: false,
    };
  };

  return {
    async setRoot(folder, named = NO_PLACES) {
      const next = await realPlaces(named);
      if (folder !== undefined && root?.folder === folder) {
        // The same folder read again — a trust change can accept a key it refused before.
        const changed = !samePlaces(places, next);
        places = next;
        if (changed) options.onChange();
        return;
      }
      stopWatching();
      idOfPath = new Map();
      entryOf = new Map();
      root = undefined;
      places = next;
      if (folder === undefined) return;
      try {
        root = { folder, real: await realpath(folder) };
      } catch {
        return;
      }
      startWatching(folder);
    },

    list(entryId) {
      if (root === undefined) return Promise.resolve(NOTHING);
      if (entryId === null) return listFolder(root.folder);
      const entry = entryOf.get(entryId);
      if (entry?.kind !== 'folder') return Promise.resolve(NOTHING);
      return listFolder(entry.path);
    },

    async briefPath(entryId) {
      const current = root;
      const entry = entryOf.get(entryId);
      if (current === undefined || entry?.kind !== 'brief') return undefined;
      try {
        // Asked again at the click: the file may have become a link to somewhere else since.
        const real = await realpath(entry.path);
        if (!isInside(current.real, real)) return undefined;
        return (await stat(real)).isFile() ? entry.path : undefined;
      } catch {
        return undefined;
      }
    },

    close() {
      stopWatching();
    },
  };
}
