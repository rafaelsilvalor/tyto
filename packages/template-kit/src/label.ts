import type { Inline, RichText } from '@tyto/core';

/**
 * A line's label: what comes before its first `:` — `Banca: Quintex` is the label `Banca:` and
 * the text ` Quintex` (TYTO-594).
 *
 * The house convention, in every template (the maintainer, 2026-11-03). Before this, one
 * template split `Label: value` by hand and another took its `**bold**` words as the label, so
 * the same line drew a label in one and none in the other. `**…**` stays what it is everywhere,
 * the highlight for something out of the ordinary: written around a label, `**Label:** text`,
 * it still gives the label `Label:`.
 *
 * **This finds the label; it never styles it.** The template paints the two halves with its own
 * declared values — the kit decides no weight and no colour.
 *
 * The text after the separator is returned exactly as written, its leading space included,
 * because a template that draws `label` and `text` as two runs of one line needs that space to
 * draw the line it drew before. A caller that wants it gone trims it.
 */

/**
 * Text in which a separator does not count: the colon of a time, the one after a URL's scheme.
 *
 * `pattern` is a regular-expression source, a string and not a `RegExp`, so an exception can
 * arrive as data — from a house's configuration as well as from code, as `KeepTogetherRule`
 * does. It is compiled with the `u` flag.
 */
export interface LabelException {
  /** What the exception is for, as a person reads it: `a time`. */
  readonly name: string;
  readonly pattern: string;
}

/** What {@link labelOf} and {@link labelOfText} take, every field optional. */
export interface LabelOptions {
  /** What ends a label. `:` by default. */
  readonly separator?: string;
  /** Whether the separator is drawn with the label (`Banca:`) or with nothing. Yes by default. */
  readonly keepSeparator?: boolean;
  /**
   * The longest label accepted, in characters, its surrounding spaces not counted: a separator
   * further in is a colon in a sentence, and the line has no label. {@link LONGEST_LABEL} by
   * default; `Infinity` accepts any length.
   */
  readonly longestLabel?: number;
  /** Where a separator does not count. {@link LABEL_EXCEPTIONS} by default; `[]` for none. */
  readonly notLabels?: readonly LabelException[];
}

/** A line read as a label and its text; `label` is `undefined` when the line has none. */
export interface Labelled<T> {
  readonly label: T | undefined;
  readonly text: T;
}

/** A label is a few words; 40 characters is twice a long one, and short of a sentence. */
export const LONGEST_LABEL = 40;

/** The separators that are not one by default: a time's colon, and a URL scheme's. */
export const LABEL_EXCEPTIONS: readonly LabelException[] = [
  { name: 'a time', pattern: String.raw`\d{1,2}:\d{2}` },
  { name: 'a URL', pattern: String.raw`\p{L}[\p{L}\d+.-]*://\S*` },
];

/**
 * Where the label of `line` ends — the offset of its first separator that counts — or nothing.
 *
 * A separator counts unless an exception's match covers it; the first one that counts is the
 * label's end, and a later one is never tried in its place: a label longer than the limit, or
 * blank, or one that crosses a line break means the line has no label.
 */
function separatorAt(line: string, options: LabelOptions): number | undefined {
  const separator = options.separator ?? ':';
  if (separator === '') return undefined;

  const covered = (options.notLabels ?? LABEL_EXCEPTIONS).flatMap((exception) =>
    [...line.matchAll(new RegExp(exception.pattern, 'gu'))].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    })),
  );

  let at = line.indexOf(separator);
  while (at >= 0 && covered.some((span) => span.start <= at && at < span.end)) {
    at = line.indexOf(separator, at + 1);
  }
  if (at < 0) return undefined;

  const label = line.slice(0, at);
  if (label.includes('\n') || label.trim() === '') return undefined;
  if ([...label.trim()].length > (options.longestLabel ?? LONGEST_LABEL)) return undefined;
  return at;
}

/** A plain line as a label and its text. */
export function labelOfText(line: string, options: LabelOptions = {}): Labelled<string> {
  const at = separatorAt(line, options);
  if (at === undefined) return { label: undefined, text: line };

  const end = at + (options.separator ?? ':').length;
  return {
    label: line.slice(0, options.keepSeparator === false ? at : end),
    text: line.slice(end),
  };
}

/**
 * A line of the brief's rich text as a label and its text, its bold, italic and marked spans
 * kept on both sides.
 *
 * The separator is looked for in the line's characters, whatever span they sit in, so
 * `**Label:** text` and `Label: text` give the same label. A span the separator falls inside is
 * cut in two, each half keeping its kind: `**Note: due** today` is the label `**Note:**` and
 * the text `**due** today`, the same as the plain line `Note: due today` — the first separator
 * is the label's end, emphasis or not.
 */
export function labelOf(line: RichText, options: LabelOptions = {}): Labelled<RichText> {
  const at = separatorAt(flatten(line), options);
  if (at === undefined) return { label: undefined, text: line };

  const end = at + (options.separator ?? ':').length;
  return {
    label: cut(line, 0, options.keepSeparator === false ? at : end),
    text: cut(line, end, Infinity),
  };
}

/** The characters from `start` up to `end` of `value`, every span that holds some of them kept. */
function cut(value: RichText, start: number, end: number): RichText {
  let offset = 0;
  const within = (inlines: RichText): Inline[] =>
    inlines.flatMap((inline): Inline[] => {
      switch (inline.kind) {
        case 'text': {
          const from = offset;
          offset += inline.value.length;
          const kept = inline.value.slice(Math.max(start - from, 0), Math.max(end - from, 0));
          if (kept === '') return [];
          const shift = Math.max(start - from, 0);
          const rangeStart = Math.min(inline.range.start + shift, inline.range.end);
          return [
            {
              ...inline,
              value: kept,
              range: {
                start: rangeStart,
                end: Math.min(rangeStart + kept.length, inline.range.end),
              },
            },
          ];
        }
        case 'break': {
          const from = offset;
          offset += 1;
          return start <= from && from < end ? [inline] : [];
        }
        default: {
          const children = within(inline.children);
          return children.length === 0 ? [] : [{ ...inline, children }];
        }
      }
    });
  return within(value);
}

/** The line's characters in order, a break read as a newline. */
function flatten(value: RichText): string {
  return value
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
          return inline.value;
        case 'break':
          return '\n';
        default:
          return flatten(inline.children);
      }
    })
    .join('');
}
