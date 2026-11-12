import {
  type ArgumentSpec,
  GENERIC_VERB_FORMS,
  VOCABULARY_EXTENSION,
  VOCABULARY_SECTIONS,
  type VerbForm,
  type VerbKind,
  type VocabularySection,
  formOfArguments,
  lintVocabulary,
  recipeSkeleton,
  vocabularySkeleton,
} from '@tyto/recipe';
import {
  type Node,
  findNodeAtLocation,
  findNodeAtOffset,
  getLocation,
  parseTree,
} from 'jsonc-parser';

import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';
import { VOCABULARY_WIRE_DIAGNOSTICS } from '../../shared/ipc.js';

/**
 * A recipe and its vocabulary, authored in the window (TYTO-402, ADR 0176): what New recipe and
 * New vocabulary write, and the vocabulary tab's lint, completion and hover. Main answers them
 * from `@tyto/recipe`'s pure functions, so what the tab marks is what a recipe reads.
 *
 * Pure: text in, plain data out. Nothing here reads or writes a file; `explorer.create` writes.
 */

export type Seed = NonNullable<IpcRequest<'explorer:create'>['seed']>;

/** What a seeded new file is called and holds, or why there is none. */
export type Seeded =
  | { readonly ok: true; readonly name: string; readonly text: string }
  | { readonly ok: false; readonly reason: 'recipe-name' };

const RECIPE_EXTENSION = '.recipe';

/**
 * The file New recipe or New vocabulary makes of the name typed: the extension added when it
 * is missing, and the skeleton that runs or lints clean as made. A recipe's stem is checked by
 * `recipeSkeleton`, since a `run` line names a recipe by it.
 */
export function seedOf(name: string, seed: Seed): Seeded {
  const lower = name.toLowerCase();
  if (seed === 'vocabulary') {
    const full = lower.endsWith(VOCABULARY_EXTENSION) ? name : `${name}${VOCABULARY_EXTENSION}`;
    return { ok: true, name: full, text: vocabularySkeleton() };
  }
  const full = lower.endsWith(RECIPE_EXTENSION) ? name : `${name}${RECIPE_EXTENSION}`;
  const skeleton = recipeSkeleton(full.slice(0, -RECIPE_EXTENSION.length));
  return skeleton.ok
    ? { ok: true, name: full, text: skeleton.value }
    : { ok: false, reason: 'recipe-name' };
}

/** Every problem of a vocabulary's text, at the characters of the file (ADR 0176 decision 5). */
export function vocabularyLint(text: string): IpcResponse<'vocabulary:lint'> {
  const linted = lintVocabulary(text);
  if (linted.ok) return { diagnostics: [] };
  return {
    diagnostics: linted.error.slice(0, VOCABULARY_WIRE_DIAGNOSTICS).map((item) => ({
      severity: item.severity,
      code: item.code,
      message: item.message,
      ...(item.range === undefined
        ? {}
        : { range: { start: item.range.start, end: item.range.end } }),
      ...(item.hint === undefined ? {} : { hint: item.hint }),
    })),
  };
}

const isSection = (key: unknown): key is VocabularySection =>
  (VOCABULARY_SECTIONS as readonly unknown[]).includes(key);

/** The fields one entry of a section's table takes, by the verb's own schema; lookups have none. */
const ENTRY_FIELDS: Readonly<
  Record<VocabularySection, readonly { name: string; value: string }[]>
> = {
  rules: [
    { name: 'when', value: '""' },
    { name: 'set', value: '{}' },
  ],
  rewrites: [
    { name: 'pattern', value: '""' },
    { name: 'replace', value: '""' },
  ],
  lookups: [],
};

/** The keys an object already holds, apart from the one being typed. */
function keysAt(tree: Node | undefined, path: readonly (string | number)[]): Set<string> {
  const node = tree === undefined ? undefined : findNodeAtLocation(tree, [...path]);
  const keys = new Set<string>();
  for (const property of node?.type === 'object' ? (node.children ?? []) : []) {
    const key = property.children?.[0];
    if (key !== undefined && typeof key.value === 'string') keys.add(key.value);
  }
  return keys;
}

/**
 * What can go at `position` (TYTO-402): a section not yet written, at the top level; a field a
 * rule (`when`, `set`) or a rewrite step (`pattern`, `replace`) does not hold yet, inside one of
 * a table's entries. Each pick writes the key with an empty value and leaves the caret in it.
 */
export function vocabularyComplete(
  text: string,
  position: number,
  explicit: boolean,
): IpcResponse<'vocabulary:complete'> {
  const location = getLocation(text, position);
  if (!location.isAtPropertyKey) return { answer: null };
  const previous = location.previousNode;
  const quoted =
    previous !== undefined &&
    (previous.type === 'string' || previous.type === 'property') &&
    position > previous.offset &&
    position <= previous.offset + previous.length;
  const from = quoted
    ? previous.offset + 1
    : position - (/[\w.-]*$/u.exec(text.slice(0, position))?.[0].length ?? 0);
  // Opened by typing, a list appears inside a string or after a letter, never on a comma.
  if (!quoted && from === position && !explicit) return { answer: null };

  const path = location.path;
  const typed = typeof path.at(-1) === 'string' ? (path.at(-1) as string) : '';
  const tree = parseTree(text);
  const fields =
    path.length === 1
      ? VOCABULARY_SECTIONS.map((name) => ({ name, value: '{}' }))
      : path.length === 4 && isSection(path[0]) && typeof path[2] === 'number'
        ? ENTRY_FIELDS[path[0]]
        : [];
  const written = keysAt(tree, path.slice(0, -1));
  const options = fields
    .filter((field) => field.name === typed || !written.has(field.name))
    .map((field) => {
      const head = `${JSON.stringify(field.name)}: `;
      // The caret inside the empty value: between a string's quotes, inside an object's braces.
      const caret = head.length + 1;
      return {
        label: field.name,
        insert: `${head}${field.value}`,
        select: [caret, caret] as [number, number],
        kind: 'property' as const,
      };
    });
  return { answer: options.length === 0 ? null : { from, quoted, options } };
}

/**
 * What the key under the pointer is (TYTO-402): a section's own key, or a named table of a
 * section with how many entries it holds. Read from the tree, so a file with a problem elsewhere
 * still explains its keys.
 */
export function vocabularyHover(text: string, position: number): IpcResponse<'vocabulary:hover'> {
  const tree = parseTree(text);
  const node = tree === undefined ? undefined : findNodeAtOffset(tree, position);
  const property = node?.parent;
  if (
    node === undefined ||
    property?.type !== 'property' ||
    property.children?.[0] !== node ||
    typeof node.value !== 'string'
  ) {
    return { answer: null };
  }
  const range = { from: node.offset, to: node.offset + node.length };
  const owner = property.parent;
  if (owner === tree) {
    return { answer: isSection(node.value) ? { ...range, section: node.value } : null };
  }
  const sectionProperty = owner?.parent;
  const sectionKey = sectionProperty?.children?.[0]?.value as unknown;
  if (
    sectionProperty?.type !== 'property' ||
    sectionProperty.parent !== tree ||
    !isSection(sectionKey)
  ) {
    return { answer: null };
  }
  const value = property.children?.[1];
  const entries =
    value?.type === 'array' || value?.type === 'object' ? (value.children ?? []).length : undefined;
  return {
    answer: {
      ...range,
      section: sectionKey,
      name: node.value,
      ...(entries === undefined ? {} : { entries }),
    },
  };
}

/** What main knows of a plugin's verb: its kind and the argument schema it declared (ADR 0135). */
export interface ContributedVerb {
  readonly kind: VerbKind;
  readonly arguments: readonly ArgumentSpec[];
}

type CatalogEntry = IpcResponse<'recipe:verbs'>['catalog'][number];

/**
 * The step picker's verbs (TYTO-402, ADR 0176 decision 2): each name `recipe:verbs` lists, with
 * its kind and its form's fields. A generic verb's form is `GENERIC_VERB_FORMS`'; a plugin's is
 * `formOfArguments` over the schema it declared. A name with neither (`param`, a header word)
 * is no step a form writes, and is left out.
 */
export function verbCatalog(
  names: readonly string[],
  contributed: (name: string) => ContributedVerb | undefined,
): CatalogEntry[] {
  const catalog: CatalogEntry[] = [];
  for (const name of names) {
    const generic = GENERIC_VERB_FORMS[name];
    const plugin = generic === undefined ? contributed(name) : undefined;
    const form: VerbForm | undefined =
      generic ??
      (plugin === undefined ? undefined : formOfArguments(name, plugin.kind, plugin.arguments));
    if (form === undefined) continue;
    catalog.push({
      name: form.verb,
      kind: form.kind,
      summary: form.summary,
      fields: form.fields.map((field) => ({
        name: field.name,
        kind: field.kind,
        placement: field.placement,
        required: field.required,
        help: field.help,
        ...(field.default === undefined ? {} : { default: field.default }),
        ...(field.values === undefined ? {} : { values: [...field.values] }),
        ...(field.inline === undefined ? {} : { inline: field.inline }),
      })),
    });
  }
  return catalog;
}

/** A JSON pointer's segment, `~` and `/` escaped as RFC 6901 says. */
const pointerSegment = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * The pointers a recipe may read from a vocabulary's text (TYTO-402): `/rules/<name>`,
 * `/rewrites/<name>` and `/lookups/<name>` for each named table of a known section, and
 * `/<key>` for each of the team's own top-level keys. Read from the tree, as the hover reads
 * it, so a file with a problem elsewhere still names what it holds.
 */
export function vocabularyPointers(text: string): string[] {
  const tree = parseTree(text);
  if (tree?.type !== 'object') return [];
  const pointers: string[] = [];
  for (const property of tree.children ?? []) {
    const key = property.children?.[0]?.value as unknown;
    if (typeof key !== 'string') continue;
    if (!isSection(key)) {
      pointers.push(`/${pointerSegment(key)}`);
      continue;
    }
    const value = property.children?.[1];
    for (const table of value?.type === 'object' ? (value.children ?? []) : []) {
      const name = table.children?.[0]?.value as unknown;
      if (typeof name === 'string') pointers.push(`/${key}/${pointerSegment(name)}`);
    }
  }
  return pointers;
}
