/**
 * Whether a word is a math operator standing on its own, between spaces (ADR 0169).
 *
 * Briefs write math as plain Unicode with spaces around the operators — `Q = U · A · ΔT` — so
 * every operator has a space on each side, and a space is where a line breaks. A line that
 * starts with `· ΔT` reads as a typo. Layout therefore refuses the break *before* such a word
 * and keeps the one after it, which is TeX's convention for an inline formula: a line may end
 * on `=` or `·`, the next one never starts with it.
 *
 * "Operator" is Unicode's Math Symbol category (`Sm`: `= + < > ± × ÷ − ≠ ≤ ≥ → ⇒ ∝ ∈`…) plus
 * the three characters a brief writes as operators that Unicode files elsewhere: the middle dot
 * `·` (a punctuation mark, U+00B7), the hyphen-minus `-` and the en dash `–`, both of which
 * plain text uses for a minus. The em dash is not one: it is prose punctuation.
 *
 * Only a word made *entirely* of those characters counts. `−3` is a signed number and `a+b` an
 * operand; a break before either reads fine. Exported so the template kit can keep the same
 * rule when it inserts a break of its own.
 */
export function isStandaloneOperator(word: string): boolean {
  return OPERATOR_WORD.test(word);
}

const OPERATOR_WORD = /^[\p{Sm}\u00b7\u2013-]+$/u;
