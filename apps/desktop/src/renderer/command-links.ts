import { TAB_EXTENSIONS } from '../../shared/file-icons.js';
import type { CommandProblemRow } from './problems-panel.js';

/**
 * The places in a command's output a click can open (TYTO-496), **without the window ever
 * naming a path to main** (ADR 0113). Two kinds, each opened by something main minted:
 *
 * - a place a diagnostic of the same run printed (`file:line:col`) opens through
 *   `cli:open-diagnostic`, by the run and the row's index;
 * - a file inside the open folder opens through `explorer:open`, by the explorer's entry id,
 *   which {@link resolveEntry} finds by listing the folders on the way down.
 *
 * Anything else — a path outside the folder, a file no tab opens, a path with `..` — stays text.
 */

export type OutputLink =
  | {
      readonly kind: 'diagnostic';
      readonly row: CommandProblemRow;
    }
  | {
      readonly kind: 'path';
      /** The folders and the file under the open folder, in order. */
      readonly segments: readonly string[];
      readonly line?: number;
      readonly column?: number;
    };

export interface LinkSpan {
  readonly start: number;
  readonly end: number;
  readonly link: OutputLink;
}

export interface LinkContext {
  /** The rows the run reported so far, which carry the place as it was printed. */
  readonly diagnostics: readonly CommandProblemRow[];
  /** The open workspace folder, absolute, or `null`: then only diagnostics link. */
  readonly folder: string | null;
  /** Windows compares paths without case (`windows-fs-ignores-case`). */
  readonly caseless: boolean;
}

const EXTENSIONS = TAB_EXTENSIONS.map((extension) => extension.slice(1)).join('|');
/**
 * A path ending in a file a tab opens, then `:line` and `:column` if printed. No spaces: a path
 * with one is linked only when a diagnostic printed it, which is matched as a literal instead.
 */
const PATH = new RegExp(
  // `\p{L}`: a folder called `Ação` is a word too.
  `(?:[A-Za-z]:)?[\\p{L}\\p{N}_.~@+-]*(?:[\\\\/][\\p{L}\\p{N}_.~@+-]+)*\\.(?:${EXTENSIONS})(?![\\p{L}\\p{N}_])(?::(\\d+)(?::(\\d+))?)?`,
  'gu',
);

const overlaps = (spans: readonly LinkSpan[], start: number, end: number): boolean =>
  spans.some((span) => start < span.end && span.start < end);

/** The links in one piece of output text, in order. */
export function linksIn(text: string, context: LinkContext): readonly LinkSpan[] {
  const spans: LinkSpan[] = [];

  for (const row of context.diagnostics) {
    if (!row.openable || row.where === undefined || row.where === '') continue;
    // The place with its line and column first, so the whole of it is the link.
    const printed =
      row.line === undefined
        ? [row.where]
        : [`${row.where}:${String(row.line)}:${String(row.column ?? 1)}`, row.where];
    for (const place of printed) {
      let from = text.indexOf(place);
      while (from !== -1) {
        const end = from + place.length;
        if (!overlaps(spans, from, end))
          spans.push({ start: from, end, link: { kind: 'diagnostic', row } });
        from = text.indexOf(place, end);
      }
    }
  }

  for (const match of text.matchAll(PATH)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(spans, start, end)) continue;
    const file = match[0].replace(/(?::\d+){1,2}$/u, '');
    const segments = segmentsUnder(file, context);
    if (segments === undefined) continue;
    const line = match[1] === undefined ? undefined : Number(match[1]);
    const column = match[2] === undefined ? undefined : Number(match[2]);
    spans.push({
      start,
      end,
      link: {
        kind: 'path',
        segments,
        ...(line === undefined ? {} : { line }),
        ...(column === undefined ? {} : { column }),
      },
    });
  }

  return spans.sort((left, right) => left.start - right.start);
}

const isAbsolute = (path: string): boolean => /^(?:[A-Za-z]:)?[\\/]/u.test(path);

/**
 * The segments of `path` under the open folder, or `undefined` when it is not inside it. A
 * relative path is the run's, whose folder is the open one (ADR 0159 decision 1).
 */
export function segmentsUnder(path: string, context: LinkContext): readonly string[] | undefined {
  if (context.folder === null) return undefined;
  const split = (value: string): string[] =>
    value.split(/[\\/]+/u).filter((segment) => segment !== '' && segment !== '.');
  let segments = split(path);
  if (isAbsolute(path)) {
    const folder = split(context.folder);
    const same = (left: string, right: string): boolean =>
      context.caseless ? left.toLowerCase() === right.toLowerCase() : left === right;
    if (folder.length >= segments.length) return undefined;
    if (!folder.every((segment, index) => same(segment, segments[index] ?? ''))) return undefined;
    segments = segments.slice(folder.length);
  }
  if (segments.length === 0 || segments.includes('..')) return undefined;
  return segments;
}

/** What {@link resolveEntry} lists a folder with: `explorer:list`. */
export type ListFolder = (entryId: string | null) => Promise<{
  readonly entries: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
  }[];
}>;

/**
 * The explorer entry id of the file `segments` names, walking down from the open folder one
 * listing at a time, or `undefined` when a step is missing. Folders for every step but the last.
 */
export async function resolveEntry(
  segments: readonly string[],
  list: ListFolder,
  caseless: boolean,
): Promise<string | undefined> {
  let parent: string | null = null;
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    const { entries } = await list(parent);
    const found = entries.find(
      (entry) =>
        (caseless ? entry.name.toLowerCase() === segment.toLowerCase() : entry.name === segment) &&
        (last ? entry.kind !== 'folder' : entry.kind === 'folder'),
    );
    if (found === undefined) return undefined;
    parent = found.id;
  }
  return parent ?? undefined;
}

/**
 * The entries of the folder `segments` names under the open folder (TYTO-496): each step listed
 * by the explorer's ids, as `resolveEntry` walks, for the completion of a path. `undefined` when a
 * step is not a folder there.
 */
export async function listFolderAt(
  segments: readonly string[],
  list: ListFolder,
  caseless: boolean,
): Promise<
  readonly { readonly name: string; readonly kind: 'folder' | 'brief' | 'file' }[] | undefined
> {
  let parent: string | null = null;
  for (const segment of segments) {
    const { entries } = await list(parent);
    const found = entries.find(
      (entry) =>
        entry.kind === 'folder' &&
        (caseless ? entry.name.toLowerCase() === segment.toLowerCase() : entry.name === segment),
    );
    if (found === undefined) return undefined;
    parent = found.id;
  }
  const { entries } = await list(parent);
  return entries.map((entry) => ({
    name: entry.name,
    kind: entry.kind === 'folder' ? 'folder' : entry.kind === 'brief' ? 'brief' : 'file',
  }));
}

/**
 * The path a command can be given for the brief in front (TYTO-496), from what the window holds:
 * the label its tab shows, which is the absolute path unless the file is under the home folder,
 * where it starts with `~` (ADR 0086). A `~` path is given relative to the open folder, where a
 * command runs (ADR 0159), when the label shows the brief inside it; otherwise there is none,
 * since the window does not know the home folder and a command reads no `~`.
 */
export function commandPathOf(
  pathLabel: string | undefined,
  folder: string | null,
): string | undefined {
  if (pathLabel === undefined || pathLabel === '') return undefined;
  if (!pathLabel.startsWith('~')) return pathLabel;
  if (folder === null) return undefined;
  const tail = pathLabel.slice(1);
  const parts = folder.split(/[\\/]+/u).filter((part) => part !== '');
  // The longest end of the folder's own path that the label's starts with, on a separator.
  for (let from = 0; from < parts.length; from += 1) {
    const end = parts.slice(from);
    const labelParts = tail.split(/[\\/]+/u).filter((part) => part !== '');
    if (end.every((part, index) => part === labelParts[index]) && labelParts.length > end.length) {
      return labelParts.slice(end.length).join(tail.includes('\\') ? '\\' : '/');
    }
  }
  return undefined;
}
