import type { CommandDescription, CommandValue } from '../../shared/ipc.js';

/**
 * Completion for the command panel (TYTO-496): what may come at the caret, read off the CLI's own
 * tree (`cli:commands`) and never off a second list.
 *
 * Subcommands and options come from the tree. A value comes from what its definition says it is
 * (`value-kinds.ts` in `@tyto/command-line`): the choices it carries, the window's templates and
 * their formats, the installed plugins, or the files and folders of the open workspace folder,
 * listed through the explorer's ids (ADR 0113).
 */

export interface Suggestion {
  readonly label: string;
  /** What replaces the word at the caret. */
  readonly insert: string;
  readonly detail?: string;
  /** A folder or a list keeps going: no space is added after it. */
  readonly continues: boolean;
}

export interface Completion {
  /** The offsets of the word the suggestions replace. */
  readonly from: number;
  readonly to: number;
  readonly items: readonly Suggestion[];
}

export interface ListedEntry {
  readonly name: string;
  readonly kind: 'folder' | 'brief' | 'file';
}

export interface CompletionSources {
  readonly templates: () =>
    Promise<readonly CompletableTemplate[]> | readonly CompletableTemplate[];
  readonly plugins: () => Promise<readonly string[]> | readonly string[];
  /** The entries of a folder under the open one, or `undefined` with none open or none there. */
  readonly list: (segments: readonly string[]) => Promise<readonly ListedEntry[] | undefined>;
  readonly caseless: boolean;
  /** Options the window refuses, which are not offered: a suggestion that always fails. */
  readonly refused?: ReadonlySet<string>;
}

export interface CompletableTemplate {
  readonly name: string;
  readonly formats: readonly string[];
  /** The template an alias renders, said beside its name. */
  readonly aliasOf?: string;
}

/** The most suggestions shown: a long list is a prefix away from short. */
export const SUGGESTION_LIMIT = 50;

interface Word {
  /** The word as `splitCommandLine` would read it: quotes gone. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** The quote it is still inside at the caret, if one is open. */
  readonly open?: '"' | "'";
}

/** The words before the caret, and the one the caret is in (empty after a space). */
export function wordsAt(line: string, caret: number): { done: Word[]; current: Word } {
  const words: Word[] = [];
  let text = '';
  let start = -1;
  let quote: '"' | "'" | undefined;
  for (let at = 0; at < caret; at += 1) {
    const character = line[at] ?? '';
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else text += character;
      continue;
    }
    if (character === '"' || character === "'") {
      if (start === -1) start = at;
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (start !== -1) words.push({ text, start, end: at });
      text = '';
      start = -1;
      continue;
    }
    if (start === -1) start = at;
    text += character;
  }
  // The word goes on past the caret until the next space: all of it is replaced.
  let end = caret;
  while (quote === undefined && end < line.length && !/\s/u.test(line[end] ?? '')) end += 1;
  const current: Word =
    start === -1
      ? { text: '', start: caret, end }
      : { text, start, end, ...(quote === undefined ? {} : { open: quote }) };
  return { done: words, current };
}

type Option = CommandDescription['options'][number];

const optionNamed = (node: CommandDescription, flag: string): Option | undefined =>
  node.options.find((option) => option.long === flag || option.short === flag);

const startsWith = (text: string, prefix: string): boolean =>
  text.toLowerCase().startsWith(prefix.toLowerCase());

/** What can come at `caret` in `line`. */
export async function complete(
  line: string,
  caret: number,
  tree: CommandDescription,
  sources: CompletionSources,
): Promise<Completion> {
  const { done, current } = wordsAt(line, caret);
  const words = done[0]?.text === 'tyto' ? done.slice(1) : done;
  const used: Option[] = [];
  const valuesTyped = new Map<Option, string>();
  let node = tree;
  let positional = 0;
  let pending: Option | undefined;

  for (const word of words) {
    if (pending !== undefined) {
      valuesTyped.set(pending, word.text);
      pending = undefined;
      continue;
    }
    if (word.text.startsWith('-') && word.text !== '-') {
      const [flag = '', value] = word.text.split('=', 2);
      const option = optionNamed(node, flag);
      if (option === undefined) continue;
      used.push(option);
      if (option.takesValue === true && value === undefined) pending = option;
      else if (value !== undefined) valuesTyped.set(option, value);
      continue;
    }
    const child =
      positional === 0 ? node.commands.find((command) => command.name === word.text) : undefined;
    if (child !== undefined) node = child;
    else positional += 1;
  }

  const range = { from: current.start, to: current.end };
  const none: Completion = { ...range, items: [] };
  const context: ValueContext = { node, valuesTyped, sources };

  if (pending !== undefined) {
    return { ...range, items: await values(pending.value, current, context) };
  }
  if (current.text.startsWith('-')) {
    const equals = current.text.indexOf('=');
    if (equals !== -1) {
      const option = optionNamed(node, current.text.slice(0, equals));
      const head = current.text.slice(0, equals + 1);
      const items = await values(
        option?.value,
        { ...current, text: current.text.slice(equals + 1) },
        context,
      );
      return { ...range, items: items.map((item) => ({ ...item, insert: head + item.insert })) };
    }
    return { ...range, items: options(node, current.text, used, sources.refused) };
  }
  if (positional === 0 && node.commands.length > 0) {
    const items = node.commands
      .filter((command) => startsWith(command.name, current.text))
      .map((command) => ({
        label: command.name,
        insert: command.name,
        detail: command.description,
        continues: false,
      }));
    return { ...range, items: items.slice(0, SUGGESTION_LIMIT) };
  }
  const argument = node.arguments[positional];
  if (argument === undefined) return none;
  return { ...range, items: await values(argument.value, current, context) };
}

function options(
  node: CommandDescription,
  typed: string,
  used: readonly Option[],
  refused: ReadonlySet<string> = new Set(),
): Suggestion[] {
  return node.options
    .filter((option) => option.long !== undefined && !used.includes(option))
    .filter((option) => !refused.has(option.long ?? ''))
    .filter(
      (option) =>
        startsWith(option.long ?? '', typed) ||
        (option.short !== undefined && option.short === typed),
    )
    .map((option) => ({
      label: option.flags,
      insert: option.long ?? '',
      detail: option.description,
      continues: false,
    }))
    .slice(0, SUGGESTION_LIMIT);
}

interface ValueContext {
  readonly node: CommandDescription;
  readonly valuesTyped: ReadonlyMap<Option, string>;
  readonly sources: CompletionSources;
}

async function values(
  value: CommandValue | undefined,
  word: Word,
  context: ValueContext,
): Promise<Suggestion[]> {
  if (value === undefined) return [];
  switch (value.kind) {
    case 'brief':
    case 'file':
    case 'folder':
      return paths(value.kind, word, context.sources);
    case 'template': {
      const templates = await context.sources.templates();
      return words(
        templates.map((template) => ({
          word: template.name,
          ...(template.aliasOf === undefined ? {} : { detail: `→ ${template.aliasOf}` }),
        })),
        word.text,
        false,
      );
    }
    case 'plugin':
      return words(
        (await context.sources.plugins()).map((name) => ({ word: name })),
        word.text,
        false,
      );
    case 'formats': {
      const templates = await context.sources.templates();
      const chosen = [...context.valuesTyped].find(([option]) => option.long === '--template')?.[1];
      const from = templates.filter((template) => chosen === undefined || template.name === chosen);
      const formats = [...new Set(from.flatMap((template) => template.formats))];
      return words(
        formats.map((format) => ({ word: format })),
        word.text,
        true,
      );
    }
    case 'types':
      return words(
        (value.choices ?? []).map((choice) => ({ word: choice })),
        word.text,
        true,
      );
  }
}

/**
 * Plain words: a name, or the last of a comma-separated list, where what is already listed stays
 * in front and is not offered again.
 */
function words(
  candidates: readonly { readonly word: string; readonly detail?: string }[],
  typed: string,
  list: boolean,
): Suggestion[] {
  const comma = list ? typed.lastIndexOf(',') : -1;
  const head = typed.slice(0, comma + 1);
  const prefix = typed.slice(comma + 1);
  const listed = new Set(head.split(',').filter((each) => each !== ''));
  return candidates
    .filter((candidate) => !listed.has(candidate.word) && startsWith(candidate.word, prefix))
    .map((candidate) => ({
      label: candidate.word,
      insert: head + candidate.word,
      ...(candidate.detail === undefined ? {} : { detail: candidate.detail }),
      continues: list,
    }))
    .slice(0, SUGGESTION_LIMIT);
}

/**
 * Files and folders under the open folder: the folder typed so far is listed and its entries
 * filtered by the rest. A folder is offered with its separator and keeps going; a word with a
 * space is quoted, a folder's quote left open for what follows.
 */
async function paths(
  kind: 'brief' | 'file' | 'folder',
  word: Word,
  sources: CompletionSources,
): Promise<Suggestion[]> {
  if (/^(?:[A-Za-z]:)?[\\/]/u.test(word.text)) return [];
  const cut = Math.max(word.text.lastIndexOf('/'), word.text.lastIndexOf('\\'));
  const folder = word.text.slice(0, cut + 1);
  const prefix = word.text.slice(cut + 1);
  const segments = folder.split(/[\\/]+/u).filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) return [];
  const separator = word.text.includes('\\') ? '\\' : '/';
  const entries = (await sources.list(segments)) ?? [];
  const fits = (entry: ListedEntry): boolean =>
    entry.kind === 'folder' ||
    kind === 'file' ||
    (kind === 'brief' && entry.name.toLowerCase().endsWith('.brief'));
  const matches = (name: string): boolean =>
    sources.caseless ? startsWith(name, prefix) : name.startsWith(prefix);
  return entries
    .filter((entry) => fits(entry) && matches(entry.name))
    .map((entry) => {
      const isFolder = entry.kind === 'folder';
      const path = `${folder}${entry.name}${isFolder ? separator : ''}`;
      const quote = word.open ?? (/\s/u.test(path) ? '"' : undefined);
      const insert =
        quote === undefined ? path : isFolder ? `${quote}${path}` : `${quote}${path}${quote}`;
      return {
        label: `${entry.name}${isFolder ? separator : ''}`,
        insert,
        continues: isFolder,
      };
    })
    .slice(0, SUGGESTION_LIMIT);
}

/** The line after a suggestion is taken, and where the caret goes. */
export function accept(
  line: string,
  completion: Pick<Completion, 'from' | 'to'>,
  suggestion: Suggestion,
): { readonly line: string; readonly caret: number } {
  const before = line.slice(0, completion.from) + suggestion.insert;
  const after = line.slice(completion.to);
  const space = suggestion.continues || after.startsWith(' ') ? '' : ' ';
  return { line: before + space + after, caret: before.length + space.length };
}
