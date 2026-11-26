import { richTextOfPlain } from './highlight.js';
import { lines, plain } from './rows.js';

import type { RichText, TemplateContext } from '@tyto/core';

/**
 * A slot read as what a piece takes in (TYTO-793): the typed inputs of ADR 0224 decision 4, so
 * a template asks for "the slot's words, or this fallback" in one call. Moved from the template
 * repositories that each kept a copy: `slotText` in three, `slideRichLines` in four, `richTextOf`
 * in two, `slotRichLines` in one.
 */

/** A rich-text slot's words as written, or nothing when the brief left it unset. */
export function richTextOf(context: TemplateContext, name: string): RichText | undefined {
  const value = context.slots[name]?.value;
  return value?.kind === 'rich-text' ? value.text : undefined;
}

/** A slot's words as plain text, trimmed; `fallback` when the slot is unset or empty. */
export function slotText(context: TemplateContext, name: string, fallback: string): string {
  const words = plain(richTextOf(context, name) ?? []).trim();
  return words === '' ? fallback : words;
}

/** A slot's lines, the empty ones left out: a slide's (`lamina`) unless another slot is named. */
export function slideRichLines(context: TemplateContext, name = 'lamina'): RichText[] {
  const written = richTextOf(context, name);
  if (written === undefined) return [];
  return lines(written).filter((line) => plain(line).trim() !== '');
}

/**
 * A slot's lines, each trimmed at both ends and the empty ones left out; the `fallback`'s one
 * line when none is left, unless the fallback is empty. A slot written as flat text (no marks)
 * is read again for `**…**`, so a value typed in a form takes bold as a brief does.
 */
export function slotRichLines(
  context: TemplateContext,
  name: string,
  fallback: string,
): RichText[] {
  const written = richTextOf(context, name) ?? [];
  const flat = written.every((inline) => inline.kind === 'text' || inline.kind === 'break');
  const rich = flat ? richTextOfPlain(plain(written)) : written;
  const kept = lines(rich)
    .map(trimmed)
    .filter((line) => plain(line) !== '');
  return kept.length > 0 || fallback === '' ? kept : [richTextOfPlain(fallback)];
}

/** A line with its leading and trailing spaces cut, a text the cut empties dropped. */
export function trimmed(line: RichText): RichText {
  const edge = (inlines: RichText, side: 'start' | 'end'): RichText => {
    const index = side === 'start' ? 0 : inlines.length - 1;
    const inline = inlines[index];
    if (inline === undefined || inline.kind === 'break') return inlines;
    const replaced =
      inline.kind === 'text'
        ? { ...inline, value: side === 'start' ? inline.value.trimStart() : inline.value.trimEnd() }
        : { ...inline, children: edge(inline.children, side) };
    const copy = [...inlines];
    // A text the trim emptied goes, so no empty run is drawn at the line's edge.
    if (replaced.kind === 'text' && replaced.value === '') copy.splice(index, 1);
    else copy[index] = replaced;
    return copy;
  };
  return edge(edge(line, 'start'), 'end');
}
