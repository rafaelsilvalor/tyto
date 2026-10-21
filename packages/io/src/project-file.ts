import { type Diagnostic, type ProjectEntry, diagnostic, sourceRange } from '@tyto/core';
import {
  type Node,
  type ParseError,
  getNodeValue,
  parseTree,
  printParseErrorCode,
} from 'jsonc-parser';

/**
 * `.tyto/project.json` as text a person wrote: JSON with comments, read with the place of
 * every top-level key (TYTO-278, ADR 0112).
 *
 * The same reading the window gives `settings.json` (ADR 0073), and for the same reason —
 * `jsonc-parser` rather than `JSON.parse`, because only a syntax tree knows where a key was
 * written, and a diagnostic that cannot point at the key is a diagnostic a person has to go
 * looking for. The window keeps its own reader for now, because it also edits its file in
 * place; the two are one ticket away from being one.
 */

const OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;
const BOM = '﻿';

export interface ProjectText {
  readonly entries: readonly ProjectEntry[];
  /** `E_PROJECT_SYNTAX`, one per problem. The keys recovered around one still count. */
  readonly syntax: readonly Diagnostic[];
}

/** The top-level keys of a project text, with their ranges. Never fails. */
export function readProjectText(text: string): ProjectText {
  // The BOM as a space: offsets stay those of the file, and the parser stops seeing a symbol.
  const source = text.startsWith(BOM) ? ` ${text.slice(1)}` : text;
  if (source.trim() === '') return { entries: [], syntax: [] };

  const errors: ParseError[] = [];
  const root = parseTree(source, errors, OPTIONS);
  const syntax = errors.map((error) =>
    diagnostic(
      'E_PROJECT_SYNTAX',
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
        diagnostic('E_PROJECT_SYNTAX', { problem: 'it is not an object of keys' }, { range }),
      ],
    };
  }

  const entries: ProjectEntry[] = [];
  for (const property of root.children ?? []) {
    const [keyNode, valueNode] = property.children ?? [];
    if (keyNode === undefined || typeof keyNode.value !== 'string') continue;
    entries.push({
      key: keyNode.value,
      value: valueNode === undefined ? undefined : (getNodeValue(valueNode) as unknown),
      keyRange: rangeOf(keyNode),
      ...(valueNode === undefined ? {} : { valueRange: rangeOf(valueNode) }),
      ...(valueNode?.type === 'array'
        ? { entryRanges: (valueNode.children ?? []).map((item) => rangeOf(item)) }
        : {}),
    });
  }
  return { entries, syntax };
}

function rangeOf(node: Node) {
  return sourceRange(node.offset, node.offset + node.length);
}

/** `InvalidSymbol` → `invalid symbol`, for a sentence. */
function describe(code: string): string {
  return code.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase();
}
