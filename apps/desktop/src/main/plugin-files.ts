import { isAbsolute, relative } from 'node:path';

import { type Diagnostic, type Diagnostics, createLineIndex, lineColumnAtIndex } from '@tyto/core';
import {
  type InstalledPacks,
  type PluginFilesApproval,
  type PluginFilesCopyOnDisk,
  type PluginFilesSyncOptions,
  type SyncedPluginFiles,
  pluginStoreWithCopies,
} from '@tyto/io';
import { type LoadedPlugins, NO_PLUGINS, type PluginStore } from '@tyto/plugin-api';

/**
 * The plugin files, for the desktop (ADR 0151, TYTO-433).
 *
 * The sync is `@tyto/io`'s, the one `tyto render` runs; this module decides **when** and what
 * the window gets from it. A sync runs when the app starts, when the window opens a workspace
 * folder, and on the two commands (ADR 0151 decision 3): the update moves every ref, the
 * others fetch only what the cache lacks and never move a pinned one. It runs in main, where
 * `git` is a child process awaited off the window's thread; the renderer only asks for it.
 *
 * **The copies run as a plugin set of their own**, beside the installed plugins and never
 * mixed into them. The installed plugins start once for the app's life (ADR 0044), but what
 * the files name changes with the folder the window opens, so this set is closed and started
 * again whenever a sync changes which copies load. Each copy is a plugin like any installed
 * one: its own process, every check at every load (ADR 0151 decision 6).
 *
 * **Templates only, in this card.** The set contributes its template packs to the search;
 * directives, panels and themes of a fetched plugin are not wired into the window yet.
 */

/** What one sync asks: the open folder and its trust, and whether refs move. */
export interface PluginFilesRequest {
  readonly workspace?: { readonly folder: string; readonly trusted: boolean };
  readonly update: boolean;
}

/** What the window's sources get from a sync: the fetched packs and what it had to say. */
export interface FetchedTemplates {
  readonly packs: InstalledPacks;
  /** The template names each fetched pack offers, by its folder; absent: all of them. */
  readonly only: ReadonlyMap<string, ReadonlySet<string>>;
  /** Plugins a copy replaces, whose installed packs leave the search (ADR 0151 decision 7). */
  readonly replaces: ReadonlySet<string>;
  /** The sync's problems and the packs' refusals, each without a range into a brief. */
  readonly problems: Diagnostics;
  /**
   * The files' configurations and aliases, resolved against the registry each read builds
   * (TYTO-433): the templates each folder configures, the image port, and each file's text by
   * the name a configuration's diagnostic carries, to place its range.
   */
  readonly configured: SyncedPluginFiles['configured'];
  readonly images: SyncedPluginFiles['images'];
  readonly texts: SyncedPluginFiles['texts'];
}

export interface DesktopPluginFilesOptions {
  readonly home: string;
  readonly builtInNames: ReadonlySet<string>;
  /** `@tyto/io`'s `syncPluginFiles`. */
  readonly sync: (options: PluginFilesSyncOptions) => Promise<SyncedPluginFiles>;
  /** Asked of a person, in a dialog, for a plugin whose permissions nobody approved. */
  readonly approve: PluginFilesApproval;
  /** Starts the copies' plugins from a store that lists them and nothing else. */
  readonly start: (store: PluginStore) => Promise<LoadedPlugins>;
  /** Activates the started plugins and checks their packs (`installedPacks`). */
  readonly packs: (
    loaded: LoadedPlugins,
    folderOf: (plugin: string) => string,
  ) => Promise<InstalledPacks>;
  /** Hands what loads to the window's sources, and tells the window to read them again. */
  readonly apply: (fetched: FetchedTemplates) => Promise<void>;
}

export interface DesktopPluginFiles {
  /** One sync, after any still running: two at once would race on one lock and one cache. */
  sync(request: PluginFilesRequest): Promise<void>;
  /** Ends the copies' processes. */
  close(): Promise<void>;
}

export function createDesktopPluginFiles(options: DesktopPluginFilesOptions): DesktopPluginFiles {
  let running: Promise<void> = Promise.resolve();
  let loaded: LoadedPlugins | undefined;
  let loadedKey = '';
  /** What the last sync the window was told about said, to tell a sync that changed nothing. */
  let lastSaid = '';

  const once = async (request: PluginFilesRequest): Promise<void> => {
    const placed = new Map<Diagnostic, { readonly file: string; readonly text: string }>();
    const synced = await options.sync({
      home: options.home,
      ...(request.workspace === undefined ? {} : { workspace: request.workspace }),
      update: request.update,
      fetches: true,
      builtInNames: options.builtInNames,
      shown: (path) => shownPath(request.workspace?.folder, path),
      onFileRead: (path, text, items) => {
        const file = shownPath(request.workspace?.folder, path);
        for (const item of items) placed.set(item, { file, text });
      },
      onSourceProblem: (file, items) => {
        for (const item of items) placed.set(item, { file, text: '' });
      },
      approve: options.approve,
    });

    const problems = synced.diagnostics.map((item) => located(item, placed.get(item)));
    // The files' text too: an edited alias or value changes no copy and no problem.
    const said = [
      ...problems.map((item) => `${item.code} ${item.message}`),
      ...[...synced.texts].map(([file, text]) => `${file}\n${text}`),
    ].join('\n');
    // **A sync that changed nothing tells the window nothing.** Every open brief is compiled
    // again on `templates:changed`, and a folder opened with no plugin files, or a start with
    // the same copies as before, must not cost a compile (seen on CI: a `.md` opened from the
    // explorer counted a brief preview it never asked for).
    const key = keyOf(synced.copies);
    const started = key === '' || loaded !== undefined;
    if (key === loadedKey && started && said === lastSaid) return;

    // Started again only when what loads changed: a sync that fetched nothing new must not
    // cost every fetched plugin its process.
    if (key !== loadedKey || !started) {
      const before = loaded;
      // Forgotten before the start, so a start that throws leaves the next sync to start one.
      loaded = undefined;
      await before?.close();
      if (key !== '') loaded = await options.start(copiesOnly(options.home, synced.copies));
      loadedKey = key;
    }
    lastSaid = said;
    const current = loaded ?? NO_PLUGINS;
    const byName = new Map(synced.copies.map((copy) => [copy.plugin, copy]));
    const packs = await options.packs(current, (plugin) => byName.get(plugin)?.directory ?? '');

    const only = new Map<string, ReadonlySet<string>>();
    for (const [directory, plugin] of packs.owners) {
      const copy = byName.get(plugin);
      if (copy !== undefined && !copy.wholePlugin) only.set(directory, new Set(copy.templates));
    }
    await options.apply({
      packs,
      only,
      replaces: new Set(byName.keys()),
      problems: [...problems, ...current.warnings, ...packs.warnings],
      configured: synced.configured,
      images: synced.images,
      texts: synced.texts,
    });
  };

  return {
    sync(request) {
      const next = running.then(() => once(request));
      // A failed sync must not stop the next one from running.
      running = next.catch(() => undefined);
      return next;
    },
    async close() {
      await running;
      await loaded?.close();
      loaded = undefined;
    },
  };
}

/** Which copies load, at which commit: what decides whether the set starts again. */
function keyOf(copies: readonly PluginFilesCopyOnDisk[]): string {
  return copies
    .map((copy) => `${copy.plugin}@${copy.directory}`)
    .sort()
    .join('\n');
}

/**
 * The copies, and only them, as a plugin store: approvals and crashes are `TYTO_HOME`'s by
 * name, as an installed plugin's are, but none of the installed plugins is listed, because
 * those already run in the app's own set.
 */
export function copiesOnly(home: string, copies: readonly PluginFilesCopyOnDisk[]): PluginStore {
  const store = pluginStoreWithCopies(home, copies);
  const names = new Set(copies.map((copy) => copy.plugin));
  return {
    ...store,
    list: async () => (await store.list()).filter((plugin) => names.has(plugin.folder)),
  };
}

/**
 * A path as a problem row shows it: inside the open folder relative to it, as the project
 * file's rows are (`workspace.ts`), else whole. A machine file stays whole because
 * `TYTO_HOME` may be anywhere, and a shortened `.tyto/plugin-files` would read as the
 * project's own folder.
 */
export function shownPath(workspace: string | undefined, path: string): string {
  if (workspace === undefined) return path;
  const between = relative(workspace, path);
  return between === '' || between.startsWith('..') || isAbsolute(between) ? path : between;
}

/**
 * A diagnostic as a row with no range: the problems panel places a range in the brief in
 * front, and one into a plugin file would point at the wrong text. The file and line go in
 * front of the message instead, the way the command line prints them.
 */
export function located(
  item: Diagnostic,
  where: { readonly file: string; readonly text: string } | undefined,
): Diagnostic {
  if (where === undefined) {
    const { range: _range, ...rest } = item;
    return rest;
  }
  if (item.range === undefined) return { ...item, message: `${where.file}: ${item.message}` };
  const { range, ...rest } = item;
  const at = lineColumnAtIndex(createLineIndex(where.text), range.start);
  return {
    ...rest,
    message: `${where.file}:${String(at.line)}:${String(at.column)}: ${item.message}`,
  };
}

/** The native box a permission prompt is, as Electron's `showMessageBox` takes it. */
export interface ApprovalBox {
  readonly type: 'question';
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [load: string, skip: string];
  readonly defaultId: 1;
  readonly cancelId: 1;
}

/** The window's words for the box, in its language. */
export type ApprovalText = (
  key: 'pluginFiles.approve.message' | 'pluginFiles.approve.load' | 'pluginFiles.approve.skip',
) => string;

/**
 * Asks about a fetched plugin that wants permissions in a native box (ADR 0151 decision 6):
 * its name, its repository and ref, and each permission. **Skipping is the default and what
 * Escape answers**, as `[y/N]` is at a terminal: a box a person dismisses approves nothing.
 * `show` is Electron's `dialog.showMessageBox`, so the rule is tested without a window.
 */
export function approveInABox(
  show: (box: ApprovalBox) => Promise<{ readonly response: number }>,
  text: ApprovalText,
): PluginFilesApproval {
  return async (manifest, source) => {
    const answer = await show({
      type: 'question',
      message: text('pluginFiles.approve.message').replaceAll('{plugin}', manifest.name),
      detail: [source, '', ...manifest.permissions].join('\n'),
      buttons: [text('pluginFiles.approve.load'), text('pluginFiles.approve.skip')],
      defaultId: 1,
      cancelId: 1,
    });
    return answer.response === 0;
  };
}
