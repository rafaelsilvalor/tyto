import type { Stats } from 'node:fs';
import { lstat, mkdir, open, opendir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { type Trust, diagnostic } from '@tyto/core';
import {
  type HostCapabilities,
  PLUGIN_FILE_LIMIT_BYTES,
  PLUGIN_FOLDER_LIST_LIMIT,
  PluginCapabilityError,
  type WorkspaceEntry,
  tooManyEntries,
} from '@tyto/plugin-api';

import { isMissing } from './real-paths.js';
import { writeEntry } from './source-cache.js';
import { confineToWorkspace } from './workspace-confine.js';

/**
 * The open workspace's files, read and written for a plugin through the host (ADR 0130,
 * ADR 0138). The plugin's process may write nowhere itself (ADR 0049); this is the one door.
 *
 * **The folder and its trust are getters, read on every call** and never fixed when the
 * plugin started: a person opens another folder, or trusts this one, while the plugin runs,
 * and the next call must see it. A restricted folder answers `E_WORKSPACE_FILE_RESTRICTED`
 * before the path is looked at, because trusting the folder is what lets the same call
 * through (ADR 0111).
 *
 * `checkedCapabilities` hands over a path already checked lexically and cleaned to `/`
 * segments. It is confined again here, after `realpath` (`confineToWorkspace`, ADR 0112), so
 * a link inside the folder that lands outside is refused; and a write is refused when the
 * real path's first segment is `.tyto`, which a link can reach as well as a name. A write
 * creates the folders it needs inside the workspace and lands whole, renamed into place.
 *
 * A part (ADR 0212) is read through an open handle at its offset into a buffer the size of
 * the part, so a 100 MB file never sits in memory whole. `list` follows each link it meets
 * through the same confinement and leaves out one that leads away, rather than refusing the
 * whole folder for it.
 */

export interface WorkspaceFilesOptions {
  /** The open folder, absolute, or `undefined` when none is open. Asked on every call. */
  readonly folder: () => string | undefined;
  /** The open folder's answer from the trust store, `--trust` counting. Asked on every call. */
  readonly trust: () => Trust;
}

export type WorkspaceFilePorts = Required<
  Pick<
    HostCapabilities,
    'workspaceRead' | 'workspaceWrite' | 'workspaceReadPart' | 'workspaceStat' | 'workspaceList'
  >
>;

function refuse(plugin: string, path: string, problem: string): never {
  throw new PluginCapabilityError(diagnostic('E_WORKSPACE_FILE', { plugin, path, problem }));
}

function overCeiling(size: number): string {
  return `the file is ${String(size)} bytes; the ceiling is ${String(PLUGIN_FILE_LIMIT_BYTES)}`;
}

/** `.tyto`, as Windows resolves a name: without case and without trailing dots or spaces. */
export function isTytoFolder(segment: string): boolean {
  return segment.replace(/[. ]+$/u, '').toLowerCase() === '.tyto';
}

/** The last segment of a path as the plugin asked for it, `''` for the folder itself. */
function nameOf(path: string): string {
  return path.split('/').at(-1) ?? '';
}

/** An entry for a file or a folder, or `undefined` for anything else (a socket, a device). */
function entryOf(name: string, found: Stats): WorkspaceEntry | undefined {
  const modifiedAt = found.mtime.toISOString();
  if (found.isFile()) return { name, kind: 'file', size: found.size, modifiedAt };
  if (found.isDirectory()) return { name, kind: 'folder', size: 0, modifiedAt };
  return undefined;
}

export function workspaceFiles(options: WorkspaceFilesOptions): WorkspaceFilePorts {
  /** The real path of `path` in the open folder, or the refusal that stops the call. */
  async function locate(
    plugin: string,
    path: string,
    access: 'read' | 'write',
  ): Promise<{ readonly real: string; readonly realFolder: string }> {
    const folder = options.folder();
    if (folder === undefined) refuse(plugin, path, 'no workspace folder is open');
    if (options.trust() !== 'trusted') {
      throw new PluginCapabilityError(diagnostic('E_WORKSPACE_FILE_RESTRICTED', { plugin, path }));
    }
    const confined = await confineToWorkspace(folder, join(folder, path), {
      follow: access === 'read' ? 'existing' : 'nearest',
    });
    if ('refused' in confined) {
      refuse(
        plugin,
        path,
        confined.refused === 'outside'
          ? 'the path leaves the folder'
          : 'the path leads out of the folder through a link',
      );
    }
    if (access === 'write') {
      const [first = ''] = relative(confined.realFolder, confined.real).split(sep);
      if (isTytoFolder(first)) refuse(plugin, path, 'it is inside .tyto/, which only Tyto writes');
    }
    return confined;
  }

  /** `stat` of a located path, with a missing one refused as the plugin's mistake. */
  async function statOf(plugin: string, path: string, real: string): Promise<Stats> {
    try {
      return await stat(real);
    } catch (cause) {
      if (isMissing(cause)) refuse(plugin, path, 'no such file or folder');
      throw cause;
    }
  }

  return {
    async workspaceRead(plugin, path) {
      const { real } = await locate(plugin, path, 'read');
      let size: number;
      try {
        const found = await stat(real);
        if (!found.isFile()) refuse(plugin, path, 'it names a folder, not a file');
        size = found.size;
      } catch (cause) {
        if (cause instanceof PluginCapabilityError) throw cause;
        if (isMissing(cause)) refuse(plugin, path, 'no such file');
        throw cause;
      }
      if (size > PLUGIN_FILE_LIMIT_BYTES) refuse(plugin, path, overCeiling(size));
      const bytes = new Uint8Array(await readFile(real));
      // Measured again on what was read: the file may have grown since `stat`.
      if (bytes.byteLength > PLUGIN_FILE_LIMIT_BYTES) {
        refuse(plugin, path, overCeiling(bytes.byteLength));
      }
      return bytes;
    },

    async workspaceWrite(plugin, path, bytes) {
      const { real } = await locate(plugin, path, 'write');
      if (bytes.byteLength > PLUGIN_FILE_LIMIT_BYTES) {
        refuse(plugin, path, overCeiling(bytes.byteLength));
      }
      const found = await stat(real).catch(() => undefined);
      if (found?.isDirectory() === true) refuse(plugin, path, 'it names a folder, not a file');
      // Inside the folder by the check above: the part that did not exist yet is no link.
      await mkdir(dirname(real), { recursive: true });
      await writeEntry(real, bytes);
    },

    async workspaceReadPart(plugin, path, offset, length) {
      const { real } = await locate(plugin, path, 'read');
      const found = await statOf(plugin, path, real);
      if (!found.isFile()) refuse(plugin, path, 'it names a folder, not a file');
      // Sized by what the file holds from the offset, so a short file costs no 32 MiB buffer.
      const wanted = Math.max(0, Math.min(length, found.size - offset));
      if (wanted === 0) return new Uint8Array(0);
      const handle = await open(real, 'r');
      try {
        const buffer = new Uint8Array(wanted);
        const { bytesRead } = await handle.read(buffer, 0, wanted, offset);
        // The file may have shrunk since `stat`; what was read is what crosses.
        return bytesRead === wanted ? buffer : buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },

    async workspaceStat(plugin, path) {
      const { real } = await locate(plugin, path, 'read');
      const entry = entryOf(nameOf(path), await statOf(plugin, path, real));
      if (entry === undefined) refuse(plugin, path, 'it is neither a file nor a folder');
      return entry;
    },

    async workspaceList(plugin, path) {
      const { real, realFolder } = await locate(plugin, path, 'read');
      if (!(await statOf(plugin, path, real)).isDirectory()) {
        refuse(plugin, path, 'it names a file, not a folder');
      }
      const entries: WorkspaceEntry[] = [];
      for await (const dirent of await opendir(real)) {
        // One past the ceiling is enough to know the folder is over it.
        if (entries.length === PLUGIN_FOLDER_LIST_LIMIT) {
          refuse(plugin, path, tooManyEntries(PLUGIN_FOLDER_LIST_LIMIT + 1));
        }
        const inside = join(real, dirent.name);
        let found: Stats | undefined = await lstat(inside).catch(() => undefined);
        if (found?.isSymbolicLink() === true) {
          // Confined like a read of the link would be; one that leads away, or nowhere, is
          // left out. Both paths are real, so only the check after `realpath` can refuse.
          const confined = await confineToWorkspace(realFolder, inside, { follow: 'existing' });
          found =
            'refused' in confined ? undefined : await stat(confined.real).catch(() => undefined);
        }
        const entry = found === undefined ? undefined : entryOf(dirent.name, found);
        if (entry !== undefined) entries.push(entry);
      }
      return entries.sort((one, other) =>
        one.name < other.name ? -1 : one.name > other.name ? 1 : 0,
      );
    },
  };
}
