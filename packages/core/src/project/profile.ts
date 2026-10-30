import { type Diagnostic, diagnostic } from '../diagnostics/diagnostic.js';
import type { SourceRange } from '../source/range.js';
import { isInsidePath, resolvePath } from './paths.js';
import type { ProjectLayer } from './project.js';

/**
 * What a workspace's `profile` key names: a work profile, the reusable sheet many folders
 * share (TYTO-347, ADR 0114).
 *
 * Two forms. **A name** (`"saude"`) is a profile the person keeps in `TYTO_HOME/profiles/`,
 * trusted by where it lives (ADR 0111). **A path** (`"../team/saude.json"`, or anything with
 * a separator or ending in `.json`) is a profile file somewhere else, which is its own source
 * with its own approval. Reading either is I/O and lives in `@tyto/io`; this is the pure rule
 * that decides which form was written and whether it may be followed at all.
 */

export const PROFILES_DIRECTORY = 'profiles';
export const PROFILE_FILE_NAME = 'profile.json';

export type ProfileReference =
  | {
      readonly kind: 'name';
      /** As written; the folder `TYTO_HOME/profiles/<name>/` holds its `profile.json`. */
      readonly name: string;
      readonly written: string;
      readonly range: SourceRange | undefined;
    }
  | {
      readonly kind: 'path';
      /** The profile file, resolved against the folder that names it. */
      readonly path: string;
      readonly written: string;
      readonly range: SourceRange | undefined;
    };

export interface ProfileReferenceRead {
  /** `undefined` when the sheet names no profile, or names one that may not be followed. */
  readonly reference: ProfileReference | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Windows refuses these as a file or folder name with any extension, so a profile called
 * `con` would be a folder nobody can create, and on some APIs a handle to the console.
 */
const RESERVED_NAMES = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/iu;
/** What no folder name may hold on Windows; the control characters are checked apart. */
const FORBIDDEN_CHARACTERS = /[<>:"|?*]/u;
const MAXIMUM_NAME_LENGTH = 64;

/**
 * The `profile` key of a workspace's own sheet, read.
 *
 * A path in a restricted folder is a path key like any other (ADR 0111): one that leads out of
 * the folder lexically is refused here with `W_PROJECT_PATH_OUTSIDE`, and the I/O side checks
 * again after `realpath`. Otherwise an untrusted folder could pull any `profile.json` on the
 * disk, and the assets it names, into an export. A name is not confined: it can only ever
 * reach `TYTO_HOME/profiles/`, the person's own.
 */
export function profileReferenceOf(layer: ProjectLayer): ProfileReferenceRead {
  const entry = [...layer.entries].reverse().find((item) => item.key === 'profile');
  if (entry === undefined) return { reference: undefined, diagnostics: [] };
  const range = entry.valueRange ?? entry.keyRange;
  const value = entry.value;

  if (typeof value !== 'string' || value.trim() === '') {
    return refused(
      typeof value === 'string' ? value : JSON.stringify(value),
      'is not a profile name or a path to a profile file',
      range,
    );
  }
  if (!isPathShaped(value)) {
    const problem = problemWithName(value);
    if (problem !== undefined) return refused(value, problem, range);
    return { reference: { kind: 'name', name: value, written: value, range }, diagnostics: [] };
  }

  const path = resolvePath(layer.root, value);
  if (layer.trust === 'restricted' && !isInsidePath(layer.root, path)) {
    return {
      reference: undefined,
      diagnostics: [
        diagnostic('W_PROJECT_PATH_OUTSIDE', { key: 'profile', path: value }, at(range)),
      ],
    };
  }
  return { reference: { kind: 'path', path, written: value, range }, diagnostics: [] };
}

/**
 * Whether `value` is a path rather than a name: it holds a separator, or ends in `.json`, so
 * `"saude.json"` is the file beside the project, never a profile called `saude.json`.
 */
export function isPathShaped(value: string): boolean {
  return /[\\/]/u.test(value) || /\.json$/iu.test(value);
}

/**
 * Why `name` cannot be a profile's folder name, or `undefined` when it can.
 *
 * Strict on purpose: the name becomes one segment under `TYTO_HOME/profiles/`, and nothing in
 * it may climb out of that folder or mean something to the file system other than a name.
 */
export function problemWithName(name: string): string | undefined {
  return problemWithFolderName(name, { noun: 'a profile name', maximum: MAXIMUM_NAME_LENGTH });
}

/**
 * Why `name` cannot be one folder's name that a person typed, or `undefined` when it can: the
 * rule ADR 0114 wrote for a profile, which a delivery's name follows too (ADR 0157). Refused,
 * never rewritten, because a second sanitiser beside the file system's own is how one name
 * ends up as two folders. A path separator is a forbidden character here, so a name is always
 * one segment. `noun` names what is refused; `maximum` counts UTF-16 code units, as Windows'
 * path limit does.
 */
export function problemWithFolderName(
  name: string,
  rule: { readonly noun: string; readonly maximum: number },
): string | undefined {
  if (name.startsWith('.')) return `starts with a dot, which ${rule.noun} may not`;
  if (name.includes('..')) return `holds '..', which ${rule.noun} may not`;
  // A separator never reaches here as a profile, which `isPathShaped` reads as a path first.
  if (/[\\/]/u.test(name)) return `holds a path separator, which ${rule.noun} may not`;
  if (FORBIDDEN_CHARACTERS.test(name) || [...name].some((character) => character < ' ')) {
    return 'holds a character a folder name may not';
  }
  if (/[ .]$/u.test(name)) return 'ends in a space or a dot, which Windows drops from a name';
  if (RESERVED_NAMES.test(name)) return 'is a name Windows reserves for a device';
  if (name.length > rule.maximum) {
    return `is longer than ${String(rule.maximum)} characters`;
  }
  return undefined;
}

function refused(
  profile: string,
  problem: string,
  range: SourceRange | undefined,
): ProfileReferenceRead {
  return {
    reference: undefined,
    diagnostics: [diagnostic('W_PROJECT_PROFILE_INVALID', { profile, problem }, at(range))],
  };
}

function at(range: SourceRange | undefined): { range?: SourceRange } {
  return range === undefined ? {} : { range };
}
