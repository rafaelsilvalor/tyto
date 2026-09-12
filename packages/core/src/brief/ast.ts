import type { SourceRange } from '../source/range.js';

/**
 * The typed shape a brief compiles to (`docs/brief-language.md`, AST section).
 *
 * Everything downstream of the parser reads this and never the Lezer tree: `resolve`
 * checks it against a template manifest, and the compiler turns it into a `Scene`. The
 * tree stays behind because it is a syntax tree — it carries a `Space` node where the
 * language means nothing and splits a word across two tokens where the language means one
 * run of text.
 *
 * Every node carries a `range`, half-open UTF-16 offsets into the brief that produced it,
 * so a diagnostic raised three stages later still points at the character the author
 * wrote.
 *
 * It lives in `core` rather than in `brief-lang` for the same reason `Scene` does: the
 * package that produces a vocabulary type is not the package that owns it. `brief-lang`
 * builds a `BriefAst` and re-exports these types for a caller that only talks to the
 * parser; `resolve` consumes one, and `docs/architecture.md` puts `resolve` in `core`.
 * With `brief-lang` depending on `core`, `core` importing back would be a cycle.
 *
 * Pure: no Node, no DOM (ADR 0010).
 */

/** Plain text. `value` is decoded — `\::` in the source arrives here as `::`. */
export interface Text {
  readonly kind: 'text';
  readonly value: string;
  readonly range: SourceRange;
}

export interface Bold {
  readonly kind: 'bold';
  readonly children: RichText;
  readonly range: SourceRange;
}

export interface Italic {
  readonly kind: 'italic';
  readonly children: RichText;
  readonly range: SourceRange;
}

/** A hard line break: a trailing `\`, or the boundary between two lines of a block body. */
export interface Break {
  readonly kind: 'break';
  readonly range: SourceRange;
}

/** `{key:value}text{/}` — a span the template may style, such as `{cor:laranja}`. */
export interface Mark {
  readonly kind: 'mark';
  readonly key: string;
  readonly value: string;
  readonly children: RichText;
  readonly range: SourceRange;
}

export type Inline = Text | Bold | Italic | Break | Mark;

export type RichText = readonly Inline[];

/** `{destaque}` has no value; `{cor: laranja}` has one. */
export interface Adjustment {
  readonly name: string;
  readonly value?: string;
  readonly range: SourceRange;
}

/**
 * One `::name` line and whatever body follows it.
 *
 * `namespace` is present only for a plugin directive (`::ai/caption`), without the slash
 * the grammar has to keep inside the token. `range` covers the directive but not the line
 * break that ends it, so an editor squiggle stops at the end of the text.
 */
export interface Directive {
  readonly name: string;
  readonly namespace?: string;
  readonly adjustments: readonly Adjustment[];
  readonly body: RichText;
  readonly range: SourceRange;
  /**
   * Just the name, namespace and its slash included: `ai/caption` in `::ai/caption`.
   *
   * A misspelled slot name is a problem with the name, and `range` covers the body too —
   * underlining five lines of indented block because the first word of the first line is
   * wrong tells an author where the directive is, not where the mistake is. `resolve`
   * reports `E_UNKNOWN_SLOT` and `E_UNKNOWN_DIRECTIVE` against this instead.
   *
   * The `::` is left out: it is the only way to write a directive, so it is never the part
   * that is wrong.
   */
  readonly nameRange: SourceRange;
}

/**
 * The YAML block, parsed but not judged.
 *
 * `data` is whatever the YAML said: the parse stage knows the language, not the templates,
 * so `template` being absent or `formats` being a number is `resolve`'s diagnostic to
 * raise. An absent block gives an empty `data` rather than `undefined`, so no caller has
 * to branch on it.
 *
 * `ranges` is what makes those diagnostics pointable. A key's value is a plain `unknown`
 * by the time it reaches `resolve`, and "this slot is not declared" has to underline the
 * key that said so, not the whole block.
 */
export interface Frontmatter {
  readonly data: Readonly<Record<string, unknown>>;
  /** The span of each top-level key, by key. */
  readonly ranges: Readonly<Record<string, SourceRange>>;
  /** The whole block, fences included; absent on a brief that has no frontmatter. */
  readonly range?: SourceRange;
}

export interface BriefAst {
  readonly frontmatter: Frontmatter;
  readonly directives: readonly Directive[];
  readonly range: SourceRange;
}
