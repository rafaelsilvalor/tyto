import { basename, dirname, join, relative } from 'node:path';

import {
  type Diagnostic,
  PROFILES_DIRECTORY,
  PROFILE_FILE_NAME,
  type Result,
  type TrustStore,
  createLineIndex,
  lineColumnAtIndex,
  ok,
} from '@tyto/core';
import {
  type LoadedProfile,
  type LoadedWorkspace,
  findWorkspace,
  isInside,
  loadWorkspace,
} from '@tyto/io';

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
 *
 * The work profile the folder names (TYTO-347, ADR 0114) is a second source with its own trust:
 * the window is told its label, its answer and what it left out, never its path, and trusts it
 * through the same door, naming only which of the two it means.
 */

/**
 * The open folder as the window may know it: its real path and name to show, whether it is
 * trusted, the output folder for the export dialog, and the project file's diagnostics as
 * problem rows. The path is shown and never sent back (ADR 0086).
 */
export type WorkspaceState = IpcResponse<'workspace:folder'>;

/** Which source a trust request means: the folder main has open, or the profile it names. */
export type TrustSource = 'folder' | 'profile';

/** For one brief: the workspace's asset folders and the fonts to draw it in. */
export interface BriefPlaces {
  readonly assets: readonly string[];
  readonly fonts: FontsInForce;
  /**
   * The font folders `fonts` was built from, so a caller adding the source cache's folders
   * (ADR 0117) can ask for the library that has both. Absent means none.
   */
  readonly fontFolders?: readonly string[];
}

/**
 * Whether a plugin may be asked for what a brief in some folder names (ADR 0118, ADR 0119),
 * and the sections it is handed. `none` is a brief in no workspace at all.
 */
export interface SourceTrust {
  readonly trust: 'trusted' | 'restricted' | 'none';
  readonly sections?: Readonly<Record<string, unknown>>;
  /** The folder the window has open, which Workspace: Manage Trust acts on. */
  readonly open?: true;
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
   * Trusts the open folder, or the profile it names, and reads the folder again at once (ADR
   * 0111): raising trust is safe, so what was withheld applies now. Nothing open, nothing
   * happens; a profile trusted by where it lives is not written down. Never given a path: it
   * acts on what main has open and on nothing else.
   */
  grant(source: TrustSource): Promise<Result<true>>;
  /**
   * Takes the trust back. **It applies the next time the folder is opened** (ADR 0111): the
   * window keeps it as it is until then, and says so.
   */
  revoke(source: TrustSource): Promise<Result<true>>;
  /** The places for a brief in `briefDirectory`: the workspace's only when it is inside. */
  placesFor(briefDirectory: string | undefined): BriefPlaces;
  /**
   * The trust a fetch for a brief in `briefDirectory` answers to (ADR 0119). Inside the open
   * folder, the folder's — a trust taken back still holds until it reopens, as everywhere
   * (ADR 0111). Outside it, the workspace the CLI would find by walking up, and its answer in
   * the trust store, so one file fetches the same in both programs. `undefined` is a brief in
   * no file yet, which has no folder to answer for it.
   */
  sourceTrustFor(briefDirectory: string | undefined): Promise<SourceTrust | undefined>;
}

/** The places of the resolved project: what a restricted folder refused is not among them. */
export interface FolderPlaces {
  readonly output: string | undefined;
  readonly assets: readonly string[];
  readonly templates: readonly string[];
}

const NO_FOLDER_PLACES: FolderPlaces = { output: undefined, assets: [], templates: [] };

export interface WorkspaceServiceOptions {
  readonly trustStore: TrustStore;
  /** `TYTO_HOME`, so the folder holding it is never read as a project (ADR 0112). */
  readonly home: string;
  /** Hands the workspace's template folders to the sources, which read them again. */
  readonly setTemplateFolders: (folders: readonly string[]) => Promise<void>;
  /**
   * The folder now open, or nothing, after every open, re-read and close — what the explorer
   * lists (TYTO-279, ADR 0115). A folder that is not a workspace is nothing. With it, the
   * folders the resolved project names, so the explorer can flag them (TYTO-282, ADR 0116).
   */
  readonly onFolder?: (folder: string | undefined, places: FolderPlaces) => Promise<void>;
}

const NOTHING_OPEN: WorkspaceState = {
  folder: null,
  name: null,
  trust: 'restricted',
  leftOut: 0,
  output: null,
  profile: null,
  places: [],
  exportPresets: [],
  problems: [],
};

/** What a restricted source leaves out: each key that led outside, and its withheld sections. */
const LEFT_OUT: ReadonlySet<string> = new Set([
  'W_PROJECT_PATH_OUTSIDE',
  'W_PROJECT_SECTIONS_WITHHELD',
]);

const PLACE_KEYS = ['assets', 'templates', 'fonts', 'output'] as const;

export function createWorkspaceService(options: WorkspaceServiceOptions): WorkspaceService {
  let open: LoadedWorkspace | undefined;
  /** Trust taken back while the folder is open, per source: still trusted until it reopens. */
  let revoked: Record<TrustSource, boolean> = { folder: false, profile: false };

  const read = async (folder: string): Promise<boolean> => {
    const loaded = await loadWorkspace(folder, {
      trustStore: options.trustStore,
      home: options.home,
    });
    open = loaded;
    revoked = { folder: false, profile: false };
    await options.setTemplateFolders(loaded?.project.templates ?? []);
    await options.onFolder?.(
      loaded?.folder,
      loaded === undefined
        ? NO_FOLDER_PLACES
        : {
            output: loaded.project.output,
            assets: loaded.project.assets,
            templates: loaded.project.templates,
          },
    );
    return loaded !== undefined;
  };

  /** The path `source` names in the store, or `undefined` when it has none to write. */
  const pathOf = (source: TrustSource): string | undefined => {
    if (open === undefined) return undefined;
    if (source === 'folder') return open.folder;
    const profile = open.profile;
    return profile === undefined || profile.byLocation ? undefined : profile.file;
  };

  const trustOf = (source: TrustSource): 'trusted' | 'restricted' | undefined =>
    source === 'folder' ? open?.trust : open?.profile?.trust;

  return {
    state() {
      if (open === undefined) return NOTHING_OPEN;
      const profile = open.profile;
      return {
        folder: open.folder,
        name: basename(open.folder),
        trust: revoked.folder ? 'revoked' : open.trust,
        leftOut: open.diagnostics.filter((item) => LEFT_OUT.has(item.code)).length,
        output: open.project.output ?? null,
        profile:
          profile === undefined
            ? null
            : {
                label: profileLabel(profile),
                trust: revoked.profile ? 'revoked' : profile.trust,
                byLocation: profile.byLocation,
                leftOut: profile.diagnostics.filter((item) => LEFT_OUT.has(item.code)).length,
              },
        places: placesOf(open),
        // Already resolved against the folder and confined by `@tyto/io` (ADR 0126); at most
        // the hundred the channel carries.
        exportPresets: open.project.exportPresets.slice(0, 100).map((preset) => ({
          name: preset.name,
          formats: [...preset.formats],
          types: [...preset.types],
          folder: preset.folder,
        })),
        problems: [...problemsOf(open)],
      };
    },

    open: read,

    async close() {
      open = undefined;
      revoked = { folder: false, profile: false };
      await options.setTemplateFolders([]);
      await options.onFolder?.(undefined, NO_FOLDER_PLACES);
    },

    async grant(source) {
      const path = pathOf(source);
      if (open === undefined || path === undefined) return ok(true);
      const granted = await options.trustStore.grant(path);
      if (!granted.ok) return granted;
      await read(open.folder);
      return ok(true);
    },

    async revoke(source) {
      const path = pathOf(source);
      if (open === undefined || path === undefined) return ok(true);
      const removed = await options.trustStore.revoke(path);
      if (!removed.ok) return removed;
      // Only an approval that was there is pending removal; a restricted source stays as it is.
      if (trustOf(source) === 'trusted') revoked = { ...revoked, [source]: true };
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
      return {
        assets: open.project.assets,
        fonts: fontsFor(open.project.fonts),
        fontFolders: open.project.fonts,
      };
    },

    async sourceTrustFor(briefDirectory) {
      if (briefDirectory === undefined) return undefined;
      if (open !== undefined && isInside(open.folder, briefDirectory)) {
        return { trust: open.trust, sections: open.project.sections, open: true };
      }
      const folder = await findWorkspace(briefDirectory, { home: options.home });
      if (folder === undefined) return { trust: 'none' };
      // The store resolves the real path itself, as `loadWorkspace` asks it.
      const answer = await options.trustStore.trustOf(folder);
      return { trust: answer.trust };
    },
  };
}

/**
 * What the window calls the profile: the name the folder wrote, or for a path the profile's own
 * folder when the file is a `profile.json`, else the file's name without `.json`. Never the path.
 */
export function profileLabel(profile: LoadedProfile): string {
  const reference = profile.reference;
  if (reference.kind === 'name') return reference.name;
  const file = basename(profile.file);
  return file.toLowerCase() === 'profile.json'
    ? basename(dirname(profile.file))
    : file.replace(/\.json$/iu, '');
}

/** Each key some sheet set, its folders and the sheet it came from (TYTO-347). */
function placesOf(open: LoadedWorkspace): WorkspaceState['places'] {
  const { project } = open;
  return PLACE_KEYS.flatMap((key) => {
    const origin = project.origins[key];
    if (origin === undefined) return [];
    const folders = key === 'output' ? [project.output ?? ''] : project[key];
    return [{ key, folders: [...folders], origin }];
  });
}

/**
 * Each diagnostic as a row the problems panel can show without a range: `.tyto\project.json:4:13`
 * in front of the message, the way the command line prints the same diagnostic. **Relative to
 * the folder**: the absolute path filled the row and cut the message off, seen in the real
 * window — the folder is already in the title. A profile's rows name the profile's file the same
 * way ({@link shownProfileFile}).
 */
function problemsOf(open: LoadedWorkspace): readonly Diagnostic[] {
  const profile = open.profile;
  return [
    ...open.trustDiagnostics,
    ...(profile?.trustDiagnostics ?? []),
    ...located(open.diagnostics, open.text, relative(open.folder, open.file)),
    ...(profile === undefined
      ? []
      : located(profile.diagnostics, profile.text, shownProfileFile(open.folder, profile))),
  ];
}

/**
 * The profile's file as a row names it: `profiles\saude\profile.json` for a named one (the
 * home folder is the person's own and fills the row), relative to the workspace for one inside
 * it, and whole for a shared one, whose place is the thing to know.
 */
function shownProfileFile(folder: string, profile: LoadedProfile): string {
  if (profile.reference.kind === 'name') {
    return join(PROFILES_DIRECTORY, profile.reference.name, PROFILE_FILE_NAME);
  }
  if (isInside(folder, profile.file)) return relative(folder, profile.file);
  return profile.file;
}

function located(
  diagnostics: readonly Diagnostic[],
  text: string,
  file: string,
): readonly Diagnostic[] {
  const index = createLineIndex(text);
  return diagnostics.map((item): Diagnostic => {
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
}
