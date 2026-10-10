import { type Diagnostic, diagnostic, sourceRange } from '@tyto/core';
import type { SettingEntry } from '@tyto/plugin-api';
import {
  type Node,
  type ParseError,
  applyEdits,
  getNodeValue,
  modify,
  parseTree,
  printParseErrorCode,
} from 'jsonc-parser';

/**
 * `settings.json` as text a person wrote: JSON with comments, read with the place of every
 * key, and edited in place (TYTO-206, ADR 0073).
 *
 * `jsonc-parser` and not `JSON.parse`, for two things only a syntax tree gives: the range of
 * a key or a value, so a diagnostic can point at it, and an edit that touches one property
 * and leaves every comment, blank line and indentation the person chose where it was.
 */

const OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;
const BOM = '﻿';

/** What a settings text says: its top-level keys, and why it cannot be written, if it cannot. */
export interface SettingsText {
  readonly entries: readonly SettingEntry[];
  /** `E_SETTINGS_SYNTAX`, one per problem. Non-empty means the app must not write the file. */
  readonly syntax: readonly Diagnostic[];
}

/**
 * The top-level keys of a settings text, with their ranges. Never fails: the keys the parser
 * recovered around a syntax error are still answered, beside the error.
 */
export function readSettingsText(text: string): SettingsText {
  const source = withoutBom(text);
  if (source.trim() === '') return { entries: [], syntax: [] };

  const errors: ParseError[] = [];
  const root = parseTree(source, errors, OPTIONS);
  const syntax = errors.map((error) =>
    diagnostic(
      'E_SETTINGS_SYNTAX',
      { problem: describe(printParseErrorCode(error.error)) },
      { range: sourceRange(error.offset, error.offset + error.length) },
    ),
  );

  if (root === undefined || root.type !== 'object') {
    const range = root === undefined ? sourceRange(0, source.length) : rangeOf(root);
    return {
      entries: [],
      syntax: [
        ...syntax,
        diagnostic('E_SETTINGS_SYNTAX', { problem: 'it is not an object of settings' }, { range }),
      ],
    };
  }

  const entries: SettingEntry[] = [];
  for (const property of root.children ?? []) {
    const [keyNode, valueNode] = property.children ?? [];
    if (keyNode === undefined || typeof keyNode.value !== 'string') continue;
    entries.push({
      key: keyNode.value,
      value: valueNode === undefined ? undefined : (getNodeValue(valueNode) as unknown),
      keyRange: rangeOf(keyNode),
      ...(valueNode === undefined ? {} : { valueRange: rangeOf(valueNode) }),
    });
  }
  return { entries, syntax };
}

/**
 * The same text with each named key set, or removed where the value is `undefined`.
 *
 * Only those properties change. A key the person wrote and the app did not touch keeps its
 * value, its comment and its place; a new key goes at the end of the object, indented like
 * the file it joins. The caller must not call this on a text {@link readSettingsText} found
 * a syntax error in — an edit computed against a tree the parser had to guess at could land
 * anywhere.
 */
export function editSettingsText(text: string, changes: Readonly<Record<string, unknown>>): string {
  const hadBom = text.startsWith(BOM);
  let source = withoutBom(text);
  if (source.trim() === '') source = '{}';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';

  for (const [key, value] of Object.entries(changes)) {
    const edits = modify(source, [key], value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol },
    });
    source = applyEdits(source, edits);
  }
  return hadBom && source.startsWith(' ') ? `${BOM}${source.slice(1)}` : source;
}

/** The BOM as a space: offsets stay those of the file, and the parser stops seeing a symbol. */
function withoutBom(text: string): string {
  return text.startsWith(BOM) ? ` ${text.slice(1)}` : text;
}

function rangeOf(node: Node) {
  return sourceRange(node.offset, node.offset + node.length);
}

/** `InvalidSymbol` → `invalid symbol`, for a sentence. */
function describe(code: string): string {
  return code.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase();
}
