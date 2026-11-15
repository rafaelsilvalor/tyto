import type { CatalogueKey } from '../../shared/i18n/index.js';
import type {
  BuiltinContext,
  BuiltinOutcome,
  PanelBuiltin,
  PanelFiles,
} from './command-builtins.js';
import { type ListedKind, listedKindOf, stepsOf, walk } from './command-paths.js';

/**
 * The command panel's file commands that only read (TYTO-537, ADR 0201): `ls`, `cd`, `pwd` and
 * `cat`. Each reaches the workspace through the explorer's ids from the session's working
 * folder (`command-paths.ts`), never outside the workspace folder, and none writes, so all four
 * run in a restricted folder (ADR 0111): reading a name or a text runs nothing.
 */

const failed = (line: string): BuiltinOutcome => ({ kind: 'printed', lines: [line], failed: true });

const sayWith = (context: BuiltinContext, key: CatalogueKey, values: Record<string, string>) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    context.say(key),
  );

const usage = (context: BuiltinContext, name: string, key: CatalogueKey): BuiltinOutcome =>
  failed(`${name}: ${context.say(key)}`);

/** The workspace, or the line saying a file command needs one. */
const filesOr = (
  context: BuiltinContext,
  name: string,
): { readonly files: PanelFiles } | { readonly refused: BuiltinOutcome } =>
  context.files === undefined
    ? { refused: failed(sayWith(context, 'commandPanel.files.noFolder', { name })) }
    : { files: context.files };

/** The entry a typed path names from the working folder, or the line saying why there is none. */
async function find(
  context: BuiltinContext,
  files: PanelFiles,
  typed: string,
): Promise<
  | {
      readonly ok: true;
      readonly found: Awaited<ReturnType<typeof walk>> & object;
    }
  | { readonly ok: false; readonly refused: BuiltinOutcome }
> {
  const steps = stepsOf(files.workingFolder, typed);
  if (!steps.ok) {
    return {
      ok: false,
      refused: failed(sayWith(context, 'commandPanel.files.outside', { path: typed })),
    };
  }
  const found = await walk(steps.steps, files.list, files.caseless);
  if (found === undefined) {
    return {
      ok: false,
      refused: failed(sayWith(context, 'commandPanel.files.missing', { path: typed })),
    };
  }
  return { ok: true, found };
}

const KIND_KEYS: Record<ListedKind, CatalogueKey> = {
  folder: 'commandPanel.files.kind.folder',
  brief: 'commandPanel.files.kind.brief',
  recipe: 'commandPanel.files.kind.recipe',
  file: 'commandPanel.files.kind.file',
};

/** One row per entry, the names padded so the kinds start together; a folder ends in `/`. */
function rows(
  context: BuiltinContext,
  entries: readonly { readonly shown: string; readonly kind: ListedKind }[],
): string[] {
  const width = Math.max(0, ...entries.map((entry) => entry.shown.length));
  return entries.map(
    (entry) => `${entry.shown.padEnd(width)}  ${context.say(KIND_KEYS[entry.kind])}`,
  );
}

const ls: PanelBuiltin = {
  name: 'ls',
  help: 'commandPanel.builtin.ls',
  runsInRestrictedFolder: true,
  arguments: 'path',
  run: async (context) => {
    const workspace = filesOr(context, 'ls');
    if ('refused' in workspace) return workspace.refused;
    const { files } = workspace;
    if (context.args.length > 1) return usage(context, 'ls', 'commandPanel.files.usage.ls');
    const typed = context.args[0]?.text ?? '.';
    const answer = await find(context, files, typed);
    if (!answer.ok) return answer.refused;
    const { found, steps } = answer.found;
    if (found.kind !== 'root' && found.kind !== 'folder') {
      // A file is listed as itself, as typed, so its name links where it is.
      return {
        kind: 'printed',
        lines: rows(context, [{ shown: typed, kind: listedKindOf(found) }]),
        base: files.workingFolder,
      };
    }
    const listing = await files.list(found.kind === 'root' ? null : found.id);
    const lines = rows(
      context,
      listing.entries.map((entry) => ({
        shown: entry.kind === 'folder' ? `${entry.name}/` : entry.name,
        kind: listedKindOf(entry),
      })),
    );
    return {
      kind: 'printed',
      lines,
      // The names are the listed folder's: a link opens the file in it, not in the working one.
      base: steps,
      ...(listing.more > 0
        ? {
            notes: [sayWith(context, 'commandPanel.files.more', { count: String(listing.more) })],
          }
        : {}),
    };
  },
};

const cd: PanelBuiltin = {
  name: 'cd',
  help: 'commandPanel.builtin.cd',
  runsInRestrictedFolder: true,
  arguments: 'folder',
  run: async (context) => {
    const workspace = filesOr(context, 'cd');
    if ('refused' in workspace) return workspace.refused;
    const { files } = workspace;
    if (context.args.length > 1) return usage(context, 'cd', 'commandPanel.files.usage.cd');
    const typed = context.args[0]?.text;
    if (typed === undefined) {
      files.changeFolder([]);
      return { kind: 'printed', lines: [] };
    }
    const answer = await find(context, files, typed);
    if (!answer.ok) return answer.refused;
    const { found, steps } = answer.found;
    if (found.kind !== 'root' && found.kind !== 'folder') {
      return failed(sayWith(context, 'commandPanel.files.notFolder', { path: typed }));
    }
    // The names as the disk has them: `cd ENTREGAS` on Windows shows `entregas` in the prompt.
    files.changeFolder(steps);
    return { kind: 'printed', lines: [] };
  },
};

/** The working folder under the workspace folder, with the folder's own separator. */
export function absoluteFolder(folder: string, steps: readonly string[]): string {
  if (steps.length === 0) return folder;
  const separator = folder.includes('\\') ? '\\' : '/';
  const trimmed = folder.endsWith(separator) ? folder.slice(0, -1) : folder;
  return [trimmed, ...steps].join(separator);
}

const pwd: PanelBuiltin = {
  name: 'pwd',
  help: 'commandPanel.builtin.pwd',
  runsInRestrictedFolder: true,
  run: (context) => {
    const workspace = filesOr(context, 'pwd');
    if ('refused' in workspace) return workspace.refused;
    const { files } = workspace;
    return { kind: 'printed', lines: [absoluteFolder(files.folder, files.workingFolder)] };
  },
};

const cat: PanelBuiltin = {
  name: 'cat',
  help: 'commandPanel.builtin.cat',
  runsInRestrictedFolder: true,
  arguments: 'path',
  run: async (context) => {
    const workspace = filesOr(context, 'cat');
    if ('refused' in workspace) return workspace.refused;
    const { files } = workspace;
    if (context.args.length === 0) return usage(context, 'cat', 'commandPanel.files.usage.cat');
    const lines: string[] = [];
    const notes: string[] = [];
    for (const word of context.args) {
      const typed = word.text;
      const answer = await find(context, files, typed);
      if (!answer.ok) return answer.refused;
      const { found } = answer.found;
      if (found.kind === 'root' || found.kind === 'folder') {
        return failed(sayWith(context, 'commandPanel.files.isFolder', { path: typed }));
      }
      const read = await files.read(found.id);
      if (!read.ok) {
        const key: CatalogueKey =
          read.reason === 'binary'
            ? 'commandPanel.files.binary'
            : read.reason === 'folder'
              ? 'commandPanel.files.isFolder'
              : 'commandPanel.files.missing';
        return failed(sayWith(context, key, { path: typed }));
      }
      const text = read.text.endsWith('\n') ? read.text.slice(0, -1) : read.text;
      if (text !== '') lines.push(...text.split(/\r?\n/u));
      if (read.truncated) {
        notes.push(sayWith(context, 'commandPanel.files.truncated', { path: typed }));
      }
    }
    return {
      kind: 'printed',
      lines,
      base: files.workingFolder,
      ...(notes.length > 0 ? { notes } : {}),
    };
  },
};

/** The read side of the file commands, in the order `help` lists them. */
export const FILE_BUILTINS: readonly PanelBuiltin[] = [ls, cd, pwd, cat];
