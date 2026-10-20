import {
  type JsonAssistSource,
  type JsonCompletionAnswer,
  type JsonHoverAnswer,
  type JsonSuggestion,
  KEYBINDING_CONTEXTS,
  KEYBINDING_CONTEXT_DESCRIPTIONS,
} from '@tyto/editor';
import { type Node, findNodeAtOffset, getLocation, parseTree } from 'jsonc-parser';

import { nextNonBlank, stringAt, wordBefore, writtenKeys } from './json-location.js';

/**
 * What the `keybindings.json` tab suggests and explains (TYTO-304, ADR 0092): the second source
 * behind `@tyto/editor`'s `jsonAssist`, beside `settings-assist.ts` and the same shape.
 *
 * Pure: a text and a position in, plain data out. The commands come from a getter the window
 * fills from its own registry — the one the resolver checks every entry against — and the
 * contexts from `KEYBINDING_CONTEXT_DESCRIPTIONS`, next to the closed list itself. Three places
 * get suggestions inside an entry `{ key, command, when }`: a field not yet written, a
 * `command`'s value, a `when`'s value. The `key`'s value is left to the person, since every
 * keystroke is one.
 */

/** A command the file may name: its id, the title the command bar shows, its default key. */
export interface KeybindingCommand {
  readonly id: string;
  /** The command bar's title; the id itself when the command has none. */
  readonly title: string;
  /** The key it is on before the person's file, as the command bar writes it: `Ctrl+Shift+E`. */
  readonly key?: string;
}

/** The three fields of an entry, in the order a person writes them. */
export const KEYBINDING_FIELDS = ['key', 'command', 'when'] as const;

export type KeybindingField = (typeof KEYBINDING_FIELDS)[number];

/**
 * What the tab says, in the window's language (TYTO-334): the hover's label, what each field
 * is, and the sentence beside a removal. The commands' titles come translated from the registry;
 * the six contexts' sentences are `@tyto/editor`'s and still English.
 */
export interface KeybindingsAssistLabels {
  readonly defaultKey: string;
  readonly fields: Readonly<Record<KeybindingField, string>>;
  /** `{title}` is the command's title. */
  readonly removes: string;
  /** The same with `{key}`, the default key being removed. */
  readonly removesWithKey: string;
}

/** Beside a removal in the list and on its hover. */
const removes = (command: KeybindingCommand, labels: KeybindingsAssistLabels): string =>
  (command.key === undefined ? labels.removes : labels.removesWithKey)
    // Functions, so a `$` in a plugin's command title is not read as a replacement pattern.
    .replace('{title}', () => command.title)
    .replace('{key}', () => command.key ?? '');

/** A field's suggestion: `"command": ""` with the caret between the empty value's quotes. */
function fieldSuggestion(
  name: string,
  description: string,
  text: string,
  position: number,
): JsonSuggestion {
  const after = nextNonBlank(text, position);
  if (after === ':') {
    return { label: name, info: description, insert: JSON.stringify(name), kind: 'property' };
  }
  const head = `${JSON.stringify(name)}: "`;
  // A field already written after this one needs a comma between them; the brace does not.
  const comma = after === '"' ? ',' : '';
  return {
    label: name,
    info: description,
    insert: `${head}"${comma}`,
    select: [head.length, head.length],
    kind: 'property',
  };
}

/** The entry object the node sits in, when it is one of the file's top-level list. */
function isEntryProperty(property: Node | undefined): boolean {
  const entry = property?.parent;
  return entry?.type === 'object' && entry.parent?.type === 'array' && !entry.parent.parent;
}

export function keybindingsAssist(
  commands: () => readonly KeybindingCommand[],
  labels: () => KeybindingsAssistLabels,
): JsonAssistSource {
  const commandOf = (id: string): KeybindingCommand | undefined =>
    commands().find((command) => command.id === id);

  return {
    complete(text, position, explicit): JsonCompletionAnswer | null {
      const location = getLocation(text, position);
      const inString = stringAt(location.previousNode, position);
      const from = inString?.from ?? wordBefore(text, position);
      // Opened by typing, a list appears inside a string or after a letter, never on a comma.
      if (inString === undefined && from === position && !explicit) return null;
      const answer = (options: readonly JsonSuggestion[]): JsonCompletionAnswer => ({
        from,
        quoted: inString !== undefined,
        options,
      });
      const [index, field] = location.path;
      if (typeof index !== 'number') return null;

      if (location.path.length === 2 && location.isAtPropertyKey) {
        const written = writtenKeys(parseTree(text), [index]);
        return answer(
          KEYBINDING_FIELDS.filter((each) => each === field || !written.has(each)).map((each) =>
            fieldSuggestion(each, labels().fields[each], text, position),
          ),
        );
      }
      if (location.path.length !== 2) return null;

      if (field === 'command') {
        const all = commands();
        // Every id first, then the removal of each one that has a default key to remove.
        return answer([
          ...all.map((command) => ({
            label: command.id,
            detail: command.title,
            ...(command.key === undefined ? {} : { info: `${command.title} — ${command.key}` }),
            insert: JSON.stringify(command.id),
            kind: 'value' as const,
          })),
          ...all
            .filter((command) => command.key !== undefined)
            .map((command) => ({
              label: `-${command.id}`,
              detail: command.title,
              info: removes(command, labels()),
              insert: JSON.stringify(`-${command.id}`),
              kind: 'value' as const,
            })),
        ]);
      }

      if (field === 'when') {
        return answer(
          KEYBINDING_CONTEXTS.map((context) => ({
            label: context,
            info: KEYBINDING_CONTEXT_DESCRIPTIONS[context],
            insert: JSON.stringify(context),
            kind: 'value' as const,
          })),
        );
      }
      return null;
    },

    hover(text, position): JsonHoverAnswer | null {
      const tree = parseTree(text);
      if (tree === undefined) return null;
      const node = findNodeAtOffset(tree, position);
      const property = node?.parent;
      if (node?.type !== 'string' || property?.type !== 'property') return null;
      if (!isEntryProperty(property)) return null;
      const span = { from: node.offset, to: node.offset + node.length };
      const [keyNode, valueNode] = property.children ?? [];

      // A field's name: what that field is.
      if (keyNode === node) {
        const field = KEYBINDING_FIELDS.find((each) => each === node.value);
        return field === undefined
          ? null
          : { ...span, title: field, text: labels().fields[field], facts: [] };
      }
      if (valueNode !== node || typeof node.value !== 'string') return null;

      if (keyNode?.value === 'command') {
        const removal = node.value.startsWith('-');
        const command = commandOf(removal ? node.value.slice(1) : node.value);
        if (command === undefined) return null;
        return {
          ...span,
          title: command.title,
          text: removal ? removes(command, labels()) : command.id,
          facts:
            command.key === undefined ? [] : [{ label: labels().defaultKey, value: command.key }],
        };
      }

      if (keyNode?.value === 'when') {
        const context = KEYBINDING_CONTEXTS.find((each) => each === node.value);
        return context === undefined
          ? null
          : { ...span, title: context, text: KEYBINDING_CONTEXT_DESCRIPTIONS[context], facts: [] };
      }
      return null;
    },
  };
}
