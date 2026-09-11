import type { SourceRange } from '@tyto/core';

import type { Selector, StyleDeclaration, StyleItem, StyleRule, ValueToken } from './ast.js';
import type { Report } from './values.js';
import { isCustomProperty, isProperty, markupProblem, unsupportedProperty } from './vocabulary.js';

/**
 * The cascade, such as it is.
 *
 * There is no specificity. Declarations apply in the order they are written and the last
 * one to set a property wins, conditional blocks included — which is why `@format story`
 * goes after the base rules in every example in `docs/template-authoring.md`. Specificity
 * exists in CSS because a stylesheet is written against a document nobody controls; a
 * template author writes both halves, and a rule that only fires when three selectors line
 * up is a rule they cannot debug from the markup.
 *
 * A guard is the other half. `@format`, `@if` and `@each` are conditions on a whole block,
 * decided once per (artwork, format) rather than per element, so they are read into a
 * `Guard` when the template is compiled and evaluated when it is built.
 */

export type Guard =
  | { readonly kind: 'always' }
  | { readonly kind: 'format'; readonly format: string }
  | { readonly kind: 'empty'; readonly slot: string }
  | { readonly kind: 'value'; readonly slot: string; readonly value: string }
  | { readonly kind: 'each'; readonly slot: string };

export interface RuleEntry {
  readonly guard: Guard;
  readonly rule: StyleRule;
}

/** What the guards are asked about, once per (artwork, format). */
export interface Conditions {
  readonly format: string;
  /**
   * The flag adjustments of this artwork, as classes — `{destaque}` is `destaque` here.
   * They are ambient: every element of the artwork carries them, which is why a rule that
   * wants one usually writes it beside the element's own class (`.title.destaque`).
   */
  readonly classes: ReadonlySet<string>;
  /**
   * The value of every enum in play, by name, with an adjustment on this artwork winning
   * over the slot of the same name. This is what `@if slot(cor) is laranja` reads, and
   * what `--slot-cor` holds.
   */
  readonly values: ReadonlyMap<string, string>;
  /** The slots the brief set no value for — what `@if slot(x) is empty` reads. */
  readonly emptySlots: ReadonlySet<string>;
  /** The repeatable slot this artwork came from, when it came from one. */
  readonly repeatable: string | undefined;
}

/** The element a selector is matched against; `build.ts` fills it in as it walks. */
export interface StyleTarget {
  readonly tag: string;
  readonly id: string | undefined;
  readonly classes: readonly string[];
}

export interface StylesheetOptions {
  readonly formats: readonly string[];
  readonly slots: readonly string[];
  /** The manifest's repeatable slot, when it declares one. */
  readonly repeatable: string | undefined;
  readonly report: Report;
}

const AT_KEYWORDS = ['format', 'if', 'each'];

function preludeText(tokens: readonly ValueToken[]): string {
  return tokens
    .map((token) =>
      token.kind === 'call' ? `${token.name}(…)` : ((token as { text?: string }).text ?? ''),
    )
    .join(' ')
    .trim();
}

/**
 * `@if slot(imagem) is empty` and `@if slot(cor) is laranja`.
 *
 * One rule with two readings of `is`, because a stylesheet needs both and the second is
 * the only way an enum reaches a value: `--slot-cor` holds the word `laranja`, and no
 * amount of `var()` turns a word into `#ff5900`. The template's vocabulary is the
 * template's to define, and this is where it defines it.
 */
function ifGuard(
  prelude: readonly ValueToken[],
  range: SourceRange,
  options: StylesheetOptions,
): Guard | undefined {
  const [call, is, value, ...extra] = prelude;

  if (
    call?.kind !== 'call' ||
    call.name !== 'slot' ||
    call.args.length !== 1 ||
    is?.kind !== 'ident' ||
    is.text !== 'is' ||
    value?.kind !== 'ident' ||
    extra.length > 0
  ) {
    options.report(
      markupProblem(
        "@if reads as '@if slot(<name>) is empty' or '@if slot(<name>) is <value>'",
        range,
      ),
    );
    return undefined;
  }

  const slot = call.args[0];
  if (slot?.kind !== 'ident' || !options.slots.includes(slot.text)) {
    options.report(
      markupProblem(
        `@if names slot '${slot?.kind === 'ident' ? slot.text : preludeText(call.args)}', which the manifest does not declare; it declares ${options.slots.join(', ')}`,
        slot?.range ?? range,
      ),
    );
    return undefined;
  }

  return value.text === 'empty'
    ? { kind: 'empty', slot: slot.text }
    : { kind: 'value', slot: slot.text, value: value.text };
}

/**
 * `@each <slot>` is a scope, not a loop.
 *
 * `compile` already calls a template once per (artwork, format) with the repeatable slot
 * resolved to this artwork's occurrence, so there is nothing left here to iterate over.
 * What the block means is "while rendering an artwork that this slot produced" — true for
 * every artwork of a brief that filled the slot, and false for the single artwork a
 * manifest with no repeatable slot produces.
 */
function eachGuard(
  prelude: readonly ValueToken[],
  range: SourceRange,
  options: StylesheetOptions,
): Guard | undefined {
  const only = prelude.length === 1 ? prelude[0] : undefined;
  if (only?.kind !== 'ident') {
    options.report(markupProblem("@each reads as '@each <repeatable slot>'", range));
    return undefined;
  }
  if (options.repeatable === undefined) {
    options.report(
      markupProblem(
        `@each names '${only.text}', and the manifest declares no repeatable slot`,
        only.range,
      ),
    );
    return undefined;
  }
  if (only.text !== options.repeatable) {
    options.report(
      markupProblem(
        `@each names '${only.text}'; the manifest's repeatable slot is '${options.repeatable}'`,
        only.range,
      ),
    );
    return undefined;
  }
  return { kind: 'each', slot: only.text };
}

function formatGuard(
  prelude: readonly ValueToken[],
  range: SourceRange,
  options: StylesheetOptions,
): Guard | undefined {
  const only = prelude.length === 1 ? prelude[0] : undefined;
  if (only?.kind !== 'ident') {
    options.report(markupProblem("@format reads as '@format <format id>'", range));
    return undefined;
  }
  if (!options.formats.includes(only.text)) {
    options.report(
      markupProblem(
        `@format names '${only.text}', which the manifest does not render; it renders ${options.formats.join(', ')}`,
        only.range,
      ),
    );
    return undefined;
  }
  return { kind: 'format', format: only.text };
}

/** `:root` and nothing else — the variable scope, which is not an element. */
function isRootRule(rule: StyleRule): boolean {
  return rule.selectors.every(
    (selector) => selector.parts.length === 1 && selector.parts[0]?.kind === 'root',
  );
}

/**
 * Every property is either one of the accepted set or a custom property, and a custom
 * property only means something in `:root`.
 *
 * The second half is what keeps variables from becoming a second cascade. One document
 * scope resolved once per (artwork, format) is a thing an author can hold in their head;
 * a variable whose value depends on which element is asking is not, and the IR has no
 * inheritance to hang it off anyway.
 */
function checkDeclarations(rule: StyleRule, report: Report): void {
  const root = isRootRule(rule);

  for (const declaration of rule.declarations) {
    if (isCustomProperty(declaration.property)) {
      if (!root) {
        report(
          markupProblem(
            `custom property '${declaration.property}' is only read inside ':root'`,
            declaration.propertyRange,
          ),
        );
      }
      continue;
    }
    if (root) {
      report(
        markupProblem(
          `':root' only sets custom properties, and '${declaration.property}' is not one`,
          declaration.propertyRange,
        ),
      );
      continue;
    }
    if (!isProperty(declaration.property)) {
      report(unsupportedProperty(declaration.property, declaration.propertyRange));
    }
  }
}

/**
 * The stylesheet as a flat, guarded list in source order.
 *
 * Flattening is what makes the cascade one loop instead of two: a rule inside `@format
 * story` and a rule beside it differ only in a guard, so nothing downstream has to know
 * that at-rules exist.
 */
export function compileStylesheet(
  styles: readonly StyleItem[],
  options: StylesheetOptions,
): RuleEntry[] {
  const entries: RuleEntry[] = [];

  for (const item of styles) {
    if (item.kind === 'rule') {
      checkDeclarations(item.rule, options.report);
      entries.push({ guard: { kind: 'always' }, rule: item.rule });
      continue;
    }

    const { at } = item;
    if (!AT_KEYWORDS.includes(at.keyword)) {
      options.report(
        markupProblem(
          `'@${at.keyword}' is not an at-rule of the template language; it has @format, @if and @each`,
          at.keywordRange,
        ),
      );
      continue;
    }

    let guard: Guard | undefined;
    if (at.keyword === 'format') guard = formatGuard(at.prelude, at.preludeRange, options);
    else if (at.keyword === 'if') guard = ifGuard(at.prelude, at.preludeRange, options);
    else guard = eachGuard(at.prelude, at.preludeRange, options);

    // The block is still read when the prelude was refused: an author fixing one at-rule
    // should not have the properties inside it reported to them on the next run instead.
    for (const rule of at.rules) {
      checkDeclarations(rule, options.report);
      if (guard !== undefined) entries.push({ guard, rule });
    }
  }

  return entries;
}

export function guardHolds(guard: Guard, conditions: Conditions): boolean {
  switch (guard.kind) {
    case 'always':
      return true;
    case 'format':
      return guard.format === conditions.format;
    case 'empty':
      return conditions.emptySlots.has(guard.slot);
    case 'value':
      return conditions.values.get(guard.slot) === guard.value;
    case 'each':
      return conditions.repeatable === guard.slot;
  }
}

export function activeRules(entries: readonly RuleEntry[], conditions: Conditions): StyleRule[] {
  return entries.filter((entry) => guardHolds(entry.guard, conditions)).map((entry) => entry.rule);
}

const VARIABLE_DEPTH = 8;

/**
 * The document's variables, in source order, `:root` blocks only.
 *
 * `--slot-<name>` is seeded from the enums in play before the stylesheet runs, so a
 * template reads `var(--slot-cor)` without declaring it — and can still override it in a
 * `:root` of its own, because the seed goes in first.
 */
export function variablesOf(
  entries: readonly RuleEntry[],
  conditions: Conditions,
): Map<string, readonly ValueToken[]> {
  const variables = new Map<string, readonly ValueToken[]>();

  for (const [name, value] of conditions.values) {
    variables.set(`--slot-${name}`, [{ kind: 'ident', text: value, range: { start: 0, end: 0 } }]);
  }

  for (const rule of activeRules(entries, conditions)) {
    if (!isRootRule(rule)) continue;
    for (const declaration of rule.declarations) {
      if (!isCustomProperty(declaration.property)) continue;
      variables.set(declaration.property, resolveVariables(declaration.value, variables, 0));
    }
  }

  return variables;
}

/**
 * `var(--x)` replaced by what `--x` holds, or by its fallback, or by nothing.
 *
 * An unknown variable disappears rather than reporting: which variables exist depends on
 * which `:root` blocks the conditions turned on, so `var(--brand)` being empty in the story
 * format is a template's own business. What it leaves behind is a value the property's
 * reader then refuses, with the range of the declaration that wrote it.
 */
export function resolveVariables(
  tokens: readonly ValueToken[],
  variables: ReadonlyMap<string, readonly ValueToken[]>,
  depth = 0,
): ValueToken[] {
  if (depth > VARIABLE_DEPTH) return [];

  const resolved: ValueToken[] = [];
  for (const token of tokens) {
    if (token.kind !== 'call') {
      resolved.push(token);
      continue;
    }
    if (token.name !== 'var') {
      resolved.push({ ...token, args: resolveVariables(token.args, variables, depth + 1) });
      continue;
    }

    const [name, , ...fallback] = token.args;
    const value = name?.kind === 'ident' ? variables.get(name.text) : undefined;
    const chosen = value ?? fallback;
    // The range of the call, not of the definition: a bad value has to underline the place
    // the author can edit, and that is where the `var()` was written.
    for (const item of resolveVariables(chosen, variables, depth + 1)) {
      resolved.push({ ...item, range: token.range });
    }
  }

  return resolved;
}

function selectorMatches(selector: Selector, target: StyleTarget, conditions: Conditions): boolean {
  if (selector.parts.length === 0) return false;

  return selector.parts.every((part) => {
    switch (part.kind) {
      case 'root':
        return false;
      case 'tag':
        return part.name === target.tag;
      case 'id':
        return part.name === target.id;
      case 'class':
        return target.classes.includes(part.name) || conditions.classes.has(part.name);
    }
  });
}

/** The declarations that reach one element, flattened by property with the last one kept. */
export function computeStyle(
  entries: readonly RuleEntry[],
  conditions: Conditions,
  target: StyleTarget,
): Map<string, StyleDeclaration> {
  const computed = new Map<string, StyleDeclaration>();

  for (const rule of activeRules(entries, conditions)) {
    if (!rule.selectors.some((selector) => selectorMatches(selector, target, conditions))) continue;
    for (const declaration of rule.declarations) {
      if (isCustomProperty(declaration.property)) continue;
      computed.set(declaration.property, declaration);
    }
  }

  return computed;
}

/**
 * The declarations of one bare class, for a mark in the brief's rich text.
 *
 * `{cor:laranja}` around a word is the brief naming something in the template's
 * vocabulary, and `.cor-laranja` is where the template says what that is. It is looked up
 * as a class on nothing rather than through `computeStyle`, because a mark is a span
 * inside a text node and not an element of its own.
 */
export function classStyle(
  entries: readonly RuleEntry[],
  conditions: Conditions,
  className: string,
): Map<string, StyleDeclaration> {
  return computeStyle(entries, conditions, { tag: '', id: undefined, classes: [className] });
}

/** `--slot-cor` is the seeded variable for the slot `cor`; nothing else wears the prefix. */
const SLOT_VARIABLE = '--slot-';

/** Every `var(--slot-x)` in a value, however deeply a call nests it. */
function slotVariablesIn(tokens: readonly ValueToken[], into: Set<string>): void {
  for (const token of tokens) {
    if (token.kind !== 'call') continue;
    if (token.name === 'var') {
      const [name] = token.args;
      if (name?.kind === 'ident' && name.text.startsWith(SLOT_VARIABLE)) {
        into.add(name.text.slice(SLOT_VARIABLE.length));
      }
    }
    // Walked either way: a `var()` can sit inside a gradient, and a `var()`'s own fallback
    // can be another `var()`.
    slotVariablesIn(token.args, into);
  }
}

/**
 * Every slot the stylesheet reads.
 *
 * The counterpart of `slotsDrawnBy` in `compile-template.ts`, which sees only the markup.
 * A stylesheet reaches a slot in two ways, and both change what comes out: a guard
 * (`@if slot(cor) is laranja`, `@if slot(imagem) is empty`, `@each slide`) decides whether
 * a block applies, and `var(--slot-cor)` splices the word itself into a value. Neither
 * draws the slot, and both mean a brief that sets it changed the artwork — which is the
 * only question `W_UNUSED_SLOT` is asking.
 *
 * Read from the compiled `entries` rather than from the at-rules, so the answer is about
 * what reaches the cascade. `@if slot(cor) is laranja { }` with nothing inside contributes
 * no entry and no slot, and it should not: an empty block changes no output, so the slot
 * in its prelude really is used by nothing.
 */
export function referencedSlots(
  entries: readonly RuleEntry[],
  slots: readonly string[],
): Set<string> {
  const found = new Set<string>();

  for (const entry of entries) {
    const { guard } = entry;
    // `format` names a format and `always` names nothing. The other three carry a slot the
    // guard builders have already checked against the manifest.
    if (guard.kind === 'empty' || guard.kind === 'value' || guard.kind === 'each') {
      found.add(guard.slot);
    }
    for (const declaration of entry.rule.declarations) {
      slotVariablesIn(declaration.value, found);
    }
  }

  // A `--slot-` prefix a template invented for itself is a custom property like any other,
  // not a reference to a slot that does not exist.
  return new Set([...found].filter((name) => slots.includes(name)));
}

/** Every id a rule targets, so a template can be told about `#grad` matching nothing. */
export function referencedIds(entries: readonly RuleEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const selector of entry.rule.selectors) {
      for (const part of selector.parts) if (part.kind === 'id') ids.add(part.name);
    }
  }
  return ids;
}
