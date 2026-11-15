import type { CatalogueKey } from '../../shared/i18n/index.js';
import type {
  BuiltinContext,
  BuiltinOutcome,
  PanelBuiltin,
  PanelFiles,
} from './command-builtins.js';
import { folderId, stepsLabel, stepsOf, walk } from './command-paths.js';

/**
 * The command panel's file commands that change the workspace (TYTO-537, ADR 0201 decision 5):
 * `new`, `mkdir`, `mv`, `cp`, `rm`, `open` and `reveal`.
 *
 * **The Explorer's own writes, nothing else.** Each goes through the window ports the Explorer
 * uses (`PanelWrites`), so main checks every id and name at the call, nothing is overwritten,
 * `rm` goes to the system's bin only, and a tab follows a move as it does after a rename there.
 * None runs in a restricted folder: the panel refuses them there before they start (ADR 0111).
 */

const failed = (line: string): BuiltinOutcome => ({ kind: 'printed', lines: [line], failed: true });
const done: BuiltinOutcome = { kind: 'printed', lines: [] };

const sayWith = (
  context: BuiltinContext,
  key: CatalogueKey,
  values: Record<string, string>,
): string =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    context.say(key),
  );

const usage = (context: BuiltinContext, name: string, key: CatalogueKey): BuiltinOutcome =>
  failed(`${name}: ${context.say(key)}`);

/** Why a write did not happen, as the panel says it; `gone` is the path's missing line. */
function refusal(
  context: BuiltinContext,
  files: PanelFiles,
  answer: { readonly reason: string; readonly detail?: string | undefined },
  path: string,
): BuiltinOutcome {
  switch (answer.reason) {
    case 'exists':
      return failed(sayWith(context, 'commandPanel.files.exists', { path }));
    case 'invalid':
    case 'recipe-name':
      return failed(sayWith(context, 'commandPanel.files.invalid', { path }));
    case 'link':
      return failed(sayWith(context, 'commandPanel.files.link', { path }));
    case 'trash-failed':
      return failed(
        sayWith(context, 'commandPanel.files.trashFailed', { path, bin: files.writes.bin }),
      );
    case 'failed':
      return failed(
        sayWith(context, 'commandPanel.files.failed', { path, detail: answer.detail ?? '' }),
      );
    default:
      return failed(sayWith(context, 'commandPanel.files.missing', { path }));
  }
}

/** The workspace, or the line saying a file command needs one. */
function filesOf(context: BuiltinContext, name: string): PanelFiles | BuiltinOutcome {
  return context.files ?? failed(sayWith(context, 'commandPanel.files.noFolder', { name }));
}

const isOutcome = (value: PanelFiles | BuiltinOutcome): value is BuiltinOutcome => 'kind' in value;

/** An existing entry a typed path names, never the root, or the line saying why not. */
async function existing(
  context: BuiltinContext,
  files: PanelFiles,
  typed: string,
): Promise<
  | {
      readonly id: string;
      readonly name: string;
      readonly kind: 'folder' | 'brief' | 'file';
      readonly steps: readonly string[];
      readonly ids: readonly string[];
    }
  | BuiltinOutcome
> {
  const steps = stepsOf(files.workingFolder, typed);
  if (!steps.ok) return failed(sayWith(context, 'commandPanel.files.outside', { path: typed }));
  if (steps.steps.length === 0) {
    return failed(sayWith(context, 'commandPanel.files.root', { path: typed }));
  }
  const walked = await walk(steps.steps, files.list, files.caseless);
  if (walked === undefined || walked.found.kind === 'root') {
    return failed(sayWith(context, 'commandPanel.files.missing', { path: typed }));
  }
  const { id, name, kind } = walked.found;
  return { id, name, kind, steps: walked.steps, ids: walked.ids };
}

/**
 * Where a new entry typed as `typed` goes: the folder above its last step, by id, and that
 * step as its name. `into` reads an existing folder as the place to put `name` in, as `mv`
 * and `cp` do.
 */
async function target(
  context: BuiltinContext,
  files: PanelFiles,
  typed: string,
  into?: string,
): Promise<
  | { readonly parentId: string | null; readonly name: string; readonly steps: readonly string[] }
  | BuiltinOutcome
> {
  const steps = stepsOf(files.workingFolder, typed);
  if (!steps.ok || steps.steps.length === 0) {
    return failed(sayWith(context, 'commandPanel.files.outside', { path: typed }));
  }
  if (into !== undefined) {
    const walked = await walk(steps.steps, files.list, files.caseless);
    if (walked?.found.kind === 'folder') {
      return { parentId: walked.found.id, name: into, steps: [...walked.steps, into] };
    }
    if (walked !== undefined) {
      return failed(sayWith(context, 'commandPanel.files.exists', { path: typed }));
    }
  }
  const above = steps.steps.slice(0, -1);
  const parentId = await folderId(above, files.list, files.caseless);
  if (parentId === undefined) {
    return failed(
      sayWith(context, 'commandPanel.files.missing', { path: stepsLabel(above) || typed }),
    );
  }
  return { parentId, name: steps.steps.at(-1) ?? '', steps: steps.steps };
}

/** Whether `inner` is `outer` or under it, by steps, as names on this disk compare. */
const under = (outer: readonly string[], inner: readonly string[], caseless: boolean): boolean =>
  inner.length >= outer.length &&
  outer.every((step, index) =>
    caseless ? step.toLowerCase() === (inner[index] ?? '').toLowerCase() : step === inner[index],
  );

/** `new <name> [--template <t>]` and `mkdir <name>`: one entry, as the Explorer's New makes it. */
function maker(kind: 'file' | 'folder'): PanelBuiltin['run'] {
  const name = kind === 'file' ? 'new' : 'mkdir';
  return async (context) => {
    const files = filesOf(context, name);
    if (isOutcome(files)) return files;
    const words = context.args.map((word) => word.text);
    let template: string | undefined;
    const paths: string[] = [];
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index] ?? '';
      if (kind === 'file' && (word === '--template' || word === '-t')) {
        template = words[index + 1];
        index += 1;
        if (template === undefined) break;
      } else {
        paths.push(word);
      }
    }
    const typed = paths[0];
    if (
      typed === undefined ||
      paths.length > 1 ||
      (template === undefined && words.includes('--template'))
    ) {
      return usage(
        context,
        name,
        kind === 'file' ? 'commandPanel.files.usage.new' : 'commandPanel.files.usage.mkdir',
      );
    }
    let brief: string | undefined;
    if (template !== undefined) {
      if (!typed.toLowerCase().endsWith('.brief')) {
        return failed(context.say('commandPanel.files.templateBrief'));
      }
      brief = files.writes.skeletonOf(template);
      if (brief === undefined) {
        return failed(sayWith(context, 'commandPanel.files.noTemplate', { template }));
      }
    }
    const place = await target(context, files, typed);
    if ('kind' in place) return place;
    const made = await files.writes.create(place.parentId, place.name, kind, brief);
    return made.ok ? done : refusal(context, files, made, typed);
  };
}

/** `mv <source> <target>` and `cp <source> <target>`. */
function mover(name: 'mv' | 'cp'): PanelBuiltin['run'] {
  return async (context) => {
    const files = filesOf(context, name);
    if (isOutcome(files)) return files;
    const [from, to, ...rest] = context.args.map((word) => word.text);
    if (from === undefined || to === undefined || rest.length > 0) {
      return usage(context, name, 'commandPanel.files.usage.mvcp');
    }
    const source = await existing(context, files, from);
    if (!('id' in source)) return source;
    const place = await target(context, files, to, source.name);
    if ('kind' in place) return place;
    // Said here, by the steps; main refuses it too, by the real paths.
    if (source.kind === 'folder' && under(source.steps, place.steps.slice(0, -1), files.caseless)) {
      return failed(sayWith(context, 'commandPanel.files.intoItself', { path: from }));
    }
    const answer =
      name === 'mv'
        ? await files.writes.move(source.id, place.parentId, place.name)
        : await files.writes.copy(source.id, place.parentId, place.name);
    return answer.ok
      ? done
      : refusal(context, files, answer, answer.reason === 'exists' ? to : from);
  };
}

const newFile: PanelBuiltin = {
  name: 'new',
  help: 'commandPanel.builtin.new',
  runsInRestrictedFolder: false,
  arguments: 'path',
  run: maker('file'),
};

const mkdir: PanelBuiltin = {
  name: 'mkdir',
  help: 'commandPanel.builtin.mkdir',
  runsInRestrictedFolder: false,
  arguments: 'folder',
  run: maker('folder'),
};

const mv: PanelBuiltin = {
  name: 'mv',
  help: 'commandPanel.builtin.mv',
  runsInRestrictedFolder: false,
  arguments: 'path',
  run: mover('mv'),
};

const cp: PanelBuiltin = {
  name: 'cp',
  help: 'commandPanel.builtin.cp',
  runsInRestrictedFolder: false,
  arguments: 'path',
  run: mover('cp'),
};

const rm: PanelBuiltin = {
  name: 'rm',
  help: 'commandPanel.builtin.rm',
  runsInRestrictedFolder: false,
  arguments: 'path',
  run: async (context) => {
    const files = filesOf(context, 'rm');
    if (isOutcome(files)) return files;
    if (context.args.length === 0) return usage(context, 'rm', 'commandPanel.files.usage.rm');
    // Every path is found before anything goes: a typo in the third does not leave two gone.
    const entries = [];
    for (const word of context.args) {
      const entry = await existing(context, files, word.text);
      if (!('id' in entry)) return entry;
      entries.push({ ...entry, typed: word.text });
    }
    for (const entry of entries) {
      const unsaved = await files.writes.unsavedUnder(entry.id);
      if (unsaved > 0 && !(await files.writes.confirmRemove(entry, unsaved))) {
        return failed(context.say('commandPanel.files.kept'));
      }
      const removed = await files.writes.remove(entry.id);
      if (!removed.ok) return refusal(context, files, removed, entry.typed);
    }
    return done;
  },
};

const open: PanelBuiltin = {
  name: 'open',
  help: 'commandPanel.builtin.open',
  runsInRestrictedFolder: false,
  arguments: 'path',
  run: async (context) => {
    const files = filesOf(context, 'open');
    if (isOutcome(files)) return files;
    const typed = context.args[0]?.text;
    if (typed === undefined || context.args.length > 1) {
      return usage(context, 'open', 'commandPanel.files.usage.open');
    }
    const entry = await existing(context, files, typed);
    if (!('id' in entry)) return entry;
    if (entry.kind === 'folder' || !(await files.writes.open(entry.id))) {
      return failed(sayWith(context, 'commandPanel.files.noTab', { path: typed }));
    }
    return done;
  },
};

const reveal: PanelBuiltin = {
  name: 'reveal',
  help: 'commandPanel.builtin.reveal',
  runsInRestrictedFolder: false,
  arguments: 'path',
  run: async (context) => {
    const files = filesOf(context, 'reveal');
    if (isOutcome(files)) return files;
    const typed = context.args[0]?.text;
    if (typed === undefined || context.args.length > 1) {
      return usage(context, 'reveal', 'commandPanel.files.usage.reveal');
    }
    const entry = await existing(context, files, typed);
    if (!('id' in entry)) return entry;
    files.writes.reveal(entry.ids);
    return done;
  },
};

/** The write side of the file commands, in the order `help` lists them. */
export const FILE_WRITES: readonly PanelBuiltin[] = [newFile, mkdir, mv, cp, rm, open, reveal];
