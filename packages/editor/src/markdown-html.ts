import { type SyntaxNode } from '@lezer/common';

import { markdownParser } from './markdown-language.js';

/**
 * A Markdown text as the HTML its preview shows (TYTO-247, ADR 0132), **sanitised by
 * construction**: nothing of the source ever reaches the output as markup.
 *
 * It walks the tree of the parser that colours the text ({@link markdownParser}) and writes
 * each node it knows as one of a fixed list of tags; every character of the source is written
 * through {@link escapeHtml}. So there is no sanitiser to get wrong, only a list:
 *
 * - The tags written are the ones in {@link MARKDOWN_TAGS}, and the only attributes are `title`
 *   on a link (its destination, escaped) and the constant `type`, `disabled` and `checked` of a
 *   task's checkbox. No `href`, no `src`, no `style`, no `on…`.
 * - Raw HTML — `HTMLBlock`, `HTMLTag`, `CommentBlock`, `Comment`, `ProcessingInstruction` — comes
 *   out as the text it is, escaped: `<script>` is shown, not run.
 * - A link is an `<a>` with no `href`, its destination in `title`: nothing to follow.
 * - An image is its alt text and nothing else (Rafael, 2026-10-24); showing images is another
 *   card.
 *
 * The frame it is shown in is `sandbox=""` under the window's CSP (ADR 0124), two layers more.
 */
export function markdownToHtml(text: string): string {
  const out: string[] = [];
  blockChildren(markdownParser.parse(text).topNode, text, out);
  return out.join('');
}

/** Every tag {@link markdownToHtml} may write, for the test that holds it to the list. */
export const MARKDOWN_TAGS: ReadonlySet<string> = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
  'pre',
  'code',
  'hr',
  'br',
  'em',
  'strong',
  'del',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'input',
]);

/** The five characters that can start or end markup, as entities. */
export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const HEADINGS: Readonly<Record<string, string>> = {
  ATXHeading1: 'h1',
  ATXHeading2: 'h2',
  ATXHeading3: 'h3',
  ATXHeading4: 'h4',
  ATXHeading5: 'h5',
  ATXHeading6: 'h6',
  SetextHeading1: 'h1',
  SetextHeading2: 'h2',
};

/** Inline nodes that are one tag around their content, marks left out. */
const WRAPPERS: Readonly<Record<string, string>> = {
  Emphasis: 'em',
  StrongEmphasis: 'strong',
  Strikethrough: 'del',
};

/** The syntax around content — `#`, `>`, `-`, `*`, `[`, `` ` `` — which the preview does not show. */
const MARKS = new Set([
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'LinkMark',
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'StrikethroughMark',
  'TableDelimiter',
  'LinkReference',
]);

/** Raw markup in the source, which is shown as the text it is. */
const RAW_BLOCKS = new Set(['HTMLBlock', 'CommentBlock', 'ProcessingInstructionBlock']);

/** An entity the source wrote, `&amp;` or `&#169;`: text already, so it may pass as it is. */
const ENTITY = /^&(?:#\d{1,7}|#[xX][\dA-Fa-f]{1,6}|[A-Za-z][A-Za-z\d]{1,31});$/u;

const children = (node: SyntaxNode): SyntaxNode[] => {
  const found: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) found.push(child);
  return found;
};

const slice = (text: string, node: SyntaxNode): string => text.slice(node.from, node.to);

/** A container's blocks, one after another; the space and marks between them say nothing. */
function blockChildren(node: SyntaxNode, text: string, out: string[]): void {
  for (const child of children(node)) block(child, text, out);
}

function wrapBlock(tag: string, node: SyntaxNode, text: string, out: string[]): void {
  out.push(`<${tag}>`);
  blockChildren(node, text, out);
  out.push(`</${tag}>`);
}

function wrapInline(tag: string, node: SyntaxNode, text: string, out: string[]): void {
  out.push(`<${tag}>`);
  inline(node, node.from, node.to, text, out);
  out.push(`</${tag}>`);
}

function block(node: SyntaxNode, text: string, out: string[]): void {
  const heading = HEADINGS[node.name];
  if (heading !== undefined) {
    out.push(`<${heading}>`);
    inline(node, node.from, node.to, text, out, true);
    out.push(`</${heading}>`);
    return;
  }
  if (RAW_BLOCKS.has(node.name)) {
    out.push(`<p>${escapeHtml(slice(text, node))}</p>`);
    return;
  }
  if (MARKS.has(node.name)) return;
  switch (node.name) {
    case 'Paragraph':
      wrapInline('p', node, text, out);
      return;
    case 'Blockquote':
      wrapBlock('blockquote', node, text, out);
      return;
    case 'BulletList':
      wrapBlock('ul', node, text, out);
      return;
    case 'OrderedList':
      wrapBlock('ol', node, text, out);
      return;
    case 'ListItem':
      wrapBlock('li', node, text, out);
      return;
    case 'Task':
      task(node, text, out);
      return;
    case 'HorizontalRule':
      out.push('<hr>');
      return;
    case 'CodeBlock':
    case 'FencedCode':
      codeBlock(node, text, out);
      return;
    case 'Table':
      table(node, text, out);
      return;
    default:
      // A block this list does not name is drawn as what it holds, never as itself.
      if (node.firstChild === null) out.push(`<p>${escapeHtml(slice(text, node))}</p>`);
      else blockChildren(node, text, out);
  }
}

/** `- [x] done`: a checkbox that cannot be ticked, then the line. */
function task(node: SyntaxNode, text: string, out: string[]): void {
  const marker = node.getChild('TaskMarker');
  const ticked = marker !== null && /x/iu.test(slice(text, marker));
  out.push(
    ticked ? '<input type="checkbox" disabled checked>' : '<input type="checkbox" disabled>',
  );
  inline(node, marker?.to ?? node.from, node.to, text, out, true);
}

/** A code block's lines, as written: an indented block loses the four spaces that made it one. */
function codeBlock(node: SyntaxNode, text: string, out: string[]): void {
  const lines = node
    .getChildren('CodeText')
    .map((code) => slice(text, code))
    .join('\n');
  const body = node.name === 'CodeBlock' ? lines.replace(/\n {1,4}/gu, '\n') : lines;
  out.push(`<pre><code>${escapeHtml(body)}</code></pre>`);
}

/** The header row in `<thead>`, the other rows in `<tbody>`; only cells are drawn. */
function table(node: SyntaxNode, text: string, out: string[]): void {
  const row = (part: SyntaxNode, cell: 'th' | 'td'): void => {
    out.push('<tr>');
    for (const found of part.getChildren('TableCell')) wrapInline(cell, found, text, out);
    out.push('</tr>');
  };
  out.push('<table>');
  const header = node.getChild('TableHeader');
  if (header !== null) {
    out.push('<thead>');
    row(header, 'th');
    out.push('</thead>');
  }
  const rows = node.getChildren('TableRow');
  if (rows.length > 0) {
    out.push('<tbody>');
    for (const found of rows) row(found, 'td');
    out.push('</tbody>');
  }
  out.push('</table>');
}

/**
 * The inline content of `node` between `from` and `to`: the text between its children escaped,
 * and each child written by {@link inlineNode}. `trim` drops the space a heading's or a task's
 * mark leaves at either end.
 */
function inline(
  node: SyntaxNode,
  from: number,
  to: number,
  text: string,
  out: string[],
  trim = false,
): void {
  const parts: string[] = [];
  let at = from;
  for (const child of children(node)) {
    if (child.to <= from || child.from >= to) continue;
    if (child.from > at) parts.push(escapeHtml(text.slice(at, child.from)));
    inlineNode(child, text, parts);
    at = Math.max(at, child.to);
  }
  if (at < to) parts.push(escapeHtml(text.slice(at, to)));
  const written = parts.join('');
  out.push(trim ? written.trim() : written);
}

function inlineNode(node: SyntaxNode, text: string, out: string[]): void {
  const wrapper = WRAPPERS[node.name];
  if (wrapper !== undefined) {
    wrapInline(wrapper, node, text, out);
    return;
  }
  if (MARKS.has(node.name)) return;
  switch (node.name) {
    case 'InlineCode':
      wrapInline('code', node, text, out);
      return;
    case 'HardBreak':
      out.push('<br>');
      return;
    case 'Escape':
      out.push(escapeHtml(slice(text, node).slice(1)));
      return;
    case 'Entity': {
      const entity = slice(text, node);
      out.push(ENTITY.test(entity) ? entity : escapeHtml(entity));
      return;
    }
    case 'Link':
      link(node, text, out);
      return;
    case 'Image':
      out.push(escapeHtml(labelText(node, text)));
      return;
    case 'Autolink':
    case 'URL': {
      const url = node.name === 'URL' ? node : node.getChild('URL');
      const destination = url === null ? slice(text, node) : slice(text, url);
      out.push(`<a title="${escapeHtml(destination)}">${escapeHtml(destination)}</a>`);
      return;
    }
    default:
      // `HTMLTag`, `Comment`, `ProcessingInstruction` and anything not named: their source, escaped.
      if (node.firstChild === null) out.push(escapeHtml(slice(text, node)));
      else inline(node, node.from, node.to, text, out);
  }
}

/** Where a link's or an image's label sits: between its first `[` and the `]` that closes it. */
function labelRange(node: SyntaxNode): { from: number; to: number } {
  const marks = node.getChildren('LinkMark');
  const open = marks[0];
  const close = marks[1];
  if (open === undefined || close === undefined) return { from: node.from, to: node.from };
  return { from: open.to, to: close.from };
}

/** An image's alt text: its label, with the marks of any emphasis in it left out. */
function labelText(node: SyntaxNode, text: string): string {
  const { from, to } = labelRange(node);
  const parts: string[] = [];
  inline(node, from, to, text, parts);
  // The label went through `inline`, so it is HTML now; the alt text is wanted as plain text.
  return parts
    .join('')
    .replace(/<[^>]*>/gu, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

/** `[label](destination)`: the label in an `<a>` with no `href`, the destination as its title. */
function link(node: SyntaxNode, text: string, out: string[]): void {
  const { from, to } = labelRange(node);
  const url = node.getChild('URL') ?? node.getChild('LinkLabel');
  const title = url === null ? '' : ` title="${escapeHtml(slice(text, url))}"`;
  out.push(`<a${title}>`);
  inline(node, from, to, text, out);
  out.push('</a>');
}
