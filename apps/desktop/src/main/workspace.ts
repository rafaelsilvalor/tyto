import { basename, relative } from 'node:path';

import {
  type Diagnostic,
  type Result,
  type TrustStore,
  createLineIndex,
  lineColumnAtIndex,
  ok,
} from '@tyto/core';
import { type LoadedWorkspace, isInside, loadWorkspace } from '@tyto/io';

import type { IpcResponse } from '../../shared/ipc.js';
import { type FontsInForce, fontsFor } from './fonts.js';

/**
 * The workspace folder the window has open, and what it changes for a brief inside it
 * (TYTO-278, ADR 0112, ADR 0113).
 *
 * One per window, and main's alone: the window asks to open one and main shows the dialog,
 * so no path the window sends ever becomes a folder Tyto reads (ADR 0010, ADR 0086). The
 * folder is read with `@tyto/io`'s `loadWorkspace`, which asks the trust store and confines a
 * restricted folder after `realpath` (ADR 0111); this is where the answer is composed into the
 * window: template folders into the sources, asset and font folders into every preview and
 * export of a brief that lives inside the folder, and the output folder as the export's
 * default destination.
 */

/**
 * The open folder as the window may know it: its real path and name to show, whether it is
 * trusted, the output folder for the export dialog, and the project file's diagnostics as
 * problem rows. The path is shown and never sent back (ADR 0086).
 */
export type WorkspaceState = IpcResponse<'workspace:folder'>;

/** For one brief: the workspace's asset folders and the fonts to draw it in. */
export interface BriefPlaces {
  readonly assets: readonly string[];
  readonly fonts: FontsInForce;
}

export interface WorkspaceService {
  state(): WorkspaceState;
  /**
   * Opens `folder` as the workspace, replacing any. `false` when it is not one — the folder
   * whose `.tyto` is `TYTO_HOME` (ADR 0112) — and then nothing is open.
   */
  open(folder: string): Promise<boolean>;
  close(): Promise<void>;
  /**
   * Trusts the open folder and reads it again at once (ADR 0111): raising trust is safe, so
   * the folders it withheld apply now. Nothing open, nothing happens. Never given a path: it
   * acts on the folder main has open and on no other.
   */
  grant(): Promise<Result<true>>;
  /**
   * Takes the open folder's trust back. **It applies the next time the folder is opened**
   * (ADR 0111): the window keeps it as it is until then, and says so.
   */
  revoke(): Promise<Result<true>>;
  /** The places for a brief in `briefDirectory`: the workspace's only when it is inside. */
  placesFor(briefDirectory: string | undefined): BriefPlaces;
}

export interface WorkspaceServiceOptions {
  readonly trustStore: TrustStore;
  /** `TYTO_HOME`, so the folder holding it is never read as a project (ADR 0112). */
  readonly home: string;
  /** Hands the workspace's template folders to the sources, which read them again. */
  readonly setTemplateFolders: (folders: readonly string[]) => Promise<void>;
}

const NOTHING_OPEN: WorkspaceState = {
  folder: null,
  name: null,
  trust: 'restricted',
  leftOut: 0,
  output: null,
  problems: [],
};

/** What a restricted folder leaves out: each key that led outside, and its withheld sections. */
const LEFT_OUT: ReadonlySet<string> = new Set([
  'W_PROJECT_PATH_OUTSIDE',
  'W_PROJECT_SECTIONS_WITHHELD',
]);

export function createWorkspaceService(options: WorkspaceServiceOptions): WorkspaceService {
  let open: LoadedWorkspace | undefined;
  /** Trust taken back while the folder is open: still trusted until it is opened again. */
  let revoked = false;

  const read = async (folder: string): Promise<boolean> => {
    const loaded = await loadWorkspace(folder, {
      trustStore: options.trustStore,
      home: options.home,
    });
    open = loaded;
    revoked = false;
    await options.setTemplateFolders(loaded?.project.templates ?? []);
    return loaded !== undefined;
  };

  return {
    state() {
      if (open === undefined) return NOTHING_OPEN;
      return {
        folder: open.folder,
        name: basename(open.folder),
        trust: revoked ? 'revoked' : open.trust,
        leftOut: open.diagnostics.filter((item) => LEFT_OUT.has(item.code)).length,
        output: open.project.output ?? null,
        problems: [...problemsOf(open)],
      };
    },

    open: read,

    async close() {
      open = undefined;
      revoked = false;
      await options.setTemplateFolders([]);
    },

    async grant() {
      if (open === undefined) return ok(true);
      const granted = await options.trustStore.grant(open.folder);
      if (!granted.ok) return granted;
      await read(open.folder);
      return ok(true);
    },

    async revoke() {
      if (open === undefined) return ok(true);
      const removed = await options.trustStore.revoke(open.folder);
      if (!removed.ok) return removed;
      // Only an approval that was there is pending removal; a restricted folder stays as it is.
      if (open.trust === 'trusted') revoked = true;
      return ok(true);
    },

    placesFor(briefDirectory) {
      // A brief outside the folder — or one in no file yet — renders as it always did: the
      // project's stock belongs to the project's briefs (ADR 0113).
      if (
        open === undefined ||
        briefDirectory === undefined ||
        !isInside(open.folder, briefDirectory)
      ) {
        return { assets: [], fonts: fontsFor([]) };
      }
      return { assets: open.project.assets, fonts: fontsFor(open.project.fonts) };
    },
  };
}

/**
 * Each diagnostic as a row the problems panel can show without a range: `.tyto\project.json:4:13`
 * in front of the message, the way the command line prints the same diagnostic. **Relative to
 * the folder**: the absolute path filled the row and cut the message off, seen in the real
 * window — the folder is already in the title.
 */
function problemsOf(open: LoadedWorkspace): readonly Diagnostic[] {
  const index = createLineIndex(open.text);
  const file = relative(open.folder, open.file);
  const located = open.diagnostics.map((item): Diagnostic => {
    const where =
      item.range === undefined
        ? file
        : (() => {
            const at = lineColumnAtIndex(index, item.range.start);
            return `${file}:${String(at.line)}:${String(at.column)}`;
          })();
    const { range: _range, ...rest } = item;
    return { ...rest, message: `${where}: ${item.message}` };
  });
  return [...open.trustDiagnostics, ...located];
}
