import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { type Trust, diagnostic } from '@tyto/core';
import {
  type HostCapabilities,
  PLUGIN_FILE_LIMIT_BYTES,
  PluginCapabilityError,
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
 */

export interface WorkspaceFilesOptions {
  /** The open folder, absolute, or `undefined` when none is open. Asked on every call. */
  readonly folder: () => string | undefined;
  /** The open folder's answer from the trust store, `--trust` counting. Asked on every call. */
  readonly trust: () => Trust;
}

export type WorkspaceFilePorts = Required<
  Pick<HostCapabilities, 'workspaceRead' | 'workspaceWrite'>
>;

function refuse(plugin: string, path: string, problem: string): never {
  throw new PluginCapabilityError(diagnostic('E_WORKSPACE_FILE', { plugin, path, problem }));
}

function overCeiling(size: number): string {
  return `the file is ${String(size)} bytes; the ceiling is ${String(PLUGIN_FILE_LIMIT_BYTES)}`;
}

/** `.tyto`, as Windows resolves a name: without case and without trailing dots or spaces. */
function isTytoFolder(segment: string): boolean {
  return segment.replace(/[. ]+$/u, '').toLowerCase() === '.tyto';
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
  };
}
