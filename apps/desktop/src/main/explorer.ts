import { randomUUID } from 'node:crypto';
import { type Dirent, type FSWatcher, watch as watchFolder } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import { isInside } from '@tyto/io';

import type { ExplorerPlace } from '../../shared/file-icons.js';
import type { IpcResponse } from '../../shared/ipc.js';
import { type ExplorerImage, IMAGE_EXTENSIONS, readExplorerImage } from './explorer-image.js';

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
 * and an entry can be used for two things: opening a `.brief`, `.txt` or `.md` as text
 * (TYTO-247, ADR 0132), and showing an image in
 * the preview as bytes main checked (TYTO-366, ADR 0124).
 *
 * **New, rename and delete take an id and a name, never a path** (TYTO-352, ADR 0121). A name is
 * checked here, the same on every operating system; no write overwrites anything; and a delete
 * goes to the operating system's trash and nowhere else. They run nothing either, so they work
 * in an untrusted folder as in a trusted one.
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
  /**
   * The file `entryId` names when its name ends in one of `extensions` (lower case, with the
   * dot) and it is still a file whose real path lies inside the root; nothing otherwise.
   */
  filePath(entryId: string, extensions: readonly string[]): Promise<string | undefined>;
  /**
   * The image `entryId` names, for the preview (TYTO-366, ADR 0124): `gone` for an id that names
   * nothing inside the folder any more, `unsupported` for a file that is not an image the preview
   * shows, and otherwise what {@link readExplorerImage} answers.
   */
  image(entryId: string, have: string | undefined): Promise<ExplorerImage>;
  /**
   * Makes an empty file or folder called `name` in the folder `parentId` names (`null` is the
   * root). Fails with `exists` rather than replace anything, and with `invalid` for a name
   * {@link checkEntryName} refuses.
   */
  create(
    parentId: string | null,
    name: string,
    kind: 'file' | 'folder',
  ): Promise<ExplorerWrite<{ entry: ExplorerEntry; path: string }>>;
  /**
   * Renames the entry in place, in its own folder. The entry keeps its id and everything under
   * a folder keeps theirs, so an expanded subtree survives; `from` and `to` are for the tabs.
   */
  rename(
    entryId: string,
    name: string,
  ): Promise<ExplorerWrite<{ entry: ExplorerEntry; from: string; to: string }>>;
  /**
   * Moves the entry to the operating system's trash through the injected adapter, and forgets
   * its ids. A trash that fails answers `trash-failed` and leaves the entry where it was:
   * there is no second way to delete.
   */
  delete(entryId: string): Promise<ExplorerDelete>;
  /**
   * Where an entry lives, for main's own use only: which tabs hold a file under it, before a
   * delete is asked about (TYTO-352). Never sent to the window.
   */
  pathOf(entryId: string): string | undefined;
  /**
   * The ids from the top of the open folder down to `path`, a file main just wrote inside it,
   * so the window can expand to it and select it (TYTO-489). `undefined` outside the folder.
   */
  idsTo(path: string): readonly string[] | undefined;
  /**
   * The folder listed, as it was opened, or nothing: what a tab's label inside it is relative to
   * (TYTO-274, ADR 0125). For main's own use; the window is told the folder by the workspace.
   */
  folder(): string | undefined;
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
  /**
   * Moves a path to the operating system's trash — `shell.trashItem` in the app, which the
   * composition root wraps so it is looked up at every call and an end-to-end suite can stand
   * in for it. Absent, every delete answers `trash-failed`: there is no fallback to `rm`.
   */
  readonly trash?: (path: string) => Promise<void>;
}

/**
 * Why a new or a rename did not happen; see ADR 0121. `failed` is any other refusal from the
 * disk — a read-only drive, a permission — and carries the system's error code, never a path.
 */
export type ExplorerWriteFailure = 'invalid' | 'exists' | 'gone' | 'failed';

export type ExplorerWrite<Done> =
  | ({ readonly ok: true } & Done)
  | { readonly ok: false; readonly reason: ExplorerWriteFailure; readonly detail?: string };

export type ExplorerDelete =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: 'gone' | 'trash-failed' };

/** Windows' reserved device names, which name a device and not a file with any extension. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

/** Separators, NUL and every other control character, and what Windows forbids in a name. */
// eslint-disable-next-line no-control-regex -- refusing control characters is the point.
const FORBIDDEN_CHARACTER = /[/\\<>:"|?*\u0000-\u001f\u007f]/u;

/** The longest name a file system this app runs on accepts in one segment. */
export const ENTRY_NAME_MAX = 255;

/**
 * Whether `name` may be given to a new or renamed entry (ADR 0121 rule 1). **The same rules on
 * every operating system**, Windows' included, so a folder made on Linux still opens on
 * Windows. Refused: empty or blank, `.` and `..`, a separator, NUL or another control
 * character, any of `<>:"|?*`, a trailing dot or space, a device name such as `CON` or
 * `com1.txt`, more than 255 characters, and `.git`. Nothing is trimmed: what the person typed
 * is the name, or it is refused.
 */
export function checkEntryName(name: string): boolean {
  if (name.trim() === '' || name === '.' || name === '..') return false;
  if (name.length > ENTRY_NAME_MAX) return false;
  if (FORBIDDEN_CHARACTER.test(name)) return false;
  if (name.endsWith('.') || name.endsWith(' ')) return false;
  if (DEVICE_NAME.test(name)) return false;
  return name.toLowerCase() !== '.git';
}

/**
 * Where `path` lies under `base`, as a relative path — `''` for `base` itself — or nothing when
 * it is not under it. Not `isInside`'s `startsWith('..')`, which would also leave out a child
 * called `..notes`; only a first segment that *is* `..` leads out.
 */
export function relativeUnder(base: string, path: string): string | undefined {
  const rest = relative(resolve(base), resolve(path));
  if (rest === '') return '';
  if (isAbsolute(rest) || rest.split(/[\\/]/u)[0] === '..') return undefined;
  return rest;
}

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : undefined;

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );

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

  /** The folder a new entry goes in, by id (`null` is the root), while it is one, inside. */
  const folderToWriteIn = async (
    folderId: string | null,
    rootReal: string,
  ): Promise<string | undefined> => {
    if (root === undefined) return undefined;
    const entry = folderId === null ? undefined : entryOf.get(folderId);
    if (folderId !== null && entry?.kind !== 'folder') return undefined;
    const folder = entry?.path ?? root.folder;
    return (await folderInside(folder, rootReal)) ? folder : undefined;
  };

  /** An entry just written, as the listing would show it, under the id it has or a new one. */
  const describeEntry = async (
    path: string,
    isFolder: boolean,
    rootReal: string,
  ): Promise<ExplorerEntry> => {
    const name = basename(path);
    const kind = kindOf(isFolder, name);
    const place = await realpath(path).then(
      (real) => placeOf(real, isFolder, rootReal, places),
      () => undefined,
    );
    return { id: idFor(path, kind), name, kind, ...(place === undefined ? {} : { place }) };
  };

  /**
   * Moves every id at or under `from` to the same place under `to`, so the entry and its
   * descendants keep theirs — the window's expanded subtree is keyed by them. An id left at the
   * new path by an entry that vanished outside the app is dropped, not shared.
   */
  const rekey = (from: string, to: string): void => {
    const moved = new Map<string, string>();
    const kept = new Map<string, string>();
    for (const [path, id] of idOfPath) {
      const rest = relativeUnder(from, path);
      if (rest === undefined) {
        kept.set(path, id);
        continue;
      }
      const next = rest === '' ? to : join(to, rest);
      moved.set(next, id);
      const known = entryOf.get(id);
      if (known !== undefined) entryOf.set(id, { ...known, path: next });
    }
    for (const [path, id] of kept) {
      if (moved.has(path)) entryOf.delete(id);
      else moved.set(path, id);
    }
    idOfPath = moved;
  };

  /** Forgets every id at or under `path`, which has just gone to the trash. */
  const forgetUnder = (path: string): void => {
    for (const [held, id] of idOfPath) {
      if (relativeUnder(path, held) === undefined) continue;
      idOfPath.delete(held);
      entryOf.delete(id);
    }
  };

  const filePath = async (
    entryId: string,
    extensions: readonly string[],
  ): Promise<string | undefined> => {
    const current = root;
    const entry = entryOf.get(entryId);
    if (current === undefined || entry === undefined || entry.kind === 'folder') return undefined;
    if (!extensions.includes(extname(entry.path).toLowerCase())) return undefined;
    try {
      // Asked again at the click: the file may have become a link to somewhere else since.
      const real = await realpath(entry.path);
      if (!isInside(current.real, real)) return undefined;
      return (await stat(real)).isFile() ? entry.path : undefined;
    } catch {
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

    filePath,

    async image(entryId, have) {
      const entry = root === undefined ? undefined : entryOf.get(entryId);
      if (entry === undefined) return { ok: false, reason: 'gone' };
      const name = basename(entry.path);
      if (entry.kind === 'folder' || !IMAGE_EXTENSIONS.includes(extname(name).toLowerCase())) {
        return { ok: false, reason: 'unsupported', name };
      }
      const path = await filePath(entryId, IMAGE_EXTENSIONS);
      if (path === undefined) return { ok: false, reason: 'gone', name };
      return readExplorerImage(path, have);
    },

    idsTo(path) {
      if (root === undefined) return undefined;
      const inside = relativeUnder(root.folder, path);
      if (inside === undefined || inside === '') return undefined;
      const names = inside.split(/[\\/]/u);
      let at = root.folder;
      return names.map((name, index) => {
        at = join(at, name);
        return idFor(at, kindOf(index < names.length - 1, name));
      });
    },

    async create(parentId, name, kind) {
      const current = root;
      if (current === undefined) return GONE;
      if (!checkEntryName(name)) return INVALID;
      const folder = await folderToWriteIn(parentId, current.real);
      if (folder === undefined) return GONE;
      const target = join(folder, name);
      if (dirname(resolve(target)) !== resolve(folder)) return INVALID;
      try {
        // `wx` and a mkdir that is not recursive: each fails on anything already there, so
        // the check and the write are one call and nothing can slip between them.
        if (kind === 'folder') await mkdir(target);
        else await writeFile(target, '', { encoding: 'utf8', flag: 'wx' });
      } catch (cause) {
        const code = codeOf(cause);
        if (code === 'EEXIST') return EXISTS;
        if (code === 'ENOENT' || code === 'ENOTDIR') return GONE;
        return failed(cause);
      }
      if (root !== current) return GONE;
      return {
        ok: true,
        entry: await describeEntry(target, kind === 'folder', current.real),
        path: target,
      };
    },

    async rename(entryId, name) {
      const current = root;
      const entry = entryOf.get(entryId);
      if (current === undefined || entry === undefined) return GONE;
      if (!checkEntryName(name)) return INVALID;
      const from = entry.path;
      const folder = dirname(from);
      if (!(await folderInside(folder, current.real)) || !(await exists(from))) return GONE;
      const to = join(folder, name);
      if (dirname(resolve(to)) !== resolve(folder)) return INVALID;
      const isFolder = entry.kind === 'folder';
      if (to !== from) {
        // Asked first, because `rename` replaces a file that is there — on Windows too. The one
        // target allowed to exist is the entry itself under another case, on a disk that
        // ignores case: then the real paths are one.
        if ((await exists(to)) && !(await sameEntryByCase(from, to))) return EXISTS;
        try {
          await rename(from, to);
        } catch (cause) {
          const code = codeOf(cause);
          if (code === 'ENOENT') return GONE;
          if (code === 'EEXIST' || code === 'ENOTEMPTY') return EXISTS;
          return failed(cause);
        }
        rekey(from, to);
      }
      if (root !== current) return GONE;
      return { ok: true, entry: await describeEntry(to, isFolder, current.real), from, to };
    },

    async delete(entryId) {
      const current = root;
      const entry = entryOf.get(entryId);
      if (current === undefined || entry === undefined) return { ok: false, reason: 'gone' };
      const { path } = entry;
      if (!(await folderInside(dirname(path), current.real)) || !(await exists(path))) {
        return { ok: false, reason: 'gone' };
      }
      const trash = options.trash;
      if (trash === undefined) return { ok: false, reason: 'trash-failed' };
      try {
        await trash(path);
      } catch (cause) {
        // Never a second way: a file the trash refused stays, and the window says so.
        options.onError?.('explorer: the trash refused an entry', cause);
        return { ok: false, reason: 'trash-failed' };
      }
      forgetUnder(path);
      return { ok: true, path };
    },

    pathOf(entryId) {
      return root === undefined ? undefined : entryOf.get(entryId)?.path;
    },

    folder() {
      return root?.folder;
    },

    close() {
      stopWatching();
    },
  };
}

/**
 * Any other refusal from the disk is an answer, not a rejection (TYTO-352): the window keeps
 * the field open and says why. Only the error's code travels, because its message names a path.
 */
const failed = (cause: unknown) =>
  ({ ok: false, reason: 'failed', detail: codeOf(cause) ?? 'UNKNOWN' }) as const;

const GONE = { ok: false, reason: 'gone' } as const;
const INVALID = { ok: false, reason: 'invalid' } as const;
const EXISTS = { ok: false, reason: 'exists' } as const;

/** Whether `folder` is still a folder whose real path lies inside the root's. */
async function folderInside(folder: string, rootReal: string): Promise<boolean> {
  try {
    const real = await realpath(folder);
    return isInside(rootReal, real) && (await stat(real)).isDirectory();
  } catch {
    return false;
  }
}

/** `to` is `from` under another case on a disk that ignores case, and not a second entry. */
async function sameEntryByCase(from: string, to: string): Promise<boolean> {
  if (from.toLowerCase() !== to.toLowerCase()) return false;
  try {
    return (await realpath(from)) === (await realpath(to));
  } catch {
    return false;
  }
}
