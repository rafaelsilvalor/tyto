import { type Diagnostic, diagnostic, sourceRange } from '@tyto/core';
import type { KeybindingEntry } from '@tyto/editor';
import { type Node, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser';

/**
 * `keybindings.json` as text a person wrote (TYTO-207, ADR 0074): a JSON-with-comments list of
 * `{ key, command, when? }`, read with the range of every entry so the resolver's warnings land
 * on the line that caused them.
 *
 * Read in the window and not in main, because what the entries are checked against — the
 * command registry — lives here. `jsonc-parser` for the reason `settings-file.ts` gives: only a
 * syntax tree has ranges.
 */

const OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;
const BOM = '﻿';

export interface KeybindingsText {
  /** The entries the parser could read, each with its range. */
  readonly entries: readonly KeybindingEntry[];
  /**
   * `E_KEYBINDINGS_SYNTAX`, one per problem: the text does not parse, is not a list, or holds
   * an entry that is not `{ key, command, when? }`. Non-empty means the window keeps the user
   * layer it had, because a file half-way through an edit says nothing reliable.
   */
  readonly syntax: readonly Diagnostic[];
}

const syntaxError = (problem: string, range: ReturnType<typeof sourceRange>): Diagnostic =>
  diagnostic('E_KEYBINDINGS_SYNTAX', { problem }, { range });

/** The entries of a keybindings text. Never throws; an empty or blank text is no entries. */
export function readKeybindingsText(text: string): KeybindingsText {
  // The BOM as a space: offsets stay those of the file, and the parser stops seeing a symbol.
  const source = text.startsWith(BOM) ? ` ${text.slice(1)}` : text;
  if (source.trim() === '') return { entries: [], syntax: [] };

  const errors: ParseError[] = [];
  const root = parseTree(source, errors, OPTIONS);
  const syntax: Diagnostic[] = errors.map((error) =>
    syntaxError(
      describe(printParseErrorCode(error.error)),
      sourceRange(error.offset, error.offset + error.length),
    ),
  );

  if (root === undefined || root.type !== 'array') {
    const range = root === undefined ? sourceRange(0, source.length) : rangeOf(root);
    return {
      entries: [],
      syntax: [...syntax, syntaxError('it is not a list of keybindings', range)],
    };
  }

  const entries: KeybindingEntry[] = [];
  for (const item of root.children ?? []) {
    const entry = entryOf(item);
    if (entry === undefined) {
      syntax.push(
        syntaxError(
          'each entry is { "key": "...", "command": "..." } with an optional "when"',
          rangeOf(item),
        ),
      );
      continue;
    }
    entries.push(entry);
  }
  return { entries, syntax };
}

/** One `{ key, command, when? }`, or nothing when a property is missing or not a string. */
function entryOf(item: Node): KeybindingEntry | undefined {
  if (item.type !== 'object') return undefined;
  const values = new Map<string, Node>();
  for (const property of item.children ?? []) {
    const [keyNode, valueNode] = property.children ?? [];
    if (keyNode === undefined || valueNode === undefined) return undefined;
    values.set(String(keyNode.value), valueNode);
  }
  const key = values.get('key');
  const command = values.get('command');
  const when = values.get('when');
  if (key?.type !== 'string' || command?.type !== 'string') return undefined;
  if (when !== undefined && when.type !== 'string') return undefined;
  return {
    key: String(key.value),
    command: String(command.value),
    ...(when === undefined ? {} : { when: String(when.value) }),
    range: rangeOf(item),
  };
}

function rangeOf(node: Node) {
  return sourceRange(node.offset, node.offset + node.length);
}

/** `InvalidSymbol` → `invalid symbol`, for a sentence. */
function describe(code: string): string {
  return code.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase();
}
