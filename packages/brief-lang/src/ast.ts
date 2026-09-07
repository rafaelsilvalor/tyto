import type { SourceRange } from '@tyto/core';

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
 * wrote. Pure: no Node, no DOM (ADR 0010).
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
}

/**
 * `frontmatter` is whatever the YAML block parsed to, unvalidated: this stage knows the
 * language, not the templates, and `template` or `formats` being absent or the wrong type
 * is `resolve`'s diagnostic to raise (E3.3). An absent block gives an empty object rather
 * than `undefined`, so no caller has to branch on it.
 */
export interface BriefAst {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly directives: readonly Directive[];
  readonly range: SourceRange;
}
