import type { Inline, RichText } from '@tyto/core';

/**
 * Words a line must never split: a currency sign and its amount, an amount and its scale word,
 * a number and its percent (TYTO-593).
 *
 * Seen in a gallery preview: a line ended on "R$" and the next began "9,8 mil". Tyto's own
 * layout decides every break before an exporter sees the text, and a break opportunity is a
 * space (U+0020) and only a space (`packages/core/src/text/layout.ts`). So a pair is kept
 * together by writing the space between its halves as a no-break space (U+00A0), which draws
 * and measures as a space and breaks nothing. No exporter has to agree to anything.
 *
 * **A template opts in.** It calls {@link keepTogether} on the brief's words before laying
 * them out; no text helper of the kit does it on its own, so a template that never calls it
 * draws exactly what it drew before a kit update.
 *
 * Every rule keeps the text's length — a space becomes a no-break space and nothing is inserted
 * or removed — which is what lets rich text be glued across its bold and marked spans.
 */

/** The space that draws and measures as one and is never a line break. */
export const NO_BREAK_SPACE = ' ';

/**
 * Two things a line may not split: the spaces between text that ends matching `before` and
 * text that starts matching `after` become no-break spaces.
 *
 * Both are regular-expression sources, strings and not `RegExp`s, so a rule can arrive as data
 * — from a house's configuration as well as from code. They are compiled with the `u` flag;
 * `before` is matched backwards from the space, so it may be as long as it needs.
 */
export interface KeepTogetherRule {
  /** What the rule is for, as a person reads it: `currency sign + amount`. */
  readonly name: string;
  readonly before: string;
  readonly after: string;
}

/** A number as Brazil writes it: digits, with the thousands dots and the decimal comma. */
const NUMBER = String.raw`\d[\d.,]*`;

/**
 * The units of measure a number keeps on its line (TYTO-620): a closed list, because a unit is
 * one or two letters and an open pattern would glue every short word after a number. SI units
 * and their common multiples, as exam questions and engineering slides write them. A unit
 * followed by more letters is a word (`3 salas`, `2 metros`), and keeps its break; one followed
 * by `/` or a superscript (`m/s²`) is still the unit.
 */
const UNITS = [
  's',
  'ms',
  'min',
  'h',
  'm',
  'km',
  'cm',
  'mm',
  'kg',
  'g',
  'mg',
  'N',
  'kN',
  'J',
  'kJ',
  'W',
  'kW',
  'kWh',
  'V',
  'mV',
  'A',
  'mA',
  'Hz',
  'kHz',
  'MHz',
  'Pa',
  'kPa',
  'MPa',
  'K',
  '°C',
  'L',
  'mL',
  'rad',
  'mol',
  'Ω',
] as const;

/**
 * The default pairs. The money ones are the same as the house's table glues
 * (`@tyto/house-style`'s `glue`), so the two never disagree on where a price may break.
 *
 * A scale word stays a word: `9 milhas` is not `9 mil` and keeps its break.
 */
export const KEEP_TOGETHER_RULES: readonly KeepTogetherRule[] = [
  { name: 'currency sign + amount', before: String.raw`(?:R\$|US\$|€)`, after: String.raw`\d` },
  {
    name: 'amount + scale word',
    before: NUMBER,
    after: String.raw`(?:mil|milhão|milhões|bi|bilhão|bilhões)(?!\p{L})`,
  },
  { name: 'number + percent', before: NUMBER, after: '%' },
  {
    name: 'number + unit',
    before: String.raw`[\d⁰¹²³⁴⁵⁶⁷⁸⁹]`,
    after: String.raw`(?:${UNITS.join('|')})(?!\p{L})`,
  },
];

/**
 * The text with every space a rule protects written as a no-break space.
 *
 * The rules are the caller's: the defaults, or the defaults and a house's own —
 * `[...KEEP_TOGETHER_RULES, { name: 'number + unit', before: '\\d', after: 'km\\b' }]`.
 */
export function keepTogetherText(
  text: string,
  rules: readonly KeepTogetherRule[] = KEEP_TOGETHER_RULES,
): string {
  return rules.reduce(
    (glued, rule) =>
      glued.replace(new RegExp(`(?<=${rule.before})( +)(?=${rule.after})`, 'gu'), (spaces) =>
        NO_BREAK_SPACE.repeat(spaces.length),
      ),
    text,
  );
}

/**
 * The brief's rich text with every space a rule protects written as a no-break space, its
 * bold, italic and marked spans kept.
 *
 * A pair may straddle two spans — `**R$** 9,8` — so the rules read the whole text at once and
 * each span takes back its own characters. A line break ends a pair: nothing is glued across it.
 */
export function keepTogether(
  value: RichText,
  rules: readonly KeepTogetherRule[] = KEEP_TOGETHER_RULES,
): RichText {
  const glued = keepTogetherText(flatten(value), rules);
  let offset = 0;
  const rewrite = (inlines: RichText): Inline[] =>
    inlines.map((inline): Inline => {
      switch (inline.kind) {
        case 'text': {
          const start = offset;
          offset += inline.value.length;
          return { ...inline, value: glued.slice(start, offset) };
        }
        case 'break':
          offset += 1;
          return inline;
        default:
          return { ...inline, children: rewrite(inline.children) };
      }
    });
  return rewrite(value);
}

/** The text's characters in order, a break read as a newline, which no rule's space matches. */
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
