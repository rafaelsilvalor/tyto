import { type Diagnostic, diagnostic, sourceRange } from '@tyto/core';
import { type BriefSnippet, snippetTemplate } from '@tyto/editor';
import { type Node, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser';

/**
 * `snippets.json` as text a person wrote (TYTO-277, ADR 0082): a JSON-with-comments map in VS
 * Code's shape — `"Name": { "prefix", "body", "description"?, "template"? }` — so a snippet
 * copied out of VS Code works when pasted here.
 *
 * Read in the window, beside `keybindings-file.ts`, because a snippet's template filter is
 * checked against the window's template list. A diagnostic about a body lands on the whole
 * `body` value: an offset inside an escaped JSON string would point a character or two off for
 * every `\n` and `\"` before it.
 */

const OPTIONS = { allowTrailingComma: true, disallowComments: false } as const;
const BOM = '﻿';

export interface SnippetsText {
  /** The snippets that can be inserted, bodies already translated. */
  readonly snippets: readonly BriefSnippet[];
  /**
   * `E_SNIPPETS_SYNTAX`: the text does not parse, or is not a map. Non-empty means the window
   * keeps the snippets it had, because a file half-way through an edit says nothing reliable.
   */
  readonly syntax: readonly Diagnostic[];
  /** One warning per entry left out, or per choice field flattened, at its range. */
  readonly problems: readonly Diagnostic[];
}

const rangeOf = (node: Node) => sourceRange(node.offset, node.offset + node.length);

/** `InvalidSymbol` → `invalid symbol`, for a sentence. */
const sentence = (code: string): string => code.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase();

/**
 * The snippets of a text. Never throws; an empty or blank text is no snippets.
 *
 * With `templates`, a snippet limited to a template not in that list is
 * `W_SNIPPET_UNKNOWN_TEMPLATE` — kept, since the template may be a folder away, but never
 * offered until a brief names it.
 */
export function readSnippetsText(text: string, templates?: readonly string[]): SnippetsText {
  // The BOM as a space: offsets stay those of the file, and the parser stops seeing a symbol.
  const source = text.startsWith(BOM) ? ` ${text.slice(1)}` : text;
  if (source.trim() === '') return { snippets: [], syntax: [], problems: [] };

  const errors: ParseError[] = [];
  const root = parseTree(source, errors, OPTIONS);
  const syntax: Diagnostic[] = errors.map((error) =>
    diagnostic(
      'E_SNIPPETS_SYNTAX',
      { problem: sentence(printParseErrorCode(error.error)) },
      { range: sourceRange(error.offset, error.offset + error.length) },
    ),
  );
  if (root === undefined || root.type !== 'object') {
    const range = root === undefined ? sourceRange(0, source.length) : rangeOf(root);
    syntax.push(
      diagnostic(
        'E_SNIPPETS_SYNTAX',
        { problem: 'it is not a map of snippets by name' },
        { range },
      ),
    );
    return { snippets: [], syntax, problems: [] };
  }

  const snippets: BriefSnippet[] = [];
  const problems: Diagnostic[] = [];
  for (const property of root.children ?? []) {
    const read = entryOf(property, templates);
    problems.push(...read.problems);
    if (read.snippet !== undefined) snippets.push(read.snippet);
  }
  return { snippets, syntax, problems };
}

interface EntryRead {
  readonly snippet?: BriefSnippet;
  readonly problems: readonly Diagnostic[];
}

function entryOf(property: Node, templates: readonly string[] | undefined): EntryRead {
  const [keyNode, valueNode] = property.children ?? [];
  const name = String(keyNode?.value ?? '');
  const invalid = (problem: string): EntryRead => ({
    problems: [diagnostic('W_SNIPPET_INVALID', { name, problem }, { range: rangeOf(property) })],
  });
  if (valueNode?.type !== 'object') return invalid('it is not { "prefix", "body" }');

  const values = new Map<string, Node>();
  for (const field of valueNode.children ?? []) {
    const [fieldKey, fieldValue] = field.children ?? [];
    if (fieldKey !== undefined && fieldValue !== undefined) {
      values.set(String(fieldKey.value), fieldValue);
    }
  }

  const prefixes = stringsOf(values.get('prefix'));
  if (
    prefixes === undefined ||
    prefixes.length === 0 ||
    prefixes.some((prefix) => !/^[\p{L}\p{N}_-]+$/u.test(prefix))
  ) {
    return invalid('"prefix" is a word, or a list of words, of letters, digits, "_" and "-"');
  }
  const bodyNode = values.get('body');
  const lines = stringsOf(bodyNode);
  if (bodyNode === undefined || lines === undefined) {
    return invalid('"body" is a string, or a list of strings, one per line');
  }
  const description = values.get('description');
  if (description !== undefined && description.type !== 'string') {
    return invalid('"description" is a string');
  }
  const template = values.get('template');
  if (template !== undefined && template.type !== 'string') {
    return invalid('"template" is the name of a template');
  }

  const translated = snippetTemplate(lines.join('\n'));
  const problems: Diagnostic[] = [];
  for (const problem of translated.problems) {
    problems.push(
      problem.kind === 'unsupported'
        ? diagnostic(
            'W_SNIPPET_UNSUPPORTED_BODY',
            { name, problem: problem.what },
            { range: rangeOf(bodyNode) },
          )
        : diagnostic(
            'W_SNIPPET_CHOICE_FLATTENED',
            { name, field: String(problem.field), first: problem.first },
            { range: rangeOf(bodyNode) },
          ),
    );
  }
  if (translated.template === undefined) return { problems };

  const forTemplate = template === undefined ? undefined : String(template.value);
  if (forTemplate !== undefined && templates !== undefined && !templates.includes(forTemplate)) {
    problems.push(
      diagnostic(
        'W_SNIPPET_UNKNOWN_TEMPLATE',
        { name, template: forTemplate },
        { range: rangeOf(template ?? property) },
      ),
    );
  }
  return {
    snippet: {
      name,
      prefixes,
      template: translated.template,
      ...(description === undefined ? {} : { description: String(description.value) }),
      ...(forTemplate === undefined ? {} : { forTemplate }),
    },
    problems,
  };
}

/** A string, or a list of strings, as a list; `undefined` for anything else. */
function stringsOf(node: Node | undefined): string[] | undefined {
  if (node?.type === 'string') return [String(node.value)];
  if (node?.type !== 'array') return undefined;
  const items = node.children ?? [];
  if (items.some((item) => item.type !== 'string')) return undefined;
  return items.map((item) => String(item.value));
}
