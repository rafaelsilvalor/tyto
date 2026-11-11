import {
  type Diagnostic,
  type Result,
  type SourceRange,
  diagnostic,
  err,
  ok,
  sourceRange,
} from '@tyto/core';
import {
  type Node,
  type ParseError,
  findNodeAtLocation,
  getNodeValue,
  parseTree,
  printParseErrorCode,
} from 'jsonc-parser';
import type { ZodType } from 'zod';

import { STEPS, groupNames, parseReplacement } from './extract.js';
import { LOOKUP } from './map.js';
import { compilePattern } from './pattern.js';
import { RULES } from './rules.js';
import { parseTemplate, templateProblem } from './template.js';
import { parseWhere } from './where.js';

/**
 * A vocabulary file (ADR 0176): the configuration a team's recipes read through data
 * references (ADR 0136, ADR 0137), in one JSON-with-comments file named `<name>.vocab.json`.
 *
 * ```jsonc
 * {
 *   "rules": { "kinds": [{ "when": "title matches ^poster", "set": { "kind": "poster" } }] },
 *   "rewrites": { "noise": [{ "pattern": "^copy - ", "replace": "" }] },
 *   "lookups": { "status": { "todo": "TO DO" } }
 * }
 * ```
 *
 * A recipe reads `@./company.vocab.json#/rules/kinds`. Each known section maps a name to what
 * one verb reads: `rules` to a `rules` table, `rewrites` to a `rewrite` list, `lookups` to a
 * `map` table. Any other top-level key is the team's own (stopwords, hosts, a graph): only the
 * pattern guard reads it, for every string under a key named `pattern`.
 */
export const VOCABULARY_EXTENSION = '.vocab.json';

export const VOCABULARY_SECTIONS = ['rules', 'rewrites', 'lookups'] as const;

export type VocabularySection = (typeof VOCABULARY_SECTIONS)[number];

/** A named table of a section, or a top-level key of the team's own, with its key's range. */
export interface VocabularyEntry {
  readonly name: string;
  readonly range: SourceRange;
}

/** What a vocabulary file holds, for an outline and for completing a reference's pointer. */
export interface VocabularyOutline {
  readonly rules: readonly VocabularyEntry[];
  readonly rewrites: readonly VocabularyEntry[];
  readonly lookups: readonly VocabularyEntry[];
  /** Top-level keys outside the three sections. */
  readonly other: readonly VocabularyEntry[];
}

const OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;
const BOM = '﻿';

/**
 * Lints a vocabulary file where it is written, as the verbs that read it would: each section's
 * shape by the verb's own Zod schema, each rule's `when` by the filter grammar, each template
 * and replacement by its reader, and each pattern by the guard (ADR 0136). A problem inside a
 * string points at the characters of the file, escapes included: `\\b` is two characters
 * of the file and one of the pattern. Every problem is reported, not only the first.
 */
export function lintVocabulary(text: string): Result<VocabularyOutline, readonly Diagnostic[]> {
  // The BOM as a space: offsets stay those of the file, as the data resolver reads it.
  const source = text.startsWith(BOM) ? ` ${text.slice(1)}` : text;
  if (source.trim() === '') {
    return err([syntaxProblem('the file is empty', sourceRange(0, source.length))]);
  }
  const errors: ParseError[] = [];
  const root = parseTree(source, errors, OPTIONS);
  const problems: Diagnostic[] = errors.map((error) =>
    syntaxProblem(
      words(printParseErrorCode(error.error)),
      sourceRange(error.offset, error.offset + error.length),
    ),
  );
  if (root?.type !== 'object') {
    const range = root === undefined ? sourceRange(0, source.length) : rangeOf(root);
    return err([...problems, syntaxProblem('it is not an object of sections', range)]);
  }

  const lint = new Lint(source, problems);
  const outline: Record<VocabularySection | 'other', VocabularyEntry[]> = {
    rules: [],
    rewrites: [],
    lookups: [],
    other: [],
  };
  for (const property of root.children ?? []) {
    const [keyNode, valueNode] = property.children ?? [];
    if (keyNode === undefined || typeof keyNode.value !== 'string' || valueNode === undefined) {
      continue;
    }
    const name = keyNode.value;
    if (!isSection(name)) {
      outline.other.push({ name, range: rangeOf(keyNode) });
      lint.patternsUnder(valueNode);
      continue;
    }
    outline[name].push(...lint.section(name, valueNode));
  }
  return problems.length > 0 ? err(problems) : ok(outline);
}

/** A vocabulary file with one rule, which lints clean and a `rules` step reads as made. */
export function vocabularySkeleton(): string {
  return [
    '{',
    '  // A recipe reads a table here as @./<file>.vocab.json#/rules/<name>.',
    '  "rules": {',
    '    "kinds": [',
    '      { "when": "title matches ^poster\\\\b", "set": { "kind": "poster" } },',
    '      { "when": "", "set": { "kind": "other" } }',
    '    ]',
    '  },',
    '  "rewrites": {},',
    '  "lookups": {}',
    '}',
    '',
  ].join('\n');
}

function isSection(name: string): name is VocabularySection {
  return (VOCABULARY_SECTIONS as readonly string[]).includes(name);
}

const SHAPES: Readonly<Record<VocabularySection, ZodType>> = {
  rules: RULES,
  rewrites: STEPS,
  lookups: LOOKUP,
};

class Lint {
  constructor(
    private readonly source: string,
    private readonly problems: Diagnostic[],
  ) {}

  /** A section's named tables, each checked by its verb's schema and then entry by entry. */
  section(section: VocabularySection, node: Node): readonly VocabularyEntry[] {
    if (node.type !== 'object') {
      this.shape(`/${section}`, 'is not an object of named tables', rangeOf(node));
      return [];
    }
    const entries: VocabularyEntry[] = [];
    for (const property of node.children ?? []) {
      const [keyNode, valueNode] = property.children ?? [];
      if (keyNode === undefined || typeof keyNode.value !== 'string' || valueNode === undefined) {
        continue;
      }
      const name = keyNode.value;
      entries.push({ name, range: rangeOf(keyNode) });
      const pointer = `/${section}/${escapePointer(name)}`;
      const checked = SHAPES[section].safeParse(getNodeValue(valueNode));
      if (!checked.success) {
        for (const issue of checked.error.issues) {
          const path = issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key));
          this.shape(
            `${pointer}${path.map((key) => `/${escapePointer(String(key))}`).join('')}`,
            lowerFirst(issue.message),
            rangeOf(nearestNode(valueNode, path)),
          );
        }
        continue;
      }
      if (section === 'rules') this.rules(valueNode);
      if (section === 'rewrites') this.rewrites(valueNode, pointer);
    }
    return entries;
  }

  /** Each `when` by the filter grammar, its `matches` patterns by the guard; each template. */
  private rules(table: Node): void {
    for (const entry of table.children ?? []) {
      const when = findNodeAtLocation(entry, ['when']);
      if (when !== undefined && typeof when.value === 'string' && when.value !== '') {
        const parsed = parseWhere(when.value, 0);
        if (!parsed.ok) this.inside(when, parsed.error);
      }
      const set = findNodeAtLocation(entry, ['set']);
      for (const property of set?.children ?? []) {
        const value = property.children?.[1];
        if (value === undefined || typeof value.value !== 'string') continue;
        const template = parseTemplate(value.value);
        if (!template.ok) {
          this.problems.push(...templateProblem(value.value, template.error, rangeOf(value)));
        }
      }
    }
  }

  /** Each pattern by the guard, and each replacement against its pattern's groups. */
  private rewrites(list: Node, pointer: string): void {
    for (const [index, step] of (list.children ?? []).entries()) {
      const pattern = findNodeAtLocation(step, ['pattern']);
      const replace = findNodeAtLocation(step, ['replace']);
      if (pattern === undefined || typeof pattern.value !== 'string') continue;
      const compiled = compilePattern(pattern.value, 0);
      if (!compiled.ok) {
        this.inside(pattern, compiled.error);
        continue;
      }
      if (replace === undefined || typeof replace.value !== 'string') continue;
      const pieces = parseReplacement(replace.value, groupNames(compiled.value));
      if (!pieces.ok) {
        this.problems.push(
          diagnostic(
            'E_RECIPE_REWRITE',
            { problem: `has at '${pointer}/${String(index)}/replace' ${pieces.error}` },
            { range: rangeOf(replace) },
          ),
        );
      }
    }
  }

  /** The generic lint of a key the vocabulary does not know: every `pattern` string. */
  patternsUnder(node: Node): void {
    for (const child of node.children ?? []) {
      if (child.type === 'property') {
        const [keyNode, valueNode] = child.children ?? [];
        if (keyNode?.value === 'pattern' && typeof valueNode?.value === 'string') {
          const compiled = compilePattern(valueNode.value, 0);
          if (!compiled.ok) this.inside(valueNode, compiled.error);
          continue;
        }
        if (valueNode !== undefined) this.patternsUnder(valueNode);
      } else {
        this.patternsUnder(child);
      }
    }
  }

  /**
   * Problems a reader found in a string's decoded value, moved onto the file: offset 0 of the
   * value is the character after the opening quote, and every escape is wider in the file.
   */
  private inside(node: Node, found: readonly Diagnostic[]): void {
    const offsets = decodedOffsets(this.source, node);
    const at = (index: number) => offsets[Math.min(Math.max(index, 0), offsets.length - 1)] ?? 0;
    for (const problem of found) {
      this.problems.push(
        problem.range === undefined
          ? { ...problem, range: rangeOf(node) }
          : { ...problem, range: sourceRange(at(problem.range.start), at(problem.range.end)) },
      );
    }
  }

  private shape(pointer: string, problem: string, range: SourceRange): void {
    this.problems.push(diagnostic('E_VOCABULARY_SHAPE', { pointer, problem }, { range }));
  }
}

/**
 * Where each character of a JSON string's value sits in the file, plus one past the last: the
 * value's character `i` is written at `offsets[i]`. `\n` is two characters of the file and
 * `é` six, for one of the value; anything else is one for one, surrogates included.
 */
export function decodedOffsets(source: string, node: Node): readonly number[] {
  const offsets: number[] = [];
  const end = node.offset + node.length - 1;
  let at = node.offset + 1;
  while (at < end) {
    offsets.push(at);
    at += source[at] !== '\\' ? 1 : source[at + 1] === 'u' ? 6 : 2;
  }
  offsets.push(end);
  return offsets;
}

/** The deepest node a Zod issue's path reaches, so a problem points as close as it can. */
function nearestNode(node: Node, path: readonly (string | number)[]): Node {
  for (let length = path.length; length > 0; length -= 1) {
    const found = findNodeAtLocation(node, [...path.slice(0, length)]);
    if (found !== undefined) return found;
  }
  return node;
}

function rangeOf(node: Node): SourceRange {
  return sourceRange(node.offset, node.offset + node.length);
}

function syntaxProblem(problem: string, range: SourceRange): Diagnostic {
  return diagnostic('E_VOCABULARY_SYNTAX', { problem }, { range });
}

/** RFC 6901: `~` is `~0` and `/` is `~1` in a pointer's token. */
function escapePointer(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** `CommaExpected` as `comma expected`. */
function words(code: string): string {
  return code.replace(/(?<=[a-z])(?=[A-Z])/gu, ' ').toLowerCase();
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
