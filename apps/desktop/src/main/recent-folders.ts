import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';

import type { IpcResponse } from '../../shared/ipc.js';
import { pathLabelOf } from './path-label.js';
import type { RecentFolders } from './recent-files.js';

/**
 * The workspace folders opened before, as the title bar's popover lists them (TYTO-487).
 *
 * **The window is handed ids, never paths it could send back.** Each row carries an id minted
 * here from the path, and a `pathLabel` to show (ADR 0086); `workspace:open-recent` takes the id
 * alone, and main finds the folder in the list it wrote. A window asking for an id nobody minted
 * gets what it would get for a folder that vanished: nothing changes. The folder then opens
 * through `WorkspaceService.open`, the door File ▸ Open Folder uses, so trust is the store's
 * answer as always (ADR 0111) and the window still has one folder (ADR 0113).
 */

export type RecentFolderRow = IpcResponse<'workspace:recent'>['folders'][number];

export interface RecentFoldersService {
  /** Puts `folder` at the front: every folder that opens, whichever door it came through. */
  remember(folder: string): Promise<void>;
  /** The list, newest first, without the folders that are gone; `current` is marked. */
  listing(current: string | null): Promise<RecentFolderRow[]>;
  /**
   * The folder `id` names, when it is in the list, still there, and not the one open — the
   * folder to open. `undefined` means nothing changes: choosing the open folder is not a reopen.
   */
  chosen(id: string, current: string | null): Promise<string | undefined>;
}

export interface RecentFoldersOptions {
  readonly list: RecentFolders;
  readonly exists: (folder: string) => Promise<boolean>;
  /** What a path is shortened against for display, asked at each listing. */
  readonly home: () => string;
  readonly platform?: NodeJS.Platform;
}

export function createRecentFoldersService(options: RecentFoldersOptions): RecentFoldersService {
  const platform = options.platform ?? process.platform;
  const windows = platform === 'win32';
  // The id and the comparison agree on what one folder is: case folded on Windows only.
  const key = (folder: string): string => (windows ? folder.toLowerCase() : folder);
  const idOf = (folder: string): string =>
    createHash('sha256').update(key(folder)).digest('hex').slice(0, 16);
  const same = (left: string, right: string | null): boolean =>
    right !== null && key(left) === key(right);

  /** The entries still on disk. Checked at each listing, the files' rule: no watcher. */
  const present = async () => {
    const entries = await options.list.list();
    const kept = await Promise.all(entries.map((entry) => options.exists(entry.path)));
    return entries.filter((_, index) => kept[index] === true);
  };

  return {
    remember: async (folder) => {
      // The platform's own separators, as `pathLabelOf` reads them: `c:\work\promo` is
      // `promo` on Windows whatever machine the code runs on.
      const name = (windows ? win32 : posix).basename(folder);
      await options.list.remember({ path: folder, name: name || folder });
    },

    listing: async (current) =>
      (await present()).map((entry) => ({
        id: idOf(entry.path),
        name: entry.name,
        pathLabel: pathLabelOf(entry.path, options.home(), undefined, platform),
        current: same(entry.path, current),
      })),

    chosen: async (id, current) => {
      const entry = (await present()).find((candidate) => idOf(candidate.path) === id);
      if (entry === undefined || same(entry.path, current)) return undefined;
      return entry.path;
    },
  };
}
