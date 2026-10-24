import {
  type Diagnostic,
  type DiagnosticCode,
  type ProjectEntry,
  type ProjectMember,
  type ProjectNode,
  diagnostic,
  sourceRange,
} from '@tyto/core';
import {
  type Node,
  type ParseError,
  getNodeValue,
  parseTree,
  printParseErrorCode,
} from 'jsonc-parser';

/**
 * A text a person wrote as JSON with comments, read with the place of every key (TYTO-350).
 *
 * The one reader behind `.tyto/project.json`, `trust.json`, a work profile (ADR 0112) and the
 * window's `settings.json` (ADR 0073). Two readers of one format drift: a fix to where a syntax
 * error points, or to what is recovered around it, would land in one file and not the other.
 * Only reading lives here; the window keeps its own writer, which edits its file in place.
 *
 * `jsonc-parser` rather than `JSON.parse`, because only a syntax tree knows where a key was
 * written, and a diagnostic that cannot point at the key is one a person has to go looking for.
 */

const OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;
const BOM = '﻿';

/**
 * The codes a JSONC file read here reports its syntax with: one per file, each with its own
 * message, and each a message with one slot, the problem.
 */
export type JsoncSyntaxCode = Extract<DiagnosticCode, 'E_PROJECT_SYNTAX' | 'E_SETTINGS_SYNTAX'>;

export interface JsoncTextOptions {
  /** The file's own syntax code, so the message names the file the person opened. */
  readonly syntaxCode: JsoncSyntaxCode;
  /** The problem a text that is not an object reports, e.g. `it is not an object of keys`. */
  readonly notAnObject: string;
}

export interface JsoncText {
  /** The top-level keys, with their ranges; an object value also with its whole tree. */
  readonly entries: readonly ProjectEntry[];
  /** One diagnostic per problem, in the file's code. The keys recovered around one still count. */
  readonly syntax: readonly Diagnostic[];
}

/** The top-level keys of a JSONC text, with their ranges. Never fails. */
export function readJsoncText(text: string, options: JsoncTextOptions): JsoncText {
  // The BOM as a space: offsets stay those of the file, and the parser stops seeing a symbol.
  const source = text.startsWith(BOM) ? ` ${text.slice(1)}` : text;
  if (source.trim() === '') return { entries: [], syntax: [] };

  const errors: ParseError[] = [];
  const root = parseTree(source, errors, OPTIONS);
  const syntax = errors.map((error) =>
    diagnostic(
      options.syntaxCode,
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
        diagnostic(options.syntaxCode, { problem: options.notAnObject }, { range }),
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
      // A list's entries each have a place, so a value checked entry by entry can point at
      // the one it refuses (TYTO-301, ADR 0091).
      ...(valueNode?.type === 'array'
        ? { entryRanges: (valueNode.children ?? []).map((item) => rangeOf(item)) }
        : {}),
      // Only an object nests far enough to need a tree: an export preset's fields (TYTO-270),
      // a setting's members (TYTO-301).
      ...(valueNode?.type === 'object' ? { node: nodeOf(valueNode) } : {}),
    });
  }
  return { entries, syntax };
}

/** A value with where every member and item of it was written, all the way down. */
function nodeOf(node: Node): ProjectNode {
  const range = rangeOf(node);
  if (node.type === 'array') {
    return { range, items: (node.children ?? []).map((item) => nodeOf(item)) };
  }
  if (node.type !== 'object') return { range };
  const members: ProjectMember[] = [];
  for (const property of node.children ?? []) {
    const [keyNode, valueNode] = property.children ?? [];
    if (keyNode === undefined || typeof keyNode.value !== 'string') continue;
    members.push({
      key: keyNode.value,
      keyRange: rangeOf(keyNode),
      value: valueNode === undefined ? undefined : nodeOf(valueNode),
    });
  }
  return { range, members };
}

function rangeOf(node: Node) {
  return sourceRange(node.offset, node.offset + node.length);
}

/** `InvalidSymbol` → `invalid symbol`, for a sentence. */
function describe(code: string): string {
  return code.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase();
}
